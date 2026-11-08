const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('회원 로그인, 팀 권한, 역할 배정과 데이터 보존', async t => {
  const { createServer } = require('../server');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zonda-test-'));
  let server;
  let base;

  async function start() {
    server = await createServer({ dataDir });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }

  async function stop() {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  function client() {
    const state = { cookie: '', csrf: '' };
    return {
      state,
      async request(route, method = 'GET', body, overrides = {}) {
        const headers = { Origin: base, ...overrides };
        if (state.cookie) headers.Cookie = state.cookie;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (state.csrf && !Object.hasOwn(overrides, 'X-CSRF-Token')) headers['X-CSRF-Token'] = state.csrf;
        const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const raw = await response.text();
        const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(raw) : raw;
        const cookie = response.headers.get('set-cookie');
        if (cookie) state.cookie = cookie.split(';')[0];
        if (data?.csrfToken) state.csrf = data.csrfToken;
        return { status: response.status, data, headers: response.headers };
      },
      login(username, password) { return this.request('/api/login', 'POST', { username, password }); }
    };
  }

  const assignments = data => data.members.map(({ id, teamId, role, customRole }) => ({ id, teamId, role, customRole }));
  const admin = client();
  let member01;
  let member02;
  let initial;
  let sixPerson;
  await start();
  t.after(async () => { await stop(); await fs.rm(dataDir, { recursive: true, force: true }); });

  await t.test('로그인 없이 회원 정보와 내부 저장 파일을 볼 수 없다', async () => {
    const visitor = client();
    assert.deepEqual((await visitor.request('/api/session')).data, { user: null });
    assert.equal((await visitor.request('/api/bootstrap')).status, 401);
    for (const route of ['/demo-accounts.txt', '/.data/store.json', '/backend.js', '/server.js']) {
      assert.equal((await visitor.request(route)).status, 404, route);
    }
  });

  await t.test('잘못된 비밀번호와 없는 계정은 로그인되지 않는다', async () => {
    const visitor = client();
    assert.equal((await visitor.login('member01', 'incorrect-password')).status, 401);
    assert.equal((await visitor.login('nobody', 'incorrect-password')).status, 401);
    assert.equal((await visitor.request('/api/session')).data.user, null);
  });

  await t.test('20개 회원 계정 모두 로그인되며 각자 자기 팀만 조회한다', async () => {
    const ids = new Set();
    for (let i = 1; i <= 20; i++) {
      const suffix = String(i).padStart(2, '0');
      const member = client();
      const login = await member.login(`member${suffix}`, `Zonda${suffix}!Demo`);
      assert.equal(login.status, 200, `member${suffix}`);
      assert.equal(login.data.user.isAdmin, false);
      ids.add(login.data.user.id);
      const bootstrap = await member.request('/api/bootstrap');
      assert.equal(bootstrap.status, 200);
      assert.equal(bootstrap.data.members.length, 4);
      assert.ok(bootstrap.data.members.every(m => m.teamId === `t${Math.ceil(i / 4)}`));
      assert.ok(bootstrap.data.members.some(m => m.id === login.data.user.id));
      assert.ok(!/password|passwordHash|salt/.test(JSON.stringify(bootstrap.data)));
      if (i === 1) member01 = member;
      if (i === 2) member02 = member;
    }
    assert.equal(ids.size, 20);
  });

  await t.test('관리자는 20명과 5개 팀을 조회하고 세션 쿠키를 받는다', async () => {
    const login = await admin.login('admin', 'ZondaAdmin!Demo27');
    assert.equal(login.status, 200);
    assert.equal(login.data.user.isAdmin, true);
    assert.ok(login.data.csrfToken);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(login.headers.get('set-cookie'), /SameSite=Strict/i);
    initial = (await admin.request('/api/bootstrap')).data;
    assert.equal(initial.members.length, 20);
    assert.equal(initial.teams.length, 5);
    for (const team of initial.teams) {
      const group = initial.members.filter(m => m.teamId === team.id);
      assert.equal(group.length, 4);
      assert.deepEqual(group.map(m => m.role).sort(), ['diet', 'leader', 'mission', 'sns']);
    }
  });

  await t.test('회원이 관리자 배정 API를 호출해도 거부된다', async () => {
    const result = await member01.request('/api/admin/assignments', 'PUT', { revision: initial.revision, members: assignments(initial) });
    assert.equal(result.status, 403);
  });

  await t.test('CSRF 토큰 누락 또는 외부 Origin은 배정 변경을 할 수 없다', async () => {
    const payload = { revision: initial.revision, members: assignments(initial) };
    assert.equal((await admin.request('/api/admin/assignments', 'PUT', payload, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await admin.request('/api/admin/assignments', 'PUT', payload, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await admin.request('/api/bootstrap')).data.revision, initial.revision);
  });

  await t.test('6인 팀에 기타 역할 2개를 지정할 수 있다', async () => {
    const roster = assignments(initial);
    Object.assign(roster.find(m => m.id === 'u05'), { teamId: 't1', role: 'other', customRole: '응원 담당' });
    Object.assign(roster.find(m => m.id === 'u06'), { teamId: 't1', role: 'other', customRole: '기록 담당' });
    const result = await admin.request('/api/admin/assignments', 'PUT', { revision: initial.revision, members: roster });
    assert.equal(result.status, 200);
    sixPerson = (await admin.request('/api/bootstrap')).data;
    assert.equal(sixPerson.members.filter(m => m.teamId === 't1').length, 6);
    assert.equal(sixPerson.members.find(m => m.id === 'u05').customRole, '응원 담당');
    assert.notEqual(sixPerson.revision, initial.revision);
    assert.equal((await member01.request('/api/bootstrap')).data.members.length, 6);
  });

  await t.test('7명 배정은 거부하고 기존 배정을 보존한다', async () => {
    const roster = assignments(sixPerson);
    Object.assign(roster.find(m => m.id === 'u07'), { teamId: 't1', role: 'other', customRole: '추가 담당' });
    const result = await admin.request('/api/admin/assignments', 'PUT', { revision: sixPerson.revision, members: roster });
    assert.equal(result.status, 422);
    const after = (await admin.request('/api/bootstrap')).data;
    assert.equal(after.revision, sixPerson.revision);
    assert.deepEqual(assignments(after), assignments(sixPerson));
  });

  await t.test('같은 팀 핵심 역할 중복과 빈 기타 역할명은 거부된다', async () => {
    const duplicate = assignments(sixPerson);
    Object.assign(duplicate.find(m => m.id === 'u05'), { role: 'leader', customRole: '' });
    assert.equal((await admin.request('/api/admin/assignments', 'PUT', { revision: sixPerson.revision, members: duplicate })).status, 422);
    const unnamed = assignments(sixPerson);
    unnamed.find(m => m.id === 'u05').customRole = '';
    assert.equal((await admin.request('/api/admin/assignments', 'PUT', { revision: sixPerson.revision, members: unnamed })).status, 422);
    assert.equal((await admin.request('/api/bootstrap')).data.revision, sixPerson.revision);
  });

  await t.test('오래된 배정본으로 다른 관리자의 저장을 덮어쓰지 않는다', async () => {
    const result = await admin.request('/api/admin/assignments', 'PUT', { revision: initial.revision, members: assignments(initial) });
    assert.equal(result.status, 409);
  });

  await t.test('중복·누락 회원 또는 알려지지 않은 팀은 거부된다', async () => {
    const duplicate = assignments(sixPerson);
    duplicate[1] = { ...duplicate[0] };
    const invalidTeam = assignments(sixPerson);
    invalidTeam[0].teamId = 'not-a-team';
    for (const members of [duplicate, assignments(sixPerson).slice(1), invalidTeam]) {
      assert.equal((await admin.request('/api/admin/assignments', 'PUT', { revision: sixPerson.revision, members })).status, 422);
    }
  });

  const personal = {
    settings: { name: '개인 기록 확인', startWeight: '75.5', goalWeight: '70' },
    records: { '2026-01-01': { weight: '74.8', breakfast: '개인 테스트 식단', lunch: '', dinner: '', workout: true, workoutNote: '테스트 메모' } }
  };
  let initialPersonalRevision;
  let savedPersonalRevision;
  let otherInitial;

  await t.test('회원 기록은 서버에 저장되며 다른 회원에게 섞이지 않는다', async () => {
    const initial = (await member01.request('/api/bootstrap')).data;
    initialPersonalRevision = initial.personalRevision;
    assert.equal(initialPersonalRevision, 0);
    otherInitial = (await member02.request('/api/bootstrap')).data;
    assert.equal(otherInitial.personalRevision, 0);
    const saved = await member01.request('/api/personal', 'PUT', { ...personal, personalRevision: initialPersonalRevision });
    assert.equal(saved.status, 200);
    savedPersonalRevision = saved.data.personalRevision;
    assert.equal(savedPersonalRevision, initialPersonalRevision + 1);
    const bootstrap = (await member01.request('/api/bootstrap')).data;
    assert.equal(bootstrap.personalRevision, savedPersonalRevision);
    const own = bootstrap.personal;
    assert.equal(Number(own.records['2026-01-01'].weight), 74.8);
    assert.equal(own.settings.name, '개인 기록 확인');
    const other = (await member02.request('/api/bootstrap')).data;
    assert.equal(other.personal.records['2026-01-01'], undefined);
    assert.ok(!JSON.stringify(other).includes('개인 테스트 식단'));
    assert.equal(other.personalRevision, otherInitial.personalRevision);
  });

  await t.test('두 개의 오래된 개인 기록 저장은 충돌로 거부되고 최신 기록을 보존한다', async () => {
    const staleSettings = { ...personal, personalRevision: initialPersonalRevision, settings: { ...personal.settings, name: '덮어쓰면 안 되는 이름' } };
    const staleRecords = { ...personal, personalRevision: initialPersonalRevision, records: {} };
    const results = await Promise.all([
      member01.request('/api/personal', 'PUT', staleSettings),
      member01.request('/api/personal', 'PUT', staleRecords)
    ]);
    for (const result of results) assert.equal(result.status, 409);
    const current = (await member01.request('/api/bootstrap')).data;
    assert.equal(current.personalRevision, savedPersonalRevision);
    assert.equal(current.personal.settings.name, personal.settings.name);
    assert.equal(current.personal.records['2026-01-01'].breakfast, '개인 테스트 식단');
  });

  await t.test('다른 회원의 저장은 독립적인 버전으로 성공하며 기존 회원의 버전을 바꾸지 않는다', async () => {
    const saved = await member02.request('/api/personal', 'PUT', {
      ...otherInitial.personal,
      settings: { ...otherInitial.personal.settings, name: '두 번째 회원' },
      personalRevision: otherInitial.personalRevision
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.personalRevision, otherInitial.personalRevision + 1);
    const first = (await member01.request('/api/bootstrap')).data;
    assert.equal(first.personalRevision, savedPersonalRevision);
    assert.equal(first.personal.settings.name, personal.settings.name);
    assert.equal(first.personal.records['2026-01-01'].breakfast, '개인 테스트 식단');
  });

  await t.test('로그아웃한 세션은 다시 사용할 수 없다', async () => {
    const oldCookie = member02.state.cookie;
    assert.equal((await member02.request('/api/logout', 'POST', {})).status, 200);
    member02.state.cookie = oldCookie;
    assert.equal((await member02.request('/api/session')).data.user, null);
    assert.equal((await member02.request('/api/bootstrap')).status, 401);
  });

  await t.test('서버를 재시작해도 팀과 개인 기록이 유지되고 평문 비밀번호는 저장되지 않는다', async () => {
    await stop();
    await start();
    assert.equal((await admin.login('admin', 'ZondaAdmin!Demo27')).status, 200);
    const after = (await admin.request('/api/bootstrap')).data;
    assert.deepEqual(assignments(after), assignments(sixPerson));
    assert.equal((await member01.login('member01', 'Zonda01!Demo')).status, 200);
    const bootstrap = (await member01.request('/api/bootstrap')).data;
    assert.equal(bootstrap.personalRevision, savedPersonalRevision);
    const own = bootstrap.personal;
    assert.equal(own.records['2026-01-01'].breakfast, '개인 테스트 식단');
    const persisted = await fs.readFile(path.join(dataDir, 'store.json'), 'utf8');
    assert.ok(!persisted.includes('Zonda01!Demo'));
    assert.ok(!persisted.includes('ZondaAdmin!Demo27'));
  });
});
