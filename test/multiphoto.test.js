const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('한 끼의 여러 사진과 공개 스냅샷 호환성', async t => {
  const { createServer } = require('../server');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zonda-multiphoto-test-'));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const imageA = await fs.readFile(path.join(__dirname, 'fixtures/meal.png'));
  const imageB = await fs.readFile(path.join(__dirname, 'fixtures/meal-replacement.png'));
  const imageDataA = `data:image/png;base64,${imageA.toString('base64')}`;
  const imageDataB = `data:image/png;base64,${imageB.toString('base64')}`;
  let server, base;
  async function start() {
    server = await createServer({ dataDir });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  t.after(async () => { await stop(); await fs.rm(dataDir, { recursive: true, force: true }); });
  function client(username, password) {
    let cookie = '', csrf = '';
    return {
      async request(route, method = 'GET', body) {
        const headers = { Origin: base };
        if (cookie) headers.Cookie = cookie;
        if (csrf) headers['X-CSRF-Token'] = csrf;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const bytes = Buffer.from(await response.arrayBuffer());
        const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : bytes;
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        if (data?.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data };
      },
      async login() { assert.equal((await this.request('/api/login', 'POST', { username, password })).status, 200); },
      async feed(day = date) { return (await this.request(`/api/meals?date=${day}`)).data; },
      async reports(day = date) { return (await this.request(`/api/reports?date=${day}`)).data.reports; }
    };
  }
  const member = client('member02', 'Zonda02!Demo');
  const diet = client('member01', 'Zonda01!Demo');
  const outsider = client('member05', 'Zonda05!Demo');
  const visitor = client('', '');
  const body = (expectedVersion, photos) => ({ date, meal: 'breakfast', caption: '여러 사진 테스트', expectedTeamId: 't1', expectedVersion, photos });
  const ownPost = feed => feed.posts.find(p => p.memberId === 'u02' && p.meal === 'breakfast');
  async function publish() {
    const feed = await diet.feed();
    const result = await diet.request('/api/reports', 'POST', { date, caption: '여러 사진 팀 정리', expectedRevision: feed.revision, expectedReportVersion: feed.report?.version || 0 });
    assert.equal(result.status, 200);
    return result.data.report;
  }
  let post, originalSix, firstReport, editedTwo, secondReport;
  await start();
  await member.login(); await diet.login(); await outsider.login();

  await t.test('한 끼에 두 사진을 순서대로 저장하고 첫 사진과 기록 수를 유지한다', async () => {
    const result = await member.request('/api/meals', 'POST', body(0, [{ imageData: imageDataA }, { imageData: imageDataB }]));
    assert.equal(result.status, 200);
    post = ownPost(result.data);
    assert.equal(post.photos.length, 2);
    assert.equal(post.imageUrl, post.photos[0].url);
    assert.notEqual(post.photos[0].id, post.photos[1].id);
    assert.deepEqual((await member.request(post.photos[0].url)).data, imageA);
    assert.deepEqual((await diet.request(post.photos[1].url)).data, imageB);
    assert.deepEqual(ownPost(await member.feed()).photos, post.photos);
    assert.equal((await member.request('/api/bootstrap')).data.photoMealCounts[date], 1);
  });

  await t.test('두 사진 중 하나만 제거할 수 있으며 마지막 사진 제거는 거부한다', async () => {
    const retained = post.photos[1];
    const edited = await member.request('/api/meals', 'POST', body(post.version, [{ id: retained.id }]));
    assert.equal(edited.status, 200);
    post = ownPost(edited.data);
    assert.deepEqual(post.photos, [retained]);
    assert.equal(post.imageUrl, retained.url);
    assert.equal((await member.request('/api/meals', 'POST', body(post.version, []))).status, 422);
    assert.deepEqual(ownPost(await member.feed()).photos, [retained]);
  });

  await t.test('기존 사진과 새 사진을 섞어 여섯 장까지 저장하고 재시작해도 순서를 유지한다', async () => {
    const retained = post.photos[0];
    const photos = [{ imageData: imageDataA }, { id: retained.id }, ...Array.from({ length: 4 }, () => ({ imageData: imageDataB }))];
    const edited = await member.request('/api/meals', 'POST', body(post.version, photos));
    assert.equal(edited.status, 200);
    post = ownPost(edited.data);
    originalSix = post.photos;
    assert.equal(originalSix.length, 6);
    assert.equal(new Set(originalSix.map(p => p.id)).size, 6);
    assert.deepEqual(originalSix[1], retained);
    assert.equal(post.imageUrl, originalSix[0].url);
    await stop(); await start();
    await member.login(); await diet.login(); await outsider.login();
    assert.deepEqual(ownPost(await member.feed()).photos, originalSix);
    assert.deepEqual((await member.request(originalSix[0].url)).data, imageA);
  });

  await t.test('일곱 장, 중복 ID, 다른 회원 사진 재사용, 혼합 형식은 저장하지 않는다', async () => {
    const foreign = await outsider.request('/api/meals', 'POST', { date, meal: 'lunch', caption: '다른 팀 사진', expectedTeamId: 't2', expectedVersion: 0, photos: [{ imageData: imageDataA }] });
    assert.equal(foreign.status, 200);
    const foreignId = foreign.data.posts[0].photos[0].id;
    const invalid = [
      body(post.version, Array.from({ length: 7 }, () => ({ imageData: imageDataA }))),
      body(post.version, [{ id: post.photos[0].id }, { id: post.photos[0].id }]),
      body(post.version, [{ id: foreignId }]),
      { ...body(post.version, [{ id: post.photos[0].id }]), imageData: imageDataB }
    ];
    for (const payload of invalid) assert.equal((await member.request('/api/meals', 'POST', payload)).status, 422);
    assert.deepEqual(ownPost(await member.feed()), post);
  });

  await t.test('여러 사진 중 하나가 잘못되면 기록·사진 파일을 전혀 추가하지 않는다', async () => {
    const storeBefore = await fs.readFile(path.join(dataDir, 'store.json'), 'utf8');
    const filesBefore = (await fs.readdir(path.join(dataDir, 'media'))).sort();
    const payload = body(post.version, [{ imageData: imageDataA }, { imageData: 'data:image/png;base64,invalid' }]);
    assert.equal((await member.request('/api/meals', 'POST', payload)).status, 422);
    assert.equal(await fs.readFile(path.join(dataDir, 'store.json'), 'utf8'), storeBefore);
    assert.deepEqual((await fs.readdir(path.join(dataDir, 'media'))).sort(), filesBefore);
  });

  await t.test('공개 전 사진 여섯 장은 같은 팀만 보고 공개 후 모든 회원이 본다', async () => {
    for (const photo of originalSix) {
      assert.equal((await outsider.request(photo.url)).status, 403);
      assert.equal((await diet.request(photo.url)).status, 200);
    }
    firstReport = await publish();
    assert.equal(firstReport.completedCount, 1);
    assert.equal(firstReport.expectedCount, 12);
    assert.deepEqual(firstReport.posts[0].photos, originalSix);
    for (const photo of originalSix) {
      assert.equal((await outsider.request(photo.url)).status, 200);
      assert.equal((await visitor.request(photo.url)).status, 401);
    }
  });

  await t.test('새 사진으로 바꿔도 이전 공개 스냅샷과 공개 범위는 재게시까지 유지된다', async () => {
    const result = await member.request('/api/meals', 'POST', body(post.version, [{ imageData: imageDataB }, { imageData: imageDataA }]));
    assert.equal(result.status, 200);
    post = ownPost(result.data);
    editedTwo = post.photos;
    assert.equal(editedTwo.length, 2);
    assert.deepEqual((await outsider.reports()).find(r => r.teamId === 't1'), firstReport);
    for (const photo of editedTwo) assert.equal((await outsider.request(photo.url)).status, 403);
    for (const photo of originalSix) assert.equal((await outsider.request(photo.url)).status, 200);
    secondReport = await publish();
    assert.equal(secondReport.version, 2);
    assert.deepEqual(secondReport.posts[0].photos, editedTwo);
    for (const photo of editedTwo) assert.equal((await outsider.request(photo.url)).status, 200);
    for (const photo of originalSix) assert.equal((await outsider.request(photo.url)).status, 403);
  });

  await t.test('여러 사진과 공개 리포트가 재시작 뒤에도 유지된다', async () => {
    await stop(); await start();
    await member.login(); await diet.login(); await outsider.login();
    assert.deepEqual(ownPost(await member.feed()).photos, editedTwo);
    assert.deepEqual((await outsider.reports()).find(r => r.teamId === 't1'), secondReport);
    for (const photo of editedTwo) assert.equal((await outsider.request(photo.url)).status, 200);
  });

  await t.test('사진 필드 없이 설명만 바꾸면 기존 사진 전체를 보존한다', async () => {
    const result = await member.request('/api/meals', 'POST', { date, meal: 'breakfast', caption: '설명만 변경', expectedTeamId: 't1', expectedVersion: post.version });
    assert.equal(result.status, 200);
    post = ownPost(result.data);
    assert.deepEqual(post.photos, editedTwo);
    assert.equal(post.caption, '설명만 변경');
    assert.deepEqual((await outsider.reports()).find(r => r.teamId === 't1'), secondReport);
  });

  await t.test('기존 단일 사진 요청과 저장 파일·공개 리포트도 계속 읽고 수정할 수 있다', async () => {
    const legacyDate = '2026-01-01';
    const created = await member.request('/api/meals', 'POST', { date: legacyDate, meal: 'dinner', caption: '이전 단일 사진', imageData: imageDataA, expectedTeamId: 't1', expectedVersion: 0 });
    assert.equal(created.status, 200);
    const legacyPost = created.data.posts.find(p => p.memberId === 'u02' && p.meal === 'dinner');
    assert.equal(legacyPost.photos.length, 1);
    const feed = await diet.feed(legacyDate);
    const published = await diet.request('/api/reports', 'POST', { date: legacyDate, caption: '이전 리포트', expectedRevision: feed.revision, expectedReportVersion: 0 });
    assert.equal(published.status, 200);
    await stop();
    const stored = JSON.parse(await fs.readFile(path.join(dataDir, 'store.json'), 'utf8'));
    const oldPost = stored.mealPosts.find(p => p.id === legacyPost.id);
    oldPost.mediaId = legacyPost.photos[0].id;
    delete oldPost.mediaIds;
    const oldReport = stored.mealReports.find(r => r.date === legacyDate && r.teamId === 't1');
    for (const entry of oldReport.posts) delete entry.photos;
    await fs.writeFile(path.join(dataDir, 'store.json'), JSON.stringify(stored));
    await start(); await member.login(); await diet.login(); await outsider.login();
    const restored = (await member.feed(legacyDate)).posts.find(p => p.id === legacyPost.id);
    assert.equal(restored.photos.length, 1);
    assert.equal(restored.photos[0].url, legacyPost.imageUrl);
    assert.deepEqual((await outsider.request(legacyPost.imageUrl)).data, imageA);
    const saved = await member.request('/api/meals', 'POST', { date: legacyDate, meal: 'dinner', caption: '이전 자료에 사진 추가', photos: [{ id: restored.photos[0].id }, { imageData: imageDataB }], expectedTeamId: 't1', expectedVersion: restored.version });
    assert.equal(saved.status, 200);
    const converted = saved.data.posts.find(p => p.id === legacyPost.id);
    assert.equal(converted.photos.length, 2);
    assert.equal(converted.photos[0].url, legacyPost.imageUrl);
    assert.equal((await outsider.request(converted.photos[1].url)).status, 403);
  });
});
