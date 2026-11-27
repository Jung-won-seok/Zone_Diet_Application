const { isDeepStrictEqual: equal } = require('node:util');
const { tables, rowKey, toRows, fromRows } = require('./rows');

// The private schema is written by this adapter and its importer. Unrelated
// bookings share the outer lock; cross-domain operations (OAuth, account
// recovery, media, etc.) retain the full snapshot precondition of the old API.
const writerLock = 'leben.store.writer.v1';
const classTables = new Set(['class_days', 'class_slots', 'reservations']);
const bookingTables = new Set([...classTables, 'memberships', 'pass_charges']);
const bookingSections = new Set(['classReservations', 'classSchedules', 'classRosterRevisions', 'memberships', 'promotionInbox']);
const conflictCodes = new Set(['40001', '40P01', '23505', '23P01']);

function errorWith(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function conflict() {
  return errorWith('STORE_CONFLICT', 409, '저장하는 동안 데이터가 변경되었습니다. 최신 상태를 확인하고 다시 시도해 주세요.');
}

async function transaction(pool, begin, action, { dryRun = false, appWrite = false } = {}) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query(begin);
    const result = await action(client);
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch { discard = true; }
    if (appWrite && conflictCodes.has(error.code)) throw conflict();
    throw error;
  } finally {
    client.release(discard);
  }
}

function byTable(make) {
  return Object.fromEntries(tables.map(table => [table.name, make(table)]));
}

function indexed(rows) {
  return byTable(table => new Map(rows[table.name].map(row => [rowKey(table, row), row])));
}

function diff(before, after) {
  return byTable(({ name }) => {
    const updates = [], additions = [], removals = [];
    if (before[name] === after[name]) return { updates, additions, removals };
    for (const [key, row] of after[name]) {
      if (!before[name].has(key)) additions.push(row);
      else if (!equal(before[name].get(key), row)) updates.push(row);
    }
    for (const [key, row] of before[name]) {
      if (!after[name].has(key)) removals.push(row);
    }
    return { updates, additions, removals };
  });
}

function changed(group) {
  return [...group.additions, ...group.updates, ...group.removals];
}

function physicalTarget(stored, after, changes) {
  const dates = new Set([...classTables].flatMap(name => changed(changes[name]).map(row => row.class_date)));
  return byTable(table => {
    const { name } = table;
    // Recurring class times come from the currently deployed weekly template.
    // Older SQL snapshots can have different regular slots. Rebuild the SQL
    // representation for a changed date; preserve other dates verbatim.
    if (classTables.has(name) && dates.size) {
      const desired = new Map([...stored[name]].filter(([, row]) => !dates.has(row.class_date)));
      for (const [key, row] of after[name]) if (dates.has(row.class_date)) desired.set(key, row);
      return desired;
    }
    const edits = changed(changes[name]);
    if (!edits.length) return stored[name];
    const desired = new Map(stored[name]);
    for (const row of edits) {
      const key = rowKey(table, row);
      if (after[name].has(key)) desired.set(key, after[name].get(key));
      else desired.delete(key);
    }
    return desired;
  });
}

function joinKeys(table, left, right) {
  return table.key.map(column => `${left}.${column} = ${right}.${column}`).join(' AND ');
}

// One query, hence one MVCC snapshot even when checking fresh values AFTER
// waiting for advisory locks at READ COMMITTED. Dates and bigint revisions
// travel as JSON so pg's date/time parser never shifts a Seoul calendar date.
async function readRows(client, keys) {
  const params = [], selects = [];
  for (const table of tables) {
    let join = '';
    if (keys) {
      const wanted = [...keys[table.name].values()];
      if (!wanted.length) continue;
      params.push(JSON.stringify(wanted));
      join = `JOIN jsonb_populate_recordset(NULL::leben.${table.name}, $${params.length}::jsonb) k
        ON ${joinKeys(table, 't', 'k')}`;
    }
    const fields = table.columns.map(column => 't.' + column).join(', ');
    selects.push(`SELECT '${table.name}' AS relation, to_jsonb(r) AS data
      FROM (SELECT ${fields} FROM leben.${table.name} t ${join}) r`);
  }
  const rows = byTable(() => []);
  if (selects.length) {
    const result = await client.query(selects.join(' UNION ALL '), params);
    for (const { relation, data } of result.rows) rows[relation].push(data);
  }
  return rows;
}

function decodeInitialized(rows) {
  if (!rows.sections.length) {
    throw errorWith('POSTGRES_STORE_EMPTY', 503, '데이터베이스 초기 설정이 필요합니다.');
  }
  const store = fromRows(rows);
  if (store.version !== 1 || !Array.isArray(store.users) || !Array.isArray(store.members) || !store.personal) {
    throw errorWith('POSTGRES_STORE_INVALID', 503, '데이터베이스 저장 형식을 확인해 주세요.');
  }
  return store;
}

function snapshotRows(pool) {
  return transaction(pool, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', client => readRows(client));
}

async function loadPostgresStore(pool) {
  return decodeInitialized(await snapshotRows(pool));
}

async function bulkWrite(client, table, operation, rows, sharedMarkers = false) {
  if (!rows.length) return;
  const relation = 'leben.' + table.name;
  const source = `jsonb_populate_recordset(NULL::${relation}, $1::jsonb) src`;
  const columns = table.columns.join(', ');
  let sql;
  if (operation === 'insert') {
    sql = `INSERT INTO ${relation} (${columns}) SELECT ${columns} FROM ${source}`;
    if (sharedMarkers) sql += ' ORDER BY field COLLATE "C" ON CONFLICT (field) DO NOTHING';
  } else if (operation === 'update') {
    const set = table.columns.filter(column => !table.key.includes(column)).map(column => column + ' = src.' + column);
    sql = `UPDATE ${relation} t SET ${set.join(', ')} FROM ${source} WHERE ${joinKeys(table, 't', 'src')}`;
  } else {
    sql = `DELETE FROM ${relation} t USING ${source} WHERE ${joinKeys(table, 't', 'src')}`;
  }
  const result = await client.query(sql, [JSON.stringify(rows)]);
  if (!sharedMarkers && result.rowCount !== rows.length) throw conflict();
}

async function writeChanges(client, changes, scoped) {
  // A class move can point an existing reservation at a newly created slot;
  // keep the old slot until after these references have moved.
  for (const table of tables) {
    await bulkWrite(client, table, 'insert', changes[table.name].additions, scoped && table.name === 'sections');
  }
  for (const table of tables) await bulkWrite(client, table, 'update', changes[table.name].updates);
  for (const table of [...tables].reverse()) await bulkWrite(client, table, 'delete', changes[table.name].removals);
}

function bookingScope(changes, base) {
  if (![...bookingTables].some(name => changed(changes[name]).length)) return false;
  return tables.every(({ name }) => {
    const group = changes[name];
    if (bookingTables.has(name)) return true;
    if (name === 'sections') {
      return !group.updates.length && !group.removals.length &&
        group.additions.every(row => row.kind === 'object' && bookingSections.has(row.field));
    }
    if (name === 'section_items') {
      // Delivery with configured push keys also reads device collections.
      return changed(group).every(row => row.field === 'promotionInbox' && !base.bookingPushKeys);
    }
    return !changed(group).length;
  });
}

function bookingGuards(changes, base, token) {
  const keys = byTable(() => new Map());
  const definitions = new Map(tables.map(table => [table.name, table]));
  function guard(name, row) {
    const table = definitions.get(name);
    const key = Object.fromEntries(table.key.map(column => [column, row[column]]));
    keys[name].set(rowKey(table, key), key);
  }
  const dates = new Set(), members = new Set();
  for (const { name } of tables) {
    for (const row of changed(changes[name])) {
      guard(name, row);
      if (classTables.has(name)) dates.add(row.class_date);
      if (row.member_id) members.add(row.member_id);
    }
  }
  // A waiting reservation or its removal can read an ineligible / unlimited
  // pass without modifying that pass. Explicitly pin even an absent pass.
  for (const date of dates) guard('class_days', { class_date: date });
  for (const id of members) {
    guard('memberships', { member_id: id });
    guard('accounts', { member_id: id });
  }
  if (changed(changes.section_items).length) guard('sections', { field: 'bookingPushKeys' });
  if (token) {
    guard('section_items', { field: 'authState', group_key: 'sessions', item_key: token });
    const actor = base.authState?.sessions?.[token]?.userId;
    if (actor) {
      guard('accounts', { member_id: actor });
      if (base.authState.sessions[token].naverIdentity) {
        // Pre-approval sessions retain the applicant id after being linked
        // to a member id. Both the link and the resolved account authenticate it.
        const memberId = base.naverApplicants?.[actor]?.memberId || actor;
        guard('accounts', { member_id: memberId });
        guard('section_items', { field: 'naverApplicants', group_key: '', item_key: actor });
        guard('section_items', { field: 'naverConnections', group_key: '', item_key: actor });
        guard('section_items', { field: 'naverConnections', group_key: '', item_key: memberId });
      }
    }
  }
  return { keys, locks: [...Array.from(dates, date => 'date/' + date), ...Array.from(members, id => 'pass/' + id)].sort() };
}

async function lockWriter(client, shared) {
  const fn = shared ? 'pg_advisory_xact_lock_shared' : 'pg_advisory_xact_lock';
  await client.query(`SELECT ${fn}(hashtextextended($1, 0))`, [writerLock]);
}

async function checkBooking(client, before, after, changes, base, token) {
  const { keys, locks } = bookingGuards(changes, base, token);
  if (locks.length) {
    // Lock acquisition order is identical on every app instance.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended(key, 1))
      FROM (SELECT key FROM unnest($1::text[]) AS wanted(key) ORDER BY key COLLATE "C") sorted`, [locks]);
  }
  const current = indexed(await readRows(client, keys));
  for (const { name } of tables) {
    for (const key of keys[name].keys()) {
      const expected = before[name].get(key), actual = current[name].get(key);
      if (equal(expected, actual)) continue;
      // First bookings on different dates can both initialize the same empty
      // top-level object. Only the identical object marker can be shared.
      if (name === 'sections' && !expected && actual && equal(actual, after[name].get(key))) continue;
      throw conflict();
    }
  }
}

function ledgerRows(changes, before, after) {
  const events = [];
  const bookingDates = new Set(changed(changes.class_days).map(row => row.class_date));
  const entries = new Map();
  for (const [rows, delta] of [[changes.pass_charges.additions, -1], [changes.pass_charges.removals, 1]]) {
    for (const charge of rows) {
      if (!bookingDates.has(charge.class_date)) continue;
      const owned = entries.get(charge.member_id) || [];
      owned.push({ class_date: charge.class_date, delta, reason: delta < 0 ? 'charge' : 'refund' });
      entries.set(charge.member_id, owned);
    }
  }
  for (const row of changed(changes.memberships)) {
    const member_id = row.member_id;
    const oldPass = before.memberships?.[member_id], pass = after.memberships?.[member_id];
    const pass_revision = pass?.revision ?? null;
    let balance = oldPass?.remainingVisits ?? 0;
    const charges = entries.get(member_id) || [];
    for (const event of charges) {
      balance += event.delta;
      events.push({ member_id, pass_revision, ...event, balance_after: balance });
    }
    const balance_after = pass?.remainingVisits ?? null;
    const delta = (balance_after ?? 0) - balance;
    // A replacement pass drops refundable dates belonging to the old pass;
    // only an actual booking transaction records a refund for a class.
    if (!charges.length || delta) {
      events.push({ member_id, pass_revision, class_date: null, balance_after, delta, reason: 'adjustment' });
    }
  }
  return events;
}

async function appendLedger(client, events) {
  if (!events.length) return;
  const fields = 'member_id, class_date, reason, delta, balance_after, pass_revision';
  await client.query(`INSERT INTO leben.membership_ledger (${fields})
    SELECT ${fields} FROM jsonb_populate_recordset(NULL::leben.membership_ledger, $1::jsonb)`, [JSON.stringify(events)]);
}

async function createPostgresContext(pool, { cookie, sessionToken } = {}) {
  const token = sessionToken ?? cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('zonda_session='))?.slice('zonda_session='.length);
  let rows = await snapshotRows(pool);
  const initialStore = decodeInitialized(rows);
  let base, logical, physical;
  return {
    initialStore,
    async persistStore(next) {
      // Existing handlers retain and sometimes mutate their snapshot; match
      // the JSON persistence contract and keep our baseline independent. A
      // read-only request never needs the write-side indexes or second copy.
      if (rows) {
        base = fromRows(rows);
        logical = indexed(toRows(base));
        physical = indexed(rows);
        rows = null;
      }
      const target = JSON.parse(JSON.stringify(next));
      const after = indexed(toRows(target));
      const original = base, expected = physical;
      const logicalChanges = diff(logical, after);
      const desired = physicalTarget(expected, after, logicalChanges);
      const changes = diff(expected, desired);
      const scoped = bookingScope(changes, original);
      await transaction(pool, 'BEGIN ISOLATION LEVEL READ COMMITTED', async client => {
        await lockWriter(client, scoped);
        if (scoped) {
          await checkBooking(client, expected, desired, changes, original, token);
        } else if (!equal(expected, indexed(await readRows(client)))) {
          throw conflict();
        }
        await writeChanges(client, changes, scoped);
        await appendLedger(client, ledgerRows(logicalChanges, original, target));
      }, { appWrite: true });
      base = target;
      logical = after;
      physical = desired;
    },
  };
}

async function importPostgresStore(pool, snapshot, { dryRun = false } = {}) {
  const target = JSON.parse(JSON.stringify(snapshot));
  const rows = toRows(target);
  return transaction(pool, 'BEGIN ISOLATION LEVEL READ COMMITTED', async client => {
    await lockWriter(client, false);
    const relations = [...tables.map(table => table.name), 'membership_ledger'];
    const anyExisting = relations.map(name => `EXISTS (SELECT 1 FROM leben.${name})`).join(' OR ');
    if ((await client.query('SELECT ' + anyExisting + ' AS occupied')).rows[0].occupied) {
      throw errorWith('POSTGRES_TARGET_NOT_EMPTY', 409, '이미 데이터가 있는 데이터베이스입니다.');
    }
    for (const table of tables) await bulkWrite(client, table, 'insert', rows[table.name]);
    await appendLedger(client, rows.memberships.filter(row => row.kind === 'visits').map(row => ({
      member_id: row.member_id, pass_revision: row.revision, class_date: null, reason: 'opening_balance',
      delta: row.remaining_visits, balance_after: row.remaining_visits,
    })));
    // A dry run must execute deferred capacity and uniqueness checks as well.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const restored = decodeInitialized(await readRows(client));
    if (!equal(restored, target)) {
      throw errorWith('POSTGRES_VERIFY_FAILED', 409, '데이터베이스 재조회 결과가 원본과 일치하지 않습니다.');
    }
    return restored;
  }, { dryRun });
}

module.exports = { createPostgresContext, loadPostgresStore, importPostgresStore };
