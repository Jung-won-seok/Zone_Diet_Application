const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ServerResponse } = require('node:http');
const { createServer, makeUser, seedStore } = require('../server');
const { installSchema } = require('../scripts/migrate-postgres');

const controlUrl = process.env.LEBEN_TEST_DATABASE_URL;
const date = '2026-11-28';
const host = 'box.example.test';

// All changes, including schema creation and failure injection, are made in a
// database created exclusively for this test run. The control database is untouched.
async function withTestDatabase(run) {
  const { Pool } = require('pg');
  const url = new URL(controlUrl);
  const database = 'leben_test_' + randomUUID().replaceAll('-', '');
  const control = new Pool({ connectionString: url.href, max: 1 });
  try {
    await control.query('CREATE DATABASE ' + database);
    url.pathname = '/' + database;
    const pool = new Pool({ connectionString: url.href, max: 6 });
    try {
      assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, database);
      await installSchema(pool);
      await assert.rejects(installSchema(pool));
      await run(pool);
    } finally {
      await pool.end();
      await control.query('DROP DATABASE ' + database);
    }
  } finally {
    await control.end();
  }
}

function memberClient(pool, createContext) {
  let cookie = '', csrf = '';
  const contextForRequest = () => createContext(pool, { cookie });
  async function request(url, method = 'GET', body, context) {
    const app = createServer({
      ...(context || await contextForRequest()), mediaStorage: {}, cloud: true, allowedHosts: [host]
    });
    const req = { url, method, body, socket: { remoteAddress: '127.0.0.1' }, headers: {
      host, origin: 'https://' + host, 'content-type': 'application/json', cookie, 'x-csrf-token': csrf
    } };
    const res = new ServerResponse(req);
    let raw;
    res.end = chunk => { raw = String(chunk); return res; };
    await app.listeners('request')[0](req, res);
    const data = JSON.parse(raw);
    if (data.csrfToken) csrf = data.csrfToken;
    if (res.hasHeader('set-cookie')) cookie = res.getHeader('set-cookie').split(';')[0];
    return { status: res.statusCode, data };
  }
  request.context = contextForRequest;
  return request;
}

function ok(response) {
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
}

// A fresh serverless request loads a fresh database context for every retry.
async function afterConflict(response, repeat) {
  for (let attempt = 1; attempt < 4 && response.data.code === 'STORE_CONFLICT'; attempt++) {
    assert.equal(response.status, 409);
    response = await repeat();
  }
  return response;
}

test('PostgreSQL migration, parallel reservations and visit accounting', {
  skip: !controlUrl && 'Set LEBEN_TEST_DATABASE_URL to a test PostgreSQL role with CREATEDB',
  timeout: 120000
}, async t => {
  const { createPostgresContext, loadPostgresStore, importPostgresStore } = require('../db/store');
  await withTestDatabase(async pool => {
    t.mock.timers.enable({apis: ['Date'], now: new Date('2026-11-27T09:00:00+09:00')});
    const password = randomUUID();
    const original = seedStore({admin: password}, {demoMembers: false});
    const ids = ['fixture1', 'fixture2', 'fixture3', 'fixture4', 'fixture5'];
    original.users.push(...ids.map(id => makeUser(id, id, id, password)));
    original.memberships = Object.fromEntries(ids.map(id => [id, {
      kind: 'visits', expiresOn: date, remainingVisits: 2, revision: 1, chargedDates: {}
    }]));
    original.media = {photo1: { memberId: ids[0], mime: 'image/jpeg', size: 12 }};
    original.wods = { [date]: {title: 'Fran', description: '21-15-9'} };
    original.classReservations = { '2026-11-25': { '20:30': [ids[2], ids[0]] } };
    original.classRosterRevisions = { '2026-11-25': 2 };
    original.memberships[ids[2]].chargedDates['2026-11-25'] = true;
    original.classSchedules = { [date]: { revision: 1, specials: ['10', '12', '14', '16'].map(hour => ({
      startTime: hour + ':00', endTime: hour + ':50', capacity: 1, waitlistCapacity: 2, label: '특강'
    })) } };
    original.archivedProgram = {label: '지난 기수', flags: [false, null]};

    await importPostgresStore(pool, original, { dryRun: true });
    await importPostgresStore(pool, original);
    assert.deepEqual(await loadPostgresStore(pool), original);
    await assert.rejects(importPostgresStore(pool, original));

    const members = new Map();
    for (const id of ['admin', ...ids]) {
      const request = memberClient(pool, createPostgresContext);
      ok(await request('/api/login', 'POST', { username: id, password }));
      ok(await request('/api/bootstrap')); // authenticates on a different server instance
      members.set(id, request);
    }
    const coach = members.get('admin');
    const dayUrl = '/api/reservations?date=' + date;
    const book = (id, startTime, action = 'reserve', context) => members.get(id)(
      '/api/reservations', 'POST', { date, startTime, action }, context);
    const ledger = async () => (await pool.query(
      'SELECT member_id, delta, balance_after, xmin::text AS tx FROM leben.membership_ledger WHERE class_date = $1 ORDER BY id', [date])).rows;
    const slot = async time => ok(await coach(dayUrl)).classes.find(item => item.startTime === time);
    const balance = async id => ok(await members.get(id)('/api/membership')).remainingVisits;
    const inbox = async id => ok(await members.get(id)('/api/notifications?format=2')).items;
    const contexts = (...accounts) => Promise.all(accounts.map(id => members.get(id).context()));

    // Both applicants have read the last seat as available, on independent connections.
    const first = await contexts(ids[0], ids[1]);
    const race = await Promise.all(ids.slice(0, 2).map((id, i) => book(id, '10:00', 'reserve', first[i])));
    assert.equal(race.filter(response => response.data.code === 'STORE_CONFLICT').length, 1);
    for (const [i, response] of race.entries()) ok(await afterConflict(response, () => book(ids[i], '10:00')));
    ok(await book(ids[2], '10:00'));
    const before = await slot('10:00');
    const winner = before.confirmed[0].id;
    const next = before.waiting[0].id;
    assert.equal(before.confirmed.length, 1);
    assert.deepEqual(before.waiting.map(person => person.id), [next, ids[2]]);
    assert.deepEqual(new Set([winner, next]), new Set(ids.slice(0, 2)));
    assert.equal(await balance(winner), 1);
    assert.equal(await balance(next), 2);

    // A failed ledger insert must roll back changes to the roster, balances and inbox.
    await pool.query(`CREATE FUNCTION leben.fail_refund_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.delta > 0 THEN RAISE EXCEPTION 'test refund failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_refund_fixture BEFORE INSERT ON leben.membership_ledger
      FOR EACH ROW EXECUTE FUNCTION leben.fail_refund_fixture()`);
    try {
      assert.ok((await book(winner, '10:00', 'cancel')).status >= 400);
      assert.deepEqual(await slot('10:00'), before);
      assert.equal(await balance(winner), 1);
      assert.equal(await balance(next), 2);
      assert.equal((await inbox(next)).length, 0);
      assert.equal((await ledger()).length, 1);
    } finally {
      await pool.query('DROP TRIGGER fail_refund_fixture ON leben.membership_ledger');
    }
    ok(await book(winner, '10:00', 'cancel'));
    ok(await book(winner, '10:00', 'cancel')); // response lost, same request sent again
    const after = await slot('10:00');
    assert.deepEqual(after.confirmed.map(person => person.id), [next]);
    assert.deepEqual(after.waiting.map(person => person.id), [ids[2]]);
    assert.equal(await balance(winner), 2);
    assert.equal(await balance(next), 1);
    assert.equal((await inbox(next)).length, 1);
    assert.equal((await inbox(ids[2])).length, 0);
    const entries = await ledger();
    assert.equal(entries.length, 3);
    const refund = entries.find(entry => entry.delta === 1 && entry.member_id === winner);
    const promotion = entries.find(entry => entry.delta === -1 && entry.member_id === next);
    assert.equal(refund.balance_after, 2);
    assert.equal(promotion.balance_after, 1);
    assert.equal(refund.tx, promotion.tx);

    // The same member submits two different classes before either request finishes.
    const times = ['12:00', '14:00'];
    const second = await contexts(ids[3], ids[3]);
    const doubles = await Promise.all(times.map((time, i) => book(ids[3], time, 'reserve', second[i])));
    const settled = await Promise.all(doubles.map((response, i) => afterConflict(response, () => book(ids[3], times[i]))));
    assert.deepEqual(settled.map(response => response.status).sort(), [200, 409]);
    const count = await pool.query('SELECT count(*)::int AS n FROM leben.reservations WHERE member_id=$1 AND class_date=$2', [ids[3], date]);
    assert.equal(count.rows[0].n, 1);
    assert.equal(await balance(ids[3]), 1);

    // A coach confirms a closure from a preview while a member books the same class.
    function close(preview, context) {
      const target = preview.classes.find(item => item.startTime === '16:00');
      return coach('/api/admin/schedule', 'POST', { action: 'cancelClass', date, startTime: '16:00',
        revision: preview.scheduleRevision, rosterRevision: preview.rosterRevision, reason: '휴강',
        expectedBookings: target.confirmedCount + target.waitlistCount,
        expectedConfirmed: target.confirmedCount, expectedWaiting: target.waitlistCount }, context);
    }
    const preview = ok(await coach(dayUrl));
    const third = await contexts('admin', ids[4]);
    const [closed, reserved] = await Promise.all([close(preview, third[0]), book(ids[4], '16:00', 'reserve', third[1])]);
    assert.deepEqual([closed.status, reserved.status].sort(), [200, 409]);
    if (closed.status === 409) {
      assert.equal((await close(preview)).status, 409);
      ok(await close(ok(await coach(dayUrl))));
    }
    assert.equal((await slot('16:00')).cancelled, true);
    assert.equal((await slot('16:00')).confirmed.length, 0);
    assert.equal((await book(ids[4], '16:00')).status, 409);
    assert.equal(await balance(ids[4]), 2);
    assert.equal((await inbox(ids[4])).length, reserved.status === 200 ? 1 : 0);

    // Different days and pass holders can book against the same initial state without a retry.
    const friday = '2026-11-27';
    const [left, right] = await contexts(winner, ids[4]);
    const freeTime = (await slot(times[0])).confirmed.length ? times[1] : times[0];
    const parallel = await Promise.all([
      members.get(winner)('/api/reservations', 'POST', {date: friday, startTime: '20:30', action: 'reserve'}, left),
      book(ids[4], freeTime, 'reserve', right)
    ]);
    parallel.forEach(ok);
    const saved = await loadPostgresStore(pool);
    assert.deepEqual(saved.classReservations[friday]['20:30'], [winner]);
    assert.deepEqual(saved.classReservations[date][freeTime], [ids[4]]);
    assert.deepEqual(saved.media, original.media);
    assert.deepEqual(saved.archivedProgram, original.archivedProgram);

    // The request authenticated before logout and arrived at its database commit afterwards.
    const stale = await members.get(ids[4]).context();
    let atCommit, resume;
    const waiting = new Promise(resolve => { atCommit = resolve; });
    const released = new Promise(resolve => { resume = resolve; });
    const delayed = { ...stale, async persistStore(nextStore) {
      atCommit();
      await released;
      return stale.persistStore(nextStore);
    } };
    const cancellation = book(ids[4], freeTime, 'cancel', delayed);
    try {
      await Promise.race([waiting, cancellation.then(() => { throw new Error('Expected cancellation to reach commit'); })]);
      ok(await members.get(ids[4])('/api/logout', 'POST', {}));
    } finally {
      resume();
    }
    const rejected = await cancellation;
    assert.equal(rejected.status, 409);
    assert.equal(rejected.data.code, 'STORE_CONFLICT');
    assert.equal((await book(ids[4], freeTime, 'cancel')).status, 401);
    assert.deepEqual((await loadPostgresStore(pool)).classReservations[date][freeTime], [ids[4]]);

    // Two existing weekdays predate the addition of a regular class to the weekly template.
    const oldDate = '2026-11-25', regularTime = '19:30';
    const slotFilter = ' WHERE class_date IN ($1, $2) AND start_time = $3';
    const params = [oldDate, friday, regularTime];
    assert.equal((await pool.query('DELETE FROM leben.class_slots' + slotFilter, params)).rowCount, 2);
    const regularDates = async () => (await pool.query(
      'SELECT class_date::text AS date FROM leben.class_slots' + slotFilter, params)).rows;
    ok(await coach('/api/wod?date=' + friday, 'PUT', {title: 'Grace', description: '30 reps', benchmarkId: '', revision: 0}));
    assert.deepEqual(await regularDates(), []);
    const member = members.get(ids[3]);
    const regularBooking = (action, context) => member('/api/reservations', 'POST',
      {date: friday, startTime: regularTime, action}, context);
    ok(await regularBooking('reserve'));
    assert.deepEqual(await regularDates(), [{date: friday}]);

    // A cancellation based on the old pass cannot credit the replacement pass.
    const beforeReplace = await member.context();
    const oldPass = ok(await member('/api/membership'));
    assert.equal(oldPass.remainingVisits, 0);
    ok(await coach('/api/admin/members/membership', 'PUT', {memberId: ids[3], kind: 'visits',
      remainingVisits: 10, expiresOn: date, revision: oldPass.revision, replacePass: true}));
    const staleRefund = await regularBooking('cancel', beforeReplace);
    assert.equal(staleRefund.status, 409);
    assert.equal(staleRefund.data.code, 'STORE_CONFLICT');
    ok(await regularBooking('cancel'));
    assert.equal(await balance(ids[3]), 10);
    const replacementEntries = await pool.query(
      'SELECT reason, delta, balance_after FROM leben.membership_ledger WHERE member_id=$1 ORDER BY id', [ids[3]]);
    assert.deepEqual(replacementEntries.rows.map(row => [row.reason, row.delta, row.balance_after]), [
      ['opening_balance', 2, 2], ['charge', -1, 1], ['charge', -1, 0], ['adjustment', 10, 10]
    ]);
  });
});
