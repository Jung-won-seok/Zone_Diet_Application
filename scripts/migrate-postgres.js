const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { getClassCapacity } = require('../schedule-server');

const format = 'leben-blob-backup-v1';
const usage = [
  'Usage: node scripts/migrate-postgres.js <backup|dry-run|import|verify> <backup-file>',
  '   or: node scripts/migrate-postgres.js backup-local <legacy-store.json> <backup-file>',
  '   or: node scripts/migrate-postgres.js schema',
].join('\n');
class MigrationError extends Error {}

function checksum(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function validateSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.users)) {
    throw new MigrationError('The source does not contain a supported club store.');
  }
}

function summarize(snapshot) {
  let confirmed = 0, waitlisted = 0, classesWithBookings = 0;
  for (const [date, classes] of Object.entries(snapshot.classReservations || {})) {
    for (const [time, roster] of Object.entries(classes)) {
      if (!roster.length) continue;
      const booked = Math.min(roster.length, getClassCapacity(snapshot, date, time));
      classesWithBookings++;
      confirmed += booked;
      waitlisted += roster.length - booked;
    }
  }
  const passes = Object.values(snapshot.memberships || {}).filter(pass => pass.kind === 'visits');
  return {
    accounts: snapshot.users.length,
    members: snapshot.users.filter(user => !user.isAdmin).length,
    classesWithBookings,
    confirmed,
    waitlisted,
    visitPasses: passes.length,
    remainingVisits: passes.reduce((total, pass) => total + pass.remainingVisits, 0),
    chargedVisits: passes.reduce((total, pass) => total + Object.keys(pass.chargedDates || {}).length, 0),
    mediaReferences: Object.keys(snapshot.media || {}).length,
  };
}

async function backup(filename, snapshot) {
  validateSnapshot(snapshot);
  const summary = summarize(snapshot);
  const sha256 = checksum(snapshot);
  const data = JSON.stringify({ format, sha256, snapshot });
  // wx prevents replacing an existing archive, including concurrent backups to the same path.
  const file = await fs.open(filename, 'wx', 0o600);
  try {
    try {
      await file.writeFile(data, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    await fs.unlink(filename);
    throw error;
  }
  await readBackup(filename);
  return { sha256, ...summary };
}

async function readBackup(filename) {
  let archive;
  const bytes = await fs.readFile(filename, 'utf8');
  try { archive = JSON.parse(bytes); } catch {
    throw new MigrationError('The archive is incomplete or is not valid JSON.');
  }
  if (archive?.format !== format || typeof archive.sha256 !== 'string' || !archive.snapshot) {
    throw new MigrationError('Expected an archive created by the backup command.');
  }
  validateSnapshot(archive.snapshot);
  if (checksum(archive.snapshot) !== archive.sha256) {
    throw new MigrationError('Archive checksum mismatch. Choose an intact backup.');
  }
  return archive.snapshot;
}

async function installSchema(pool) {
  const ddl = await fs.readFile(path.join(__dirname, '../db/schema.sql'), 'utf8');
  const client = await pool.connect();
  let discardConnection = false;
  try {
    await client.query('BEGIN');
    // Claim a fresh namespace atomically before running the schema file's idempotent DDL.
    await client.query('CREATE SCHEMA leben');
    await client.query(ddl);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discardConnection = true; }
    if (error.code === '42P06') {
      throw new MigrationError('The leben schema already exists. Use the previously installed target or choose a fresh database.');
    }
    throw error;
  } finally {
    client.release(discardConnection);
  }
}

async function runDatabaseCommand(command, snapshot, pool, adapter) {
  const summary = { sha256: checksum(snapshot), ...summarize(snapshot) };
  if (command === 'verify') {
    const restored = await adapter.loadPostgresStore(pool);
    if (!isDeepStrictEqual(restored, snapshot)) {
      throw new MigrationError('The database differs from the archive. Check the source and target before cutover.');
    }
  } else if (command === 'import' || command === 'dry-run') {
    // The adapter checks the full round trip inside the same transaction before commit or rollback.
    await adapter.importPostgresStore(pool, snapshot, { dryRun: command === 'dry-run' });
  } else throw new MigrationError(usage);
  return summary;
}

async function main(args) {
  const [command, filename] = args;
  if (command === 'backup-local' && args.length === 3 && filename && args[2]) {
    const raw = await fs.readFile(filename, 'utf8');
    let snapshot;
    try { snapshot = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch {
      throw new MigrationError('The legacy source is incomplete or is not valid JSON.');
    }
    const summary = await backup(args[2], snapshot);
    console.log('Local metadata archive saved and checksum verified.', JSON.stringify(summary));
    return;
  }
  const schemaOnly = command === 'schema' && args.length === 1;
  if (!schemaOnly && (args.length !== 2 || !filename || !['backup', 'dry-run', 'import', 'verify'].includes(command))) {
    throw new MigrationError(usage);
  }
  if (command === 'backup') {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new MigrationError('Set BLOB_READ_WRITE_TOKEN for the source private Blob store.');
    const { readLegacyBlobStore } = require('../cloud-storage');
    const summary = await backup(filename, await readLegacyBlobStore());
    console.log('Metadata archive saved and checksum verified.', JSON.stringify(summary));
    return;
  }
  const snapshot = schemaOnly ? null : await readBackup(filename);
  const { getPool } = require('../db/pool');
  const pool = getPool();
  try {
    if (schemaOnly) {
      await installSchema(pool);
      console.log('Club database schema installed.');
      return;
    }
    const summary = await runDatabaseCommand(command, snapshot, pool, require('../db/store'));
    const messages = {
      'dry-run': 'Trial import verified and rolled back.',
      import: 'Import verified and committed.',
      verify: 'Database matches all archive fields, including roster order and individual pass balances.',
    };
    console.log(messages[command], JSON.stringify(summary));
  } finally {
    await pool.end();
  }
}

function errorMessage(error) {
  if (error instanceof MigrationError) return error.message;
  if (error?.code === 'EEXIST') return 'The backup file already exists. Choose a new path.';
  if (error?.code === 'ENOENT') return 'Check that the source file and the backup directory exist.';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'Check access rights to the backup file and its directory.';
  if (error?.code === 'POSTGRES_TARGET_NOT_EMPTY') return 'The database already contains club data. Choose an empty target for import.';
  if (error?.code === 'POSTGRES_STORE_EMPTY') return 'The database has no imported club data to verify.';
  if (error?.code === 'POSTGRES_VERIFY_FAILED') return 'Import rolled back because the database differs from the archive.';
  // Provider exceptions and PostgreSQL constraint details can include credentials or whole records.
  return 'Operation failed. Check the private Blob or database connection, schema and target state.';
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}

module.exports = { backup, readBackup, installSchema, runDatabaseCommand, errorMessage };
