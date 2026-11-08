const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('팀 식단 사진과 식단 담당자의 전체 공개 리포트', async t => {
  const { createServer } = require('../server');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zonda-meals-test-'));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const originalImage = await fs.readFile(path.join(__dirname, 'fixtures/meal.png'));
  const replacementImage = await fs.readFile(path.join(__dirname, 'fixtures/meal-replacement.png'));
  const imageData = `data:image/png;base64,${originalImage.toString('base64')}`;
  const changedImageData = `data:image/png;base64,${replacementImage.toString('base64')}`;
  let server;
  let base;
  async function start() {
    server = await createServer({ dataDir });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  t.after(async () => { await stop(); await fs.rm(dataDir, { recursive: true, force: true }); });
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
        const bytes = Buffer.from(await response.arrayBuffer());
        const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : bytes;
        const cookie = response.headers.get('set-cookie');
        if (cookie) state.cookie = cookie.split(';')[0];
        if (data?.csrfToken) state.csrf = data.csrfToken;
        return { status: response.status, data, headers: response.headers };
      },
      login(username, password) { return this.request('/api/login', 'POST', { username, password }); },
      meals() { return this.request(`/api/meals?date=${date}`); },
      reports() { return this.request(`/api/reports?date=${date}`); }
    };
  }
  const visitor = client(), admin = client(), diet = client(), member = client(), outsider = client();
  const assignmentRows = data => data.members.map(({ id, teamId, role, customRole }) => ({ id, teamId, role, customRole }));
  let initialFeed;
  let firstReport;
  let secondReport;
  let originalPhoto;
  let changedPhoto;
  await start();
  assert.equal((await admin.login('admin', 'ZondaAdmin!Demo27')).status, 200);
  assert.equal((await diet.login('member01', 'Zonda01!Demo')).status, 200);
  assert.equal((await member.login('member02', 'Zonda02!Demo')).status, 200);
  assert.equal((await outsider.login('member05', 'Zonda05!Demo')).status, 200);

  await t.test('식단과 리포트 조회 및 업로드는 로그인이 필요하다', async () => {
    assert.equal((await visitor.meals()).status, 401);
    assert.equal((await visitor.reports()).status, 401);
    assert.equal((await visitor.request('/api/meals', 'POST', { date, meal: 'breakfast', caption: '', imageData, expectedTeamId: 't1', expectedVersion: 0 })).status, 401);
  });

  await t.test('회원이 아침·점심·저녁 사진을 올리고 팀원이 확인한다', async () => {
    for (const meal of ['breakfast', 'lunch', 'dinner']) {
      const upload = await member.request('/api/meals', 'POST', { date, meal, caption: `${meal} 테스트 사진`, imageData, expectedTeamId: 't1', expectedVersion: 0 });
      assert.equal(upload.status, 200);
      assert.equal(upload.data.posts.find(p => p.memberId === 'u02' && p.meal === meal).version, 1);
    }
    initialFeed = (await diet.meals()).data;
    assert.equal(initialFeed.members.length, 4);
    assert.equal(initialFeed.posts.length, 3);
    assert.equal(initialFeed.canPublish, true);
    assert.equal((await member.meals()).data.canPublish, false);
    originalPhoto = initialFeed.posts.find(p => p.meal === 'breakfast').imageUrl;
    const photo = await diet.request(originalPhoto);
    assert.equal(photo.status, 200);
    assert.match(photo.headers.get('content-type'), /^image\/png/);
    assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(photo.data, originalImage);
    assert.equal((await member.request('/api/bootstrap')).data.photoMealCounts[date], 3);
    assert.equal((await diet.request('/api/bootstrap')).data.photoMealCounts[date], undefined);
    assert.equal((await outsider.request('/api/bootstrap')).data.photoMealCounts[date], undefined);
  });

  await t.test('사진을 다시 올리지 않고 설명만 수정할 수 있다', async () => {
    const oldLunch = initialFeed.posts.find(p => p.meal === 'lunch');
    const edited = await member.request('/api/meals', 'POST', { date, meal: 'lunch', caption: '사진을 유지하고 설명만 수정', expectedTeamId: 't1', expectedVersion: 1 });
    assert.equal(edited.status, 200);
    const lunch = edited.data.posts.find(p => p.meal === 'lunch');
    assert.equal(lunch.version, 2);
    assert.equal(lunch.imageUrl, oldLunch.imageUrl);
    assert.equal(lunch.caption, '사진을 유지하고 설명만 수정');
    initialFeed = (await diet.meals()).data;
  });

  await t.test('공개 전에는 다른 팀이 피드 또는 사진에 접근할 수 없다', async () => {
    const ownFeed = (await outsider.meals()).data;
    assert.equal(ownFeed.posts.length, 0);
    assert.ok(ownFeed.members.every(m => m.id !== 'u02'));
    assert.equal((await outsider.request(`/api/meals?date=${date}&teamId=t1`)).status, 403);
    assert.equal((await member.request(`/api/meals?date=${date}&teamId=t1`)).status, 403);
    assert.equal((await outsider.request(originalPhoto)).status, 403);
    assert.equal((await visitor.request(originalPhoto)).status, 401);
    assert.equal((await admin.request(originalPhoto)).status, 200);
    assert.equal((await admin.request(`/api/meals?date=${date}&teamId=t1`)).data.posts.length, 3);
    assert.equal((await outsider.request('/api/reports', 'POST', { date, caption: '', expectedRevision: ownFeed.revision, expectedReportVersion: 0 })).status, 422);
  });

  await t.test('식단 담당자만 공개할 수 있고 CSRF 없이 업로드할 수 없다', async () => {
    const report = { date, caption: '팀 식단 정리', expectedRevision: initialFeed.revision, expectedReportVersion: 0 };
    assert.equal((await member.request('/api/reports', 'POST', report)).status, 403);
    assert.equal((await admin.request('/api/reports', 'POST', report)).status, 403);
    assert.equal((await member.request('/api/meals', 'POST', { date, meal: 'breakfast', caption: '', imageData, expectedTeamId: 't1', expectedVersion: 1 }, { 'X-CSRF-Token': '' })).status, 403);
  });

  await t.test('사진 일부만 모여도 누락 수를 확인할 수 있는 리포트를 공개한다', async () => {
    const publish = await diet.request('/api/reports', 'POST', { date, caption: '한 회원의 세 끼가 등록됐어요.', expectedRevision: initialFeed.revision, expectedReportVersion: 0 });
    assert.equal(publish.status, 200);
    firstReport = publish.data.report;
    assert.equal(firstReport.version, 1);
    assert.equal(firstReport.teamId, 't1');
    assert.equal(firstReport.members.length, 4);
    assert.equal(firstReport.completedCount, 3);
    assert.equal(firstReport.expectedCount, 12);
    assert.equal(firstReport.expectedCount - firstReport.completedCount, 9);
    assert.equal(firstReport.posts.length, 3);
    assert.equal(firstReport.publishedBy.id, 'u01');
    const publicReport = (await outsider.reports()).data.reports.find(r => r.teamId === 't1');
    assert.deepEqual(publicReport, firstReport);
    assert.equal((await outsider.request(originalPhoto)).status, 200);
    assert.equal((await visitor.request(originalPhoto)).status, 401);
  });

  await t.test('사진 변경이 없어도 오래된 리포트 화면으로 게시 내용을 덮어쓸 수 없다', async () => {
    const reviewed = (await diet.meals()).data;
    assert.equal(reviewed.revision, firstReport.sourceRevision);
    const stale = await diet.request('/api/reports', 'POST', { date, caption: '오래된 창의 설명', expectedRevision: reviewed.revision, expectedReportVersion: 0 });
    assert.equal(stale.status, 409);
    assert.deepEqual((await outsider.reports()).data.reports.find(r => r.teamId === 't1'), firstReport);
  });

  await t.test('사진을 바꿔도 공개된 리포트 원본은 재공개 전까지 유지된다', async () => {
    const upload = await member.request('/api/meals', 'POST', { date, meal: 'breakfast', caption: '새 아침 사진', imageData: changedImageData, expectedTeamId: 't1', expectedVersion: 1 });
    assert.equal(upload.status, 200);
    const breakfast = upload.data.posts.find(p => p.meal === 'breakfast');
    assert.equal(breakfast.version, 2);
    changedPhoto = breakfast.imageUrl;
    assert.notEqual(changedPhoto, originalPhoto);
    assert.deepEqual((await member.request(changedPhoto)).data, replacementImage);
    assert.deepEqual((await diet.request(originalPhoto)).data, originalImage);
    assert.equal((await outsider.request(changedPhoto)).status, 403);
    assert.equal((await outsider.request(originalPhoto)).status, 200);
    assert.deepEqual((await outsider.reports()).data.reports.find(r => r.teamId === 't1'), firstReport);
  });

  await t.test('오래된 사진 버전과 리포트 검토본은 저장을 거부한다', async () => {
    assert.equal((await member.request('/api/meals', 'POST', { date, meal: 'breakfast', caption: '오래된 저장', imageData, expectedTeamId: 't1', expectedVersion: 1 })).status, 409);
    assert.equal((await diet.request('/api/reports', 'POST', { date, caption: '오래된 검토본', expectedRevision: initialFeed.revision, expectedReportVersion: 1 })).status, 409);
    assert.equal((await member.meals()).data.posts.find(p => p.meal === 'breakfast').imageUrl, changedPhoto);
    assert.deepEqual((await outsider.reports()).data.reports.find(r => r.teamId === 't1'), firstReport);
  });

  await t.test('검토 후 팀 편성이 바뀌어도 리포트 저장 충돌을 감지한다', async () => {
    const reviewed = (await diet.meals()).data;
    const adminData = (await admin.request('/api/bootstrap')).data;
    const rows = assignmentRows(adminData);
    rows.find(m => m.id === 'u09').role = 'leader';
    rows.find(m => m.id === 'u10').role = 'diet';
    assert.equal((await admin.request('/api/admin/assignments', 'PUT', { revision: adminData.revision, members: rows })).status, 200);
    assert.equal((await diet.request('/api/reports', 'POST', { date, caption: '배정 변경 전 검토본', expectedRevision: reviewed.revision, expectedReportVersion: 1 })).status, 409);
  });

  await t.test('최신 사진으로 재공개하면 새 스냅샷만 다른 팀에 공개된다', async () => {
    const current = (await diet.meals()).data;
    const publish = await diet.request('/api/reports', 'POST', { date, caption: '아침 사진을 수정해 다시 공유합니다.', expectedRevision: current.revision, expectedReportVersion: 1 });
    assert.equal(publish.status, 200);
    secondReport = publish.data.report;
    assert.equal(secondReport.id, firstReport.id);
    assert.equal(secondReport.version, 2);
    assert.equal(secondReport.posts.find(p => p.meal === 'breakfast').imageUrl, changedPhoto);
    assert.equal((await outsider.request(changedPhoto)).status, 200);
    assert.equal((await outsider.request(originalPhoto)).status, 403);
    assert.deepEqual((await outsider.reports()).data.reports.find(r => r.teamId === 't1'), secondReport);
  });

  await t.test('잘못된 날짜, 이미지 유형, SVG, 크기 초과를 저장하지 않는다', async () => {
    assert.equal((await diet.request('/api/meals?date=2026-02-30')).status, 422);
    assert.equal((await diet.request('/api/reports?date=2099-01-01')).status, 422);
    const body = { date, meal: 'breakfast', caption: '', imageData, expectedTeamId: 't1', expectedVersion: 0 };
    const invalid = [
      { ...body, date: '2099-01-01' },
      { ...body, meal: 'snack' },
      { ...body, imageData: `data:image/jpeg;base64,${originalImage.toString('base64')}` },
      { ...body, imageData: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}` },
      { ...body, imageData: 'data:image/png;base64,invalid' }
    ];
    for (const item of invalid) assert.equal((await diet.request('/api/meals', 'POST', item)).status, 422);
    const large = Buffer.alloc(2 * 1024 * 1024 + 1);
    originalImage.copy(large);
    assert.equal((await diet.request('/api/meals', 'POST', { ...body, imageData: `data:image/png;base64,${large.toString('base64')}` })).status, 413);
    const oversizedRequest = Buffer.alloc(3 * 1024 * 1024 + 1);
    assert.equal((await diet.request('/api/meals', 'POST', { ...body, imageData: `data:image/png;base64,${oversizedRequest.toString('base64')}` })).status, 413);
    assert.equal((await diet.meals()).data.posts.length, 3);
  });

  await t.test('식단 역할을 바꾸면 기존 담당자의 공개 권한이 즉시 사라진다', async () => {
    const adminData = (await admin.request('/api/bootstrap')).data;
    const rows = assignmentRows(adminData);
    rows.find(m => m.id === 'u01').role = 'leader';
    rows.find(m => m.id === 'u02').role = 'diet';
    assert.equal((await admin.request('/api/admin/assignments', 'PUT', { revision: adminData.revision, members: rows })).status, 200);
    const previous = (await diet.meals()).data;
    assert.equal(previous.canPublish, false);
    assert.equal((await diet.request('/api/reports', 'POST', { date, caption: '', expectedRevision: previous.revision, expectedReportVersion: 2 })).status, 403);
    assert.equal((await member.meals()).data.canPublish, true);
  });

  await t.test('다른 팀으로 이동한 뒤 이전 팀 화면에서 저장해도 새 팀에 사진을 올리지 않는다', async () => {
    const originalRoster = (await admin.request('/api/bootstrap')).data;
    const movedRows = assignmentRows(originalRoster);
    Object.assign(movedRows.find(m => m.id === 'u02'), { teamId: 't2', role: 'other', customRole: '기록 담당' });
    assert.equal((await admin.request('/api/admin/assignments', 'PUT', { revision: originalRoster.revision, members: movedRows })).status, 200);
    const newTeamFeed = (await member.meals()).data;
    assert.equal(newTeamFeed.team.id, 't2');
    assert.equal(newTeamFeed.posts.length, 0);
    const before = JSON.parse(await fs.readFile(path.join(dataDir, 'store.json'), 'utf8'));
    const staleUpload = await member.request('/api/meals', 'POST', {
      date, meal: 'breakfast', caption: '이전 팀 화면에서 준비한 사진', imageData,
      expectedTeamId: 't1', expectedVersion: 2
    });
    assert.equal(staleUpload.status, 409);
    const after = JSON.parse(await fs.readFile(path.join(dataDir, 'store.json'), 'utf8'));
    assert.deepEqual(after.mealPosts, before.mealPosts);
    assert.deepEqual(after.media, before.media);
    assert.equal((await member.meals()).data.posts.length, 0);
    assert.equal(after.mealPosts.filter(p => p.memberId === 'u02' && p.teamId === 't1').length, 3);
    assert.equal(after.mealPosts.find(p => p.memberId === 'u02' && p.teamId === 't1' && p.meal === 'breakfast').version, 2);
    const current = (await admin.request('/api/bootstrap')).data;
    assert.equal((await admin.request('/api/admin/assignments', 'PUT', { revision: current.revision, members: assignmentRows(originalRoster) })).status, 200);
    assert.equal((await member.meals()).data.posts.length, 3);
  });

  await t.test('사진과 공개 스냅샷은 서버 재시작 뒤에도 유지된다', async () => {
    await stop();
    await start();
    assert.equal((await member.login('member02', 'Zonda02!Demo')).status, 200);
    assert.equal((await outsider.login('member05', 'Zonda05!Demo')).status, 200);
    assert.equal((await member.meals()).data.posts.find(p => p.meal === 'breakfast').version, 2);
    assert.deepEqual((await outsider.reports()).data.reports.find(r => r.teamId === 't1'), secondReport);
    assert.deepEqual((await outsider.request(changedPhoto)).data, replacementImage);
    assert.equal((await outsider.request(originalPhoto)).status, 403);
    assert.equal((await visitor.request(changedPhoto)).status, 401);
  });
});
