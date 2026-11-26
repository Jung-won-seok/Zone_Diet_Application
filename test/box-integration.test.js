const test = require('node:test');
const assert = require('node:assert/strict');
const {ServerResponse} = require('node:http');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {createServer} = require('../server');

function client(server) {
  const handler = server.listeners('request')[0];
  let cookie = '', csrf = '';
  return async (url, method = 'GET', body) => {
    // Exercise the same parsed-body request listener used by api/handler.js.
    const req = {method, url, body, socket: {remoteAddress: '127.0.0.1'}, headers: {
      host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json',
      cookie, 'x-csrf-token': csrf
    }};
    const res = new ServerResponse(req);
    let raw = '';
    res.end = chunk => { raw = String(chunk ?? ''); return res; };
    await handler(req, res);
    const data = JSON.parse(raw);
    if (data.csrfToken) csrf = data.csrfToken;
    if (res.hasHeader('set-cookie')) cookie = res.getHeader('set-cookie').split(';')[0];
    return {status: res.statusCode, data};
  };
}

test('a registered box member can book independently of Zonda and keeps their reservation on enrollment and restart', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'crossfit-box-integration-'));
  t.after(() => rm(dataDir, {recursive: true, force: true}));
  t.mock.timers.enable({apis: ['Date'], now: new Date('2026-11-25T00:01:00Z')});
  const app = createServer({dataDir});
  const admin = client(app), member = client(app), legacy = client(app);
  const date = '2026-11-25', startTime = '20:30', schedule = '/api/reservations?date=' + date;
  const classAt = result => {
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.classes.find(slot => slot.startTime === startTime);
  };
  const credentials = {username: 'boxmember21', password: 'Growth-test-member21'};
  assert.equal((await member(schedule)).status, 401);
  assert.equal((await admin('/api/login', 'POST', {username: 'admin', password: 'ZondaAdmin!Demo27'})).status, 200);
  assert.equal((await legacy('/api/login', 'POST', {username: 'member01', password: 'Zonda01!Demo'})).status, 200);

  const created = await admin('/api/admin/members', 'POST', {...credentials, name: '예약 회원', zonda: false});
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.members.length, 21);
  const memberId = created.data.members.find(row => row.username === credentials.username).id;
  assert.equal((await admin('/api/bootstrap')).data.members.length, 20);
  assert.equal((await legacy('/api/meals')).status, 200);
  assert.equal((await member('/api/login', 'POST', credentials)).status, 200);
  const boxOnly = (await member('/api/bootstrap')).data;
  assert.equal(boxOnly.zondaParticipant, false);
  assert.deepEqual(boxOnly.members, []);
  assert.deepEqual(boxOnly.teams, []);
  assert.equal(boxOnly.personal, null);
  for (const url of ['/api/admin/members', '/api/meals', '/api/reports', '/api/naver/onboarding']) {
    assert.equal((await member(url)).status, 403, url);
  }
  assert.equal((await member('/api/personal', 'PUT', {})).status, 403);

  const reservation = await member('/api/reservations', 'POST', {date, startTime, action: 'reserve'});
  assert.equal(classAt(reservation).myStatus, 'confirmed');
  const duplicateDay = await member('/api/reservations', 'POST', {date, startTime: '21:30', action: 'reserve'});
  assert.equal(duplicateDay.status, 409);
  assert.equal(classAt(await admin(schedule)).confirmed[0].id, memberId);
  const otherView = classAt(await legacy(schedule));
  assert.equal(otherView.confirmedCount, 1);
  assert.equal(otherView.confirmed, undefined);
  assert.equal(otherView.myStatus, null);

  const enrollment = await admin('/api/admin/members/enroll', 'POST', {memberId});
  assert.equal(enrollment.status, 200, JSON.stringify(enrollment.data));
  assert.equal(enrollment.data.members.find(row => row.id === memberId).zonda, true);
  assert.equal((await admin('/api/bootstrap')).data.members.length, 21);
  assert.equal((await member('/api/bootstrap')).data.zondaParticipant, true);
  assert.equal((await member('/api/meals')).status, 200);
  assert.equal(classAt(await member(schedule)).myStatus, 'confirmed');

  const returning = client(createServer({dataDir}));
  assert.equal((await returning('/api/login', 'POST', credentials)).status, 200);
  assert.equal(classAt(await returning(schedule)).myStatus, 'confirmed');
  const changed = await returning('/api/reservations', 'POST', {date, fromStartTime: startTime, startTime: '21:30', action: 'change'});
  assert.equal(changed.status, 200);
  assert.equal(classAt(changed).confirmedCount, 0);
  assert.equal(changed.data.classes.find(slot => slot.startTime === '21:30').myStatus, 'confirmed');
  const canceled = await returning('/api/reservations', 'POST', {date, startTime: '21:30', action: 'cancel'});
  assert.equal(canceled.data.myClassStartTime, null);
});
