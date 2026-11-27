const MAX_VISITS = 100000;

function membershipView(store, memberId) {
  const pass = store.memberships?.[memberId];
  return {
    kind: pass?.kind || 'unassigned',
    expiresOn: pass?.expiresOn ?? null,
    remainingVisits: pass?.remainingVisits ?? null,
    revision: pass?.revision || 0,
  };
}

function membershipIssue(store, memberId, classDate, { alreadyConfirmed = false } = {}) {
  const pass = store.memberships?.[memberId];
  if (!pass || pass.kind === 'unassigned') return null;
  // Both dates are the class's Seoul calendar date. The expiry day is included.
  if (pass.expiresOn && classDate > pass.expiresOn) return '선택한 수업 날짜에는 이용권이 만료됩니다.';
  if (pass.kind === 'visits' && pass.remainingVisits <= 0 && !alreadyConfirmed) return '남은 이용 횟수가 없습니다.';
  return null;
}

function withPass(store, memberId, pass) {
  return { ...store, memberships: { ...store.memberships, [memberId]: pass } };
}

function chargeVisit(store, memberId, classDate) {
  const pass = store.memberships?.[memberId];
  if (pass?.kind !== 'visits' || pass.chargedDates?.[classDate]) return store;
  if (membershipIssue(store, memberId, classDate)) {
    // A caller must check availability before promoting/reserving; never silently book on zero.
    const error = new Error('이용권으로 해당 수업을 예약할 수 없습니다.');
    error.status = 409;
    throw error;
  }
  return withPass(store, memberId, { ...pass, revision: pass.revision + 1,
    remainingVisits: pass.remainingVisits - 1, chargedDates: { ...pass.chargedDates, [classDate]: true } });
}

function refundVisit(store, memberId, classDate) {
  const pass = store.memberships?.[memberId];
  if (pass?.kind !== 'visits' || !pass.chargedDates?.[classDate]) return store;
  const chargedDates = { ...pass.chargedDates };
  delete chargedDates[classDate];
  return withPass(store, memberId, { ...pass, revision: pass.revision + 1,
    remainingVisits: pass.remainingVisits + 1, chargedDates });
}

function createMembershipService({ getStore, commit, ApiError, isValidDate }) {
  async function update(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !['period', 'visits', 'unassigned'].includes(body.kind) ||
      !Number.isSafeInteger(body.revision) || body.revision < 0 ||
      (body.replacePass !== undefined && typeof body.replacePass !== 'boolean')) {
      throw new ApiError(422, '이용권 종류와 수정 내용을 확인해주세요.');
    }
    const store = getStore();
    const user = store.users.find(member => member.id === body.memberId && !member.isAdmin);
    if (!user) throw new ApiError(404, '등록된 박스 회원을 찾을 수 없습니다.');
    const previous = membershipView(store, user.id);
    if (body.revision !== previous.revision) throw new ApiError(409, '예약 또는 이용권 정보가 변경됐습니다. 최신 잔여 횟수를 확인해주세요.');
    const { kind, expiresOn = null, remainingVisits = null } = body;
    if ((expiresOn !== null && !isValidDate(expiresOn)) || (kind === 'period' && !expiresOn) || (kind === 'unassigned' && expiresOn !== null)) {
      throw new ApiError(422, '유효한 만료일을 선택해주세요.');
    }
    if (kind === 'visits') {
      // A coach may have topped up to the entry limit before an older booking was refunded.
      const max = body.replacePass ? MAX_VISITS : Math.max(MAX_VISITS, previous.remainingVisits || 0);
      if (!Number.isInteger(remainingVisits) || remainingVisits < 0 || remainingVisits > max) {
        throw new ApiError(422, `잔여 횟수는 0~${max}회 사이의 정수로 입력해주세요.`);
      }
    } else if (remainingVisits !== null) {
      throw new ApiError(422, '횟수권에만 잔여 횟수를 입력할 수 있습니다.');
    }
    if (body.replacePass && (previous.kind !== 'visits' || kind !== 'visits')) {
      throw new ApiError(422, '기존 횟수권을 새 횟수권으로 교체할 때만 선택해주세요.');
    }
    if (!body.replacePass && previous.kind === kind && expiresOn === previous.expiresOn && remainingVisits === previous.remainingVisits) return previous;
    const pass = { kind, expiresOn, remainingVisits, revision: previous.revision + 1 };
    // Only confirmed visits actually charged to this particular pass can be refunded.
    // Date is the reservation key because a member can hold at most one class per day.
    if (kind === 'visits') {
      pass.chargedDates = !body.replacePass && previous.kind === 'visits' ? store.memberships[user.id].chargedDates || {} : {};
    }
    const next = withPass(store, user.id, pass);
    await commit(next);
    return membershipView(next, user.id);
  }

  async function handle(req, res, session, url, readJson, send) {
    const mine = url.pathname === '/api/membership';
    const admin = url.pathname === '/api/admin/members/membership';
    if (!mine && !admin) return false;
    if (!session?.user) throw new ApiError(401, '로그인이 필요합니다.');
    if (session.user.pendingApproval) throw new ApiError(403, '박스 회원 등록 후 이용할 수 있습니다.');
    if (admin && !session.user.isAdmin) throw new ApiError(403, '관리자만 이용권을 변경할 수 있습니다.');
    if (mine && req.method === 'GET') {
      send(res, 200, membershipView(getStore(), session.user.id));
    } else if (admin && req.method === 'PUT') {
      send(res, 200, await update(await readJson(req, 2048)));
    } else {
      throw new ApiError(405, '지원하지 않는 요청입니다.');
    }
    return true;
  }
  return { handle };
}

module.exports = { membershipView, membershipIssue, chargeVisit, refundVisit, createMembershipService };
