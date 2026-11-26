const test = require('node:test');
const assert = require('node:assert/strict');
const { ServerResponse } = require('node:http');
const { createServer, makeUser, seedStore } = require('../server');

function client(app) {
  let cookie = '', csrf = '';
  return async (url, method = 'GET', body, token = csrf) => {
    const req = { url, method, body, socket: { remoteAddress: '127.0.0.1' }, headers: {
      host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', cookie, 'x-csrf-token': token
    } };
    const res = new ServerResponse(req);
    let data;
    res.end = chunk => { data = JSON.parse(chunk); return res; };
    await app.listeners('request')[0](req, res);
    if (res.hasHeader('set-cookie')) cookie = res.getHeader('set-cookie').split(';')[0];
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: res.statusCode, data };
  };
}

test('ordinary box members can log a WOD and privately compare benchmark results across days', async t => {
  // Local midnight rolls over in Korea while it is still Nov 25 UTC.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-25T15:05:00Z') });
  const password = 'test-password-123';
  let store = seedStore({ admin: password }, { demoMembers: false });
  for (const id of ['first', 'second']) store.users.push(makeUser(id, id, id, password));
  const server = () => createServer({ initialStore: store, persistStore: next => { store = next; } });
  const app = server();
  const coach = client(app), member = client(app), other = client(app);
  const wod = date => '/api/wod?date=' + date;
  const record = date => '/api/wod/result?date=' + date;
  const details = { title: 'Fran', description: '21-15-9\nThrusters and pull-ups', benchmarkId: '', revision: 0 };
  const score = { wodRevision: 1, revision: 0, time: '06:03', weight: '65', unit: 'lb', scaling: '밴드 풀업' };
  const login = (request, username) => request('/api/login', 'POST', { username, password });
  assert.equal((await member('/api/wod')).status, 401);
  await login(coach, 'admin');
  const firstLogin = await login(member, 'first');
  await login(other, 'second');
  assert.equal((await member('/api/bootstrap')).data.zondaParticipant, false);
  const blank = await member('/api/wod');
  assert.equal(blank.data.date, '2026-11-26');
  assert.equal(blank.data.wod, null);
  assert.equal((await member(wod('2026-11-23'), 'PUT', details)).status, 403);
  const published = await coach(wod('2026-11-23'), 'PUT', details);
  assert.equal(published.status, 200, JSON.stringify(published.data));
  const { benchmarkId } = published.data.wod;
  assert.ok(benchmarkId);
  assert.equal((await member(record('2026-11-23'), 'PUT', score)).data.result.time, '6:03');
  assert.equal((await other(record('2026-11-23'), 'PUT', { ...score, scaling: 'Rx' })).status, 200);
  assert.equal((await member(record('2026-11-23'), 'PUT', score)).status, 409);
  assert.equal((await coach(wod('2026-11-23'), 'PUT', { ...details, revision: 1 })).status, 409);
  assert.equal((await coach(wod('2026-11-23'), 'PUT', { ...details, benchmarkId, revision: 1, title: '프란' })).status, 200);
  assert.equal((await member(record('2026-11-23'), 'PUT', { ...score, revision: 1 })).status, 409);
  // Reusing the display name alone never mixes two different workouts.
  await coach(wod('2026-11-24'), 'PUT', details);
  assert.equal((await member(wod('2026-11-24'))).data.previous, null);
  await coach(wod('2026-11-26'), 'PUT', { ...details, title: 'Fran (프란)', benchmarkId });
  const replay = (await member('/api/wod')).data;
  assert.equal(replay.previous.date, '2026-11-23');
  assert.equal(replay.previous.title, '프란');
  assert.equal(replay.previous.weight, '65');
  assert.equal(replay.previous.unit, 'lb');
  assert.equal(replay.previous.scaling, '밴드 풀업');
  assert.equal(replay.result, null);
  assert.equal(replay.benchmarks, undefined);
  assert.equal((await other('/api/wod')).data.previous.scaling, 'Rx');
  // The active cookie may belong to a different member if another tab switched accounts.
  const staleTab = await other('/api/wod/history', 'GET', undefined, firstLogin.data.csrfToken);
  assert.equal(staleTab.status, 401);
  assert.equal(staleTab.data.items, undefined);
  assert.equal((await coach('/api/wod')).data.previous, null);
  await member(record('2026-11-26'), 'PUT', { ...score, time: '05:50' });
  const returning = client(server());
  await login(returning, 'first');
  const saved = (await returning('/api/wod/history?memberId=second')).data.items;
  assert.deepEqual(saved.map(row => row.date), ['2026-11-26', '2026-11-23']);
  assert.ok(saved.every(row => row.scaling === '밴드 풀업'));
  const earlier = (await returning('/api/wod/history?before=2026-11-26')).data.items;
  assert.deepEqual(earlier.map(row => row.date), ['2026-11-23']);
  assert.equal((await coach('/api/wod/history')).status, 403);
  assert.equal((await member(wod('2026-02-31'))).status, 422);
  assert.equal((await member(record('2026-11-27'), 'PUT', score)).status, 422);
  assert.equal((await member(record('2026-11-25'), 'PUT', score)).status, 404);
  for (const bad of [{ time: '4:90' }, { weight: '-5' }, { unit: 'g' }]) {
    assert.equal((await member(record('2026-11-26'), 'PUT', { ...score, revision: 1, ...bad })).status, 422);
  }
  assert.equal((await member(record('2026-11-24'), 'PUT', { wodRevision: 1, revision: 0 })).status, 422);

  for (let day = 1; day <= 10; day++) {
    const date = '2026-11-' + String(day).padStart(2, '0');
    assert.equal((await coach(wod(date), 'PUT', { ...details, benchmarkId })).status, 200);
    assert.equal((await member(record(date), 'PUT', score)).status, 200);
  }
  const firstPage = (await member('/api/wod/history')).data;
  const lastPage = (await member('/api/wod/history?before=' + firstPage.nextBefore)).data;
  assert.equal(firstPage.items.length, 10);
  assert.deepEqual(lastPage.items.map(row => row.date), ['2026-11-02', '2026-11-01']);
  assert.equal(lastPage.nextBefore, null);
});

test('named WOD guide pages only the signed-in member’s matching results, including legacy templates and scaling', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T08:00:00Z') });
  const password = 'test-password-123';
  let store = seedStore({ admin: password }, { demoMembers: false });
  store.users.push(makeUser('athlete', 'athlete', 'athlete', password), makeUser('other', 'other', 'other', password));
  store.wods = {};
  store.wodResults = { athlete: {}, other: {} };
  const fixture = (day, title, benchmarkId) => {
    const date = '2026-11-' + String(day).padStart(2, '0');
    store.wods[date] = { benchmarkId, title, description: '이번 주 목표는 Fran 연습', revision: 1 };
    store.wodResults.athlete[date] = { benchmarkId, revision: 1, time: '6:30', scaling: '밴드 풀업' };
  };
  for (let day = 1; day <= 12; day++) fixture(day, 'Fran', 'fran-template');
  fixture(1, 'Fran (Rx’d)', 'straight-fran-1');
  fixture(2, "Fran Rx'd", 'straight-fran-2');
  fixture(3, 'Fran (RxD)', 'straight-fran-3');
  fixture(13, '프란 (Fran)', 'bilingual-template');
  fixture(14, 'FRAN (Scaled)', 'scaled-template');
  fixture(15, '레벤 테스트', 'fran-template');
  fixture(16, 'Double Fran', 'fran-template');
  fixture(17, 'Fran + Cindy', 'fran-template');
  fixture(18, 'François', 'unrelated');
  fixture(19, '기술 연습', 'custom-template');
  fixture(20, 'Fran', 'ambiguous-template');
  fixture(21, 'Cindy', 'ambiguous-template');
  fixture(22, '금요일 수업', 'ambiguous-template');
  fixture(23, '팀프란', 'fran-template');
  fixture(24, 'Fran (Rx’d Team)', 'fran-template');
  store.wodResults.other['2026-11-13'] = { benchmarkId: 'bilingual-template', revision: 1, time: '4:00', scaling: 'Rx' };
  const app = createServer({ initialStore: store, persistStore: next => { store = next; } });
  const athlete = client(app), other = client(app), coach = client(app);
  for (const [request, username] of [[athlete, 'athlete'], [other, 'other'], [coach, 'admin']]) {
    await request('/api/login', 'POST', { username, password });
  }
  const history = '/api/wod/history?guide=fran';
  const page = (await athlete(history + '&memberId=other')).data;
  assert.equal(page.items.length, 10);
  assert.deepEqual(page.items.slice(0, 4).map(row => row.date), ['2026-11-20', '2026-11-15', '2026-11-14', '2026-11-13']);
  assert.ok(page.items.every(row => row.scaling === '밴드 풀업'));
  const secondPage = (await athlete(history + '&before=' + page.nextBefore)).data;
  assert.deepEqual(secondPage.items.map(row => row.date), [6, 5, 4, 3, 2, 1].map(day => '2026-11-0' + day));
  assert.equal(secondPage.nextBefore, null);
  assert.deepEqual((await other(history)).data.items.map(row => row.scaling), ['Rx']);
  assert.equal((await coach(history)).status, 403);
  assert.equal((await athlete('/api/wod/history?guide=double-fran')).status, 422);
  assert.deepEqual((await athlete('/api/wod/history?guide=cindy')).data.items.map(row => row.date), ['2026-11-21']);

  // A coach can correct the only title of a template without orphaning its
  // existing guide association, even if the stored data predates the guide.
  const edit = await coach('/api/wod?date=2026-11-13', 'PUT', {
    title: '박스 타임트라이얼', description: '21-15-9', benchmarkId: 'bilingual-template', revision: 1
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.data.wod.guideId, 'fran');
  assert.equal((await other(history)).data.items[0].title, '박스 타임트라이얼');
});
