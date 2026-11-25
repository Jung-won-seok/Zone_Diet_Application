const { randomUUID } = require('node:crypto');

function createBoxMemberService({ getStore, commit, ApiError, makeUser, blankPersonal }) {
  function directory(store) {
    const assignments = new Map(store.members.map(member => [member.id, member]));
    const members = store.users.filter(user => !user.isAdmin).map(user => {
      const assignment = assignments.get(user.id);
      return {
        id: user.id, username: user.username, name: user.name,
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
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
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

  async function handle(req, res, session, url, readJson, send) {
    const base = '/api/admin/members';
    if (url.pathname !== base && url.pathname !== base + '/enroll') return false;
    if (!session?.user.isAdmin) throw new ApiError(403, '관리자만 박스 회원을 관리할 수 있습니다.');
    if (url.pathname === base && req.method === 'GET') {
      send(res, 200, directory(getStore()));
    } else if (url.pathname === base && req.method === 'POST') {
      send(res, 201, await register(await readJson(req)));
    } else if (url.pathname === base + '/enroll' && req.method === 'POST') {
      send(res, 200, await enroll(await readJson(req)));
    } else {
      return false;
    }
    return true;
  }

  return { handle };
}

module.exports = { createBoxMemberService };
