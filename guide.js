const guideCategories = {
  movement: '동작 사전',
  benchmark: '네임드 와드',
  term: '기본 용어'
};

function guideEntries() {
  const catalog = { movement: guideMovements, benchmark: guideBenchmarks, term: guideTerms };
  return Object.entries(catalog).flatMap(([category, entries]) => entries.map(entry => ({ ...entry, category })));
}

function guideEnglishLabel(entry) {
  const abbreviations = entry.aliases.filter(name => /^[A-Z][A-Z0-9&/+ -]{1,8}$/.test(name) && name !== entry.english);
  return [entry.english, ...abbreviations].join(' · ');
}

function guideView() {
  const filters = Object.entries({ all: '전체', ...guideCategories }).map(([id, label]) =>
    `<button type="button" data-guide-filter="${id}" aria-pressed="${id === 'all'}">${label}</button>`
  ).join('');
  return `<header class="page-heading"><h1>크로스핏 가이드</h1></header>
    <div id="guide-page">
      <div class="guide-tools">
        <label class="guide-search" for="guide-query"><span>가이드 검색</span>
          <input id="guide-query" type="search" placeholder="동작명, 와드 이름 또는 약어" autocomplete="off" maxlength="100"></label>
        <div class="guide-filters" role="group" aria-label="가이드 분류">${filters}</div>
      </div>
      <p class="sr-only" role="status" data-guide-count></p>
      <div class="guide-results" data-guide-results></div>
    </div>`;
}

function guideResultGroups(entries) {
  if (!entries.length) return '<p class="guide-empty">검색 결과가 없습니다. 다른 이름이나 약어로 검색해 보세요.</p>';
  return Object.entries(guideCategories).map(([category, label]) => {
    const matches = entries.filter(item => item.category === category);
    if (!matches.length) return '';
    const rows = matches.map(item => `<li><button type="button" class="guide-row"
        data-guide-entry="${escapeHTML(item.id)}" aria-haspopup="dialog">
        <span><strong>${escapeHTML(item.name)}</strong><small lang="en">${escapeHTML(guideEnglishLabel(item))}</small></span>
        <span aria-hidden="true" class="guide-chevron">›</span></button></li>`).join('');
    return `<section class="guide-group" aria-labelledby="guide-title-${category}">
      <h2 id="guide-title-${category}">${label} <span>${matches.length}</span></h2>
      <ul>${rows}</ul></section>`;
  }).join('');
}

function mountGuide() {
  const page = document.querySelector('#guide-page');
  if (!page) return;
  const all = guideEntries();
  const query = page.querySelector('#guide-query');
  const filters = page.querySelectorAll('[data-guide-filter]');
  let category = 'all';
  function update() {
    const results = all.filter(item => (category === 'all' || category === item.category) && guideSearchMatches(item, query.value));
    page.querySelector('[data-guide-results]').innerHTML = guideResultGroups(results);
    page.querySelector('[data-guide-count]').textContent = `검색 결과 ${results.length}개`;
    for (const filter of filters) filter.setAttribute('aria-pressed', String(filter.dataset.guideFilter === category));
  }
  page.onclick = event => {
    const filter = event.target.closest('[data-guide-filter]');
    if (filter) {
      category = filter.dataset.guideFilter;
      update();
      return;
    }
    const opener = event.target.closest('[data-guide-entry]');
    if (opener) openGuideEntry(opener.dataset.guideEntry, opener);
  };
  query.oninput = update;
  update();
}

function guideDetail(entry, showHistory) {
  const videoId = /^[A-Za-z0-9_-]{11}$/.test(entry.videoId || '') ? entry.videoId : '';
  const video = videoId ? `<section class="guide-demo"><h3>동작 시범</h3>
    <div class="guide-player"><button class="guide-play" type="button" data-guide-video="${videoId}">
      <span aria-hidden="true">▶</span> 시범 영상 재생</button></div>
    <a class="guide-link" href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer">YouTube에서 보기 ↗</a></section>` : '';
  const workout = entry.workout?.length ? `<section><h3>운동 구성</h3><ul class="guide-workout">
    ${entry.workout.map(line => '<li>' + escapeHTML(line) + '</li>').join('')}</ul></section>` : '';
  const history = showHistory && entry.category === 'benchmark'
    ? `<details class="wod-history guide-history" open><summary>내 지난 기록</summary><ul></ul>
      <p role="status"></p><button type="button" class="button secondary" data-history-more hidden>더 보기</button></details>` : '';
  return `<header class="guide-dialog-header"><div><p class="guide-kind">${guideCategories[entry.category]}</p>
      <h2 id="guide-detail-title">${escapeHTML(entry.name)}</h2><p class="guide-english" lang="en">${escapeHTML(guideEnglishLabel(entry))}</p></div>
      <button class="guide-close" type="button" aria-label="가이드 닫기" autofocus>닫기</button></header>
    <div class="guide-dialog-body"><p>${escapeHTML(entry.description)}</p>
      ${entry.cue ? '<p>' + escapeHTML(entry.cue) + '</p>' : ''}
      ${video}${workout}
      ${entry.scoring ? '<section><h3>기록 방법</h3><p>' + escapeHTML(entry.scoring) + '</p></section>' : ''}
      ${entry.example ? '<section><h3>예시</h3><p>' + escapeHTML(entry.example) + '</p></section>' : ''}
      ${history}
      ${entry.sourceUrl ? `<a class="guide-link" href="${escapeHTML(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">CrossFit 공식 자료 ↗</a>` : ''}
    </div>`;
}

function cleanupGuide() {
  const dialog = document.querySelector('.guide-dialog');
  if (dialog) dialog.remove();
}

function openGuideEntry(id, opener) {
  const entry = guideEntries().find(item => item.id === id);
  const host = document.querySelector('#app');
  if (!entry || !host) return;
  cleanupGuide();
  const dialog = document.createElement('dialog');
  dialog.className = 'guide-dialog';
  dialog.setAttribute('aria-labelledby', 'guide-detail-title');
  dialog.setAttribute('closedby', 'any');
  dialog.innerHTML = guideDetail(entry, Boolean(session && !session.isAdmin && !session.pendingApproval));
  host.append(dialog);
  dialog.onclose = () => {
    dialog.remove();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
  dialog.onclick = event => {
    if (event.target.closest('.guide-close') || event.target.closest('.guide-history a')) {
      dialog.close();
      return;
    }
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      return;
    }
    const play = event.target.closest('[data-guide-video]');
    if (play) {
      const frame = document.createElement('iframe');
      frame.title = entry.name + ' 동작 시범 영상';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.src = 'https://www.youtube-nocookie.com/embed/' + play.dataset.guideVideo + '?autoplay=1&playsinline=1';
      play.replaceWith(frame);
      frame.focus({ preventScroll: true });
    }
  };
  dialog.showModal();
  const history = dialog.querySelector('.guide-history');
  if (history) bindWodHistory(history, entry.id);
}
