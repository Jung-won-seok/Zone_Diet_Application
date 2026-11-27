const test = require('node:test');
const assert = require('node:assert/strict');
const { tables, rowKey, toRows, fromRows } = require('../server/db/rows');

test('database rows preserve legacy accounts, pass charges, FIFO and unknown app data in arbitrary query order', () => {
  const date = '2027-03-01';
  const snapshot = {
    version: 1, revision: 3, users: [
      { id: 'b', username: 'Bee', name: '비', salt: 'salt', passwordHash: 'digest', passwordRecovery: { digest: 'recovery', expiresAt: 999 }, authVersion: 4 },
      { id: 'a', username: 'A', isAdmin: false, name: '에이' },
    ],
    members: [{ id: 'a', teamId: null, role: '', customRole: '' }, { id: 'b', teamId: 'blue', extra: 1 }],
    memberships: {
      b: { kind: 'visits', remainingVisits: 2, expiresOn: null, revision: 1, chargedDates: { [date]: true }, note: 'renewed' },
      a: { kind: 'unassigned', remainingVisits: null, expiresOn: null, revision: 2 },
    },
    classSchedules: { [date]: {
      revision: 2, closure: { reason: '대관', from: 1000 }, futureField: false,
      specials: [
        { startTime: '16:00', endTime: '16:30', label: '리프팅', capacity: 1, waitlistCapacity: 1, note: ['first'] },
        { startTime: '15:00', endTime: '15:30', label: '기초', capacity: 3, waitlistCapacity: 0 },
      ],
      cancelled: { '09:40': { reason: '취소', detail: 0 } },
    }, '2027-03-06': { specials: [], cancelled: {} } },
    classRosterRevisions: { [date]: 7, '2027-03-10': 0 },
    classReservations: { [date]: { '16:00': ['b','a'], '09:40': [] }, '2027-03-07': {} },
    media: { photo: { id: 'photo', memberId: 'b', teamId: 'blue', mime: 'image/webp', futureField: 0 } },
    teams: [{ id: 'red' }, { id: 'blue' }], unknownNull: null,
    authState: { sessions: { token: { userId: 'b', csrfToken: 'csrf' } }, failures: {}, future: 'extra' },
    promotionInbox: { b: [{ type: 'class_cancelled', date, startTime: '09:40' }] },
    futureMap: JSON.parse('{"__proto__":{"field":"ordinary data"},"constructor":null}'),
  };
  const rows = toRows(snapshot);
  assert.deepEqual(rows.reservations.map(row => [row.member_id, row.position]), [['b', 1], ['a', 2]]);
  assert.deepEqual(rows.pass_charges, [{ member_id: 'b', class_date: date, value: true }]);
  assert.deepEqual(rows.memberships[0].details, { expiresOn: null, note: 'renewed' });
  assert.deepEqual(rows.accounts[0].details.passwordRecovery, snapshot.users[0].passwordRecovery);
  assert.equal(rows.accounts[0].details.passwordHash, undefined);
  assert.ok(rows.section_items.some(row => row.field === 'authState' && row.group_key === 'sessions' && row.item_key === 'token'));
  assert.equal(rows.class_slots.find(row => row.start_time === '16:00').capacity, 1);
  for (const def of tables) {
    for (const row of rows[def.name]) assert.deepEqual(Object.keys(row).sort(), [...def.columns].sort());
    assert.equal(new Set(rows[def.name].map(row => rowKey(def, row))).size, rows[def.name].length);
    rows[def.name].reverse();
  }
  const saved = structuredClone(rows);
  const restored = fromRows(rows);
  assert.deepEqual(restored, snapshot);
  restored.authState.sessions.token.userId = 'a';
  assert.deepEqual(rows, saved);
});

test('missing sections and empty collections remain distinct', () => {
  for (const snapshot of [{}, { version: 1 }, { users: [], members: [], memberships: {}, classSchedules: {}, media: {}, authState: { sessions: {} } }]) {
    assert.deepEqual(fromRows(toRows(snapshot)), snapshot);
  }
});
