const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('끼니별 탄단지 블록과 사진 기록', async t => {
  const { createServer } = require('../server');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zonda-blocks-test-'));
  const date = '2026-01-15';
  const empty = { carbs: null, protein: null, fat: null };
  const bytes = await fs.readFile(path.join(__dirname, 'fixtures/meal.png'));
  const imageData = `data:image/png;base64,${bytes.toString('base64')}`;
  let server, base;
  async function start() {
    server = createServer({ dataDir });
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
      async request(route, method = 'GET', body, options = {}) {
        const headers = { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, ...options };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json();
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        if (data.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data };
      },
      async login() { assert.equal((await this.request('/api/login', 'POST', { username, password })).status, 200); },
      async feed(day = date) { return (await this.request(`/api/meals?date=${day}`)).data; },
      async reports(day = date) { return (await this.request(`/api/reports?date=${day}`)).data.reports; },
    };
  }
  const member = client('member02', 'Zonda02!Demo');
  const diet = client('member01', 'Zonda01!Demo');
  const outsider = client('member05', 'Zonda05!Demo');
  const ownPost = (feed, meal) => feed.posts.find(post => post.memberId === 'u02' && post.meal === meal);
  const mealBody = (meal, expectedVersion, extra = {}) => ({ date, meal, caption: '', expectedTeamId: 't1', expectedVersion, ...extra });
  async function publish(day = date) {
    const feed = await diet.feed(day);
    const result = await diet.request('/api/reports', 'POST', { date: day, caption: '오늘의 식단', expectedRevision: feed.revision, expectedReportVersion: feed.report?.version || 0 });
    assert.equal(result.status, 200);
    return result.data.report;
  }
  await start(); await member.login(); await diet.login(); await outsider.login();
  let breakfast, lunch, dinner, firstReport;

  await t.test('사진 없이 0블록을 저장하고 미입력과 구분한다', async () => {
    const result = await member.request('/api/meals', 'POST', mealBody('breakfast', 0, { photos: [], blocks: { carbs: 0, protein: null, fat: 0.5 } }));
    assert.equal(result.status, 200);
    breakfast = ownPost(result.data, 'breakfast');
    assert.deepEqual(breakfast.blocks, { carbs: 0, protein: null, fat: 0.5 });
    assert.deepEqual(breakfast.photos, []);
    assert.equal(breakfast.imageUrl, '');
    assert.equal((await member.request('/api/bootstrap')).data.photoMealCounts[date], undefined);
  });

  await t.test('사진 여러 장과 소수점 두 자리 블록을 함께 저장한다', async () => {
    const result = await member.request('/api/meals', 'POST', mealBody('lunch', 0, { photos: [{ imageData }, { imageData }], blocks: { carbs: 3.25, protein: 4.1, fat: 2 } }));
    assert.equal(result.status, 200);
    lunch = ownPost(result.data, 'lunch');
    assert.equal(lunch.photos.length, 2);
    assert.deepEqual(lunch.blocks, { carbs: 3.25, protein: 4.1, fat: 2 });
    assert.equal((await member.request('/api/bootstrap')).data.photoMealCounts[date], 1);
  });

  await t.test('이전 방식의 사진 등록과 블록을 생략한 수정은 호환된다', async () => {
    const created = await member.request('/api/meals', 'POST', mealBody('dinner', 0, { imageData }));
    assert.equal(created.status, 200);
    dinner = ownPost(created.data, 'dinner');
    assert.deepEqual(dinner.blocks, empty);
    const edited = await member.request('/api/meals', 'POST', mealBody('lunch', lunch.version, { caption: '점심 메모 수정' }));
    assert.equal(edited.status, 200);
    const saved = ownPost(edited.data, 'lunch');
    assert.deepEqual(saved.blocks, lunch.blocks);
    assert.deepEqual(saved.photos, lunch.photos);
    lunch = saved;
  });

  await t.test('잘못된 블록은 사진 파일이나 기존 기록을 변경하지 않는다', async () => {
    const storeBefore = await fs.readFile(path.join(dataDir, 'store.json'), 'utf8');
    const mediaBefore = (await fs.readdir(path.join(dataDir, 'media'))).sort();
    const invalid = [null, [], {}, { carbs: 1, protein: 1 }, { carbs: 1, protein: 1, fat: 1, extra: 0 },
      { carbs: '3', protein: 1, fat: 1 }, { carbs: -0.1, protein: 1, fat: 1 }, { carbs: 100.01, protein: 1, fat: 1 },
      { carbs: 0.001, protein: 1, fat: 1 }, { carbs: true, protein: 1, fat: 1 }, { carbs: {}, protein: 1, fat: 1 }];
    for (const blocks of invalid) {
      const result = await member.request('/api/meals', 'POST', mealBody('lunch', lunch.version, { photos: [{ imageData }], blocks }));
      assert.equal(result.status, 422, JSON.stringify(blocks));
    }
    assert.equal(await fs.readFile(path.join(dataDir, 'store.json'), 'utf8'), storeBefore);
    assert.deepEqual((await fs.readdir(path.join(dataDir, 'media'))).sort(), mediaBefore);
    const blank = await member.request('/api/meals', 'POST', mealBody('breakfast', breakfast.version, { photos: [], blocks: empty }));
    assert.equal(blank.status, 422);
    assert.deepEqual(ownPost(await member.feed(), 'breakfast'), breakfast);
  });

  await t.test('블록 수정도 버전·팀·CSRF 권한을 확인한다', async () => {
    const update = mealBody('breakfast', breakfast.version, { blocks: { carbs: 2, protein: 3, fat: 1 } });
    assert.equal((await member.request('/api/meals', 'POST', { ...update, expectedVersion: 0 })).status, 409);
    assert.equal((await member.request('/api/meals', 'POST', { ...update, expectedTeamId: 't2' })).status, 409);
    assert.equal((await member.request('/api/meals', 'POST', update, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await outsider.request(`/api/meals?date=${date}&teamId=t1`)).status, 403);
    assert.deepEqual(ownPost(await member.feed(), 'breakfast'), breakfast);
  });

  await t.test('공유된 블록과 사진은 원본을 바꿔도 재공유 전까지 보존한다', async () => {
    firstReport = await publish();
    assert.equal(firstReport.posts.length, 3);
    assert.deepEqual(firstReport.posts.find(p => p.meal === 'breakfast').blocks, breakfast.blocks);
    assert.deepEqual(firstReport.posts.find(p => p.meal === 'breakfast').photos, []);
    const changed = await member.request('/api/meals', 'POST', mealBody('lunch', lunch.version, { photos: [], blocks: { carbs: 5, protein: 6, fat: null } }));
    assert.equal(changed.status, 200);
    lunch = ownPost(changed.data, 'lunch');
    assert.deepEqual(lunch.photos, []);
    assert.deepEqual(lunch.blocks, { carbs: 5, protein: 6, fat: null });
    assert.deepEqual((await outsider.reports()).find(r => r.teamId === 't1'), firstReport);
    assert.equal((await member.request('/api/bootstrap')).data.photoMealCounts[date], 1);
  });

  await t.test('사진 없는 블록 기록만으로도 팀 공유가 가능하다', async () => {
    const day = '2026-01-16';
    const saved = await member.request('/api/meals', 'POST', { ...mealBody('dinner', 0, { blocks: { carbs: 0, protein: 0, fat: 0 } }), date: day });
    assert.equal(saved.status, 200);
    const report = await publish(day);
    assert.equal(report.completedCount, 1);
    assert.deepEqual(report.posts[0].blocks, { carbs: 0, protein: 0, fat: 0 });
    assert.deepEqual(report.posts[0].photos, []);
    assert.equal((await member.request('/api/bootstrap')).data.photoMealCounts[day], undefined);
  });

  await t.test('재시작 후 값과 공개 스냅샷을 보존하고 이전 기록은 미입력으로 읽는다', async () => {
    await stop();
    const storeFile = path.join(dataDir, 'store.json');
    const stored = JSON.parse(await fs.readFile(storeFile, 'utf8'));
    delete stored.mealPosts.find(post => post.id === dinner.id).blocks;
    delete stored.mealReports.find(report => report.date === date).posts.find(post => post.id === dinner.id).blocks;
    await fs.writeFile(storeFile, JSON.stringify(stored));
    await start(); await member.login(); await diet.login(); await outsider.login();
    const feed = await member.feed();
    assert.deepEqual(ownPost(feed, 'breakfast').blocks, breakfast.blocks);
    assert.deepEqual(ownPost(feed, 'lunch').blocks, lunch.blocks);
    assert.deepEqual(ownPost(feed, 'dinner').blocks, empty);
    assert.deepEqual(feed.report, firstReport);
    assert.deepEqual((await outsider.reports()).find(r => r.teamId === 't1'), firstReport);
    const report = await publish();
    assert.equal(report.version, 2);
    assert.deepEqual(report.posts.find(p => p.meal === 'lunch').blocks, lunch.blocks);
  });
});
