const guideCategories = {
  movement: '동작 사전',
  benchmark: '네임드 와드',
  term: '기본 용어'
};

function guideEntries() {
  const catalog = { movement: guideMovements, benchmark: guideBenchmarks, term: guideTerms };
  return Object.entries(catalog).flatMap(([category, entries]) => entries.map(entry => ({ ...entry, category })));
}

function guideEnglishLabel(entry, abbreviationLimit = Infinity) {
  const abbreviations = entry.aliases.filter(name => /^[A-Z][A-Z0-9&/+ -]{1,8}$/.test(name) && name !== entry.english);
  return [entry.english, ...abbreviations.slice(0, abbreviationLimit)].join(' · ');
}

function benchmarkSummary(entry) {
  if (entry.amrapMinutes) return { format: 'AMRAP', goal: '최대한 많이 반복', label: '제한 시간', amount: entry.amrapMinutes + '분' };
  if (entry.emomMinutes) return { format: 'EMOM', goal: '매분 한 라운드 시작', label: '운동 시간', amount: entry.emomMinutes + '분' };
  const rounds = entry.roundReps?.length || entry.rounds;
  const summary = { format: 'For Time', goal: '완료 시간 측정' };
  if (rounds) return { ...summary, label: '라운드 수', amount: rounds + '라운드' };
  if (entry.steps.length === 1) return { ...summary, label: '총 반복 횟수', amount: entry.steps[0].amount };
  return { ...summary, label: '운동 구성', amount: entry.steps.length + '단계' };
}

function guideFacts(entry) {
  if (entry.category === 'movement') {
    return [{ label: '동작 유형', value: entry.family }, { label: '사용 장비', value: entry.equipment }];
  }
  if (entry.category === 'term') {
    return [{ label: '용어 분류', value: entry.topic }, { label: '와드 표기 예시', value: entry.notation, english: true }];
  }
  const { format, goal, label, amount } = benchmarkSummary(entry);
  return [{ label: '운동 방식', value: format, english: true, note: goal }, { label, value: amount }];
}

function guideFactValue(fact) {
  const value = escapeHTML(fact.value);
  return fact.english ? `<span lang="en">${value}</span>` : value;
}

function guideResultRow(entry) {
  const isMovement = entry.category === 'movement';
  const english = guideEnglishLabel(entry, isMovement ? 1 : Infinity);
  let summary = '';
  if (!isMovement) {
    const facts = guideFacts(entry).map(guideFactValue).join(' · ');
    const description = entry.category === 'benchmark' ? entry.steps.map(step => step.name).join(' · ') : entry.description;
    summary = `<span class="guide-card-facts">${facts}</span><span class="guide-card-description">${escapeHTML(description)}</span>`;
  }
  return `<li><button type="button" class="guide-row${isMovement ? ' guide-movement-row' : ''}" data-guide-entry="${escapeHTML(entry.id)}" aria-haspopup="dialog">
      <span><span class="guide-card-name"><strong>${escapeHTML(entry.name)}</strong><small lang="en">${escapeHTML(english)}</small></span>${summary}</span>
      <span aria-hidden="true" class="guide-chevron">›</span></button></li>`;
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
    const rows = matches.map(guideResultRow).join('');
    return `<section class="guide-group" aria-labelledby="guide-title-${category}">
      <h2 id="guide-title-${category}">${label} <span>${matches.length}</span></h2>
      <ul>${rows}</ul></section>`;
  }).join('');
}

const guideListVisits = new Map();
let lastGuideList = null;
let stopTrackingGuideList = null;

function mountGuide() {
  const page = document.querySelector('#guide-page');
  if (!page) return;
  const all = guideEntries();
  const query = page.querySelector('#guide-query');
  const filters = page.querySelectorAll('[data-guide-filter]');
  const owner = session.id;
  if (lastGuideList && lastGuideList.owner !== owner) {
    guideListVisits.clear();
    lastGuideList = null;
  }
  const stored = history.state?.guideList;
  const previous = stored?.owner === owner ? guideListVisits.get(stored.key) || stored : lastGuideList;
  const visit = {
    owner, key: stored?.owner === owner ? stored.key : crypto.getRandomValues(new Uint32Array(2)).join('-'),
    category: previous?.category || 'all', query: previous?.query || '',
    scrollY: previous?.scrollY || 0, entry: previous?.entry || ''
  };
  // Older entries can restore their serialized History snapshot after leaving this cache.
  guideListVisits.delete(visit.key);
  guideListVisits.set(visit.key, visit);
  if (guideListVisits.size > 50) guideListVisits.delete(guideListVisits.keys().next().value);
  lastGuideList = visit;
  query.value = visit.query;
  const hash = location.hash;
  function rememberScroll() {
    if (location.hash === hash) visit.scrollY = window.scrollY;
  }
  function saveEntry() {
    if (location.hash === hash) {
      rememberScroll();
      history.replaceState({ ...history.state, guideList: visit }, '');
    }
  }
  function saveBeforeLink(event) {
    if (event.target.closest('a[href]')) saveEntry();
  }
  function update() {
    const results = all.filter(item => (visit.category === 'all' || visit.category === item.category) && guideSearchMatches(item, visit.query));
    page.querySelector('[data-guide-results]').innerHTML = guideResultGroups(results);
    page.querySelector('[data-guide-count]').textContent = `검색 결과 ${results.length}개`;
    for (const filter of filters) filter.setAttribute('aria-pressed', String(filter.dataset.guideFilter === visit.category));
  }
  page.onclick = event => {
    const filter = event.target.closest('[data-guide-filter]');
    if (filter) {
      visit.category = filter.dataset.guideFilter;
      visit.entry = '';
      update();
      return;
    }
    const opener = event.target.closest('[data-guide-entry]');
    if (opener) {
      visit.entry = opener.dataset.guideEntry;
      rememberScroll();
      openGuideEntry(visit.entry, opener);
    }
  };
  query.oninput = () => {
    visit.query = query.value;
    visit.entry = '';
    update();
  };
  update();
  window.scrollTo(0, visit.scrollY);
  if (visit.entry) {
    const row = [...page.querySelectorAll('[data-guide-entry]')].find(node => node.dataset.guideEntry === visit.entry);
    row?.focus({ preventScroll: true });
  }
  saveEntry();
  window.addEventListener('scroll', rememberScroll, { passive: true });
  window.addEventListener('pagehide', saveEntry);
  document.addEventListener('click', saveBeforeLink, true);
  stopTrackingGuideList = () => {
    window.removeEventListener('scroll', rememberScroll);
    window.removeEventListener('pagehide', saveEntry);
    document.removeEventListener('click', saveBeforeLink, true);
  };
}

function guideVideoButton(id) {
  return `<button class="guide-play" type="button" data-guide-video="${id}">
    <span aria-hidden="true">▶</span> 시범 영상 재생</button>`;
}

function benchmarkDetail(entry) {
  let workout;
  if (entry.roundReps) {
    const columns = entry.steps.map(step => '<th scope="col">' + escapeHTML(step.name) + '</th>').join('');
    const rows = entry.roundReps.map((reps, index) => `<tr><th scope="row">${index + 1}라운드</th>
      ${entry.steps.map(() => '<td>' + reps + '회</td>').join('')}</tr>`).join('');
    workout = `<section><h3>라운드별 운동 순서</h3><table class="benchmark-rounds"><caption class="sr-only">${escapeHTML(entry.name)} 라운드별 동작과 횟수</caption>
      <thead><tr><th scope="col">라운드</th>${columns}</tr></thead><tbody>${rows}</tbody></table></section>`;
  } else {
    const title = entry.amrapMinutes || entry.emomMinutes || entry.rounds ? '한 라운드의 운동 순서' : '운동 구성';
    const steps = entry.steps.map(step => `<li><div><span>${escapeHTML(step.name)}</span><strong>${escapeHTML(step.amount)}</strong></div></li>`).join('');
    workout = `<section><h3>${title}</h3><ol class="benchmark-steps">${steps}</ol></section>`;
  }
  const rx = entry.rx ? `<section><h3>처방 기준 <span lang="en">(Rx)</span></h3>
    <table class="benchmark-rx"><caption class="sr-only">${escapeHTML(entry.name)}의 여성·남성 처방 기준</caption>
      <thead><tr><th scope="col">항목</th><th scope="col">여성</th><th scope="col">남성</th></tr></thead>
      <tbody>${entry.rx.map(row => `<tr><th scope="row">${escapeHTML(row.label)}</th><td>${escapeHTML(row.women)}</td>
        <td>${escapeHTML(row.men)}</td></tr>`).join('')}</tbody></table></section>` : '';
  return `<p>${escapeHTML(entry.description)}</p>${workout}${rx}
    <section class="guide-callout"><h3>기록 방법</h3><p>${escapeHTML(entry.scoring)}</p></section>`;
}

function guideDetail(entry, showHistory, motion) {
  const facts = guideFacts(entry).map(fact => `<div><dt>${escapeHTML(fact.label)}</dt><dd>${guideFactValue(fact)}${fact.note ? '<small>' + escapeHTML(fact.note) + '</small>' : ''}</dd></div>`).join('');
  const summary = `<dl class="guide-summary">${facts}</dl>`;
  let content;
  if (entry.category === 'benchmark') {
    content = benchmarkDetail(entry);
  } else if (entry.category === 'movement') {
    const cue = entry.cue ? `<section class="guide-callout"><h3>동작 포인트</h3><p>${escapeHTML(entry.cue)}</p></section>` : '';
    content = `<p>${escapeHTML(entry.description)}</p>${cue}`;
  } else {
    const definition = [entry.description, entry.cue].filter(Boolean).join(' ');
    content = `<p>${escapeHTML(definition)}</p><section class="guide-callout"><h3>와드 예시</h3><p>${escapeHTML(entry.example)}</p></section>`;
  }
  const videoId = /^[A-Za-z0-9_-]{11}$/.test(entry.videoId || '') ? entry.videoId : '';
  const video = videoId ? `<details class="guide-demo"><summary>공식 시범 영상</summary>
    <div class="guide-player">${guideVideoButton(videoId)}</div>
    <a class="guide-link" href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer">YouTube에서 보기 ↗</a></details>` : '';
  const history = showHistory && entry.category === 'benchmark'
    ? `<details class="wod-history guide-history" open><summary>내 지난 기록</summary><ul></ul>
      <p role="status"></p><button type="button" class="button secondary" data-history-more hidden>더 보기</button></details>` : '';
  return `<header class="guide-dialog-header"><div><p class="guide-kind">${guideCategories[entry.category]}</p>
      <h2 id="guide-detail-title">${escapeHTML(entry.name)}</h2><p class="guide-english" lang="en">${escapeHTML(guideEnglishLabel(entry))}</p></div>
      <button class="guide-close" type="button" aria-label="가이드 닫기" autofocus>닫기</button></header>
    <div class="guide-dialog-body">${summary}${content}
      ${motion ? movementPlayerView(motion) : ''}${video}
      ${history}
      ${entry.sourceUrl ? `<a class="guide-link" href="${escapeHTML(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">CrossFit 공식 자료 ↗</a>` : ''}
    </div>`;
}

const guideMotionPlayers = new WeakMap();

function removeGuideDialog(dialog) {
  guideMotionPlayers.get(dialog)?.dispose();
  guideMotionPlayers.delete(dialog);
  dialog.remove();
}

function cleanupGuide() {
  if (stopTrackingGuideList) stopTrackingGuideList();
  stopTrackingGuideList = null;
  if (!session) {
    guideListVisits.clear();
    lastGuideList = null;
  }
  const dialog = document.querySelector('.guide-dialog');
  if (dialog) removeGuideDialog(dialog);
}

function openGuideEntry(id, opener) {
  const entry = guideEntries().find(item => item.id === id);
  const host = document.querySelector('#app');
  if (!entry || !host) return;
  const previous = document.querySelector('.guide-dialog');
  if (previous) removeGuideDialog(previous);
  const dialog = document.createElement('dialog');
  dialog.className = 'guide-dialog';
  dialog.setAttribute('aria-labelledby', 'guide-detail-title');
  dialog.setAttribute('closedby', 'any');
  const motion = entry.category === 'movement' ? getMovementMotion(entry.id) : null;
  dialog.innerHTML = guideDetail(entry, Boolean(session && !session.isAdmin && !session.pendingApproval), motion);
  host.append(dialog);
  dialog.onclose = () => {
    removeGuideDialog(dialog);
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
      guideMotionPlayers.get(dialog)?.pause();
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
  const simulator = dialog.querySelector('[data-motion-player]');
  if (simulator) {
    const player = mountMovementPlayer(simulator, motion);
    guideMotionPlayers.set(dialog, player);
    const video = dialog.querySelector('.guide-demo');
    if (video) {
      video.ontoggle = () => {
        if (video.open) player.pause();
        else if (video.querySelector('iframe')) video.querySelector('.guide-player').innerHTML = guideVideoButton(entry.videoId);
      };
      const closeVideo = () => { if (video.open) video.open = false; };
      simulator.addEventListener('click', closeVideo);
      simulator.addEventListener('input', closeVideo);
    }
  }
  const history = dialog.querySelector('.guide-history');
  if (history) bindWodHistory(history, entry.id);
}
