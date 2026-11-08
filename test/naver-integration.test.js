const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer, seedStore } = require('../server');

test('Naver OAuth HTTP routes preserve app authentication and member ownership', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zonda-naver-http-'));
  const listener = http.createServer();
  t.after(async () => {
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const providerRequests = [];
  const naverFetch = async (url, options = {}) => {
    providerRequests.push({ url, options });
    if (url === 'https://nid.naver.com/oauth2.0/token') {
      const body = new URLSearchParams(options.body);
      assert.equal(options.method, 'POST');
      assert.equal(body.get('grant_type'), 'authorization_code');
      return Response.json({ access_token: 'http-access-secret', refresh_token: 'http-refresh-secret', expires_in: 3600, token_type: 'bearer' });
    }
    if (url === 'https://openapi.naver.com/v1/nid/me') {
      assert.equal(options.headers.Authorization, 'Bearer http-access-secret');
      return Response.json({ resultcode: '00', response: { id: 'http-private-provider-id', nickname: '김민준' } });
    }
    if (url === 'https://nid.naver.com/oauth2.0/revoke') return new Response(null, { status: 200 });
    throw new Error('Unexpected provider endpoint in mock');
  };
  const app = createServer({
    dataDir,
    initialStore: seedStore(),
    naverFetch,
    naverConfig: { clientId: 'http-test-client', clientSecret: 'http-client-secret', callbackUrl: base + '/api/naver/callback', encryptionKey: Buffer.alloc(32, 11).toString('base64') },
  });
  listener.on('request', app.listeners('request')[0]);

  async function request(route, { method = 'GET', cookie = '', csrf = '', body, headers = {} } = {}) {
    const response = await fetch(base + route, {
      method,
      redirect: 'manual',
      headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    return { status: response.status, headers: response.headers, raw, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(raw) : null };
  }
  async function login(username, password) {
    const result = await request('/api/login', { method: 'POST', body: { username, password } });
    assert.equal(result.status, 200);
    assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    return { cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.data.csrfToken };
  }
  async function connect(member) {
    const result = await request('/api/naver/connect', { method: 'POST', ...member, body: {} });
    assert.equal(result.status, 200);
    const url = new URL(result.data.authorizeUrl);
    assert.equal(url.origin, 'https://nid.naver.com');
    assert.equal(url.searchParams.get('redirect_uri'), base + '/api/naver/callback');
    assert.match(result.headers.get('set-cookie'), /Path=\/api\/naver\/callback; HttpOnly; SameSite=Lax/);
    assert.doesNotMatch(result.headers.get('set-cookie'), /zonda_session/);
    return { state: url.searchParams.get('state'), nonceCookie: result.headers.get('set-cookie').split(';')[0] };
  }
  const callbackRoute = flow => '/api/naver/callback?' + new URLSearchParams({ state: flow.state, code: 'http-authorization-code' });
  const member = await login('member01', 'Zonda01!Demo');
  const admin = await login('admin', 'ZondaAdmin!Demo27');

  await t.test('authentication, CSRF, origin and role checks precede provider requests', async () => {
    for (const route of ['/api/naver/status', '/api/admin/naver']) assert.equal((await request(route)).status, 401);
    assert.equal((await request('/api/naver/connect', { method: 'POST', body: {} })).status, 401);
    assert.equal((await request('/api/naver/connect', { method: 'POST', cookie: member.cookie, body: {} })).status, 403);
    assert.equal((await request('/api/naver/connect', { method: 'POST', ...member, body: {}, headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await request('/api/naver/connect', { method: 'POST', ...member, body: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await request('/api/naver/connect', { method: 'POST', ...admin, body: {} })).status, 403);
    assert.equal((await request('/api/naver/disconnect', { method: 'POST', ...admin, body: {} })).status, 403);
    assert.equal((await request('/api/admin/naver', member)).status, 403);
    assert.equal((await request('/api/admin/naver', { method: 'PUT', ...member, body: {} })).status, 403);
    assert.equal((await request('/api/admin/naver', admin)).status, 200);
    assert.equal((await request('/api/naver/preview', { method: 'POST', ...admin, body: {} })).status, 403);
    assert.equal(providerRequests.length, 0);
  });

  await t.test('callback authenticates its nonce without the Strict app cookie and exposes only public connection fields', async () => {
    const flow = await connect(member);
    assert.ok(!flow.nonceCookie.includes('zonda_session'));
    const result = await request(callbackRoute(flow), { cookie: flow.nonceCookie, headers: { 'Sec-Fetch-Site': 'cross-site', Referer: 'https://nid.naver.com/' } });
    assert.equal(result.status, 303);
    assert.equal(result.headers.get('location'), '/#settings/naver-success');
    assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(providerRequests.length, 2);
    const status = await request('/api/naver/status', member);
    assert.equal(status.status, 200);
    assert.equal(status.data.connection.connected, true);
    assert.equal(status.data.connection.displayName, '김민준');
    assert.deepEqual(Object.keys(status.data.connection).sort(), ['connected', 'connectedAt', 'connectionId', 'displayName', 'needsReconnect']);
    assert.doesNotMatch(status.raw, /http-access-secret|http-refresh-secret|http-private-provider-id|http-client-secret|encryptedTokens|providerIdHash/);
    const persisted = await fs.readFile(path.join(dataDir, 'store.json'), 'utf8');
    assert.doesNotMatch(persisted, /http-access-secret|http-refresh-secret|http-private-provider-id|http-authorization-code/);
    assert.equal((await request('/api/session', member)).data.user.id, 'u01');
    const replay = await request(callbackRoute(flow), { cookie: flow.nonceCookie });
    assert.equal(replay.status, 303);
    assert.equal(replay.headers.get('location'), '/#settings/naver-error');
    assert.equal(providerRequests.length, 2);
  });

  await t.test('logout revokes the app session underlying a pending callback', async () => {
    const other = await login('member02', 'Zonda02!Demo');
    const flow = await connect(other);
    assert.equal((await request('/api/logout', { method: 'POST', ...other, body: {} })).status, 200);
    const before = providerRequests.length;
    const result = await request(callbackRoute(flow), { cookie: flow.nonceCookie });
    assert.equal(result.status, 303);
    assert.equal(result.headers.get('location'), '/#settings/naver-error');
    assert.equal(providerRequests.length, before);
    const relogged = await login('member02', 'Zonda02!Demo');
    assert.equal((await request('/api/naver/status', relogged)).data.connection.connected, false);
  });

  await t.test('an authenticated app cookie cannot replace the callback browser nonce', async () => {
    const flow = await connect(member);
    const before = providerRequests.length;
    const result = await request(callbackRoute(flow), member);
    assert.equal(result.status, 303);
    assert.equal(result.headers.get('location'), '/#settings/naver-error');
    assert.equal(providerRequests.length, before);
  });
});
