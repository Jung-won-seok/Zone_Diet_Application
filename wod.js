function wodView() {
  return `<header class="page-heading"><h1>오늘의 와드</h1></header>
    <div id="wod-page" class="wod-stack" aria-busy="true">
      <p role="status">와드를 불러오는 중입니다.</p></div>`;
}

function wodIsDirty() {
  const form = document.querySelector('#wod-page form');
  return Boolean(form && (form.dataset.saving === 'true' ||
    form.dataset.saved !== JSON.stringify([...new FormData(form)])));
}

function restoreWodDate() {
  const root = document.querySelector('#wod-page');
  const field = root?.querySelector('#wod-date');
  if (field) field.value = root.dataset.date;
}

function wodUrl(date) {
  return '/api/wod' + (validBookingDate(date) ? '?date=' + encodeURIComponent(date) : '');
}

async function mountWodPreview(date) {
  const schedule = document.querySelector('#box-schedule');
  if (!schedule) return;
  const preview = document.createElement('section');
  preview.className = 'wod-preview';
  preview.setAttribute('aria-label', '선택한 날짜의 와드');
  schedule.before(preview);
  const link = document.createElement('a');
  link.href = validBookingDate(date) ? '#wod/' + date : '#wod';
  link.textContent = '와드 보기 →';
  preview.append(link);
  try {
    const day = await api(wodUrl(date));
    if (!preview.isConnected) return;
    const info = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = day.date === day.today ? '오늘의 와드' : dateLabel(day.date) + ' 와드';
    const title = document.createElement('p');
    title.textContent = day.wod?.title || '아직 등록된 와드가 없습니다.';
    info.append(heading, title);
    if (day.wod) {
      const description = document.createElement('p');
      description.className = 'wod-preview-plan';
      description.textContent = day.wod.description;
      info.append(description);
    }
    if (day.previous) {
      const last = document.createElement('p');
      last.className = 'wod-preview-result';
      last.textContent = '지난 기록 · ' + day.previous.date + ' · ' + wodRecordSummary(day.previous);
      info.append(last);
    }
    preview.prepend(info);
    link.href = '#wod/' + day.date;
    link.textContent = !day.wod && session.isAdmin ? '와드 등록 →' : '와드 보기 →';
  } catch {
    if (preview.isConnected) preview.prepend('와드를 불러오지 못했습니다.');
  }
}

function wodRecordSummary(record) {
  const parts = [record.time, record.weight ? record.weight + ' ' + record.unit : '', record.score, record.scaling];
  return parts.filter(Boolean).join(' · ');
}

function wodEditor(day) {
  const wod = day.wod;
  const options = day.benchmarks.map(entry =>
    `<option value="${escapeHTML(entry.benchmarkId)}"${entry.benchmarkId === wod?.benchmarkId ? ' selected' : ''}>${escapeHTML(entry.title)}</option>`
  ).join('');
  return `<form class="card wod-form" id="wod-editor">
    <h2>${wod ? '와드 수정' : '와드 등록'}</h2>
    <div class="field"><label for="wod-template">기존 와드 불러오기</label>
      <select id="wod-template" name="benchmarkId"><option value="">새 와드</option>${options}</select></div>
    <div class="field"><label for="wod-title">와드 이름</label>
      <input id="wod-title" name="title" value="${escapeHTML(wod?.title)}" maxlength="80" required placeholder="예: Fran"></div>
    <div class="field"><label for="wod-description">운동 구성</label>
      <textarea id="wod-description" name="description" rows="5" maxlength="4000" required placeholder="동작, 횟수, 기준 중량을 입력하세요.">${escapeHTML(wod?.description)}</textarea></div>
    <div><button class="button" type="submit">${wod ? '와드 수정 저장' : '와드 게시'}</button></div></form>`;
}

function wodResultForm(result = {}) {
  return `<form class="card wod-form" id="wod-result">
    <h2>내 운동 기록</h2>
    <div class="wod-field-grid">
      <div class="field"><label for="wod-time">완료 시간 (분:초)</label>
        <input id="wod-time" type="text" name="time" placeholder="예: 8:35" maxlength="6" pattern="[0-9]{1,3}:[0-5][0-9]" title="분:초 형식으로 입력하세요. 예: 8:35" value="${escapeHTML(result.time)}"></div>
      <div class="field"><label for="wod-weight">사용 중량</label><div class="wod-weight">
        <input id="wod-weight" type="number" name="weight" step="0.01" min="0.01" max="9999.99" placeholder="예: 42.5" value="${escapeHTML(result.weight)}">
        <select aria-label="중량 단위" name="unit"><option${result.unit !== 'lb' ? ' selected' : ''}>kg</option><option${result.unit === 'lb' ? ' selected' : ''}>lb</option></select></div></div>
      <div class="field"><label for="wod-score">라운드·횟수</label>
        <input id="wod-score" name="score" maxlength="80" placeholder="예: 5라운드 + 12회" value="${escapeHTML(result.score)}"></div>
      <div class="field"><label for="wod-scaling">스케일링</label>
        <input id="wod-scaling" name="scaling" maxlength="160" placeholder="예: Rx 또는 밴드 풀업" value="${escapeHTML(result.scaling)}"></div>
    </div><div><button class="button" type="submit">내 기록 저장</button></div></form>`;
}

function wodMemberView(day) {
  const wod = day.wod;
  let html = wod
    ? `<section class="card wod-sheet"><h2>${escapeHTML(wod.title)}</h2><p>${escapeHTML(wod.description)}</p></section>`
    : '<p class="card">이 날짜에는 등록된 와드가 없습니다.</p>';
  if (wod) {
    const previous = day.previous;
    html += `<section class="card wod-prior"><h2>같은 와드의 지난 기록</h2>
      ${previous ? `<p><a href="#wod/${escapeHTML(previous.date)}">${escapeHTML(previous.date)}</a></p>
        <strong>${escapeHTML(wodRecordSummary(previous))}</strong>` : '<p>이 날짜 이전에 남긴 기록이 없습니다.</p>'}</section>`;
    html += day.date <= day.today ? wodResultForm(day.result || {}) : '<p class="wod-note">운동 기록은 해당 날짜부터 입력할 수 있습니다.</p>';
  }
  return html;
}

function wodHistoryView() {
  return `<details class="card wod-history"><summary>내 전체 운동 기록</summary>
    <ul></ul><p role="status"></p><button class="button secondary" data-history-more type="button" hidden>더 보기</button></details>`;
}

function bindWodHistory(panel) {
  let cursor = '';
  let loaded = false;
  let busy = false;
  const list = panel.querySelector('ul');
  const message = panel.querySelector('[role="status"]');
  const more = panel.querySelector('button');
  async function load() {
    if (busy || (loaded && !cursor)) return;
    busy = true;
    more.hidden = true;
    message.textContent = '기록을 불러오는 중입니다.';
    try {
      const url = '/api/wod/history' + (cursor ? '?before=' + encodeURIComponent(cursor) : '');
      const page = await api(url);
      if (!panel.isConnected) return;
      for (const row of page.items) {
        list.insertAdjacentHTML('beforeend', `<li><a href="#wod/${escapeHTML(row.date)}">
          <time>${escapeHTML(row.date)}</time><strong>${escapeHTML(row.title)}</strong>
          <span>${escapeHTML(wodRecordSummary(row))}</span></a></li>`);
      }
      loaded = true;
      cursor = page.nextBefore;
      message.textContent = list.children.length ? '' : '아직 저장한 운동 기록이 없습니다.';
      more.hidden = !cursor;
      more.textContent = '더 보기';
    } catch (error) {
      if (!panel.isConnected) return;
      message.textContent = error.message;
      more.textContent = '다시 시도';
      more.hidden = false;
    } finally { busy = false; }
  }
  panel.ontoggle = () => { if (panel.open && !loaded) void load(); };
  more.onclick = load;
}

async function mountWod(date) {
  const root = document.querySelector('#wod-page');
  if (!root) return;
  let day;
  async function loadDay() {
    const oldForm = root.querySelector('form');
    if (oldForm) oldForm.inert = true;
    root.setAttribute('aria-busy', 'true');
    try {
      const fresh = await api(wodUrl(date));
      if (!root.isConnected) return;
      day = fresh;
      paint();
    } catch (error) {
      if (!root.isConnected) return;
      if (!day) root.innerHTML = '<p id="wod-message" role="status"></p><div><button class="button secondary" data-wod-reload type="button">다시 시도</button></div>';
      root.querySelector('[data-wod-reload]').hidden = false;
      root.querySelector('#wod-message').textContent = error.message;
    } finally {
      if (oldForm) oldForm.inert = false;
      root.setAttribute('aria-busy', 'false');
    }
  }
  function paint() {
    root.dataset.date = day.date;
    root.innerHTML = `<div class="wod-toolbar"><label for="wod-date">운동 날짜
      <input id="wod-date" type="date" value="${escapeHTML(day.date)}" required></label>
      <a class="button text" href="#wod/${escapeHTML(day.today)}">오늘</a></div>
      ${session.isAdmin ? wodEditor(day) : wodMemberView(day)}
      <div class="wod-feedback"><p id="wod-message" role="status"></p>
      <button type="button" class="button secondary" data-wod-reload hidden>최신 내용 불러오기</button></div>
      ${session.isAdmin ? '' : wodHistoryView()}`;
    const form = root.querySelector('form');
    if (form) form.dataset.saved = JSON.stringify([...new FormData(form)]);
    const history = root.querySelector('.wod-history');
    if (history) bindWodHistory(history);
  }
  root.onclick = event => {
    if (!event.target.closest('[data-wod-reload]') || root.getAttribute('aria-busy') === 'true') return;
    if (!wodIsDirty() || confirm('입력한 내용을 버리고 최신 정보를 불러올까요?')) void loadDay();
  };
  root.onchange = event => {
    const field = event.target;
    if (field.id === 'wod-date') {
      if (validBookingDate(field.value)) location.hash = 'wod/' + field.value;
      else restoreWodDate();
    }
    if (field.id === 'wod-template') {
      const template = day.benchmarks.find(row => row.benchmarkId === field.value);
      const fields = field.form.elements;
      fields.title.value = template?.title || '';
      fields.description.value = template?.description || '';
    }
  };
  root.onsubmit = async event => {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.saving === 'true' || root.getAttribute('aria-busy') === 'true') return;
    const body = Object.fromEntries(new FormData(form));
    const publish = form.id === 'wod-editor';
    const message = root.querySelector('#wod-message');
    const path = publish ? '/api/wod' : '/api/wod/result';
    if (publish) body.revision = day.wod?.revision || 0;
    else {
      if (![body.time, body.weight, body.score, body.scaling].some(field => field.trim())) {
        message.textContent = '완료 시간, 중량, 라운드·횟수, 스케일링 중 하나 이상을 입력해주세요.';
        form.elements.time.focus();
        return;
      }
      body.wodRevision = day.wod.revision;
      body.revision = day.result?.revision || 0;
    }
    form.dataset.saving = 'true';
    form.inert = true;
    message.textContent = '저장 중입니다.';
    try {
      const saved = await api(path + '?date=' + encodeURIComponent(day.date), {method:'PUT', body:JSON.stringify(body)});
      if (!form.isConnected) return;
      day = saved;
      paint();
      root.querySelector('#wod-message').textContent = publish ? '와드를 게시했습니다.' : '내 운동 기록을 저장했습니다.';
    } catch (error) {
      if (!form.isConnected) return;
      message.textContent = error.message;
      root.querySelector('[data-wod-reload]').hidden = error.status !== 409;
    } finally {
      form.inert = false;
      form.dataset.saving = 'false';
    }
  };
  await loadDay();
}
