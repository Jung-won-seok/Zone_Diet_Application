const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

test('서버 인스턴스가 바뀌는 클라우드 저장과 인증', { timeout: 20000 }, async t => {
  const { createServer, seedStore } = require('../server');
  let persisted = seedStore();
  let generation = 0;
  let rejectNextCommit = false;
  let persistenceBarrier = null;
  let requestInstances = 0;
  let failWriteNumber = 0;
  let writeNumber = 0;
  const media = new Map();
  const image = await fs.readFile(path.join(__dirname, 'fixtures/meal.png'));
  const imageData = `data:image/png;base64,${image.toString('base64')}`;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const conflict = () => Object.assign(new Error('다른 요청이 먼저 저장했습니다.'), { status: 409 });
  const mediaStorage = {
    async write(id, buffer) {
      await new Promise(resolve => setImmediate(resolve));
      writeNumber++;
      if (writeNumber === failWriteNumber) throw new Error('테스트 저장 실패');
      assert.ok(!media.has(id));
      media.set(id, Buffer.from(buffer));
    },
    async read(id) {
      await new Promise(resolve => setImmediate(resolve));
      if (!media.has(id)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return Buffer.from(media.get(id));
    },
    async remove(id) { await new Promise(resolve => setImmediate(resolve)); media.delete(id); }
  };
  const proxy = http.createServer((req, res) => {
    requestInstances++;
    const expectedGeneration = generation;
    const instance = createServer({
      initialStore: structuredClone(persisted),
      cloud: true,
      allowedHosts: ['app.example.com'],
      mediaStorage,
      async persistStore(next) {
        if (persistenceBarrier) await persistenceBarrier();
        await new Promise(resolve => setImmediate(resolve));
        if (rejectNextCommit) { rejectNextCommit = false; throw conflict(); }
        if (expectedGeneration !== generation) throw conflict();
        persisted = structuredClone(next);
        generation++;
      }
    });
    instance.emit('request', req, res);
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => proxy.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  function client(username, password) {
    const state = { cookie: '', csrf: '' };
    return {
      state,
      async request(route, method = 'GET', body, options = {}) {
        const headers = { Host: options.host || 'app.example.com' };
        if (options.origin !== null) headers.Origin = options.origin || 'https://app.example.com';
        if (state.cookie) headers.Cookie = state.cookie;
        if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await new Promise((resolve, reject) => {
          const request = http.request(base + route, { method, headers }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: new Headers(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join('; ') : value])), bytes: Buffer.concat(chunks) }));
            res.on('error', reject);
          });
          request.on('error', reject);
          request.end(body === undefined ? undefined : JSON.stringify(body));
        });
        const bytes = response.bytes;
        const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : bytes;
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) state.cookie = setCookie.split(';')[0];
        if (data?.csrfToken) state.csrf = data.csrfToken;
        return { status: response.status, data, headers: response.headers };
      },
      login() { return this.request('/api/login', 'POST', { username, password }); },
      async bootstrap() { const result = await this.request('/api/bootstrap'); assert.equal(result.status, 200); return result.data; }
    };
  }
  const member = client('member01', 'Zonda01!Demo');
  const second = client('member02', 'Zonda02!Demo');
  const visitor = client('member03', 'Zonda03!Demo');
  let uploaded;

  await t.test('허용하지 않은 호스트와 Origin 누락·외부 Origin의 변경 요청은 차단한다', async () => {
    assert.equal((await visitor.request('/api/session', 'GET', undefined, { host: 'unknown.example.com' })).status, 403);
    const credentials = { username: 'member03', password: 'Zonda03!Demo' };
    assert.equal((await visitor.request('/api/login', 'POST', credentials, { origin: null })).status, 403);
    assert.equal((await visitor.request('/api/login', 'POST', credentials, { origin: 'https://attacker.example.com' })).status, 403);
    assert.equal((await visitor.request('/api/login', 'POST', credentials, { origin: 'http://app.example.com' })).status, 403);
    assert.equal((await visitor.request('/api/session', 'GET', undefined, { origin: null })).status, 200);
  });

  await t.test('로그인 세션은 새 인스턴스에서도 유지되고 쿠키는 Secure·HttpOnly이다', async () => {
    const login = await member.login();
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /(?:;\s*)Secure(?:;|$)/i);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(login.headers.get('set-cookie'), /SameSite=Strict/i);
    const afterLoginGeneration = generation;
    const instancesBeforeRead = requestInstances;
    const session = await member.request('/api/session', 'GET', undefined, { origin: null });
    assert.equal(session.status, 200);
    assert.equal(session.data.user.id, 'u01');
    assert.equal((await member.bootstrap()).user.id, 'u01');
    assert.equal(generation, afterLoginGeneration, '인증 조회만으로 저장을 덮어쓰지 않는다');
    assert.equal(requestInstances, instancesBeforeRead + 2);
    assert.equal((await second.login()).status, 200);
    assert.equal((await member.request('/api/session')).data.user.id, 'u01');
  });

  await t.test('비동기 저장소의 여러 사진은 다음 인스턴스에서 다시 읽을 수 있다', async () => {
    const result = await member.request('/api/meals', 'POST', { date, meal: 'breakfast', caption: '클라우드 사진', expectedTeamId: 't1', expectedVersion: 0, photos: [{ imageData }, { imageData }] });
    assert.equal(result.status, 200);
    uploaded = result.data.posts.find(p => p.memberId === 'u01');
    assert.equal(uploaded.photos.length, 2);
    assert.equal(media.size, 2);
    const feed = await member.request(`/api/meals?date=${date}`);
    assert.deepEqual(feed.data.posts.find(p => p.id === uploaded.id), uploaded);
    for (const photo of uploaded.photos) {
      const result = await second.request(photo.url);
      assert.equal(result.status, 200);
      assert.deepEqual(result.data, image);
    }
  });

  await t.test('저장 충돌이 발생하면 개인 기록 성공 응답을 보내지 않는다', async () => {
    const current = await member.bootstrap();
    const before = structuredClone(persisted);
    rejectNextCommit = true;
    const result = await member.request('/api/personal', 'PUT', { ...current.personal, settings: { ...current.personal.settings, name: '실패해야 하는 저장' }, personalRevision: current.personalRevision });
    assert.equal(result.status, 409);
    assert.ok(result.data.error);
    assert.deepEqual(persisted, before);
    assert.equal((await member.bootstrap()).personal.settings.name, current.personal.settings.name);
  });

  await t.test('사진 저장 후 데이터 충돌이 발생하면 새 사진을 정리하고 기존 사진을 유지한다', async () => {
    const before = structuredClone(persisted);
    const beforeIds = [...media.keys()].sort();
    rejectNextCommit = true;
    const result = await member.request('/api/meals', 'POST', { date, meal: 'breakfast', caption: '충돌할 사진', expectedTeamId: 't1', expectedVersion: uploaded.version, photos: [{ imageData }, { imageData }] });
    assert.equal(result.status, 409);
    assert.deepEqual(persisted, before);
    assert.deepEqual([...media.keys()].sort(), beforeIds);
    assert.deepEqual((await member.request(`/api/meals?date=${date}`)).data.posts.find(p => p.id === uploaded.id), uploaded);
  });

  await t.test('여러 사진 중 두 번째 파일 저장 실패도 앞서 올린 새 파일을 정리한다', async () => {
    const before = structuredClone(persisted);
    const beforeIds = [...media.keys()].sort();
    failWriteNumber = writeNumber + 2;
    const result = await member.request('/api/meals', 'POST', { date, meal: 'breakfast', caption: '실패할 업로드', expectedTeamId: 't1', expectedVersion: uploaded.version, photos: [{ imageData }, { imageData }] });
    assert.equal(result.status, 500);
    assert.deepEqual(persisted, before);
    assert.deepEqual([...media.keys()].sort(), beforeIds);
    failWriteNumber = 0;
  });

  await t.test('서로 다른 요청의 오래된 전체 저장본이 최신 자료를 덮어쓰지 않는다', async () => {
    const firstData = await member.bootstrap();
    const secondData = await second.bootstrap();
    const payloads = [
      { ...firstData.personal, settings: { ...firstData.personal.settings, name: '첫 회원 저장' }, personalRevision: firstData.personalRevision },
      { ...secondData.personal, settings: { ...secondData.personal.settings, name: '둘째 회원 저장' }, personalRevision: secondData.personalRevision }
    ];
    let arrivals = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    persistenceBarrier = async () => { if (++arrivals === 2) release(); await barrier; };
    const clients = [member, second];
    const results = await Promise.all(clients.map((c, i) => c.request('/api/personal', 'PUT', payloads[i])));
    persistenceBarrier = null;
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const losingIndex = results.findIndex(r => r.status === 409);
    const fresh = await clients[losingIndex].bootstrap();
    assert.equal((await clients[losingIndex].request('/api/personal', 'PUT', { ...payloads[losingIndex], personalRevision: fresh.personalRevision })).status, 200);
    assert.equal((await member.bootstrap()).personal.settings.name, '첫 회원 저장');
    assert.equal((await second.bootstrap()).personal.settings.name, '둘째 회원 저장');
  });

  await t.test('로그인 저장 실패는 사용 가능한 쿠키나 세션을 만들지 않는다', async () => {
    const before = structuredClone(persisted);
    rejectNextCommit = true;
    const result = await visitor.login();
    assert.equal(result.status, 409);
    assert.equal(result.headers.get('set-cookie'), null);
    assert.deepEqual(persisted, before);
    assert.equal((await visitor.request('/api/session')).data.user, null);
  });

  await t.test('로그아웃은 새 인스턴스에서도 이전 쿠키를 무효화한다', async () => {
    const oldCookie = second.state.cookie;
    assert.equal((await second.request('/api/logout', 'POST', {})).status, 200);
    second.state.cookie = oldCookie;
    assert.equal((await second.request('/api/session')).data.user, null);
    assert.equal((await second.request('/api/bootstrap')).status, 401);
  });

  await t.test('실패한 로그인 시도도 인스턴스 간 보존된다', async () => {
    const before = generation;
    assert.equal((await visitor.request('/api/login', 'POST', { username: 'member03', password: 'wrong-password' })).status, 401);
    assert.equal(generation, before + 1);
    assert.ok(persisted.authState);
    assert.ok(Object.keys(persisted.authState.failures).length > 0);
    const firstFailures = structuredClone(persisted.authState.failures);
    assert.equal((await visitor.request('/api/login', 'POST', { username: 'member03', password: 'wrong-password' })).status, 401);
    assert.notDeepEqual(persisted.authState.failures, firstFailures);
    assert.equal((await visitor.login()).status, 200);
    assert.equal((await visitor.request('/api/session')).data.user.id, 'u03');
  });
});
