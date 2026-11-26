const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function guideContext(extra = {}) {
  const context = vm.createContext({
    escapeHTML: text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    ...extra
  });
  for (const file of ['guide-movements', 'guide-benchmarks', 'guide-terms', 'guide-match', 'guide']) {
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
  assert.equal(filters[2]['aria-pressed'], 'true');
  search.value = '';
  search.oninput();
  assert.match(results.innerHTML, /data-guide-entry="cindy"/);
  assert.doesNotMatch(results.innerHTML, /data-guide-entry="toes-to-bar"/);
});

test('movement guide loads video only on activation and returns focus without scrolling or changing route', () => {
  let current, frame, returned = false;
  const host = { append(dialog) { current = dialog; } };
  const document = {
    querySelector(selector) { return selector === '#app' ? host : current; },
    createElement(tag) {
      if (tag === 'iframe') return { focus() {} };
      return {
        setAttribute() {}, showModal() { this.open = true; },
        remove() { current = null; }, close() { this.onclose(); },
        querySelector() { return null; }
      };
    }
  };
  const ui = guideContext({ document, session: { isAdmin: false } });
  const opener = { isConnected: true, focus(options) { returned = options.preventScroll; } };
  ui.openGuideEntry('toes-to-bar', opener);
  assert.equal(current.open, true);
  assert.doesNotMatch(current.innerHTML, /<iframe/);
  assert.match(current.innerHTML, /https:\/\/www.youtube.com\/watch\?v=/);
  const token = current.innerHTML.match(/data-guide-video="([\w-]+)"/)[1];
  const play = { dataset: { guideVideo: token }, replaceWith(node) { frame = node; } };
  current.onclick({ target: { closest(selector) { return selector === '[data-guide-video]' ? play : null; } } });
  assert.equal(frame.src, 'https://www.youtube-nocookie.com/embed/' + token + '?autoplay=1&playsinline=1');
  assert.equal(frame.referrerPolicy, 'strict-origin-when-cross-origin');
  current.onclick({ target: { closest(selector) { return selector === '.guide-close' ? {} : null; } } });
  assert.equal(current, null);
  assert.equal(returned, true);
});

test('only benchmark detail for a member offers personal benchmark history', () => {
  const ui = guideContext();
  const entries = ui.guideEntries();
  const find = id => entries.find(item => item.id === id);
  assert.match(ui.guideDetail(find('fran'), true), /내 지난 기록/);
  assert.doesNotMatch(ui.guideDetail(find('fran'), false), /내 지난 기록/);
  assert.doesNotMatch(ui.guideDetail(find('amrap'), true), /내 지난 기록/);
  assert.doesNotMatch(ui.guideDetail(find('toes-to-bar'), true), /내 지난 기록/);
});
