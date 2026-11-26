const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../schedule-ui'), 'utf8');

function element() {
  const children = new Map();
  return {
    dataset: {}, isConnected: true, value: '', disabled: false, hidden: false,
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    querySelectorAll() { return []; },
    addEventListener() {}, focus() {}, reset() {},
    reportValidity() { return true; },
    replaceChildren(...options) { this.value = options[0]?.value || ''; }
  };
}

function fixture(serverError) {
  const calls = [];
  let refreshes = 0;
  const ui = vm.createContext({
    Option: class { constructor(text, value) { this.value = value; } },
    api: async (route, request) => {
      calls.push({ route, body: JSON.parse(request.body) });
      if (serverError) throw serverError;
    }
  });
  vm.runInContext(source, ui);
  const host = element();
  const form = host.querySelector('form');
  form.elements = Object.fromEntries(['action','slot','reason','label','startTime','endTime','capacity','waitlistCapacity']
    .map(name => [name, element()]));
  form.elements.namedItem = name => form.elements[name];
  const date = '2027-01-10';
  const day = {
    date, today: date, dayClosed: false, canCloseDay: true, canOpenDay: false,
    scheduleRevision: 3, rosterRevision: 7,
    classes: [
      { startTime: '10:00', endTime: '11:00', started: true, cancelled: false, confirmedCount: 10, waitlistCount: 0 },
      { startTime: '13:00', endTime: '14:00', started: false, cancelled: true, confirmedCount: 0, waitlistCount: 0 },
      { startTime: '16:00', endTime: '17:00', started: false, cancelled: false, confirmedCount: 3, waitlistCount: 2 }
    ]
  };
  const page = { date, data: day, busy: false, error: '' };
  const paint = () => ui.paintCoachSchedule(host, page, () => { refreshes++; });
  paint();
  form.elements.action.value = 'closeDay';
  form.onchange();
  const review = host.querySelector('[data-schedule-review]');
  return {
    calls, day, page, paint, review, form, message: host.querySelector('[role="status"]'),
    get refreshes() { return refreshes; },
    preview: () => form.onsubmit({preventDefault() {}}),
    apply: () => review.querySelector('[data-schedule-submit]').onclick()
  };
}

test('schedule changes wait for a separate confirmation of the future affected roster', async () => {
  const f = fixture();
  f.form.elements.reason.value = '시설 점검';
  f.preview();
  assert.deepEqual(f.calls, []);
  assert.equal(f.review.hidden, false);
  assert.match(f.review.querySelector('[data-schedule-impact]').textContent, /확정 3명과 대기 2명/);
  assert.match(f.review.querySelector('[data-schedule-rebooking]').textContent, /다시 신청/);
  await f.apply();
  assert.deepEqual(f.calls, [{route:'/api/admin/schedule', body:{
    date:f.day.date, revision:3, action:'closeDay', reason:'시설 점검', rosterRevision:7,
    expectedConfirmed:3, expectedWaiting:2, expectedBookings:5
  }}]);
  assert.equal(f.refreshes, 1);
});

test('schedule, counts, or roster identity changes discard the preview without losing the draft', async () => {
  for (const update of [day => day.scheduleRevision++, day => day.rosterRevision++, day => day.classes[2].confirmedCount++]) {
    const f = fixture();
    f.form.elements.reason.value = '설 연휴';
    f.preview();
    update(f.day);
    f.paint();
    assert.equal(f.review.hidden, true);
    assert.equal(f.form.elements.reason.value, '설 연휴');
    await f.apply();
    assert.equal(f.calls.length, 0);
  }
});

test('server conflict refreshes but requires a new review and never repeats the original mutation', async () => {
  const f = fixture(Object.assign(new Error('명단이 변경되었습니다.'), {status:409}));
  f.preview();
  await f.apply();
  await f.apply();
  assert.equal(f.calls.length, 1);
  assert.equal(f.refreshes, 1);
  assert.equal(f.review.hidden, true);
  assert.match(f.message.textContent, /다시 진행/);
});
