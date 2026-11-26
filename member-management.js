let boxMemberPage = null;

function boxMembershipText(pass) {
  if (pass?.kind === 'period') return '기간권 · ' + pass.expiresOn + '까지';
  if (pass?.kind === 'visits') {
    const expiry = pass.expiresOn ? ' · ' + pass.expiresOn + '까지' : '';
    return '횟수권 · ' + pass.remainingVisits + '회 남음' + expiry;
  }
  return '미설정';
}

function boxMembersView() {
  return `<header class="page-heading"><div><h1>박스 회원 관리</h1>
    <p class="subtitle">등록한 회원은 아이디와 비밀번호로 로그인해 수업을 예약할 수 있습니다.</p></div></header>
    <div id="box-member-management" class="form-stack">
      <form id="box-member-form" class="card">
        <div class="card-heading"><h2>회원 등록</h2></div>
        <div class="field-row">
          <div class="field"><label for="box-member-name">회원 이름</label>
            <input id="box-member-name" name="name" autocomplete="off" maxlength="30" required></div>
          <div class="field"><label for="box-member-username">로그인 아이디</label>
            <input id="box-member-username" name="username" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="40" required></div>
        </div>
        <div class="field"><label for="box-member-password">초기 비밀번호</label>
          <input id="box-member-password" name="password" type="password" autocomplete="new-password" placeholder="8자 이상" minlength="8" maxlength="128" required></div>
        <label class="check-field"><input type="checkbox" name="zonda">존다 프로그램에도 등록</label>
        <div class="form-actions"><button type="submit" class="button">회원 등록</button></div>
      </form>
      <p id="box-member-message" role="status" aria-live="polite"></p>
      <section class="card" aria-labelledby="box-member-directory-title">
        <div class="card-heading"><h2 id="box-member-directory-title">등록 회원</h2><span id="box-member-total" class="badge"></span></div>
        <div class="admin-toolbar"><div class="search-wrap"><label class="sr-only" for="box-member-search">이름 또는 아이디 검색</label>
          <input type="search" id="box-member-search" placeholder="이름 또는 아이디 검색"></div>
          <button id="box-members-refresh" type="button" class="button secondary">새로고침</button></div>
        <div id="box-member-directory"><p role="status">회원 목록을 불러오는 중입니다.</p></div>
        <dialog id="box-pass-dialog" class="card" aria-labelledby="box-pass-title">
          <h2 id="box-pass-title">이용권 관리</h2>
          <p id="box-pass-identity"></p>
          <form id="box-pass-form" class="form-stack">
            <div class="field"><label for="box-pass-kind">이용권 종류</label>
              <select name="kind" id="box-pass-kind">
                <option value="unassigned">미설정</option><option value="period">기간권</option><option value="visits">횟수권</option>
              </select></div>
            <div class="field" data-pass-visits><label for="box-pass-remaining">남은 횟수</label>
              <input type="number" inputmode="numeric" name="remainingVisits" id="box-pass-remaining" min="0" max="100000" step="1"></div>
            <div class="field" data-pass-expiry><label for="box-pass-expiry">만료일</label>
              <input type="date" name="expiresOn" id="box-pass-expiry"></div>
            <div data-pass-replace hidden>
              <label class="check-field"><input type="checkbox" name="replacePass" aria-describedby="box-pass-replace-help">새 횟수권으로 교체</label>
              <p class="box-pass-help" id="box-pass-replace-help">교체 전 예약을 취소해도 그 횟수는 새 이용권에 더해지지 않습니다.</p>
            </div>
            <p id="box-pass-feedback" role="status" aria-live="polite"></p>
            <div class="form-actions">
              <button type="button" class="button secondary" data-pass-close>닫기</button>
              <button type="button" class="button secondary" data-pass-reload hidden>최신 이용권 불러오기</button>
              <button type="submit" class="button">저장</button>
            </div>
          </form>
        </dialog>
        <dialog id="box-recovery-dialog" class="card" aria-labelledby="box-recovery-title">
          <h2 id="box-recovery-title">회원 계정 찾기</h2>
          <p id="box-recovery-identity"></p>
          <form id="box-recovery-form" class="form-stack">
            <label class="check-field"><input name="verified" type="checkbox" required>박스에서 회원 본인을 확인했습니다.</label>
            <p class="subtitle">비밀번호를 잊은 회원에게만 재설정 링크를 전달하세요. 새로 발급하면 이전 링크는 만료됩니다.</p>
            <button type="submit" class="button">재설정 링크 발급</button>
          </form>
          <div id="box-recovery-result" class="form-stack" hidden>
            <div class="field"><label for="box-recovery-url">회원에게 전달할 링크</label>
              <input id="box-recovery-url" type="url" readonly autocomplete="off"></div>
            <button id="box-recovery-copy" type="button" class="button secondary">링크 복사</button>
          </div>
          <p id="box-recovery-feedback" role="status"></p>
          <button type="button" id="box-recovery-close" class="button secondary">닫기</button>
        </dialog>
      </section>
    </div>`;
}

function boxMembersIsDirty() {
  if (!boxMemberPage) return false;
  const fields = boxMemberPage.form.elements;
  return Boolean(boxMemberPage.busy || boxMemberPage.hasPassDraft?.() || fields.name.value || fields.username.value ||
    fields.password.value || fields.zonda.checked);
}

function cleanupBoxMembers() {
  boxMemberPage = null;
}

function mountBoxMembers() {
  const root = document.querySelector('#box-member-management');
  if (!root) return;
  const form = root.querySelector('#box-member-form');
  const list = root.querySelector('#box-member-directory');
  const search = root.querySelector('#box-member-search');
  const refresh = root.querySelector('#box-members-refresh');
  const message = root.querySelector('#box-member-message');
  const dialog = root.querySelector('#box-recovery-dialog');
  const recoveryForm = root.querySelector('#box-recovery-form');
  const recoveryResult = root.querySelector('#box-recovery-result');
  const recoveryUrl = root.querySelector('#box-recovery-url');
  const recoveryFeedback = root.querySelector('#box-recovery-feedback');
  const passDialog = root.querySelector('#box-pass-dialog');
  const passForm = root.querySelector('#box-pass-form');
  const passFeedback = root.querySelector('#box-pass-feedback');
  const passSave = passForm.querySelector('[type=submit]');
  const passReload = passForm.querySelector('[data-pass-reload]');
  let passTarget = null;
  let recoveryTarget = null;
  const current = { form, busy: false, members: [], readVersion: 0 };
  boxMemberPage = current;

  function paintList() {
    const query = search.value.trim().toLowerCase();
    const filtered = current.members.filter(member =>
      member.name.toLowerCase().includes(query) || member.username.toLowerCase().includes(query)
    );
    root.querySelector('#box-member-total').textContent = `총 ${current.members.length}명`;
    if (!filtered.length) {
      list.innerHTML = `<p class="empty-state">${query ? '검색 결과가 없습니다.' : '등록된 회원이 없습니다.'}</p>`;
      return;
    }
    const rows = filtered.map(member => {
      const team = bootstrap.teams.find(team => team.id === member.teamId)?.name;
      const action = member.zonda ? '<span class="badge">참여 중</span>' :
        `<button type="button" class="button secondary" data-enroll-member="${escapeHTML(member.id)}"
          aria-label="${escapeHTML(member.name)} 존다 참여 등록">참여 등록</button>`;
      return `<div class="directory-row"><div class="box-member-identity"><strong>${escapeHTML(member.name)}</strong>
          <span class="box-member-pass">${escapeHTML(boxMembershipText(member.membership))}</span></div><code>${escapeHTML(member.username)}</code>
        <span>${escapeHTML(team || (member.zonda ? '미배정' : '—'))}</span><div>${action}
          <button type="button" class="button text" data-pass-member="${escapeHTML(member.id)}"
            aria-label="${escapeHTML(member.name)} 이용권 관리">이용권 관리</button>
          <button type="button" class="button text" data-recover-member="${escapeHTML(member.id)}"
            aria-label="${escapeHTML(member.name)} 계정 찾기">계정 찾기</button></div></div>`;
    });
    list.innerHTML = `<div class="directory-head"><span>이름</span><span>로그인 아이디</span><span>팀</span><span>회원 관리</span></div>${rows.join('')}`;
  }

  function acceptDirectory(data) {
    current.members = data.members;
    if (bootstrap.revision !== data.revision) {
      bootstrap.members = data.members.filter(member => member.zonda);
      bootstrap.revision = data.revision;
      resetAdminDraft();
    }
    paintList();
  }

  async function readDirectory() {
    const version = ++current.readVersion;
    refresh.disabled = true;
    try {
      const data = await api('/api/admin/members');
      if (boxMemberPage === current && version === current.readVersion) {
        message.textContent = '';
        acceptDirectory(data);
        return true;
      }
    } catch (error) {
      if (boxMemberPage === current && version === current.readVersion) {
        message.textContent = error.message;
        if (!current.members.length) list.textContent = '회원 목록을 불러오지 못했습니다.';
      }
    } finally {
      if (version === current.readVersion) refresh.disabled = false;
    }
  }

  async function save(url, body, feedback, resetForm) {
    if (current.busy) return;
    current.busy = true;
    current.readVersion++;
    root.inert = true;
    message.textContent = '저장 중입니다.';
    try {
      const data = await api(url, { method: 'POST', body: JSON.stringify(body) });
      if (boxMemberPage !== current) return;
      if (resetForm) form.reset();
      acceptDirectory(data);
      message.textContent = feedback;
    } catch (error) {
      if (boxMemberPage === current) message.textContent = error.message;
    } finally {
      current.busy = false;
      root.inert = false;
      refresh.disabled = false;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const fields = form.elements;
    const member = {
      name: fields.name.value.trim(), username: fields.username.value.trim(),
      password: fields.password.value, zonda: fields.zonda.checked
    };
    void save('/api/admin/members', member, `${member.name} 회원을 등록했습니다.`, true);
  });

  function configurePassFields() {
    const fields = passForm.elements;
    const kind = fields.kind.value;
    const period = kind === 'period';
    const visits = kind === 'visits';
    const replace = visits && passTarget?.membership.kind === 'visits';
    passForm.querySelector('[data-pass-visits]').hidden = !visits;
    passForm.querySelector('[data-pass-expiry]').hidden = !(period || visits);
    passForm.querySelector('[data-pass-replace]').hidden = !replace;
    passForm.querySelector('label[for=box-pass-expiry]').textContent = visits ? '만료일 (선택)' : '만료일';
    fields.remainingVisits.disabled = !visits;
    fields.remainingVisits.required = visits;
    fields.remainingVisits.max = String(replace && !fields.replacePass.checked
      ? Math.max(100000, passTarget.membership.remainingVisits) : 100000);
    fields.expiresOn.disabled = !(period || visits);
    fields.expiresOn.required = period;
    fields.replacePass.disabled = !replace;
    if (!replace) fields.replacePass.checked = false;
  }

  function showPass(member) {
    const pass = member.membership || { kind: 'unassigned', expiresOn: null, remainingVisits: null, revision: 0 };
    passTarget = { id: member.id, membership: pass, saving: false };
    root.querySelector('#box-pass-identity').textContent = member.name + ' · ' + member.username;
    const fields = passForm.elements;
    fields.kind.value = pass.kind;
    fields.remainingVisits.value = pass.remainingVisits ?? '';
    fields.expiresOn.value = pass.expiresOn || '';
    fields.replacePass.checked = false;
    configurePassFields();
    passForm.inert = false;
    passSave.disabled = false;
    passReload.hidden = true;
    passFeedback.textContent = '';
    if (!passDialog.open) passDialog.showModal();
  }

  current.hasPassDraft = () => {
    if (!passDialog.open || !passTarget) return false;
    const fields = passForm.elements, pass = passTarget.membership;
    return passTarget.saving || fields.kind.value !== pass.kind ||
      (pass.kind !== 'unassigned' && fields.expiresOn.value !== (pass.expiresOn || '')) ||
      (pass.kind === 'visits' && (fields.remainingVisits.value !== String(pass.remainingVisits) || fields.replacePass.checked));
  };

  async function reloadPass() {
    const target = passTarget;
    if (!target) return;
    passSave.disabled = true;
    passReload.disabled = true;
    passFeedback.textContent = '최신 이용권을 확인하는 중입니다.';
    const loaded = await readDirectory();
    if (boxMemberPage !== current || passTarget !== target) return;
    passReload.disabled = false;
    const member = loaded && current.members.find(row => row.id === target.id);
    if (member) {
      showPass(member);
      passFeedback.textContent = '회원의 이용권이 변경되어 최신 값으로 불러왔습니다. 확인한 후 다시 저장하세요.';
    } else {
      passFeedback.textContent = '최신 이용권을 불러오지 못했습니다. 다시 시도하세요.';
      passReload.hidden = false;
    }
  }

  passForm.elements.kind.addEventListener('change', configurePassFields);
  passForm.elements.replacePass.addEventListener('change', configurePassFields);
  passForm.querySelector('[data-pass-close]').addEventListener('click', () => passDialog.close());
  passDialog.addEventListener('cancel', event => { if (passTarget?.saving) event.preventDefault(); });
  passDialog.addEventListener('close', () => {
    const id = passTarget?.id;
    passTarget = null;
    const opener = [...list.querySelectorAll('[data-pass-member]')].find(button => button.dataset.passMember === id);
    opener?.focus();
  });
  passReload.addEventListener('click', reloadPass);
  passForm.addEventListener('submit', async event => {
    event.preventDefault();
    const target = passTarget;
    if (!target || target.saving || passSave.disabled) return;
    const fields = passForm.elements;
    const kind = fields.kind.value;
    const payload = {
      memberId: target.id, revision: target.membership.revision, kind,
      expiresOn: kind !== 'unassigned' && fields.expiresOn.value ? fields.expiresOn.value : null,
      remainingVisits: kind === 'visits' ? Number(fields.remainingVisits.value) : null
    };
    if (!fields.replacePass.disabled && fields.replacePass.checked) payload.replacePass = true;
    target.saving = true;
    passFeedback.textContent = '저장 중입니다.';
    passForm.inert = true;
    try {
      const membership = await api('/api/admin/members/membership', { method: 'PUT', body: JSON.stringify(payload) });
      if (boxMemberPage !== current || passTarget !== target) return;
      current.readVersion++;
      refresh.disabled = false;
      current.members = current.members.map(member => member.id === target.id ? { ...member, membership } : member);
      paintList();
      passDialog.close();
      message.textContent = '이용권을 저장했습니다. ' + boxMembershipText(membership);
    } catch (error) {
      if (boxMemberPage !== current || passTarget !== target) return;
      if (error.status === 409) await reloadPass();
      else passFeedback.textContent = error.message;
    } finally {
      target.saving = false;
      passForm.inert = false;
    }
  });

  list.addEventListener('click', event => {
    const passButton = event.target.closest('[data-pass-member]');
    if (passButton) {
      const member = current.members.find(row => row.id === passButton.dataset.passMember);
      if (member) showPass(member);
      return;
    }
    const recover = event.target.closest('[data-recover-member]');
    if (recover) {
      const member = current.members.find(entry => entry.id === recover.dataset.recoverMember);
      if (!member) return;
      recoveryTarget = { member };
      root.querySelector('#box-recovery-identity').textContent = `${member.name} 회원 · 로그인 아이디 ${member.username}`;
      recoveryForm.reset();
      recoveryForm.hidden = false;
      recoveryForm.querySelector('button').disabled = false;
      recoveryResult.hidden = true;
      recoveryUrl.value = '';
      recoveryFeedback.textContent = '';
      dialog.showModal();
      return;
    }
    const button = event.target.closest('[data-enroll-member]');
    if (!button) return;
    const member = current.members.find(entry => entry.id === button.dataset.enrollMember);
    if (member) void save('/api/admin/members/enroll', { memberId: member.id }, `${member.name} 회원을 존다에 등록했습니다.`, false);
  });
  recoveryForm.addEventListener('submit', async event => {
    event.preventDefault();
    const target = recoveryTarget;
    if (!target || target.busy || !recoveryForm.elements.verified.checked) return;
    target.busy = true;
    const button = recoveryForm.querySelector('button');
    button.disabled = true;
    recoveryFeedback.textContent = '링크를 발급하는 중입니다.';
    try {
      const result = await api('/api/admin/members/recovery', { method: 'POST',
        body: JSON.stringify({ memberId: target.member.id, identityVerified: true }) });
      if (boxMemberPage !== current || recoveryTarget !== target) return;
      recoveryUrl.value = new URL('/#reset-password/' + result.token, location.origin).href;
      recoveryForm.hidden = true;
      recoveryResult.hidden = false;
      const expiry = new Date(result.expiresAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit' });
      recoveryFeedback.textContent = `한국 시간 ${expiry}까지 한 번 사용할 수 있습니다.`;
      recoveryUrl.focus();
      recoveryUrl.select();
    } catch (error) {
      if (boxMemberPage === current && recoveryTarget === target) recoveryFeedback.textContent = error.message;
    } finally {
      target.busy = false;
      if (recoveryTarget === target) button.disabled = false;
    }
  });
  root.querySelector('#box-recovery-copy').addEventListener('click', async () => {
    const target = recoveryTarget;
    try {
      await navigator.clipboard.writeText(recoveryUrl.value);
      if (recoveryTarget === target) recoveryFeedback.textContent = '링크를 복사했습니다.';
    } catch {
      if (recoveryTarget !== target) return;
      recoveryUrl.select();
      recoveryFeedback.textContent = '선택된 링크를 복사해서 회원에게 전달해주세요.';
    }
  });
  root.querySelector('#box-recovery-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { recoveryTarget = null; recoveryUrl.value = ''; });
  search.addEventListener('input', paintList);
  refresh.addEventListener('click', readDirectory);
  void readDirectory();
}
