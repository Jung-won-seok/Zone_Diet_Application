const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoxMemberService } = require('../server/services/members');
const { ApiError } = require('../server');

const accounts = '/api/admin/members';
const applicant = { name: '박스 회원', username: 'new-member', password: 'initial-pass-123' };

function fixture() {
  const legacy = { id: 'u01', username: 'member01', name: '기존 회원', salt: 'salt', passwordHash: 'original' };
  const assignment = { id: legacy.id, teamId: 't1', role: 'diet', customRole: '' };
  const record = { settings: { name: legacy.name }, records: { '2026-11-10': { weight: '72' } } };
  let store = {
    revision: 4, users: [{ id: 'admin', username: 'admin', isAdmin: true }, legacy],
    members: [assignment], personal: { u01: record }, personalRevisions: { u01: 5 }
  };
  let writes = 0;
  let writeError;
  const encoded = [];
  const svc = createBoxMemberService({
    getStore: () => store,
    commit(next) {
      if (writeError) throw writeError;
      store = next;
      writes++;
    },
    ApiError,
    makeUser(id, username, name, password) {
      encoded.push({ id, username, name, password });
      return { id, username, name, isAdmin: false, salt: 'salt', passwordHash: 'hashed' };
    },
    blankPersonal(name) { return { settings: { name }, records: {} }; }
  });
  return {
    get store() { return store; }, get writes() { return writes; }, legacy, assignment, record, encoded,
    setWriteError(error) { writeError = error; },
    async request(method, route = accounts, body, isAdmin = true) {
      let result;
      const handled = await svc.handle({ method }, {}, { user: { isAdmin } }, { pathname: route },
        async () => body, (_res, status, value) => { result = { status, value }; });
      assert.equal(handled, true);
      return result;
    }
  };
}

test('등록한 일반 회원은 로그인 계정을 받으며 기존 존다 팀과 기록은 그대로 유지된다', async () => {
  const f = fixture();
  const created = await f.request('POST', accounts, applicant);
  assert.equal(created.status, 201);
  const member = created.value.members.find(m => m.username === applicant.username);
  assert.equal(member.zonda, false);
  assert.equal(f.encoded[0].password, applicant.password);
  assert.equal(f.store.users.find(u => u.id === member.id).passwordHash, 'hashed');
  assert.equal(JSON.stringify(f.store).includes(applicant.password), false);
  assert.deepEqual(f.store.members, [f.assignment]);
  assert.deepEqual(f.store.personal, { u01: f.record });
  assert.equal(f.store.revision, 4);
  const fresh = await f.request('GET');
  assert.deepEqual(fresh.value, created.value);
  assert.equal(fresh.value.members.length, 2);
  assert.equal(fresh.value.members.find(m => m.id === 'u01').zonda, true);
  assert.equal(fresh.value.members.some(m => m.id === 'admin'), false);
  for (const field of ['passwordHash', 'salt', 'records']) assert.ok(!JSON.stringify(fresh.value).includes(field));
});

test('존다 참여 등록은 미배정 명단을 갱신하고 중복 요청에서 팀과 개인 자료를 유지한다', async () => {
  const f = fixture();
  const created = await f.request('POST', accounts, { ...applicant, zonda: true });
  const participant = created.value.members.find(m => m.username === applicant.username);
  assert.equal(participant.zonda, true);
  assert.equal(participant.teamId, null);
  assert.equal(f.store.personal[participant.id].settings.name, applicant.name);
  assert.equal(f.store.revision, 5);
  const enrolled = await f.request('POST', accounts + '/enroll', { memberId: 'u01' });
  assert.equal(enrolled.value.revision, 5);
  assert.equal(f.store.members[0], f.assignment);
  assert.equal(f.store.personal.u01, f.record);
  const standard = await f.request('POST', accounts, { ...applicant, username: 'another-member' });
  const id = standard.value.members.at(-1).id;
  await f.request('POST', accounts + '/enroll', { memberId: id });
  await f.request('POST', accounts + '/enroll', { memberId: id });
  assert.equal(f.store.members.filter(m => m.id === id).length, 1);
  assert.equal(f.store.revision, 6);
  assert.equal(f.writes, 3);
});

test('이름, 아이디, 비밀번호, 참여 여부 검증과 중복 아이디 처리가 등록과 동일한 경로에서 적용된다', async () => {
  const f = fixture();
  for (const body of [null, { ...applicant, name: ' ' }, { ...applicant, password: 'short' },
    { ...applicant, username: 'two words' }, { ...applicant, zonda: 'yes' }]) {
    await assert.rejects(f.request('POST', accounts, body), { status: 422 });
  }
  await assert.rejects(f.request('POST', accounts, { ...applicant, username: ' Member01 ' }), { status: 409 });
  const overlap = await Promise.allSettled([
    f.request('POST', accounts, applicant), f.request('POST', accounts, applicant)
  ]);
  assert.equal(overlap.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(overlap.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(f.writes, 1);
});

test('관리자에게만 회원 관리가 허용되고 저장 충돌은 성공 처리하지 않는다', async () => {
  const f = fixture();
  await assert.rejects(f.request('GET', accounts, undefined, false), { status: 403 });
  await assert.rejects(f.request('POST', accounts, applicant, false), { status: 403 });
  await assert.rejects(f.request('POST', accounts + '/enroll', { memberId: 'admin' }), { status: 404 });
  const before = f.store;
  f.setWriteError(new ApiError(409, '동시 변경'));
  await assert.rejects(f.request('POST', accounts, { ...applicant, zonda: true }), { status: 409 });
  assert.equal(f.store, before);
  assert.equal(f.writes, 0);
});
