const test = require('node:test');
const assert = require('node:assert/strict');
const { createReservationService } = require('../reservations-server');

const MONDAY = '2026-11-30';
const CLASS = '09:40';
const commonClasses = [
  ['09:40', '10:30'], ['11:50', '12:40'], ['17:30', '18:20'], ['18:30', '19:20'],
  ['19:30', '20:20'], ['20:30', '21:30'], ['21:30', '22:20'],
];

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function box() {
  const users = Array.from({length: 22}, (_, i) => ({
    id: 'u' + (i + 1), username: 'account' + (i + 1), name: '회원 ' + (i + 1),
    isAdmin: false, passwordHash: 'private-hash',
  }));
  // Existing box data, with one existing Zonda member and no reservation records.
  return {
    users: [...users, {id: 'admin', name: '관리자', isAdmin: true}],
    members: [{id: 'u1', teamId: 't1'}],
    personal: {u1: {records: {}}},
  };
}

function fixture(initialStore = box(), persist = () => {}) {
  let store = initialStore;
  let now = '2026-11-29T15:05:00Z'; // Monday 00:05 in Korea
  const service = createReservationService({
    ApiError, getStore: () => store, now: () => new Date(now),
    async commit(next) { await persist(next); store = next; },
  });
  async function request(method, user, url, body) {
    const session = {user: typeof user === 'string' ? store.users.find(u => u.id === user) : user};
    let response;
    const matched = await service.handle(
      {method}, {}, session, new URL(url, 'http://localhost'), async () => body,
      (_, status, data) => { assert.equal(status, 200); response = data; },
    );
    assert.equal(matched, true);
    return response;
  }
  return {
    get store() { return store; },
    setTime(value) { now = value; },
    day(user = 'u1', date = MONDAY) {
      return request('GET', user, date ? '/api/reservations?date=' + date : '/api/reservations');
    },
    change(user, action = 'reserve', startTime = CLASS, date = MONDAY) {
      return request('POST', user, '/api/reservations', {action, date, startTime});
    },
  };
}

const classAt = (day, startTime = CLASS) => day.classes.find(slot => slot.startTime === startTime);
const clientError = error => error instanceof ApiError && error.status >= 400 && error.status < 500;

test('weekly schedule and today follow the Korean calendar', async () => {
  const f = fixture();
  const current = await f.day('u1', null);
  assert.equal(current.today, MONDAY);
  assert.equal(current.date, MONDAY);
  for (const [date, early] of [
    [MONDAY, true], ['2026-12-01', false], ['2026-12-02', true],
    ['2026-12-03', false], ['2026-12-04', true],
  ]) {
    const day = await f.day('u1', date);
    assert.deepEqual(day.classes.map(slot => [slot.startTime, slot.endTime]),
      early ? [['06:30', '07:20'], ...commonClasses] : commonClasses);
    assert.ok(day.classes.every(slot => slot.capacity === 18 && slot.waitlistCapacity === 2));
  }
  assert.deepEqual((await f.day('u1', '2026-12-05')).classes, []);
  assert.deepEqual((await f.day('u1', '2026-12-06')).classes, []);
});

test('all Monday classes open together at Sunday midnight in Korea', async () => {
  const f = fixture();
  f.setTime('2026-11-28T14:59:59.999Z');
  const before = await f.day();
  assert.equal(before.opensAt, '2026-11-29T00:00:00+09:00');
  assert.equal(before.notOpenYet, true);
  assert.ok(before.classes.every(slot => slot.notOpenYet && !slot.closed));
  await assert.rejects(f.change('u1'), clientError);
  f.setTime('2026-11-28T15:00:00.000Z');
  const open = await f.change('u1');
  assert.equal(open.today, '2026-11-29');
  assert.equal(open.notOpenYet, false);
  assert.ok(open.classes.every(slot => !slot.notOpenYet && !slot.closed));
  assert.equal(open.myClassStartTime, CLASS);
  await assert.rejects(f.change('u2', 'reserve', CLASS, '2026-12-01'), clientError);
});

test('class start closes the slot and invalid schedule entries cannot be booked', async () => {
  const f = fixture();
  f.setTime('2026-11-30T00:39:59Z');
  assert.equal(classAt(await f.change('u1')).closed, false);
  f.setTime('2026-11-30T00:40:00Z');
  assert.equal(classAt(await f.day()).closed, true);
  await assert.rejects(f.change('u2'), clientError);
  await assert.rejects(f.change('u1', 'cancel'), clientError);
  await assert.rejects(f.change('u1', 'reserve', '18:30'), clientError);
  f.setTime('2026-11-30T02:00:00Z'); // 11:00, after the 09:40 class ended
  await assert.rejects(f.change('u1', 'reserve', '18:30'), clientError);
  await assert.rejects(f.change('u2', 'reserve', '06:30', '2026-12-01'), clientError);
  await assert.rejects(f.change('u2', 'reserve', CLASS, '2026-12-05'), clientError);
  await assert.rejects(f.change('u2', 'reserve', '12:40', '2026-12-01'), clientError);
  await assert.rejects(f.day('u1', '2026-11-31'), clientError);
  assert.equal(classAt(await f.day()).confirmedCount, 1);
});

test('18 confirmed, two waiting, FIFO promotion and retry-safe actions', async () => {
  const f = fixture();
  for (let number = 1; number <= 18; number++) {
    const slot = classAt(await f.change('u' + number));
    assert.equal(slot.confirmedCount, number);
    assert.equal(slot.myStatus, 'confirmed');
  }
  assert.equal(classAt(await f.change('u1')).confirmedCount, 18);
  for (let position = 1; position <= 2; position++) {
    const slot = classAt(await f.change('u' + (18 + position)));
    assert.equal(slot.confirmedCount, 18);
    assert.equal(slot.myStatus, 'waiting');
    assert.equal(slot.myWaitlistPosition, position);
  }
  await assert.rejects(f.change('u21'), clientError);
  assert.equal(classAt(await f.change('u20')).myWaitlistPosition, 2);
  assert.equal((await f.day('u20')).myClassStartTime, CLASS);
  await assert.rejects(f.change('u20', 'reserve', '18:30'), clientError);
  assert.equal(classAt(await f.change('u8', 'cancel')).myStatus, null);
  assert.equal(classAt(await f.day('u19')).myStatus, 'confirmed');
  assert.equal(classAt(await f.day('u20')).myWaitlistPosition, 1);
  const repeated = classAt(await f.change('u8', 'cancel'));
  assert.equal(repeated.confirmedCount, 18);
  assert.equal(repeated.waitlistCount, 1);
  assert.equal(classAt(await f.change('u21')).myWaitlistPosition, 2);
  await f.change('u20', 'cancel');
  assert.equal(classAt(await f.day('u21')).myWaitlistPosition, 1);
  assert.equal((await f.change('u20', 'reserve', '18:30')).myClassStartTime, '18:30');
});

test('a member can move classes by cancelling before class start', async () => {
  const f = fixture();
  assert.equal((await f.day()).myClassStartTime, null);
  assert.equal((await f.change('u1')).myClassStartTime, CLASS);
  await assert.rejects(f.change('u1', 'reserve', '18:30'), clientError);
  const cancelled = await f.change('u1', 'cancel');
  assert.equal(cancelled.myClassStartTime, null);
  const changed = await f.change('u1', 'reserve', '18:30');
  assert.equal(changed.myClassStartTime, '18:30');
  assert.equal(classAt(changed, '18:30').myStatus, 'confirmed');
  assert.equal(classAt(changed).confirmedCount, 0);
});

test('bookings are independent of Zonda and other dates; only admins see names', async () => {
  const f = fixture();
  await f.change('u1');
  await f.change('u2');
  await f.change('u2', 'reserve', CLASS, '2026-12-01');
  assert.deepEqual(f.store.members, [{id: 'u1', teamId: 't1'}]);
  const restarted = fixture(structuredClone(f.store));
  const slot = classAt(await restarted.day('u2'));
  assert.equal(slot.myStatus, 'confirmed');
  assert.equal(slot.confirmedCount, 2);
  assert.ok(!('confirmed' in slot) && !('waiting' in slot));
  assert.doesNotMatch(JSON.stringify(slot), /회원 1|private-hash/);
  const admin = classAt(await restarted.day('admin'));
  assert.deepEqual(admin.confirmed, [{id: 'u1', name: '회원 1'}, {id: 'u2', name: '회원 2'}]);
  assert.deepEqual(admin.waiting, []);
  assert.equal(classAt(await restarted.day('u1', '2026-12-01')).myStatus, null);
  assert.equal((await restarted.day('u2', '2026-12-01')).myClassStartTime, CLASS);
  assert.equal(classAt(await restarted.day('u1'), '18:30').myStatus, null);
  await assert.rejects(restarted.change('admin'), clientError);
  const applicant = {id: 'pending', pendingApproval: true, name: '신청자'};
  await assert.rejects(restarted.day(applicant), clientError);
  await assert.rejects(restarted.change(applicant), clientError);
});

function versionedStore(initialStore) {
  let durable = structuredClone(initialStore);
  let version = 1;
  return function instance() {
    let expected = version;
    return fixture(structuredClone(durable), async next => {
      if (expected !== version) throw new ApiError(409, '저장 충돌');
      durable = structuredClone(next);
      expected = ++version;
    });
  };
}

test('simultaneous bookings for two classes on the same date allow just one to commit', async () => {
  const instance = versionedStore(box());
  const times = [CLASS, '18:30'];
  const results = await Promise.allSettled(times.map(time => instance().change('u1', 'reserve', time)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  const verifier = instance();
  const view = await verifier.day('u1');
  const recorded = view.classes.filter(slot => slot.myStatus !== null);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].startTime, view.myClassStartTime);
  const otherTime = times.find(time => time !== view.myClassStartTime);
  await assert.rejects(verifier.change('u1', 'reserve', otherTime), clientError);
  const retry = await verifier.change('u1', 'reserve', view.myClassStartTime);
  assert.equal(classAt(retry, view.myClassStartTime).confirmedCount, 1);
});

test('a stale simultaneous claim for the last waitlist seat cannot overwrite a committed reservation', async () => {
  const seed = fixture();
  for (let i = 1; i <= 19; i++) await seed.change('u' + i);
  const instance = versionedStore(seed.store);
  const clients = [instance(), instance()];
  const results = await Promise.allSettled([clients[0].change('u20'), clients[1].change('u21')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  const verifier = instance();
  const slot = classAt(await verifier.day('admin'));
  assert.equal(slot.confirmed.length, 18);
  assert.equal(slot.waiting.length, 2);
  const winner = slot.waiting[1].id;
  const loser = winner === 'u20' ? 'u21' : 'u20';
  assert.equal(classAt(await verifier.change(winner)).myWaitlistPosition, 2);
  await assert.rejects(verifier.change(loser), clientError);
});
