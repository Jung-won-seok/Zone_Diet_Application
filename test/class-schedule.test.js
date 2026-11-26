const test = require('node:test');
const assert = require('node:assert/strict');
const { createReservationService } = require('../reservations-server');
const { ApiError } = require('../server');

const saturday = '2026-12-05', monday = '2026-12-07';
const special = { action: 'addClass', startTime: '09:00', endTime: '10:00', label: '역도 특강', capacity: 1, waitlistCapacity: 2 };
const pass = visits => ({ kind: 'visits', remainingVisits: visits, revision: 1, chargedDates: {} });
function fixture(persist = () => {}) {
  const users = ['coach', 'choi', 'lee', 'kim', 'han'].map(id => ({ id, name: id, isAdmin: id === 'coach' }));
  let store = { users, memberships: Object.fromEntries(users.map(user => [user.id, pass(1)])) };
  let now = Date.parse('2026-12-04T08:00:00+09:00');
  const sent = [];
  const service = createReservationService({
    getStore: () => store, now: () => now, ApiError,
    commit: async next => { await persist(next); store = next; },
    recordPromotion: (next, event) => ({ ...next, inbox: [...(next.inbox || []), event] }),
    deliverPromotions: async events => { sent.push(...events); },
  });
  async function request(userId, method, path, body) {
    let data;
    await service.handle({ method }, {}, {user: users.find(user => user.id === userId)},
      new URL(path, 'http://localhost'), async () => body, (_, status, result) => { assert.equal(status, 200); data = result; });
    return data;
  }
  const view = (date = saturday, id = 'coach') => request(id, 'GET', '/api/reservations?date=' + date);
  async function schedule(fields, date = saturday) {
    const current = await view(date);
    const affected = current.classes.filter(slot => !slot.started && !slot.cancelled && (!fields.startTime || slot.startTime === fields.startTime));
    const affectedCounts = ['cancelClass', 'closeDay'].includes(fields.action) ? {
      rosterRevision: current.rosterRevision,
      expectedBookings: affected.reduce((n, slot) => n + slot.confirmedCount + slot.waitlistCount, 0),
      expectedConfirmed: affected.reduce((n, slot) => n + slot.confirmedCount, 0),
      expectedWaiting: affected.reduce((n, slot) => n + slot.waitlistCount, 0),
    } : {};
    return request('coach', 'POST', '/api/admin/schedule', { date, revision: current.scheduleRevision, ...affectedCounts, ...fields });
  }
  const book = (id, startTime, action = 'reserve', date = saturday, fromStartTime) =>
    request(id, 'POST', '/api/reservations', { date, action, startTime, ...(fromStartTime && { fromStartTime }) });
  return { get store() { return store; }, setTime: iso => { now = Date.parse(iso); }, sent, request, view, schedule, book };
}

test('weekend special and holiday use the same member schedule, validation, clock and access rules', async () => {
  const f = fixture();
  assert.equal((await f.view()).classes.length, 0);
  await assert.rejects(f.request('choi', 'POST', '/api/admin/schedule', { ...special, date: saturday, revision: 0 }), {status: 403});
  const day = await f.schedule(special);
  assert.equal(day.classes.length, 1);
  assert.equal(day.classes[0].label, '역도 특강');
  assert.equal((await f.view('2026-12-04', 'choi')).weekOverrides[saturday], 'special');
  await assert.rejects(f.schedule({ ...special, startTime: '09:30', endTime: '10:30' }), {status: 409});
  for (const bad of [{endTime:'09:00'}, {endTime:'25:05'}, {capacity:0}, {waitlistCapacity:21}, {label:'A'.repeat(41)}]) {
    await assert.rejects(f.schedule({ ...special, startTime:'15:00', endTime:'16:00', ...bad }), {status: 422});
  }
  await f.schedule({ ...special, startTime: '10:00', endTime: '11:00' });
  await assert.rejects(f.schedule({action:'closeDay', revision:0}), {status: 409});
  const closed = await f.schedule({action:'closeDay', reason:'공휴일'});
  assert.equal(closed.scheduleReason, '공휴일');
  assert.equal(closed.weekOverrides[saturday], 'closed');
  assert.ok(closed.classes.every(slot => slot.closed && slot.cancelled && !slot.started));
  await assert.rejects(f.book('lee','09:00'), {status: 409});
  const reopened = await f.schedule({action:'openDay'});
  assert.equal(reopened.weekOverrides[saturday], 'special');
  assert.ok(reopened.classes.every(slot => !slot.cancelled));
  f.setTime('2026-12-05T09:00:00+09:00');
  await assert.rejects(f.schedule({ action:'cancelClass',startTime:'09:00' }), {status:409});
  f.setTime('2026-12-06T00:00:00+09:00');
  await assert.rejects(f.schedule({ action:'closeDay' }), {status:409});
});

test('cancelled classes remove both groups, refund only charged members and can reopen empty', async () => {
  const f = fixture();
  await f.schedule(special);
  for (const id of ['choi','lee','kim']) await f.book(id,'09:00');
  assert.equal((await f.view(saturday, 'choi')).membership.remainingVisits, 0);
  assert.equal((await f.view(saturday, 'lee')).membership.remainingVisits, 1);
  await assert.rejects(f.book('han','09:00'), {status:409});
  const cancelled = await f.schedule({ action:'cancelClass', startTime:'09:00', reason:'시설 점검' });
  assert.equal(cancelled.classes[0].cancelled, true);
  assert.equal(cancelled.classes[0].cancelReason, '시설 점검');
  assert.equal(cancelled.classes[0].confirmedCount + cancelled.classes[0].waitlistCount, 0);
  assert.equal((await f.view(saturday, 'choi')).membership.remainingVisits, 1);
  assert.equal((await f.view(saturday, 'lee')).membership.remainingVisits, 1);
  assert.deepEqual(f.sent.map(e => [e.memberId,e.previousStatus]), [['choi','confirmed'],['lee','waiting'],['kim','waiting']]);
  assert.ok(f.store.inbox.every(e => e.type === 'class_cancelled' && e.dayClosed === false));
  assert.deepEqual(f.store.inbox, f.sent);
  await assert.rejects(f.schedule({ action:'cancelClass', startTime:'09:00' }), {status:409});
  assert.equal((await f.schedule({action:'restoreClass', startTime:'09:00'})).classes[0].confirmedCount, 0);
  assert.equal((await f.book('lee','09:00')).membership.remainingVisits, 0);
});

test('same-day closure affects upcoming slots only; reopening preserves historical and individual cancellations', async () => {
  const f = fixture();
  f.setTime('2026-12-06T07:00:00+09:00');
  await f.book('choi','06:30','reserve',monday);
  await f.book('lee','11:50','reserve',monday);
  await f.schedule({action:'cancelClass',startTime:'19:30',reason:'코치 일정'}, monday);
  f.setTime('2026-12-07T08:30:00+09:00');
  const closed = await f.schedule({action:'closeDay',reason:'폭설'}, monday);
  assert.ok(closed.dayClosed);
  assert.ok(!closed.classes[0].cancelled && closed.classes[0].confirmedCount === 1);
  assert.equal((await f.view(monday,'choi')).membership.remainingVisits, 0);
  assert.equal((await f.view(monday,'lee')).membership.remainingVisits, 1);
  assert.deepEqual(f.sent.map(e => [e.memberId,e.dayClosed]), [['lee',true]]);
  f.setTime('2026-12-07T12:00:00+09:00');
  const open = await f.schedule({action:'openDay'}, monday);
  assert.equal(open.classes.find(s => s.startTime === '11:50').cancelReason, '폭설');
  assert.equal(open.classes.find(s => s.startTime === '19:30').cancelReason, '코치 일정');
  assert.ok(!open.classes.find(s => s.startTime === '20:30').cancelled);
  assert.equal(open.classes[0].confirmedCount, 1);
});

test('same-count roster swaps require fresh confirmation, and a write failure leaves bookings, visits and inbox intact', async () => {
  let rejectWrites = false;
  const f = fixture(() => { if (rejectWrites) throw new Error('storage unavailable'); });
  await f.schedule(special);
  const beforeSwap = await f.book('choi','09:00');
  await f.book('choi','09:00','cancel');
  await f.book('lee','09:00');
  await assert.rejects(f.schedule({ action:'cancelClass',startTime:'09:00',rosterRevision:beforeSwap.rosterRevision }), {status:409});
  const prior = structuredClone(f.store);
  rejectWrites = true;
  await assert.rejects(f.schedule({action:'closeDay'}), /storage unavailable/);
  assert.deepEqual(f.store, prior);
  assert.deepEqual(f.sent, []);
});

test('a member booking racing a coach closure is either retained with a stale-preview conflict or blocked by closure', async () => {
  for (const coachFirst of [false, true]) {
    const f = fixture();
    const day = await f.schedule(special);
    const close = () => f.request('coach', 'POST', '/api/admin/schedule', {
      date: saturday, action: 'closeDay', revision: day.scheduleRevision, rosterRevision: day.rosterRevision, expectedBookings: 0,
    });
    const reserve = () => f.book('choi', '09:00');
    const results = await Promise.allSettled((coachFirst ? [close, reserve] : [reserve, close]).map(request => request()));
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].reason.status, 409);
    const actual = await f.view(saturday, 'choi');
    assert.equal(actual.dayClosed, coachFirst);
    assert.equal(actual.myClassStartTime, coachFirst ? null : '09:00');
    assert.equal(actual.membership.remainingVisits, coachFirst ? 1 : 0);
    assert.equal(f.sent.length, 0);
  }
});

test('transfers charge a waiting member only on confirmation and preserve a confirmed members charged visit', async () => {
  const f = fixture();
  await f.schedule(special);
  await f.schedule({...special,startTime:'10:10',endTime:'11:20'});
  await f.book('choi','09:00');
  await f.book('lee','09:00');
  const moved = await f.book('lee','10:10','change',saturday,'09:00');
  assert.equal(moved.membership.remainingVisits, 0);
  await f.book('choi','09:00','cancel');
  assert.equal((await f.book('lee','09:00','change',saturday,'10:10')).membership.remainingVisits, 0);
  assert.equal((await f.book('lee','09:00','cancel')).membership.remainingVisits, 1);
});

test('a now-ineligible waiter is notified and the first eligible successor pays exactly once', async () => {
  const f = fixture();
  await f.schedule(special);
  for (const id of ['choi','lee','kim']) await f.book(id,'09:00');
  // Lee used the remaining visit for a confirmed class on a different date.
  f.setTime('2026-12-04T08:00:00+09:00');
  await f.book('lee','20:30','reserve','2026-12-04');
  assert.equal((await f.view(saturday, 'lee')).membership.remainingVisits, 0);
  await f.book('choi','09:00','cancel');
  assert.deepEqual(f.sent.map(e => [e.memberId,e.type || 'promotion']), [['lee','waitlist_removed'],['kim','promotion']]);
  assert.equal((await f.view(saturday,'lee')).myClassStartTime, null);
  assert.equal((await f.view(saturday,'kim')).membership.remainingVisits, 0);
  await f.book('choi','09:00','cancel');
  assert.equal(f.sent.length, 2);
});
