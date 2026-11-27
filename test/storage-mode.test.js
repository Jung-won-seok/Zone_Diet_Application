const test = require('node:test');
const assert = require('node:assert/strict');
const { ServerResponse } = require('node:http');
const Module = require('node:module');
const { Client } = require('pg');
const { getStoreMode, checkMaintenance } = require('../server/storage/storage-mode');
const { poolOptions } = require('../server/db/pool');

function isolateEnvironment(t, keys) {
  for (const key of keys) {
    const original = process.env[key];
    delete process.env[key];
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
}

function mockBlobSdk(t, sdk) {
  const originalLoad = Module._load;
  t.mock.method(Module, '_load', function(request, ...args) {
    if (request === '@vercel/blob') return sdk;
    return originalLoad.call(this, request, ...args);
  });
  // cloud-storage captures the SDK methods when first imported.
  for (const id of ['../api/handler', '../server/storage/cloud-storage']) {
    const filename = require.resolve(id);
    const previous = require.cache[filename];
    delete require.cache[filename];
    t.after(() => {
      if (previous) require.cache[filename] = previous;
      else delete require.cache[filename];
    });
  }
}

async function getRoute(handler, url, headers) {
  const req = { url, method: 'GET', headers, socket: {} };
  const res = new ServerResponse(req);
  let body;
  res.end = chunk => { body = Buffer.isBuffer(chunk) ? chunk : JSON.parse(chunk); return res; };
  await handler(req, res);
  return { status: res.statusCode, retry: res.getHeader('retry-after'), body };
}

test('storage defaults follow the entry point and a bad selection fails closed', t => {
  isolateEnvironment(t, ['LEBEN_STORE']);
  assert.equal(getStoreMode(), 'blob');
  assert.equal(getStoreMode('local'), 'local');
  for (const mode of ['postgres', 'blob']) {
    process.env.LEBEN_STORE = mode;
    assert.equal(getStoreMode(), mode);
    assert.equal(getStoreMode('local'), mode);
  }
  process.env.LEBEN_STORE = 'local';
  assert.equal(getStoreMode('local'), 'local');
  assert.throws(() => getStoreMode(), { status: 503 });
  process.env.LEBEN_STORE = 'postgress';
  assert.throws(() => getStoreMode(), { status: 503 });
  assert.throws(() => getStoreMode('local'), { status: 503 });
});

test('maintenance mode stops requests during cutover', t => {
  isolateEnvironment(t, ['LEBEN_MAINTENANCE']);
  assert.doesNotThrow(checkMaintenance);
  process.env.LEBEN_MAINTENANCE = '1';
  assert.throws(checkMaintenance, { status: 503 });
  process.env.LEBEN_MAINTENANCE = '0';
  assert.doesNotThrow(checkMaintenance);
});

test('driver verifies remote TLS, including custom roots and provider URL options', () => {
  const remote = 'postgresql://member@db.example.test/box';
  for (const query of ['', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=verify-full']) {
    const client = new Client(poolOptions(remote + query));
    assert.equal(client.connectionParameters.host, 'db.example.test');
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  }
  const withCa = new Client(poolOptions(remote + '?sslmode=require', 'line1\\nline2'));
  assert.deepEqual(withCa.connectionParameters.ssl, { rejectUnauthorized: true, ca: 'line1\nline2' });
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    const local = 'postgresql://' + host + '/box';
    assert.equal(new Client(poolOptions(local)).connectionParameters.ssl, false);
    assert.equal(new Client(poolOptions(local + '?sslmode=disable')).connectionParameters.ssl, false);
    assert.equal(new Client(poolOptions(local + '?sslmode=require')).connectionParameters.ssl.rejectUnauthorized, true);
  }
});

test('invalid database URLs and TLS overrides cannot change the effective driver configuration', () => {
  const remote = 'postgres://db.example.test/box';
  for (const query of ['sslmode=disable', 'sslmode=no-verify', 'sslmode=prefer', 'ssl=false', 'sslrootcert=untrusted', 'uselibpqcompat=true']) {
    assert.throws(() => poolOptions(remote + '?' + query));
  }
  assert.throws(() => poolOptions('postgresql://localhost/box?host=remote.example.test'));
  for (const invalid of [undefined, '', 'bad input', 'https://db.example.test/box', 'postgresql:///box']) {
    assert.throws(() => poolOptions(invalid));
  }
});

test('backup only reads and the cloud HTTP entry point never falls back from a failed database to Blob', async t => {
  isolateEnvironment(t, ['APP_HOSTS', 'BLOB_READ_WRITE_TOKEN', 'LEBEN_STORE', 'LEBEN_DATABASE_URL', 'LEBEN_MAINTENANCE', 'INITIAL_ACCOUNT_PASSWORDS']);
  process.env.APP_HOSTS = 'box.example.test';
  process.env.BLOB_READ_WRITE_TOKEN = 'fixture-token';
  process.env.INITIAL_ACCOUNT_PASSWORDS = JSON.stringify({ admin: 'fixture-password' });
  const backup = { version: 1, users: [], members: [], personal: {}, media: {} };
  let source = null;
  const sdk = {
    get: t.mock.fn(async () => source && { stream: new Response(JSON.stringify(source)).body, blob: { etag: 'fixture' } }),
    put: t.mock.fn(async () => { throw Error('Unexpected Blob write'); }),
  };
  // Replace only the network SDK while exercising the real Vercel handler and
  // the actual storage selection, backup reader and application route.
  mockBlobSdk(t, sdk);
  t.mock.method(console, 'error', () => {});
  const { readLegacyBlobStore } = require('../server/storage/cloud-storage');
  const handler = require('../api/handler');
  const session = () => getRoute(handler, '/api/handler?route=session', { host: 'box.example.test' });
  await assert.rejects(readLegacyBlobStore(), { status: 503 });
  assert.equal(sdk.put.mock.callCount(), 0);
  assert.equal(sdk.get.mock.callCount(), 1);
  source = backup;
  assert.deepEqual(await readLegacyBlobStore(), backup);
  assert.deepEqual((await session()).body, { user: null });
  const initialReads = sdk.get.mock.callCount();
  process.env.LEBEN_MAINTENANCE = '1';
  const paused = await session();
  assert.equal(paused.status, 503);
  assert.equal(paused.retry, '60');
  assert.equal(sdk.get.mock.callCount(), initialReads);
  delete process.env.LEBEN_MAINTENANCE;
  for (const mode of ['postgres', 'local', 'invalid']) {
    process.env.LEBEN_STORE = mode;
    assert.equal((await session()).status, 503);
  }
  assert.equal(sdk.get.mock.callCount(), initialReads);
  assert.equal(sdk.put.mock.callCount(), 0);
});

test('PostgreSQL serves the signed-in user and private photo through the deployed and local entry points', async t => {
  isolateEnvironment(t, ['APP_HOSTS', 'BLOB_READ_WRITE_TOKEN', 'LEBEN_STORE', 'LEBEN_MAINTENANCE']);
  process.env.APP_HOSTS = 'box.example.test';
  process.env.LEBEN_STORE = 'postgres';
  process.env.BLOB_READ_WRITE_TOKEN = 'fixture-token';
  const id = 'a'.repeat(32);
  const imageBytes = Buffer.from('fixture-photo');
  const sdk = {
    get: t.mock.fn(async (pathname, options) => {
      assert.equal(pathname, 'media/' + id);
      assert.equal(options.access, 'private');
      assert.equal(options.token, 'fixture-token');
      return { stream: new Response(imageBytes).body };
    }),
    put: t.mock.fn(async () => { throw Error('Unexpected Blob write'); }),
    del: t.mock.fn(async () => { throw Error('Unexpected Blob delete'); }),
  };
  mockBlobSdk(t, sdk);
  const pool = {};
  t.mock.method(require('../server/db/pool'), 'getPool', () => pool);
  const cookie = 'zonda_session=existing-session';
  const user = { id: 'user-a', username: 'a', name: 'A', isAdmin: false };
  const snapshot = {
    version: 1, users: [user], members: [{ id: user.id, teamId: null }], personal: {},
    media: { [id]: { memberId: user.id, mime: 'image/png' } },
    authState: { sessions: { 'existing-session': { userId: user.id, expires: Date.now() + 60000, csrfToken: 'csrf' } } },
  };
  const context = t.mock.method(require('../server/db/store'), 'createPostgresContext', async (actualPool, request) => {
    assert.equal(actualPool, pool);
    assert.equal(request.cookie, cookie);
    return { initialStore: structuredClone(snapshot) };
  });
  const handler = require('../api/handler');
  const headers = { host: 'box.example.test', cookie };
  const session = await getRoute(handler, '/api/handler?route=session', headers);
  assert.equal(session.status, 200);
  assert.deepEqual(session.body, { user, csrfToken: 'csrf' });
  assert.equal(sdk.get.mock.callCount(), 0);
  const media = await getRoute(handler, '/api/handler?route=media/' + id, headers);
  assert.equal(media.status, 200);
  assert.deepEqual(media.body, imageBytes);
  assert.equal(sdk.get.mock.callCount(), 1);
  assert.equal(context.mock.callCount(), 2);

  delete process.env.BLOB_READ_WRITE_TOKEN;
  const local = require('../server/local').createLocalServer();
  const localSession = await getRoute(local.listeners('request')[0], '/api/session', { host: 'localhost', cookie });
  assert.equal(localSession.status, 200);
  assert.deepEqual(localSession.body, session.body);
  const page = await getRoute(local.listeners('request')[0], '/', { host: 'localhost' });
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /<!doctype html>/i);
  assert.equal(context.mock.callCount(), 3);
  assert.equal(sdk.get.mock.callCount(), 1);
  assert.equal(sdk.put.mock.callCount(), 0);
  assert.equal(sdk.del.mock.callCount(), 0);
});
