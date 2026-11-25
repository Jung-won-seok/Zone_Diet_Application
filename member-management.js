let boxMemberPage = null;

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
      </section>
    </div>`;
}

function boxMembersIsDirty() {
  if (!boxMemberPage) return false;
  const fields = boxMemberPage.form.elements;
  return Boolean(boxMemberPage.busy || fields.name.value || fields.username.value ||
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
      return `<div class="directory-row"><strong>${escapeHTML(member.name)}</strong><code>${escapeHTML(member.username)}</code>
        <span>${escapeHTML(team || (member.zonda ? '미배정' : '—'))}</span><div>${action}</div></div>`;
    });
    list.innerHTML = `<div class="directory-head"><span>이름</span><span>로그인 아이디</span><span>팀</span><span>존다 참여</span></div>${rows.join('')}`;
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
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-enroll-member]');
    if (!button) return;
    const member = current.members.find(entry => entry.id === button.dataset.enrollMember);
    if (member) void save('/api/admin/members/enroll', { memberId: member.id }, `${member.name} 회원을 존다에 등록했습니다.`, false);
  });
  search.addEventListener('input', paintList);
  refresh.addEventListener('click', readDirectory);
  void readDirectory();
}
