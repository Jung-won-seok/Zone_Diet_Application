const test = require('node:test');
const assert = require('node:assert/strict');
const { readPublicAsset } = require('./support/public-assets');
const vm = require('node:vm');

const catalog = [
  { id: 't2b', category: 'movement', name: '토투바', english: 'Toes-to-Bar', aliases: ['T2B', '토 투 바'] },
  { id: 'press', category: 'movement', name: '프레스', english: 'Press' },
  { id: 'push-press', category: 'movement', name: '푸시 프레스', english: 'Push Press' },
  { id: 'burpee', category: 'movement', name: '버피', english: 'Burpee' },
  { id: 'fran', category: 'benchmark', name: '프랜', english: 'Fran' },
  { id: 'amrap', category: 'term', name: '앰랩', english: 'AMRAP' },
];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function loadUI(overrides = {}) {
  const context = vm.createContext({ guideEntries: () => catalog, escapeHTML, URLSearchParams, ...overrides });
  for (const file of ['guide-match.js', 'wod.js']) {
    vm.runInContext(readPublicAsset(file), context);
  }
  return context;
}

test('운동 이름 검색은 한글·영문·약어와 띄어쓰기·하이픈 변형을 허용한다', () => {
  const ui = loadUI();
  for (const spelling of ['토 투 바', 'TOES TO', 'toes–TO–bar', 'Ｔ２Ｂ']) {
    assert.equal(ui.guideSearchMatches(catalog[0], spelling), true);
  }
  assert.equal(ui.guideSearchMatches(catalog[0], 'press'), false);
});

test('와드 본문은 긴 동작명, 복수형, 붙여 쓴 횟수와 조사를 구분하고 입력한 표기를 유지한다', () => {
  const ui = loadUI();
  const text = 'AMRAP 10\n10T2B를 하고 Toes to Bar, push-presses · burpees. 토 투 바10회 / 프랜으로';
  const html = ui.guideInlineHTML(text);
  assert.deepEqual([...html.matchAll(/data-guide-entry="(.*?)"/g)].map(hit => hit[1]),
    ['amrap', 't2b', 't2b', 'push-press', 'burpee', 't2b', 'fran']);
  assert.equal(html.replace(/<[^>]+>/g, ''), text);
  assert.match(html, /T2B<\/button>를/);
  assert.match(html, /10<button[^>]+>T2B/);
  assert.doesNotMatch(ui.guideInlineHTML('François 프랜차이즈 burpeeless XT2B T2B2 PushPresser AMRAPper'), /<button/);
});

test('새 네임드 와드는 영문과 한글 별칭으로 같은 항목을 찾고 와드 본문에서도 연결된다', () => {
  const entries = require('../shared/guide-benchmarks').map(entry => ({ ...entry, category: 'benchmark' }));
  const ui = loadUI({ guideEntries: () => entries });
  const names = [
    ['angie', '엔지'], ['elizabeth', '엘리자벳'], ['mary', '메리'], ['kelly', '캘리'], ['eva', '에바'],
    ['amanda', '아만다'], ['chelsea', '첼시'], ['dt', 'D.T.'], ['murph', '머프 와드'],
  ];
  for (const [id, spelling] of names) {
    const entry = entries.find(item => item.id === id);
    for (const query of [spelling, entry.english]) {
      assert.ok(ui.guideSearchMatches(entry, query), query);
      assert.match(ui.guideInlineHTML(query + ' 기록'), new RegExp('data-guide-entry="' + id + '"'), query);
    }
  }
  assert.doesNotMatch(ui.guideInlineHTML('Maryland Murphy DTs'), /data-guide-entry/);
});

test('동작을 연결하더라도 코치가 입력한 HTML과 회원 메모는 실행되지 않는다', () => {
  const ui = loadUI();
  const day = { wod: { title: 'Fran', description: '<svg onload="evil()"> T2B & 버피' },
    result: { scaling: 'T2B <hi>' }, benchmarks: [], date: '2026-11-26', today: '2026-11-26' };
  const html = ui.wodMemberView(day);
  assert.match(html, /&lt;svg onload=&quot;evil\(\)&quot;&gt;/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /data-guide-entry="fran"/);
  assert.match(html, /value="T2B &lt;hi&gt;"/);
  assert.doesNotMatch(ui.wodEditor(day), /data-guide-entry=/);
  assert.match(ui.wodEditor(day), /&lt;svg/);
  assert.equal(ui.wodPreviewExcerpt('A\nB\nC'), 'A\nB…');
});

test('와드의 동작 버튼은 폼이나 해시를 바꾸지 않고 가이드에 원래 버튼을 전달한다', () => {
  const seen = [];
  const ui = loadUI({ openGuideEntry: (...args) => seen.push(args) });
  const button = { dataset: { guideEntry: 't2b' } };
  ui.wodGuideClick({ target: { closest: selector => selector === '[data-guide-entry]' ? button : null } });
  ui.wodGuideClick({ target: { closest: () => null } });
  assert.deepEqual(seen, [['t2b', button]]);
});

test('가이드에서 열린 개인 기록은 첫 페이지부터 다음 페이지까지 선택한 와드만 요청한다', async () => {
  const requests = [], rows = [];
  const list = { children: rows, insertAdjacentHTML: (where, html) => rows.push(html) };
  const status = {}, more = {};
  const panel = { isConnected: true, open: true, querySelector: selector =>
    selector === 'ul' ? list : selector === 'button' ? more : status };
  const ui = loadUI({ api: async url => {
    requests.push(url);
    return { items: [{ date: '2026-11-20', title: 'Fran', time: '8:30' }],
      nextBefore: requests.length === 1 ? '2026-11-20' : null };
  } });
  ui.bindWodHistory(panel, 'fran');
  panel.ontoggle();
  await new Promise(resolve => setImmediate(resolve));
  await more.onclick();
  assert.deepEqual(requests, ['/api/wod/history?guide=fran', '/api/wod/history?guide=fran&before=2026-11-20']);
  assert.equal(more.hidden, true);
  assert.equal(rows.length, 2);
});
