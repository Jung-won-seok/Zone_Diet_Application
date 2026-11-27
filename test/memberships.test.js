const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiError } = require('../server');
const { createMembershipService, chargeVisit, refundVisit, membershipIssue, membershipView } = require('../server/services/memberships');

const writePath = '/api/admin/members/membership';
const coach = { id: 'admin', isAdmin: true };
const member = { id: 'u1', isAdmin: false };
const other = { id: 'u2', isAdmin: false };
const noPass = { kind: 'unassigned', remainingVisits: null, expiresOn: null, revision: 0 };

function fixture() {
  let state = { users: [coach, member, other] };
  const service = createMembershipService({
    getStore: () => state, commit: next => { state = next; }, ApiError,
    isValidDate: value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) &&
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
  });
  async function request(method, path, user, body) {
    let result;
    const handled = await service.handle({ method }, {}, user && { user }, new URL(path, 'http://localhost'),
      async () => body, (_res, code, value) => { assert.equal(code, 200); result = value; });
    assert.equal(handled, true);
    return result;
  }
  return {
    get state() { return state; },
    issue: (date, options) => membershipIssue(state, member.id, date, options),
    charge: date => { state = chargeVisit(state, member.id, date); },
    refund: date => { state = refundVisit(state, member.id, date); },
    save: (body, user = coach) => request('PUT', writePath, user, { memberId: member.id, ...body }),
    mine: (user = member) => request('GET', '/api/membership?memberId=u1', user),
  };
}

test('legacy accounts keep booking, expiry uses the class calendar date inclusively, only the owner and coach see their pass', async () => {
  const f = fixture();
  assert.deepEqual(await f.mine(), noPass);
  assert.equal(f.issue('2030-12-31'), null);
  const period = { kind: 'period', expiresOn: '2026-12-02', remainingVisits: null, revision: 0 };
  await assert.rejects(f.save(period, member), { status: 403 });
  await assert.rejects(f.save({ ...period, memberId: coach.id }), { status: 404 });
  await assert.rejects(f.mine({ id: 'applicant', pendingApproval: true }), { status: 403 });
  await assert.rejects(f.mine(null), { status: 401 });
  await assert.rejects(f.save({ ...period, expiresOn: null }), { status: 422 });
  await assert.rejects(f.save({ ...period, expiresOn: '2026-02-30' }), { status: 422 });
  assert.deepEqual(await f.save(period), { ...period, revision: 1 });
  assert.deepEqual(await f.mine(other), noPass);
  assert.equal(f.issue('2026-12-02'), null);
  assert.match(f.issue('2026-12-03'), /만료/);
  const before = f.state;
  f.charge('2026-12-02');
  assert.equal(f.state, before);
});

test('a reservation is charged once, cancellations refund only a recorded debit, and a stale coach cannot overwrite it', async () => {
  const f = fixture();
  const newPass = { kind: 'visits', expiresOn: null, remainingVisits: 1, revision: 0 };
  for (const remainingVisits of [null, -1, 1.5, 100001]) {
    await assert.rejects(f.save({ ...newPass, remainingVisits }), { status: 422 });
  }
  await f.save(newPass);
  f.refund('2026-12-01'); // Booking that predates initial membership configuration.
  assert.equal((await f.mine()).remainingVisits, 1);
  f.charge('2026-12-02');
  const spent = f.state;
  f.charge('2026-12-02');
  assert.equal(f.state, spent);
  assert.match(f.issue('2026-12-03'), /횟수/);
  assert.equal(f.issue('2026-12-02', { alreadyConfirmed: true }), null);
  assert.throws(() => f.charge('2026-12-03'), { status: 409 });
  await assert.rejects(f.save({ ...newPass, revision: 1 }), { status: 409 });
  assert.deepEqual(await f.mine(), { kind: 'visits', remainingVisits: 0, expiresOn: null, revision: 2 });
  f.refund('2026-12-02');
  f.refund('2026-12-02');
  assert.deepEqual(await f.mine(), { kind: 'visits', remainingVisits: 1, expiresOn: null, revision: 3 });
});

test('ordinary edits keep refundable visits; replacing or clearing a pass never credits a later pass for old bookings', async () => {
  const f = fixture();
  const pass = { kind: 'visits', expiresOn: null, remainingVisits: 2, revision: 0 };
  await f.save(pass);
  f.charge('2026-12-02');
  await f.save({ ...pass, remainingVisits: 5, revision: 2 });
  f.refund('2026-12-02');
  assert.equal((await f.mine()).remainingVisits, 6);
  f.charge('2026-12-03');
  await f.save({ ...pass, revision: 5, replacePass: true, expiresOn: '2026-12-31' });
  f.refund('2026-12-03');
  assert.equal((await f.mine()).remainingVisits, 2);
  f.charge('2026-12-04');
  await f.save({ ...noPass, revision: 7 });
  const result = await f.save({ ...pass, revision: 8 });
  f.refund('2026-12-04');
  assert.deepEqual(await f.mine(), result);
  assert.deepEqual(membershipView(f.state, other.id), noPass);
});

test('a refund after a maximum top-up remains editable and cannot be copied into a replacement', async () => {
  const f = fixture();
  const pass = { kind: 'visits', expiresOn: null, remainingVisits: 1, revision: 0 };
  await f.save(pass);
  f.charge('2026-12-01');
  await f.save({ ...pass, remainingVisits: 100000, revision: 2 });
  f.refund('2026-12-01');
  const returned = await f.mine();
  assert.equal(returned.remainingVisits, 100001);
  await assert.rejects(f.save({ ...returned, replacePass: true }), { status: 422 });
  const updated = await f.save({ ...returned, expiresOn: '2026-12-31' });
  assert.equal(updated.remainingVisits, 100001);
});
