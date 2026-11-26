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

function benchmarkSummary(entry) {
  if (entry.amrapMinutes) return { format: 'AMRAP', goal: '최대한 많이 반복', label: '제한 시간', amount: entry.amrapMinutes + '분' };
  const rounds = entry.roundReps?.length || entry.rounds;
  const summary = { format: 'For Time', goal: '완료 시간 측정' };
  if (rounds) return { ...summary, label: '라운드 수', amount: rounds + '라운드' };
  if (entry.steps.length === 1) return { ...summary, label: '총 반복 횟수', amount: entry.steps[0].amount };
  return { ...summary, label: '운동 구성', amount: entry.steps.length + '개 동작' };
}

function guideResultRow(entry) {
  const isBenchmark = entry.category === 'benchmark';
  const name = `<strong>${escapeHTML(entry.name)}</strong><small lang="en">${escapeHTML(guideEnglishLabel(entry))}</small>`;
  let content = name;
  if (isBenchmark) {
    const { format, amount } = benchmarkSummary(entry);
    content = `<span class="benchmark-name">${name}</span>
      <span class="benchmark-card-format"><span lang="en">${format}</span> · ${escapeHTML(amount)}</span>
      <span class="benchmark-card-moves">${entry.steps.map(step => escapeHTML(step.name)).join(' · ')}</span>`;
  }
  return `<li><button type="button" class="guide-row${isBenchmark ? ' guide-benchmark-row' : ''}"
      data-guide-entry="${escapeHTML(entry.id)}" aria-haspopup="dialog">
      <span>${content}</span><span aria-hidden="true" class="guide-chevron">›</span></button></li>`;
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
    return `<section class="guide-group${category === 'benchmark' ? ' guide-benchmarks' : ''}" aria-labelledby="guide-title-${category}">
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

function guideVideoButton(id) {
  return `<button class="guide-play" type="button" data-guide-video="${id}">
    <span aria-hidden="true">▶</span> 시범 영상 재생</button>`;
}

function benchmarkDetail(entry) {
  const { format, goal, label, amount } = benchmarkSummary(entry);
  const summary = `<dl class="benchmark-summary"><div><dt>운동 방식</dt><dd><span lang="en">${format}</span><small>${goal}</small></dd></div>
    <div><dt>${label}</dt><dd>${escapeHTML(amount)}</dd></div></dl>`;
  let workout;
  if (entry.roundReps) {
    const columns = entry.steps.map(step => '<th scope="col">' + escapeHTML(step.name) + '</th>').join('');
    const rows = entry.roundReps.map((reps, index) => `<tr><th scope="row">${index + 1}라운드</th>
      ${entry.steps.map(() => '<td>' + reps + '회</td>').join('')}</tr>`).join('');
    workout = `<section><h3>라운드별 운동 순서</h3><table class="benchmark-rounds"><caption class="sr-only">${escapeHTML(entry.name)} 라운드별 동작과 횟수</caption>
      <thead><tr><th scope="col">라운드</th>${columns}</tr></thead><tbody>${rows}</tbody></table></section>`;
  } else {
    const title = entry.amrapMinutes || entry.rounds ? '한 라운드의 운동 순서' : '운동 구성';
    const steps = entry.steps.map(step => `<li><div><span>${escapeHTML(step.name)}</span><strong>${escapeHTML(step.amount)}</strong></div></li>`).join('');
    workout = `<section><h3>${title}</h3><ol class="benchmark-steps">${steps}</ol></section>`;
  }
  const rx = entry.rx ? `<section><h3>처방 기준 <span lang="en">(Rx)</span></h3>
    <table class="benchmark-rx"><caption class="sr-only">${escapeHTML(entry.name)}의 여성·남성 처방 기준</caption>
      <thead><tr><th scope="col">항목</th><th scope="col">여성</th><th scope="col">남성</th></tr></thead>
      <tbody>${entry.rx.map(row => `<tr><th scope="row">${escapeHTML(row.label)}</th><td>${escapeHTML(row.women)}</td>
        <td>${escapeHTML(row.men)}</td></tr>`).join('')}</tbody></table></section>` : '';
  return `${summary}<p>${escapeHTML(entry.description)}</p>${workout}${rx}
    <section class="benchmark-score"><h3>기록 방법</h3><p>${escapeHTML(entry.scoring)}</p></section>`;
}

function guideDetail(entry, showHistory, motion) {
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
    <div class="guide-dialog-body">${entry.category === 'benchmark' ? benchmarkDetail(entry) : '<p>' + escapeHTML(entry.description) + '</p>'}
      ${entry.cue ? '<p>' + escapeHTML(entry.cue) + '</p>' : ''}
      ${motion ? movementPlayerView(motion) : ''}${video}
      ${entry.example ? '<section><h3>예시</h3><p>' + escapeHTML(entry.example) + '</p></section>' : ''}
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
  const dialog = document.querySelector('.guide-dialog');
  if (dialog) removeGuideDialog(dialog);
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
