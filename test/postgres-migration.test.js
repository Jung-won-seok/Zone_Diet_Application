const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { backup, readBackup, installSchema, runDatabaseCommand, errorMessage } = require('../scripts/migrate-postgres');

const date = '2030-01-07';
function fixture() {
  return {
    version: 1,
    users: ['coach', 'm1', 'm2', 'm3'].map((id, i) => ({ id, isAdmin: !i })),
    classSchedules: { [date]: { specials: [{ startTime: '10:00', capacity: 1 }] } },
    classReservations: { [date]: { '10:00': ['m2', 'm1', 'm3'], '18:30': [] } },
    memberships: {
      m1: { kind: 'visits', remainingVisits: 4, chargedDates: {} },
      m2: { kind: 'visits', remainingVisits: 1, chargedDates: { [date]: true } },
      m3: { kind: 'period', remainingVisits: null },
    },
    media: { 'fixture-photo': { ownerId: 'm1' } },
    futureField: { privateValue: 'private-fixture-value' },
  };
}

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leben-migration-'));
  t.after(async () => {
    for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name));
    await fs.rmdir(dir);
  });
  return dir;
}

test('metadata archive preserves unknown fields, ordered rosters and pass data without overwriting existing files', async t => {
  const dir = await tempDir(t);
  const file = path.join(dir, 'backup.json');
  const source = fixture();
  const { sha256, ...summary } = await backup(file, source);
  assert.match(sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(summary, {
    accounts: 4, members: 3, classesWithBookings: 1, confirmed: 1, waitlisted: 2,
    visitPasses: 2, remainingVisits: 5, chargedVisits: 1, mediaReferences: 1,
  });
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o077, 0);
  const before = await fs.readFile(file);
  await assert.rejects(backup(file, { version: 1, users: [] }), { code: 'EEXIST' });
  assert.deepEqual(await fs.readFile(file), before);
  assert.deepEqual(await readBackup(file), source);
});

test('backup-local can be rehearsed offline, and verify rejects a modified archive before opening a database', async t => {
  const dir = await tempDir(t);
  const raw = path.join(dir, 'source.json');
  const file = path.join(dir, 'backup.json');
  await fs.writeFile(raw, JSON.stringify(fixture()));
  const cli = path.join(__dirname, '../scripts/migrate-postgres.js');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const saved = run('backup-local', raw, file);
  assert.equal(saved.status, 0, saved.stderr);
  assert.doesNotMatch(saved.stdout + saved.stderr, /private-fixture-value|fixture-photo/);
  const archive = JSON.parse(await fs.readFile(file, 'utf8'));
  archive.snapshot.classReservations[date]['10:00'].reverse();
  await fs.writeFile(file, JSON.stringify(archive));
  const rejected = run('verify', file);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /checksum mismatch/);
  assert.doesNotMatch(rejected.stderr, /private-fixture-value|fixture-photo/);
  await fs.writeFile(file, '{"private-fixture-value"');
  await assert.rejects(readBackup(file), /incomplete or is not valid JSON/);
});

test('database verification detects queue positions, balances and private fields changing at constant totals', async () => {
  const source = fixture();
  const pool = {};
  const verify = store => runDatabaseCommand('verify', source, pool, { async loadPostgresStore(input) {
    assert.equal(input, pool);
    return store;
  } });
  const reorderedKeys = Object.fromEntries(Object.entries(source).reverse());
  assert.equal((await verify(reorderedKeys)).waitlisted, 2);
  for (const change of [
    target => target.classReservations[date]['10:00'].splice(1, 2, 'm3', 'm1'),
    target => { target.memberships.m1.remainingVisits--; target.memberships.m2.remainingVisits++; },
    target => { delete target.futureField; },
  ]) {
    const target = structuredClone(source);
    change(target);
    await assert.rejects(verify(target), /differs from the archive/);
  }
});

test('dry run explicitly requests transactional rollback and error messages hide provider details', async () => {
  const source = fixture();
  const pool = {};
  const options = [];
  const adapter = { async importPostgresStore(input, snapshot, opts) {
    assert.equal(input, pool);
    assert.equal(snapshot, source);
    options.push(opts);
    return snapshot;
  } };
  for (const command of ['dry-run', 'import']) await runDatabaseCommand(command, source, pool, adapter);
  await assert.rejects(runDatabaseCommand('unknown', source, pool, adapter), /Usage/);
  assert.deepEqual(options, [{ dryRun: true }, { dryRun: false }]);
  const privateError = new Error('private-fixture-value');
  assert.doesNotMatch(errorMessage(privateError), /private-fixture-value/);
  privateError.code = 'POSTGRES_TARGET_NOT_EMPTY';
  assert.match(errorMessage(privateError), /empty target/);
});

test('schema installation never touches an existing namespace and rolls back partial installation', async () => {
  for (const failure of ['existing schema', 'failed DDL']) {
    const statements = [];
    let released = false;
    const pool = { async connect() {
      return {
        async query(sql) {
          if (sql === 'CREATE SCHEMA leben' && failure === 'existing schema') {
            statements.push('claim');
            throw Object.assign(new Error('duplicate schema'), { code: '42P06' });
          }
          if (sql.includes('CREATE TABLE')) {
            statements.push('DDL');
            throw new Error('synthetic DDL failure');
          }
          statements.push(sql);
        },
        release() { released = true; },
      };
    } };
    if (failure === 'existing schema') {
      await assert.rejects(installSchema(pool), /schema already exists/);
      assert.deepEqual(statements, ['BEGIN', 'claim', 'ROLLBACK']);
    } else {
      await assert.rejects(installSchema(pool), /synthetic DDL failure/);
      assert.deepEqual(statements, ['BEGIN', 'CREATE SCHEMA leben', 'DDL', 'ROLLBACK']);
    }
    assert.equal(released, true);
  }
});
