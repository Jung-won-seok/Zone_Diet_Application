const test = require('node:test');
const assert = require('node:assert/strict');
const { ServerResponse } = require('node:http');
const { createBoxMemberService } = require('../members-server');
const { createServer, makeUser, seedStore, ApiError } = require('../server');

const issuePath = '/api/admin/members/recovery';
const resetPath = '/api/account/reset-password';

test('코치 본인 확인, 재발급, 만료, 일회용 토큰 및 원래 회원 데이터 유지', async () => {
  const original = makeUser('u1', 'runner', '김회원', 'old-test-password');
  const admin = makeUser('admin', 'coach', '코치', 'test-admin-password', true);
  const assignments = [{ id: 'u1', teamId: 't1', role: 'leader' }];
  let store = { users: [original, admin], members: assignments };
  let clock = Date.now();
  const service = createBoxMemberService({ getStore: () => store, commit: next => { store = next; }, makeUser, ApiError, now: () => clock });
  async function issue(memberId, isAdmin = true, identityVerified = true) {
    let result;
    await service.handle({ method: 'POST' }, {}, { user: { isAdmin } }, { pathname: issuePath },
      async () => ({ memberId, identityVerified }), (_res, code, data) => { assert.equal(code, 201); result = data; });
    return result;
  }
  async function reset(token, password = 'replacement-test-password') {
    let result;
    await service.handlePublic({ method: 'POST' }, {}, { pathname: resetPath },
      async () => ({ token, password }), (_res, code, data) => { assert.equal(code, 200); result = data; });
    return result;
  }
  await assert.rejects(issue('u1', false), { status: 403 });
  await assert.rejects(issue('admin'), { status: 404 });
  await assert.rejects(issue('u1', true, false), { status: 422 });
  const first = await issue('u1');
  const next = await issue('u1');
  assert.notEqual(first.token, next.token);
  assert.equal(JSON.stringify(store).includes(next.token), false);
  await assert.rejects(reset(first.token), { status: 400 });
  clock = next.expiresAt;
  await assert.rejects(reset(next.token), { status: 400 });
  const last = await issue('u1');
  await assert.rejects(reset(last.token, 'short'), { status: 422 });
  const results = await Promise.allSettled([reset(last.token), reset(last.token)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 400);
  assert.deepEqual(results.find(r => r.status === 'fulfilled').value, { username: 'runner' });
  assert.equal(store.users[0].authVersion, 1);
  assert.equal(store.users[0].passwordRecovery, undefined);
  assert.notEqual(store.users[0].passwordHash, original.passwordHash);
  assert.notEqual(store.users[0].salt, original.salt);
  assert.equal(store.users[1], admin);
  assert.equal(store.members, assignments);
});

test('배포 환경의 별도 요청에서도 비밀번호 변경 후 기존 세션이 만료되고 다른 계정은 유지된다', async () => {
  const adminPassword = 'test-coach-password';
  let store = seedStore({ admin: adminPassword }, { demoMembers: false });
  store.users.push(makeUser('runner-id', 'runner', '회원', 'before-reset-test'));
  let revision = 0;
  async function request(url, body, session = {}, extraHeaders = {}) {
    const headers = { host: 'box.example.test', origin: 'https://box.example.test', ...extraHeaders };
    if (body) headers['content-type'] = 'application/json';
    if (session.cookie) headers.cookie = session.cookie;
    if (session.csrfToken) headers['x-csrf-token'] = session.csrfToken;
    const req = { url, method: body ? 'POST' : 'GET', headers, body, socket: { remoteAddress: '127.0.0.1' } };
    let snapshotRevision = revision;
    const app = createServer({ initialStore: structuredClone(store), cloud: true, allowedHosts: [req.headers.host],
      persistStore: async next => {
        if (snapshotRevision !== revision) throw new ApiError(409, '저장 충돌');
        store = structuredClone(next);
        snapshotRevision = ++revision;
      } });
    const res = new ServerResponse(req);
    let data;
    res.end = chunk => { data = JSON.parse(chunk); return res; };
    await app.listeners('request')[0](req, res);
    return { status: res.statusCode, data, cookie: res.getHeader('set-cookie')?.split(';')[0] };
  }
  async function login(username, password) {
    const result = await request('/api/login', { username, password });
    assert.equal(result.status, 200);
    return { cookie: result.cookie, csrfToken: result.data.csrfToken };
  }
  const admin = await login('admin', adminPassword);
  const member = await login('runner', 'before-reset-test');
  // An earlier deployment stored sessions without authVersion.
  for (const existing of Object.values(store.authState.sessions)) delete existing.authVersion;
  const input = { memberId: 'runner-id', identityVerified: true };
  assert.equal((await request(issuePath, input)).status, 401);
  assert.equal((await request(issuePath, input, member)).status, 403);
  assert.equal((await request(issuePath, input, { cookie: admin.cookie })).status, 403);
  const issued = await request(issuePath, input, admin);
  assert.equal(issued.status, 201);
  assert.equal((await request('/api/bootstrap', undefined, member)).status, 200);
  const reset = { token: issued.data.token, password: 'after-reset-test' };
  assert.equal((await request(resetPath, reset, {}, { origin: 'https://elsewhere.invalid' })).status, 403);
  const changed = await request(resetPath, reset, admin);
  assert.equal(changed.status, 200);
  assert.equal(changed.cookie, undefined);
  assert.equal((await request(resetPath, reset)).status, 400);
  assert.equal((await request('/api/bootstrap', undefined, member)).status, 401);
  assert.equal((await request('/api/bootstrap', undefined, admin)).status, 200);
  assert.equal((await request('/api/login', { username: 'runner', password: 'before-reset-test' })).status, 401);
  const fresh = await login('runner', 'after-reset-test');
  assert.equal((await request('/api/bootstrap', undefined, fresh)).status, 200);
});
