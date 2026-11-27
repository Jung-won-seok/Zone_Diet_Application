// The fragment is never sent with an HTTP request. Keep the token in memory while
// the form is open and replace the fragment before the app boots.
let accountResetToken = null;

function collectAccountResetToken() {
  if (!location.hash.startsWith('#reset-password/')) return;
  const value = location.hash.slice('#reset-password/'.length);
  accountResetToken = /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  history.replaceState(null, '', location.pathname + location.search + '#reset-password');
}
collectAccountResetToken();

function showAccountRecovery(root) {
  collectAccountResetToken();
  const isReset = location.hash === '#reset-password';
  if (!isReset) accountResetToken = null;
  if (!isReset && location.hash !== '#account-help') return false;

  const back = '<button type="button" class="button secondary" data-recovery-back>돌아가기</button>';
  function backToApp() {
    accountResetToken = null;
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }
  function panel(contents) {
    root.innerHTML = `<section class="login-panel"><h1>${isReset ? '비밀번호 재설정' : '아이디·비밀번호 찾기'}</h1>${contents}</section>`;
    root.querySelector('[data-recovery-back]').addEventListener('click', backToApp);
  }

  if (!isReset) {
    panel(`<p>박스에서 코치에게 회원 이름을 알려주세요. 본인 확인 후 로그인 아이디를 안내받을 수 있습니다.</p>
      <p>비밀번호도 잊었다면 재설정 링크를 요청하세요. 받은 링크에서 15분 안에 새 비밀번호를 정할 수 있습니다.</p>${back}`);
    return true;
  }
  const token = accountResetToken;
  if (!token) {
    panel(`<p>코치에게 받은 링크를 다시 열어주세요. 링크가 만료되었다면 새로 발급받으세요.</p>${back}`);
    return true;
  }
  panel(`<form id="account-reset-form" class="form-stack">
    <div class="field"><label for="account-new-password">새 비밀번호</label>
      <input id="account-new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="8~128자"></div>
    <div class="field"><label for="account-repeat-password">새 비밀번호 확인</label>
      <input id="account-repeat-password" name="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div>
    <p role="status" id="account-reset-status"></p><button type="submit" class="button">새 비밀번호 저장</button>
    </form>${back}`);
  const form = root.querySelector('#account-reset-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    const status = form.querySelector('[role=status]');
    if (submit.disabled) return;
    if (form.elements.password.value !== form.elements.confirmation.value) {
      status.textContent = '두 비밀번호가 일치하는지 확인해주세요.';
      form.elements.confirmation.focus();
      return;
    }
    submit.disabled = true;
    status.textContent = '비밀번호를 변경하는 중입니다.';
    try {
      const result = await api('/api/account/reset-password', { method: 'POST',
        body: JSON.stringify({ token, password: form.elements.password.value }) });
      if (accountResetToken !== token || !form.isConnected) return;
      accountResetToken = null;
      form.reset();
      panel(`<p role="status">비밀번호를 변경했습니다. 아이디 <strong>${escapeHTML(result.username)}</strong>와 새 비밀번호로 로그인하세요.</p>${back}`);
    } catch (error) {
      if (!form.isConnected) return;
      status.textContent = error.message;
      if (error.status === 400) {
        accountResetToken = null;
        form.reset();
      } else {
        submit.disabled = false;
      }
    }
  });
  return true;
}
