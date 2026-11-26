const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { membershipView } = require('./memberships-server');

const recoveryLifetime = 15 * 60 * 1000;
const digestToken = token => createHash('sha256').update(token).digest('hex');
const validPassword = password => typeof password === 'string' && password.length >= 8 && password.length <= 128;

function createBoxMemberService({ getStore, commit, ApiError, makeUser, blankPersonal, now = Date.now }) {
  function directory(store) {
    const assignments = new Map(store.members.map(member => [member.id, member]));
    const members = store.users.filter(user => !user.isAdmin).map(user => {
      const assignment = assignments.get(user.id);
      return {
        id: user.id, username: user.username, name: user.name, membership: membershipView(store, user.id),
        zonda: Boolean(assignment), teamId: assignment?.teamId ?? null,
        role: assignment?.role || '', customRole: assignment?.customRole || ''
      };
    });
    return { members, revision: store.revision };
  }

  function withZondaParticipant(store, user) {
    if (store.members.some(member => member.id === user.id)) return store;
    const assignment = { id: user.id, teamId: null, role: '', customRole: '' };
    return {
      ...store,
      revision: store.revision + 1,
      members: [...store.members, assignment],
      personal: { ...store.personal, [user.id]: store.personal[user.id] ?? blankPersonal(user.name) }
    };
  }

  async function register(body) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    if (!name || name.length > 30) throw new ApiError(422, '회원 이름은 1~30자로 입력해주세요.');
    if (!username || username.length > 40 || /[\s\p{Cc}]/u.test(username)) {
      throw new ApiError(422, '아이디는 공백 없이 1~40자로 입력해주세요.');
    }
    if (!validPassword(body.password)) {
      throw new ApiError(422, '초기 비밀번호는 8~128자로 입력해주세요.');
    }
    if (body.zonda !== undefined && typeof body.zonda !== 'boolean') {
      throw new ApiError(422, '존다 참여 여부를 확인해주세요.');
    }
    const store = getStore();
    if (store.users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
      throw new ApiError(409, '이미 사용 중인 아이디입니다.');
    }
    const user = makeUser(randomUUID(), username, name, body.password);
    const updated = { ...store, users: [...store.users, user] };
    await commit(body.zonda ? withZondaParticipant(updated, user) : updated);
    return directory(getStore());
  }

  async function enroll(body) {
    const store = getStore();
    const user = store.users.find(user => !user.isAdmin && user.id === body?.memberId);
    if (!user) throw new ApiError(404, '등록된 박스 회원을 찾을 수 없습니다.');
    const next = withZondaParticipant(store, user);
    if (next !== store) await commit(next);
    return directory(getStore());
  }

  async function issueRecovery(body) {
    if (body?.identityVerified !== true) throw new ApiError(422, '회원 본인 확인을 먼저 진행해주세요.');
    const store = getStore();
    const user = store.users.find(member => member.id === body.memberId && !member.isAdmin);
    if (!user) throw new ApiError(404, '등록된 박스 회원을 찾을 수 없습니다.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now() + recoveryLifetime;
    const passwordRecovery = { digest: digestToken(token), expiresAt };
    await commit({ ...store, users: store.users.map(member => member.id === user.id ? { ...member, passwordRecovery } : member) });
    return { token, expiresAt, username: user.username };
  }

  async function handlePublic(req, res, url, readJson, send) {
    if (url.pathname !== '/api/account/reset-password' || req.method !== 'POST') return false;
    const body = await readJson(req, 2048);
    const invalid = () => new ApiError(400, '링크가 만료되었거나 유효하지 않습니다. 코치에게 새 링크를 요청해주세요.');
    if (typeof body?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw invalid();
    const digest = digestToken(body.token);
    const store = getStore();
    const user = store.users.find(member => !member.isAdmin && member.passwordRecovery?.digest === digest);
    if (!user || user.passwordRecovery.expiresAt <= now()) throw invalid();
    if (!validPassword(body.password)) throw new ApiError(422, '새 비밀번호는 8~128자로 입력해주세요.');
    const { salt, passwordHash } = makeUser(user.id, user.username, user.name, body.password);
    const passwordResetRevision = (store.passwordResetRevision || 0) + 1;
    const updated = { ...user, salt, passwordHash, authVersion: (user.authVersion || 0) + 1, passwordResetAt: now(), passwordResetRevision };
    delete updated.passwordRecovery;
    await commit({ ...store, passwordResetRevision, users: store.users.map(member => member.id === user.id ? updated : member) });
    send(res, 200, { username: user.username });
    return true;
  }

  async function handle(req, res, session, url, readJson, send) {
    const base = '/api/admin/members';
    if (![base, base + '/enroll', base + '/recovery'].includes(url.pathname)) return false;
    if (!session?.user.isAdmin) throw new ApiError(403, '관리자만 박스 회원을 관리할 수 있습니다.');
    if (url.pathname === base && req.method === 'GET') {
      send(res, 200, directory(getStore()));
    } else if (url.pathname === base && req.method === 'POST') {
      send(res, 201, await register(await readJson(req)));
    } else if (url.pathname === base + '/enroll' && req.method === 'POST') {
      send(res, 200, await enroll(await readJson(req)));
    } else if (url.pathname === base + '/recovery' && req.method === 'POST') {
      send(res, 201, await issueRecovery(await readJson(req, 2048)));
    } else {
      return false;
    }
    return true;
  }

  return { handle, handlePublic };
}

module.exports = { createBoxMemberService };
