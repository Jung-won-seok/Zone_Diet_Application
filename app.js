const labels = { today: '오늘의 현황', team: '우리 팀 식단', board: '전체 식단', record: '데일리 기록', progress: '나의 변화', settings: '내 설정', admin: '팀 · 역할 관리', accounts: '회원 계정', naver: '네이버 카페 연결' };
const blankState = () => ({ settings: { name: '', startWeight: '', goalWeight: '' }, records: {} });
let state = blankState();
let session = null;
let bootstrap = null;
let csrfToken = '';
let authReady = false;
let renderedHash = location.hash;
const app = document.querySelector('#app');
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
  return `<div class="login-shell"><section class="login-story"><a class="brand" href="#"><span class="brand-mark">L<span>↗</span></span><span>LEBEN ZONDA<small>8-WEEK TEAM PROGRAM</small></span></a><div><span class="eyebrow">BETTER, TOGETHER</span><h1>나의 변화,<br>우리의 8주.</h1><p>함께 기록하고, 서로 응원하고.<br>각자의 역할로 완성하는 존다 프로그램.</p><div class="login-people"><span>식단</span><span>조장</span><span>운동</span><span>SNS</span></div></div><small>20 MEMBERS · 5 TEAMS · ONE JOURNEY</small></section><section class="login-panel"><div class="eyebrow">WELCOME TO THE TEAM</div><h2>우리 팀에 합류하세요.</h2><p class="subtitle">관리자가 전달한 계정으로 로그인해주세요.</p><form id="login-form"><div class="field"><label for="login-id">아이디</label><input id="login-id" name="username" autocomplete="username" required maxlength="40" placeholder="아이디 입력"></div><div class="field"><label for="login-password">비밀번호</label><input id="login-password" name="password" autocomplete="current-password" type="password" required maxlength="128" placeholder="비밀번호 입력"></div><p id="login-error" class="form-error" role="alert">${escapeHTML(error)}</p><button class="button" type="submit">로그인 <span>↗</span></button></form><div class="demo-note"><strong>테스트용 프로그램입니다</strong><p>가상의 회원 20명과 관리자 1명이 등록되어 있습니다.<br>아이디와 초기 비밀번호는 계정 안내 파일을 확인해주세요.</p></div></section></div>`;
}
function renderShell() {
  document.body.classList.toggle('is-admin', session.isAdmin);
  const routes = session.isAdmin ? [['admin','팀 · 역할 관리'], ['accounts','회원 계정'], ['naver','네이버 카페 연결'], ['board','전체 식단']] : [['today','오늘'],['team','우리 팀'],['board','전체 식단'],['record','기록'],['progress','변화']];
  const mobileLabels = {admin:'팀 관리',accounts:'회원 계정',naver:'카페 연결',board:'전체 식단'};
  document.querySelector('.sidebar nav').innerHTML = routes.map(([id,label]) => `<a href="#${id}" data-page="${id}" aria-label="${label}"><span class="nav-icon">${zondaIcon(id)}</span><span class="nav-label">${label}</span>${session.isAdmin?`<span class="nav-mobile-label" aria-hidden="true">${mobileLabels[id]}</span>`:''}</a>`).join('');
  document.querySelector('.program-label').textContent = session.isAdmin ? '관리자 워크스페이스' : bootstrap.program.name;
  document.querySelector('.settings-link').style.display = session.isAdmin ? 'none' : '';
  document.querySelector('.settings-link').setAttribute('aria-label','프로그램 설정');
  document.querySelector('.settings-link').innerHTML = `${zondaIcon('settings','settings-icon')}<span class="settings-desktop-label">프로그램 설정</span><span class="settings-mobile-label" aria-hidden="true">설정</span>`;
  document.querySelector('.profile').innerHTML = `<span class="avatar">${session.isAdmin ? 'AD' : escapeHTML(session.name.slice(-2))}</span><span>${escapeHTML(session.name)}</span><button id="logout-button" type="button">로그아웃</button>`;
  document.querySelector('#logout-button').addEventListener('click', async () => {
    if (naverIsDirty() && !confirm('저장하지 않은 카페 연결 설정이 있습니다. 로그아웃할까요?')) return;
    if(mealsHasUnsaved() && !await confirmMealDiscard()) return;
    if (typeof adminIsDirty === 'function' && adminIsDirty() && !confirm('저장하지 않은 팀 편성 변경이 있습니다. 로그아웃할까요?')) return;
    try { await api('/api/logout', {method:'POST',body:'{}'}); session = null; bootstrap = null; csrfToken = ''; state = blankState(); resetAdminDraft(); location.hash = ''; render(); }
    catch(error) { toast(error.message); }
  });
}
function heading(kicker, title, subtitle, extra = '') { return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${extra}</div>`; }
function stat(label, value, unit, note, icon) { return `<div class="stat"><div class="stat-label"><span>${label}</span><span>${zondaIcon(icon)}</span></div><div class="stat-value">${escapeHTML(value || '—')}<small>${unit}</small></div><p class="stat-note">${note}</p></div>`; }
function chart() {
  const rows = weights();
  if (rows.length < 2) return `<div class="empty-chart"><div class="chart-icon">${zondaIcon('activity')}</div><p>${rows.length ? '첫 번째 체중이 기록됐어요.<br>다음 기록부터 변화를 보여드릴게요.' : '나의 변화는 첫 기록부터.<br>체중을 기록하고 흐름을 확인해보세요.'}</p></div>`;
  const values = rows.map(([, r]) => Number(r.weight));
  const min = Math.min(...values) - .5, max = Math.max(...values) + .5;
  const points = values.map((v, i) => [22 + i / (values.length - 1) * 456, 130 - (v - min) / (max - min) * 100]);
  const path = points.map(p => p.join(',')).join(' ');
  return `<div class="chart"><svg viewBox="0 0 500 155" role="img" aria-label="체중 변화 그래프. 날짜별 체중은 아래 기록에서 확인할 수 있습니다."><path d="M20 30H480 M20 80H480 M20 130H480" stroke="var(--line, #e9ede3)" fill="none"/><polygon points="22,150 ${path} 478,150" fill="var(--chart-fill, #edf3e4)"/><polyline points="${path}" fill="none" stroke="var(--green, #5e804a)" stroke-width="2.5" stroke-linejoin="round"/>${points.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4" fill="var(--green, #204b3e)"><title>${escapeHTML(rows[i][0])}: ${values[i]} kg</title></circle>`).join('')}</svg></div><div class="chart-bottom"><span>${escapeHTML(rows[0][0])}</span><span>${escapeHTML(rows.at(-1)[0])}</span></div><p class="chart-caption">${Math.min(...values)}–${Math.max(...values)} kg · 기록한 날짜 순서</p>`;
}
function todayView() {
  const r = state.records[todayKey()] || {};
  const foodCount = Math.max(mealCount(r), bootstrap.photoMealCounts?.[todayKey()] || 0);
  const done = Number(Boolean(r.weight)) + Number(foodCount > 0) + Number(Boolean(r.workout));
  const name = `${escapeHTML(state.settings.name || session.name)}님, `;
  return heading('YOUR DAILY CHECK-IN', `${name}오늘도 한 걸음.`, '기록은 가볍게, 건강한 습관은 꾸준하게.', `<span class="date-tag">${dateLabel(todayKey())}</span>`) +
    memberTeamBanner() + `<section class="hero"><div><div class="eyebrow">BUILD YOUR OWN PACE</div><h2>${done === 3 ? '오늘의 체크인, 완료했어요.' : '오늘의 작은 실천을<br>기록해볼까요?'}</h2><p>잘 먹고, 즐겁게 움직이고, 나의 변화를 확인해요.</p><a class="button lime" href="#record">${done ? '오늘 기록 이어가기' : '오늘의 기록 시작하기'} <span>↗</span></a></div><div class="hero-art"><div class="hero-number">${done}<span>/ 3</span></div><small>오늘의 체크인</small></div></section>` +
    `<div class="stats">${stat('현재 체중', currentWeight(), 'kg', weights().length ? '가장 최근에 기록한 체중' : '설정 또는 기록으로 시작해요', 'scale')}${stat('목표 체중', state.settings.goalWeight, 'kg', '나의 속도에 맞춘 목표', 'target')}${stat('기록한 날', entries().filter(([, r]) => hasRecord(r)).length.toString(), '일', '하루씩 쌓이는 나의 습관', 'calendar')}</div>` +
    `<div class="columns"><section class="card"><div class="card-heading"><h2>오늘의 체크리스트</h2><span class="badge">${done} / 3 완료</span></div>${task('scale', '체중 기록', r.weight ? `${r.weight} kg 기록했어요` : '오늘의 몸 상태를 확인해요', Boolean(r.weight))}${task('meal', '식단 사진', foodCount ? `${foodCount}끼를 기록했어요` : '우리 팀에 식단 사진을 올려요', foodCount > 0, 'team')}${task('exercise', '운동 체크', r.workout ? '오늘의 운동을 완료했어요' : '오늘의 운동 또는 휴식을 기록해요', Boolean(r.workout))}</section><section class="card"><div class="card-heading"><h2>나의 체중 흐름</h2><a class="button text" href="#progress">전체 보기 ↗</a></div>${chart()}</section></div>`;
}
function task(icon, title, description, done, route = 'record') { return `<a class="task-row" href="#${route}"><span class="task-symbol" aria-hidden="true">${zondaIcon(icon)}</span><div class="task-text"><strong>${title}</strong><p>${escapeHTML(description)}</p></div><span class="task-status ${done ? 'done' : ''}" aria-label="${done ? '완료' : '미완료'}">${zondaIcon(done ? 'check' : 'arrow')}</span></a>`; }
function recordView(date = todayKey()) {
  const r = state.records[date] || {};
  return heading('DAILY JOURNAL', '오늘을 기록해요.', '완벽한 하루가 아니어도 괜찮아요. 있는 그대로 남겨주세요.') +
    `<div class="form-layout"><form id="record-form" class="form-stack"><section class="card"><div class="card-heading"><h2>몸 상태</h2><span class="badge">01</span></div><div class="field-row"><div class="field"><label for="record-date">기록 날짜</label><input id="record-date" name="date" type="date" required max="${todayKey()}" value="${escapeHTML(date)}"></div><div class="field"><label for="weight">체중 (kg)</label><input id="weight" name="weight" type="number" min="1" max="500" step="0.1" placeholder="예: 72.5" value="${escapeHTML(r.weight || '')}"></div></div></section><section class="card"><div class="card-heading"><h2>식단 메모</h2><span class="badge">나만 보기</span></div><a class="photo-record-link" href="#team/${date}"><span><strong>사진은 우리 팀 식단에 올려주세요</strong><small>식단 담당이 모아 전체 회원에게 공유해요</small></span><span>↗</span></a>${['breakfast', 'lunch', 'dinner'].map((key, i) => `<div class="field"><label for="${key}">${['아침', '점심', '저녁'][i]}</label><input id="${key}" name="${key}" maxlength="300" placeholder="먹은 음식을 간단하게 적어주세요" value="${escapeHTML(r[key] || '')}"></div>`).join('')}</section><section class="card"><div class="card-heading"><h2>운동</h2><span class="badge">03</span></div><label class="check-field"><input name="workout" type="checkbox" ${r.workout ? 'checked' : ''}> 오늘 운동을 완료했어요</label><div class="field"><label for="workout-note">운동 메모 <small>선택</small></label><textarea id="workout-note" name="workoutNote" maxlength="1000" placeholder="오늘의 WOD, 운동 시간 또는 휴식 메모">${escapeHTML(r.workoutNote || '')}</textarea></div><div class="form-actions"><button class="button" type="submit">기록 저장하기 <span>↗</span></button></div></section></form><aside class="card helper-card"><div class="large-symbol">${zondaIcon('sparkles')}</div><h2>오늘의 나에게 집중하기</h2><p>체중은 가능하면 비슷한 시간에 기록해보세요. 하루의 숫자보다 쌓여가는 흐름을 살펴봐요.</p><p>모든 항목을 채우지 않아도 저장할 수 있어요. 쉬는 날에는 운동 메모에 휴식을 남겨주세요.</p><p>같은 날짜의 기록을 다시 저장하면 기존 내용이 수정됩니다.</p></aside></div>`;
}
function progressView() {
  const current = Number(currentWeight()), start = Number(state.settings.startWeight);
  const change = current && start ? Math.round((current - start) * 10) / 10 : null;
  return heading('YOUR PROGRESS', '차곡차곡, 나의 변화.', '숫자 하나보다 꾸준히 쌓아온 기록을 살펴보세요.') +
    `<div class="stats">${stat('시작 체중', state.settings.startWeight, 'kg', '프로그램 설정에서 입력', 'scale')}${stat('현재 체중', currentWeight(), 'kg', '가장 최근에 기록한 체중', 'scale')}${stat('시작 대비 변화', change === null ? '' : `${change > 0 ? '+' : ''}${change}`, 'kg', '현재 체중 − 시작 체중', 'progress')}</div><section class="card progress-chart"><div class="card-heading"><h2>체중 변화</h2><span class="badge">전체 기록</span></div>${chart()}</section><section class="card history"><div class="card-heading"><h2>지난 기록</h2><a class="button text" href="#record">기록하기 ＋</a></div>${entries().length ? `<div class="history-row header"><span>날짜</span><span>체중</span><span>식단</span><span>운동</span></div>${entries().reverse().map(([date, r]) => `<a class="history-row" href="#record/${date}" aria-label="${escapeHTML(date)} 기록 수정"><span>${escapeHTML(date.slice(5).replace('-', '. '))} ↗</span><span>${r.weight ? `${escapeHTML(r.weight)} kg` : '—'}</span><span>${mealCount(r)}끼 기록</span><span>${r.workout ? '운동 완료' : r.workoutNote ? '메모 있음' : '—'}</span></a>`).join('')}` : '<div class="empty-state">아직 기록이 없어요.<br>첫 번째 기록으로 시작해보세요.<br><a class="button secondary" href="#record">첫 기록 남기기 ↗</a></div>'}</section>`;
}
function settingsView() {
  return heading('PROGRAM SETTINGS', '나에게 맞는 시작.', '프로그램에서 사용할 이름과 체중 목표를 설정해주세요.') +
    `<form id="settings-form" class="card settings-card"><div class="card-heading"><h2>나의 기본 정보</h2><span class="badge">모든 항목 선택</span></div><div class="field"><label for="name">이름 또는 닉네임</label><input id="name" name="name" maxlength="30" value="${escapeHTML(state.settings.name)}" placeholder="어떻게 불러드릴까요?"></div><div class="field-row" style="margin-top:22px"><div class="field"><label for="start-weight">시작 체중 (kg)</label><input id="start-weight" name="startWeight" type="number" min="1" max="500" step="0.1" value="${escapeHTML(state.settings.startWeight)}" placeholder="예: 75"></div><div class="field"><label for="goal-weight">목표 체중 (kg)</label><input id="goal-weight" name="goalWeight" type="number" min="1" max="500" step="0.1" value="${escapeHTML(state.settings.goalWeight)}" placeholder="직접 설정해주세요"></div></div><div class="form-actions"><button class="button" type="submit">설정 저장하기 ↗</button></div></form><p class="privacy-note">기록은 로그인한 계정별로 서버에 저장됩니다.<br>개인 체중과 이곳의 식단 메모는 다른 회원에게 공개되지 않습니다.<br>우리 팀에 올린 식단 사진과 사진 메모는 팀원이 볼 수 있고, 식단 담당이 전체 회원에게 공유할 수 있습니다.<br>팀과 역할은 관리자가 지정하며, 이 화면의 이름은 개인 화면에서 사용할 닉네임입니다.</p>`;
}
function render() {
  if (!authReady) return;
  cleanupMeals();
  cleanupNaverUI();
  renderedHash = location.hash;
  document.body.classList.remove('auth-pending');
  document.body.classList.toggle('logged-out', !session);
  const loginRoot = document.querySelector('#login-root');
  if (!session) {
    app.innerHTML = ''; document.querySelector('.profile').innerHTML = ''; loginRoot.innerHTML = loginView();
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
  const allowed = session.isAdmin ? ['admin','accounts','naver','board'] : ['today','team','board','record','progress','settings'];
  const page = allowed.includes(route) ? route : allowed[0];
  document.querySelector('#page-label').textContent = labels[page];
  document.querySelector('.topbar > span:first-child').firstChild.textContent = session.isAdmin ? 'ADMIN SPACE ' : 'MEMBER SPACE ';
  document.querySelectorAll('[data-page]').forEach(node => { node.classList.toggle('active', node.dataset.page === page); if (node.dataset.page === page) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current'); });
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00`)) && date <= todayKey();
  app.innerHTML = ({today:todayView,team:()=>mealLoadingView(false),board:()=>mealLoadingView(true),record:()=>recordView(validDate ? date : todayKey()),progress:progressView,settings:settingsView,admin:adminView,accounts:accountsView,naver:naverAdminView})[page]();
  if (page === 'admin') bindAdmin();
  if (page === 'naver') mountNaverAdmin();
  if (page === 'settings') { app.insertAdjacentHTML('beforeend', naverMemberView()); mountNaverMember(); }
  if (page === 'team' || page === 'board') mountMeals(page === 'board', validDate ? date : todayKey());
  document.querySelector('#record-date')?.addEventListener('change', event => { if(event.target.checkValidity()) location.hash = `record/${event.target.value}`; });
  document.querySelector('#record-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
    const data = new FormData(event.currentTarget), date = data.get('date');
    const record = Object.fromEntries(['weight','breakfast','lunch','dinner','workoutNote'].map(k=>[k,String(data.get(k)||'').trim()])); record.workout = data.get('workout') === 'on';
    const next = {...state, records:{...state.records}}; if(hasRecord(record)) next.records[date] = record; else delete next.records[date];
    if(await save(next)) toast('기록을 저장했어요. 오늘도 수고했어요!'); button.disabled = false;
  });
  document.querySelector('#settings-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true; const data = new FormData(event.currentTarget);
    if(await save({...state,settings:Object.fromEntries(['name','startWeight','goalWeight'].map(k=>[k,String(data.get(k)||'').trim()]))})) toast('설정을 저장했어요.'); button.disabled = false;
  });
  window.scrollTo(0,0);
}
window.addEventListener('hashchange', async () => {
  if (naverIsDirty()) {
    const nextHash = location.hash; history.replaceState(null, '', renderedHash || location.pathname);
    if (!confirm('저장하지 않은 카페 연결 설정을 버리고 이동할까요?')) return;
    history.replaceState(null, '', nextHash || location.pathname);
  }
  if(mealsHasUnsaved()) {
    const nextHash=location.hash;
    history.replaceState(null, '', renderedHash || location.pathname);
    const dateInput=document.querySelector('#meal-date');if(dateInput)dateInput.value=mealPage.date;
    if(!await confirmMealDiscard())return;
    history.replaceState(null, '', nextHash || location.pathname);
  }
  render();
});
window.addEventListener('beforeunload', event => { if(adminIsDirty() || mealsHasUnsaved() || naverIsDirty()) { event.preventDefault(); event.returnValue = ''; } });
(async () => {
  try { const result = await api('/api/session'); session = result.user; csrfToken = result.csrfToken || ''; if(session) await loadBootstrap(); }
  catch(error) { session = null; toast('서버에 연결하지 못했습니다. 잠시 후 새로고침해주세요.'); }
  authReady = true; render();
})();
