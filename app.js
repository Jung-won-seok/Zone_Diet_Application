const labels = { today: '오늘의 현황', team: '우리 팀 식단', board: '전체 식단', record: '데일리 기록', progress: '나의 변화', settings: '내 설정', admin: '팀 · 역할 관리', accounts: '회원 계정', naver: '네이버 카페 연결', connect: '카페 연동 신청' };
const blankState = () => ({ settings: { name: '', startWeight: '', goalWeight: '' }, records: {} });
let state = blankState();
let session = null;
let bootstrap = null;
let csrfToken = '';
let authReady = false;
let renderedHash = location.hash;
let navigationPending = false;
let personalSaved = '';
let personalSaving = false;
const app = document.querySelector('#app');
const mobileNavigation = MobileNavigation.create({
  root: document.querySelector('.sidebar'),
  content: app,
  navigate: href => { if (!navigationPending) location.hash = href; },
  isBlocked: () => !session || navigationPending || personalSaving || Boolean(document.querySelector('dialog[open]'))
});
function personalFormSignature() {
  const form = document.querySelector('#record-form, #settings-form');
  return form ? JSON.stringify([...new FormData(form)].filter(([key]) => key !== 'date')) : '';
}
function personalIsDirty() { return personalSaving || personalFormSignature() !== personalSaved; }
function navIcon(page) {
  const paths = {
    today: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    team: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/>',
    board: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 3v18M8 9h13M13 14h4m-4 3h4"/>',
    record: '<rect x="4" y="3" width="16" height="18" rx="4"/><path d="M12 8v8m-4-4h8"/>',
    progress: '<path d="M4 4v16h16M8 15l4-5 4 2 4-7"/>',
    settings: '<path d="M9.5 4 10 2h4l.5 2 2 1.2 2-.6 2 3.4-1.5 1.5v3l1.5 1.5-2 3.4-2-.6-2 1.2-.5 2h-4l-.5-2-2-1.2-2 .6-2-3.4L5 12.5v-3L3.5 8l2-3.4 2 .6Z"/><circle cx="12" cy="11" r="3"/>',
    admin: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    accounts: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    naver: '<path d="m10 13 4-4m-7 2-2 2a4.2 4.2 0 0 0 6 6l2-2m-2-10 2-2a4.2 4.2 0 0 1 6 6l-2 2"/>'
  };
  return `<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[page] || paths.naver}</svg></span>`;
}
function navLabel(page, label, mobileLabel) {
  return `${navIcon(page)}<span class="nav-label">${label}</span><span class="nav-mobile-label">${mobileLabel}</span>`;
}
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateLabel = key => new Date(`${key}T12:00:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
const entries = () => Object.entries(state.records).filter(([, r]) => r && typeof r === 'object').sort(([a], [b]) => a.localeCompare(b));
const weights = () => entries().filter(([, r]) => Number(r.weight) > 0);
const currentWeight = () => weights().at(-1)?.[1].weight || state.settings.startWeight || '';
const mealCount = r => ['breakfast', 'lunch', 'dinner'].filter(k => String(r[k] || '').trim()).length;
const hasRecord = r => Boolean(r.weight || mealCount(r) || r.workout || r.workoutNote);
let toastTimer;
function toast(message) { const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 4000); }
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(csrfToken ? {'X-CSRF-Token': csrfToken} : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/login') { session = null; bootstrap = null; csrfToken = ''; state = blankState(); render(); }
    const error = new Error(data.error || '요청을 처리하지 못했습니다.'); error.status = response.status; throw error;
  }
  return data;
}
async function save(next) {
  try { const result = await api('/api/personal', {method:'PUT', body:JSON.stringify({...next, personalRevision:bootstrap.personalRevision})}); bootstrap = result; state = result.personal; return true; }
  catch (error) { toast(error.status === 409 ? '다른 창에서 기록이 변경됐어요. 입력 내용을 복사한 뒤 새로고침해주세요.' : error.message); return false; }
}
async function loadBootstrap() {
  bootstrap = await api('/api/bootstrap'); session = bootstrap.user; csrfToken = bootstrap.csrfToken; state = bootstrap.personal || blankState();
}
function loginView(error = '') {
  return `<div class="login-shell"><section class="login-story"><a class="brand" href="#"><span class="brand-mark">L<span>↗</span></span><span>LEBEN ZONDA<small>8-WEEK TEAM PROGRAM</small></span></a><div><span class="eyebrow">BETTER, TOGETHER</span><h1>나의 변화,<br>우리의 8주.</h1><p>함께 기록하고, 서로 응원하고.<br>각자의 역할로 완성하는 존다 프로그램.</p><div class="login-people"><span>식단</span><span>조장</span><span>운동</span><span>SNS</span></div></div><small>20 MEMBERS · 5 TEAMS · ONE JOURNEY</small></section><section class="login-panel"><div class="eyebrow">WELCOME TO THE TEAM</div><h2>우리 팀에 합류하세요.</h2><p class="subtitle">네이버로 로그인하고 카페 연동을 신청해주세요.</p>${naverLoginView()}<details class="legacy-login"><summary>관리자 · 기존 계정 로그인</summary><form id="login-form"><div class="field"><label for="login-id">아이디</label><input id="login-id" name="username" autocomplete="username" required maxlength="40" placeholder="아이디 입력"></div><div class="field"><label for="login-password">비밀번호</label><input id="login-password" name="password" autocomplete="current-password" type="password" required maxlength="128" placeholder="비밀번호 입력"></div><p id="login-error" class="form-error" role="alert">${escapeHTML(error)}</p><button class="button" type="submit">로그인 <span>↗</span></button></form></details><div class="demo-note"><strong>테스트용 프로그램입니다</strong><p>가상의 회원 20명과 관리자 1명이 등록되어 있습니다.<br>아이디와 초기 비밀번호는 계정 안내 파일을 확인해주세요.</p></div></section></div>`;
}
function renderShell() {
  document.body.classList.toggle('is-admin', session.isAdmin);
  document.body.classList.toggle('is-pending-member', Boolean(session.pendingApproval));
  const routes = session.pendingApproval ? [['connect','카페 연동 신청','카페 연동']] : session.isAdmin ? [['admin','팀 · 역할 관리','팀 관리'], ['accounts','회원 계정','회원'], ['naver','네이버 카페 연결','카페 연결'], ['board','전체 식단','전체 식단']] : [['today','오늘의 현황','오늘'],['team','우리 팀','우리 팀'],['board','전체 식단','전체 식단'],['record','데일리 기록','기록'],['progress','나의 변화','변화']];
  document.querySelector('.sidebar nav').innerHTML = routes.map(([id,label,mobileLabel]) => `<a href="#${id}" data-page="${id}" aria-label="${label}" draggable="false">${navLabel(id,label,mobileLabel)}</a>`).join('');
  const settingsLink = document.querySelector('.settings-link');
  settingsLink.innerHTML = navLabel('settings','프로그램 설정','설정');
  settingsLink.setAttribute('aria-label','프로그램 설정');
  settingsLink.setAttribute('draggable','false');
  document.querySelector('.program-label').textContent = session.pendingApproval ? '카페 연결 준비' : session.isAdmin ? '관리자 워크스페이스' : bootstrap.program.name;
  document.querySelector('.settings-link').style.display = session.isAdmin || session.pendingApproval ? 'none' : '';
  document.querySelector('.profile').innerHTML = `<span class="avatar">${session.isAdmin ? 'AD' : escapeHTML(session.name.slice(-2))}</span><span>${escapeHTML(session.name)}</span><button id="logout-button" type="button">로그아웃</button>`;
  document.querySelector('#logout-button').addEventListener('click', async () => {
    if (navigationPending || personalSaving) return;
    if (personalIsDirty() && !confirm('저장하지 않은 기록을 버리고 로그아웃할까요?')) return;
    if (naverIsDirty() && !confirm('저장하지 않은 카페 연결 설정이 있습니다. 로그아웃할까요?')) return;
    if(mealsHasUnsaved() && !await confirmMealDiscard()) return;
    if (typeof adminIsDirty === 'function' && adminIsDirty() && !confirm('저장하지 않은 팀 편성 변경이 있습니다. 로그아웃할까요?')) return;
    try { await api('/api/logout', {method:'POST',body:'{}'}); session = null; bootstrap = null; csrfToken = ''; state = blankState(); resetAdminDraft(); location.hash = ''; render(); }
    catch(error) { toast(error.message); }
  });
}
function heading(kicker, title, subtitle, extra = '') { return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${extra}</div>`; }
function stat(label, value, unit, note, icon) { return `<div class="stat"><div class="stat-label"><span>${label}</span><span>${icon}</span></div><div class="stat-value">${escapeHTML(value || '—')}<small>${unit}</small></div><p class="stat-note">${note}</p></div>`; }
function chart() {
  const rows = weights();
  if (rows.length < 2) return `<div class="empty-chart"><div class="chart-icon">⌁</div><p>${rows.length ? '첫 번째 체중이 기록됐어요.<br>다음 기록부터 변화를 보여드릴게요.' : '나의 변화는 첫 기록부터.<br>체중을 기록하고 흐름을 확인해보세요.'}</p></div>`;
  const values = rows.map(([, r]) => Number(r.weight));
  const min = Math.min(...values) - .5, max = Math.max(...values) + .5;
  const points = values.map((v, i) => [22 + i / (values.length - 1) * 456, 130 - (v - min) / (max - min) * 100]);
  const path = points.map(p => p.join(',')).join(' ');
  return `<div class="chart"><svg viewBox="0 0 500 155" role="img" aria-label="체중 변화 그래프. 날짜별 체중은 아래 기록에서 확인할 수 있습니다."><path d="M20 30H480 M20 80H480 M20 130H480" stroke="#e9ede3" fill="none"/><polygon points="22,150 ${path} 478,150" fill="#edf3e4"/><polyline points="${path}" fill="none" stroke="#5e804a" stroke-width="2.5" stroke-linejoin="round"/>${points.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4" fill="#204b3e"><title>${escapeHTML(rows[i][0])}: ${values[i]} kg</title></circle>`).join('')}</svg></div><div class="chart-bottom"><span>${escapeHTML(rows[0][0])}</span><span>${escapeHTML(rows.at(-1)[0])}</span></div><p class="chart-caption">${Math.min(...values)}–${Math.max(...values)} kg · 기록한 날짜 순서</p>`;
}
function todayView() {
  const r = state.records[todayKey()] || {};
  const foodCount = Math.max(mealCount(r), bootstrap.photoMealCounts?.[todayKey()] || 0);
  const done = Number(Boolean(r.weight)) + Number(foodCount > 0) + Number(Boolean(r.workout));
  const name = `${escapeHTML(state.settings.name || session.name)}님, `;
  return heading('YOUR DAILY CHECK-IN', `${name}오늘도 한 걸음.`, '기록은 가볍게, 건강한 습관은 꾸준하게.', `<span class="date-tag">${dateLabel(todayKey())}</span>`) +
    memberTeamBanner() + `<section class="hero"><div><div class="eyebrow">BUILD YOUR OWN PACE</div><h2>${done === 3 ? '오늘의 체크인, 완료했어요.' : '오늘의 작은 실천을<br>기록해볼까요?'}</h2><p>잘 먹고, 즐겁게 움직이고, 나의 변화를 확인해요.</p><a class="button lime" href="#record">${done ? '오늘 기록 이어가기' : '오늘의 기록 시작하기'} <span>↗</span></a></div><div class="hero-art"><div class="hero-number">${done}<span>/ 3</span></div><small>오늘의 체크인</small></div></section>` +
    `<div class="stats">${stat('현재 체중', currentWeight(), 'kg', weights().length ? '가장 최근에 기록한 체중' : '설정 또는 기록으로 시작해요', '◌')}${stat('목표 체중', state.settings.goalWeight, 'kg', '나의 속도에 맞춘 목표', '⚑')}${stat('기록한 날', entries().filter(([, r]) => hasRecord(r)).length.toString(), '일', '하루씩 쌓이는 나의 습관', '▦')}</div>` +
    `<div class="columns"><section class="card"><div class="card-heading"><h2>오늘의 체크리스트</h2><span class="badge">${done} / 3 완료</span></div>${task('◌', '체중 기록', r.weight ? `${r.weight} kg 기록했어요` : '오늘의 몸 상태를 확인해요', Boolean(r.weight))}${task('♧', '식단 사진', foodCount ? `${foodCount}끼를 기록했어요` : '우리 팀에 식단 사진을 올려요', foodCount > 0, 'team')}${task('↗', '운동 체크', r.workout ? '오늘의 운동을 완료했어요' : '오늘의 운동 또는 휴식을 기록해요', Boolean(r.workout))}</section><section class="card"><div class="card-heading"><h2>나의 체중 흐름</h2><a class="button text" href="#progress">전체 보기 ↗</a></div>${chart()}</section></div>`;
}
function task(icon, title, description, done, route = 'record') { return `<a class="task-row" href="#${route}"><span class="task-symbol" aria-hidden="true">${icon}</span><div class="task-text"><strong>${title}</strong><p>${escapeHTML(description)}</p></div><span class="task-status ${done ? 'done' : ''}" aria-label="${done ? '완료' : '미완료'}">${done ? '✓' : '↗'}</span></a>`; }
function recordView(date = todayKey()) {
  const r = state.records[date] || {};
  return heading('DAILY JOURNAL', '오늘을 기록해요.', '완벽한 하루가 아니어도 괜찮아요. 있는 그대로 남겨주세요.') +
    `<div class="form-layout"><form id="record-form" class="form-stack"><section class="card"><div class="card-heading"><h2>몸 상태</h2><span class="badge">01</span></div><div class="field-row"><div class="field"><label for="record-date">기록 날짜</label><input id="record-date" name="date" type="date" required max="${todayKey()}" value="${escapeHTML(date)}"></div><div class="field"><label for="weight">체중 (kg)</label><input id="weight" name="weight" type="number" min="1" max="500" step="0.1" placeholder="예: 72.5" value="${escapeHTML(r.weight || '')}"></div></div></section><section class="card"><div class="card-heading"><h2>식단 메모</h2><span class="badge">나만 보기</span></div><a class="photo-record-link" href="#team/${date}"><span><strong>사진은 우리 팀 식단에 올려주세요</strong><small>식단 담당이 모아 전체 회원에게 공유해요</small></span><span>↗</span></a>${['breakfast', 'lunch', 'dinner'].map((key, i) => `<div class="field"><label for="${key}">${['아침', '점심', '저녁'][i]}</label><input id="${key}" name="${key}" maxlength="300" placeholder="먹은 음식을 간단하게 적어주세요" value="${escapeHTML(r[key] || '')}"></div>`).join('')}</section><section class="card"><div class="card-heading"><h2>운동</h2><span class="badge">03</span></div><label class="check-field"><input name="workout" type="checkbox" ${r.workout ? 'checked' : ''}> 오늘 운동을 완료했어요</label><div class="field"><label for="workout-note">운동 메모 <small>선택</small></label><textarea id="workout-note" name="workoutNote" maxlength="1000" placeholder="오늘의 WOD, 운동 시간 또는 휴식 메모">${escapeHTML(r.workoutNote || '')}</textarea></div><div class="form-actions"><button class="button" type="submit">기록 저장하기 <span>↗</span></button></div></section></form><aside class="card helper-card"><div class="large-symbol">✳</div><h2>오늘의 나에게 집중하기</h2><p>체중은 가능하면 비슷한 시간에 기록해보세요. 하루의 숫자보다 쌓여가는 흐름을 살펴봐요.</p><p>모든 항목을 채우지 않아도 저장할 수 있어요. 쉬는 날에는 운동 메모에 휴식을 남겨주세요.</p><p>같은 날짜의 기록을 다시 저장하면 기존 내용이 수정됩니다.</p></aside></div>`;
}
function progressView() {
  const current = Number(currentWeight()), start = Number(state.settings.startWeight);
  const change = current && start ? Math.round((current - start) * 10) / 10 : null;
  return heading('YOUR PROGRESS', '차곡차곡, 나의 변화.', '숫자 하나보다 꾸준히 쌓아온 기록을 살펴보세요.') +
    `<div class="stats">${stat('시작 체중', state.settings.startWeight, 'kg', '프로그램 설정에서 입력', '◌')}${stat('현재 체중', currentWeight(), 'kg', '가장 최근에 기록한 체중', '◌')}${stat('시작 대비 변화', change === null ? '' : `${change > 0 ? '+' : ''}${change}`, 'kg', '현재 체중 − 시작 체중', '↗')}</div><section class="card progress-chart"><div class="card-heading"><h2>체중 변화</h2><span class="badge">전체 기록</span></div>${chart()}</section><section class="card history"><div class="card-heading"><h2>지난 기록</h2><a class="button text" href="#record">기록하기 ＋</a></div>${entries().length ? `<div class="history-row header"><span>날짜</span><span>체중</span><span>식단</span><span>운동</span></div>${entries().reverse().map(([date, r]) => `<a class="history-row" href="#record/${date}" aria-label="${escapeHTML(date)} 기록 수정"><span>${escapeHTML(date.slice(5).replace('-', '. '))} ↗</span><span>${r.weight ? `${escapeHTML(r.weight)} kg` : '—'}</span><span>${mealCount(r)}끼 기록</span><span>${r.workout ? '운동 완료' : r.workoutNote ? '메모 있음' : '—'}</span></a>`).join('')}` : '<div class="empty-state">아직 기록이 없어요.<br>첫 번째 기록으로 시작해보세요.<br><a class="button secondary" href="#record">첫 기록 남기기 ↗</a></div>'}</section>`;
}
function settingsView() {
  return heading('PROGRAM SETTINGS', '나에게 맞는 시작.', '프로그램에서 사용할 이름과 체중 목표를 설정해주세요.') +
    `<form id="settings-form" class="card settings-card"><div class="card-heading"><h2>나의 기본 정보</h2><span class="badge">모든 항목 선택</span></div><div class="field"><label for="name">이름 또는 닉네임</label><input id="name" name="name" maxlength="30" value="${escapeHTML(state.settings.name)}" placeholder="어떻게 불러드릴까요?"></div><div class="field-row" style="margin-top:22px"><div class="field"><label for="start-weight">시작 체중 (kg)</label><input id="start-weight" name="startWeight" type="number" min="1" max="500" step="0.1" value="${escapeHTML(state.settings.startWeight)}" placeholder="예: 75"></div><div class="field"><label for="goal-weight">목표 체중 (kg)</label><input id="goal-weight" name="goalWeight" type="number" min="1" max="500" step="0.1" value="${escapeHTML(state.settings.goalWeight)}" placeholder="직접 설정해주세요"></div></div><div class="form-actions"><button class="button" type="submit">설정 저장하기 ↗</button></div></form><p class="privacy-note">기록은 로그인한 계정별로 서버에 저장됩니다.<br>개인 체중과 이곳의 식단 메모는 다른 회원에게 공개되지 않습니다.<br>우리 팀에 올린 식단 사진과 사진 메모는 팀원이 볼 수 있고, 식단 담당이 전체 회원에게 공유할 수 있습니다.<br>팀과 역할은 관리자가 지정하며, 이 화면의 이름은 개인 화면에서 사용할 닉네임입니다.</p>`;
}
function render() {
  if (!authReady) return;
  mobileNavigation.cancel();
  cleanupMeals();
  cleanupNaverUI();
  renderedHash = location.hash;
  document.body.classList.remove('auth-pending');
  document.body.classList.toggle('logged-out', !session);
  const loginRoot = document.querySelector('#login-root');
  if (!session) {
    app.innerHTML = ''; document.querySelector('.profile').innerHTML = ''; loginRoot.innerHTML = loginView();
    personalSaved = ''; mobileNavigation.sync();
    mountNaverLogin();
    document.querySelector('#login-form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); const data = new FormData(form); button.disabled = true; button.textContent = '로그인 중…';
      try {
        const result = await api('/api/login', {method:'POST',body:JSON.stringify({username:String(data.get('username')).trim(),password:data.get('password')})});
        session = result.user; csrfToken = result.csrfToken; await loadBootstrap(); resetAdminDraft();
        location.hash = session.isAdmin ? 'admin' : 'today'; render();
      } catch(error) { session = null; bootstrap = null; document.querySelector('#login-error').textContent = error.message; }
      finally { button.disabled = false; button.innerHTML = '로그인 <span>↗</span>'; }
    });
    return;
  }
  loginRoot.innerHTML = ''; renderShell();
  const [route,date] = location.hash.slice(1).split('/');
  const allowed = session.pendingApproval ? ['connect'] : session.isAdmin ? ['admin','accounts','naver','board'] : ['today','team','board','record','progress','settings','connect'];
  const page = !session.isAdmin && route === 'settings' && date === 'naver-success' ? 'connect' : allowed.includes(route) ? route : allowed[0];
  document.querySelector('#page-label').textContent = labels[page];
  document.querySelector('.topbar > span:first-child').firstChild.textContent = session.isAdmin ? 'ADMIN SPACE ' : 'MEMBER SPACE ';
  document.querySelectorAll('[data-page]').forEach(node => { node.classList.toggle('active', node.dataset.page === page); if (node.dataset.page === page) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current'); });
  mobileNavigation.sync();
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00`)) && date <= todayKey();
  app.innerHTML = ({today:todayView,team:()=>mealLoadingView(false),board:()=>mealLoadingView(true),record:()=>recordView(validDate ? date : todayKey()),progress:progressView,settings:settingsView,admin:adminView,accounts:accountsView,naver:naverAdminView,connect:naverOnboardingView})[page]();
  if (page === 'admin') bindAdmin();
  if (page === 'naver') mountNaverAdmin();
  if (page === 'connect') mountNaverOnboarding();
  if (page === 'settings') { app.insertAdjacentHTML('beforeend', naverMemberView()); mountNaverMember(); }
  if (page === 'team' || page === 'board') mountMeals(page === 'board', validDate ? date : todayKey());
  document.querySelector('#record-date')?.addEventListener('change', event => { if(event.target.checkValidity()) location.hash = `record/${event.target.value}`; });
  document.querySelector('#record-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true; personalSaving = true;
    const submittedSignature = personalFormSignature();
    const data = new FormData(event.currentTarget), date = data.get('date');
    const record = Object.fromEntries(['weight','breakfast','lunch','dinner','workoutNote'].map(k=>[k,String(data.get(k)||'').trim()])); record.workout = data.get('workout') === 'on';
    const next = {...state, records:{...state.records}}; if(hasRecord(record)) next.records[date] = record; else delete next.records[date];
    if(await save(next)) { personalSaved = submittedSignature; toast('기록을 저장했어요. 오늘도 수고했어요!'); } button.disabled = false; personalSaving = false;
  });
  document.querySelector('#settings-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true; personalSaving = true; const data = new FormData(event.currentTarget);
    const submittedSignature = personalFormSignature();
    if(await save({...state,settings:Object.fromEntries(['name','startWeight','goalWeight'].map(k=>[k,String(data.get(k)||'').trim()]))})) { personalSaved = submittedSignature; toast('설정을 저장했어요.'); } button.disabled = false; personalSaving = false;
  });
  personalSaved = personalFormSignature();
  window.scrollTo(0,0);
}
window.addEventListener('hashchange', async () => {
  const nextHash = location.hash;
  if (nextHash === renderedHash) return;
  const restoreHash = () => history.replaceState(null, '', `${location.pathname}${location.search}${renderedHash}`);
  if (navigationPending) { restoreHash(); return; }
  navigationPending = true;
  mobileNavigation.cancel();
  try {
    const hasDraft = personalIsDirty() || naverIsDirty() || mealsHasUnsaved() || adminIsDirty();
    if (hasDraft) {
      restoreHash();
      const recordDate = document.querySelector('#record-date');
      if (recordDate) recordDate.value = renderedHash.split('/')[1] || todayKey();
      const mealDate = document.querySelector('#meal-date');
      if (mealDate && mealPage) mealDate.value = mealPage.date;
      if (personalSaving) { toast('기록을 저장하고 있어요. 저장이 끝난 뒤 이동해주세요.'); return; }
      if (personalIsDirty() && !confirm('저장하지 않은 기록을 버리고 이동할까요?')) return;
      if (naverIsDirty() && !confirm('저장하지 않은 카페 연결 설정을 버리고 이동할까요?')) return;
      if (mealsHasUnsaved() && !await confirmMealDiscard()) return;
      if (adminIsDirty()) {
        if (!confirm('저장하지 않은 팀 편성 변경을 버리고 이동할까요?')) return;
        resetAdminDraft();
      }
      history.replaceState(null, '', `${location.pathname}${location.search}${nextHash}`);
    }
    render();
  } finally {
    navigationPending = false;
    mobileNavigation.sync();
  }
});
window.addEventListener('beforeunload', event => { if(adminIsDirty() || mealsHasUnsaved() || naverIsDirty() || personalIsDirty()) { event.preventDefault(); event.returnValue = ''; } });
(async () => {
  try { const result = await api('/api/session'); session = result.user; csrfToken = result.csrfToken || ''; if(session) await loadBootstrap(); }
  catch(error) { session = null; toast('서버에 연결하지 못했습니다. 잠시 후 새로고침해주세요.'); }
  authReady = true; render();
})();
