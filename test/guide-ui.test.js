const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function guideContext(extra = {}) {
  const context = vm.createContext({
    escapeHTML: text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    ...extra
  });
  for (const file of ['guide-movements', 'guide-benchmarks', 'guide-terms', 'guide-match',
    'motion-strength', 'motion-bodyweight', 'motion-equipment', 'motion-muscle-ups', 'motion-timeline', 'motion-muscles', 'motion-muscle-view',
    'motion-3d-controls', 'motion-player', 'guide']) {
    vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), context);
  }
  return context;
}

test('guide searches across categories, combines filters with aliases and can recover an empty result', () => {
  const filters = ['all', 'movement', 'benchmark', 'term'].map(category => ({
    dataset: { guideFilter: category },
    setAttribute(name, value) { this[name] = value; },
    closest() { return this; }
  }));
  const search = { value: '' }, results = {}, count = {};
  const page = {
    querySelectorAll: () => filters,
    querySelector: selector => ({ '#guide-query': search, '[data-guide-results]': results, '[data-guide-count]': count })[selector]
  };
  const ui = guideContext({ document: { querySelector: () => page } });
  ui.mountGuide();
  assert.equal(filters[0]['aria-pressed'], 'true');
  search.value = 't2b';
  search.oninput();
  assert.match(results.innerHTML, /토투바/);
  assert.match(results.innerHTML, /Toes-to-Bar · T2B/);
  assert.equal(count.textContent, '검색 결과 1개');
  page.onclick({ target: filters[2] });
  assert.match(results.innerHTML, /검색 결과가 없습니다/);
  search.value = 'Fran';
  search.oninput();
  assert.match(results.innerHTML, /data-guide-entry="fran"/);
  assert.match(results.innerHTML, /For Time<\/span> · 3라운드/);
  assert.match(results.innerHTML, /쓰러스터 · 풀업/);
  assert.equal(filters[2]['aria-pressed'], 'true');
  search.value = '';
  search.oninput();
  assert.match(results.innerHTML, /data-guide-entry="cindy"/);
  assert.doesNotMatch(results.innerHTML, /data-guide-entry="toes-to-bar"/);
});

test('머슬업 검색은 두 기구를 보여주고 와드의 기구별 표기는 각각 해당 동작을 연다', () => {
  const ui = guideContext();
  const entries = Array.from(ui.guideEntries());
  const ids = ['bar-muscle-up', 'ring-muscle-up'];
  for (const query of ['머슬업', '머슬 업', 'Muscle-Up']) {
    assert.deepEqual(entries.filter(entry => ui.guideSearchMatches(entry, query)).map(entry => entry.id).sort(), ids);
  }
  for (const [query, expected] of [['bmu', ids[0]], ['RMU', ids[1]], ['rmus', ids[1]]]) {
    assert.deepEqual(entries.filter(entry => ui.guideSearchMatches(entry, query)).map(entry => entry.id), [expected]);
  }
  const wod = '3 BMU · 3 RMUs · Bar Muscle-Ups · 링 머슬 업을 하고 바머슬업 1회';
  const html = ui.guideInlineHTML(wod);
  assert.deepEqual([...html.matchAll(/data-guide-entry="([^"]+)"/g)].map(hit => hit[1]),
    [ids[0], ids[1], ids[0], ids[1], ids[0]]);
  assert.equal(html.replace(/<[^>]+>/g, ''), wod);
  assert.doesNotMatch(ui.guideInlineHTML('머슬업 5회'), /data-guide-entry/);
  const videos = ids.map(id => {
    const entry = entries.find(item => item.id === id);
    const detail = ui.guideDetail(entry, false, ui.getMovementMotion(id));
    assert.match(detail, /data-motion-mode="3d"/);
    assert.ok(detail.includes('data-guide-video="' + entry.videoId + '"'));
    return entry.videoId;
  });
  assert.notEqual(videos[0], videos[1]);
});

test('movement guide loads video only on activation and returns focus without scrolling or changing route', () => {
  let current, frame, returned = false, pauses = 0, disposals = 0;
  const host = { append(dialog) { current = dialog; } };
  const simulator = { addEventListener() {} }, video = {};
  const document = {
    querySelector(selector) { return selector === '#app' ? host : current; },
    createElement(tag) {
      if (tag === 'iframe') return { focus() {} };
      return {
        setAttribute() {}, showModal() { this.open = true; },
        remove() { current = null; }, close() { this.onclose(); },
        querySelector(selector) {
          if (selector === '[data-motion-player]') return simulator;
          if (selector === '.guide-demo') return video;
          return null;
        }
      };
    }
  };
  const ui = guideContext({ document, session: { isAdmin: false } });
  ui.mountMovementPlayer = () => ({ pause() { pauses++; }, dispose() { disposals++; } });
  const opener = { isConnected: true, focus(options) { returned = options.preventScroll; } };
  ui.openGuideEntry('toes-to-bar', opener);
  assert.equal(current.open, true);
  assert.match(current.innerHTML, /data-motion-player/);
  assert.match(current.innerHTML, /<details class="guide-demo"><summary>공식 시범 영상/);
  assert.doesNotMatch(current.innerHTML, /<iframe/);
  assert.match(current.innerHTML, /https:\/\/www.youtube.com\/watch\?v=/);
  const token = current.innerHTML.match(/data-guide-video="([\w-]+)"/)[1];
  const play = { dataset: { guideVideo: token }, replaceWith(node) { frame = node; } };
  video.open = true;
  video.ontoggle();
  assert.equal(pauses, 1);
  current.onclick({ target: { closest(selector) { return selector === '[data-guide-video]' ? play : null; } } });
  assert.equal(frame.src, 'https://www.youtube-nocookie.com/embed/' + token + '?autoplay=1&playsinline=1');
  assert.equal(frame.referrerPolicy, 'strict-origin-when-cross-origin');
  current.onclick({ target: { closest(selector) { return selector === '.guide-close' ? {} : null; } } });
  assert.equal(current, null);
  assert.equal(returned, true);
  assert.equal(disposals, 1);
  ui.openGuideEntry('toes-to-bar', opener);
  ui.cleanupGuide();
  assert.equal(disposals, 2);
});

test('only benchmark detail for a member offers personal benchmark history', () => {
  const ui = guideContext();
  const entries = ui.guideEntries();
  const find = id => entries.find(item => item.id === id);
  assert.match(ui.guideDetail(find('fran'), true), /내 지난 기록/);
  assert.doesNotMatch(ui.guideDetail(find('fran'), true), /data-motion-player/);
  assert.doesNotMatch(ui.guideDetail(find('fran'), false), /내 지난 기록/);
  assert.doesNotMatch(ui.guideDetail(find('amrap'), true), /내 지난 기록/);
  assert.doesNotMatch(ui.guideDetail(find('toes-to-bar'), true), /내 지난 기록/);
});

test('named workouts present the prescribed order, per-round reps, equipment and scoring', () => {
  const ui = guideContext();
  const catalog = ui.guideEntries().filter(entry => entry.category === 'benchmark');
  for (const entry of catalog) {
    const html = ui.guideDetail(entry, true);
    assert.match(html, /class="benchmark-summary"/, entry.id);
    assert.ok(html.includes(entry.description) && html.includes(entry.scoring), entry.id);
    assert.ok(html.includes(entry.sourceUrl), entry.id);
    let previous = -1;
    for (const step of entry.steps) {
      const position = html.indexOf('>' + step.name + '<');
      assert.ok(position > previous, entry.id);
      previous = position;
      if (step.amount) assert.ok(html.includes('>' + step.amount + '<'), entry.id);
    }
    for (const rule of entry.rx || []) {
      assert.ok(html.includes(rule.label) && html.includes(rule.women) && html.includes(rule.men), entry.id);
    }
  }
  const detail = id => ui.guideDetail(catalog.find(entry => entry.id === id), true);
  const rounds = [...detail('fran').matchAll(/<td>(\d+)회<\/td>/g)].map(hit => Number(hit[1]));
  assert.deepEqual(rounds, [21, 21, 15, 15, 9, 9]);
  assert.equal((detail('annie').match(/<th scope="row">\d라운드/g) || []).length, 5);
  assert.match(detail('cindy'), /AMRAP[\s\S]*20분[\s\S]*5회[\s\S]*10회[\s\S]*15회/);
  assert.doesNotMatch(detail('cindy'), /class="benchmark-rx"/);
  assert.match(detail('karen'), /공 무게[\s\S]*14 lb[\s\S]*20 lb[\s\S]*표적 높이[\s\S]*9 ft[\s\S]*10 ft/);
});
