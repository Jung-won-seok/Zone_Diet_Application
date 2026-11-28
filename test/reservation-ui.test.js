const test = require('node:test');
const assert = require('node:assert/strict');
const { readPublicAsset } = require('./support/public-assets');
const vm = require('node:vm');

const reservationSource = readPublicAsset('reservations.js');
const ui = vm.createContext({ escapeHTML: value => String(value ?? '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char])) });
vm.runInContext(reservationSource, ui);

test('the WOD preview and editor share one request only for the same session, date and freshness window', async () => {
  const calls = [];
  let clock = Date.parse('2026-11-27T03:00:00Z');
  const ctx = vm.createContext({ session:{id:'a'}, csrfToken:'first', Date:class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }, api(url) { calls.push(url); return Promise.resolve({query:url}); } });
  vm.runInContext(reservationSource, ctx);
  vm.runInContext(readPublicAsset('wod.js'), ctx);
  const first = ctx.readWodDay();
  assert.equal(ctx.readWodDay('2026-11-27'), first);
  await first;
  assert.equal(ctx.readWodDay(), first);
  assert.notEqual(ctx.readWodDay(undefined, true), first);
  ctx.csrfToken = 'second'; await ctx.readWodDay();
  ctx.session = {id:'b'}; await ctx.readWodDay();
  clock += 16000; await ctx.readWodDay();
  await ctx.readWodDay('2026-11-26');
  assert.deepEqual(calls, [...Array(5).fill('/api/wod'), '/api/wod?date=2026-11-26']);
  ctx.api = async () => { throw new Error('offline'); };
  await assert.rejects(ctx.readWodDay(undefined, true), /offline/);
  ctx.api = async () => 'retried';
  assert.equal(await ctx.readWodDay(), 'retried');
});

function slot(changes = {}) {
  return {
    startTime: '09:40', endTime: '10:30', capacity: 18, waitlistCapacity: 2,
    myStatus: null, myWaitlistPosition: null, confirmedCount: 0, waitlistCount: 0,
    notOpenYet: false, closed: false, ...changes
  };
}

test('returning members see the last schedule while actions wait for the live response', async () => {
  const requests = [];
  const host = {parentElement:{querySelector:() => ({})}};
  const ctx = vm.createContext({
    session:{id:'member'}, csrfToken:'first', AbortController, clearTimeout,
    document:{querySelector:()=>host, addEventListener(){}, removeEventListener(){}},
    window:{matchMedia:()=>({addEventListener(){}, removeEventListener(){}})},
    api(url, options) {
      return new Promise((resolve, reject) => requests.push({url, signal:options.signal, resolve, reject}));
    }
  });
  vm.runInContext(reservationSource, ctx);
  vm.runInContext('paintReservationDay = () => {}; scheduleReservationRefresh = () => {}', ctx);
  const day = vm.runInContext('bookingKoreaDate.format(new Date())', ctx);
  const data = {date:day, today:day, classes:[]};
  const current = () => vm.runInContext('reservationPage', ctx);
  const initial = ctx.mountReservations(day);
  requests[0].resolve(data); await initial;
  const returning = ctx.mountReservations(day);
  assert.equal(current().data, data);
  assert.equal(current().showingSnapshot, true);
  await ctx.changeReservation(current(), {});
  assert.equal(requests.length, 2);
  const newest = ctx.mountReservations(day);
  assert.equal(requests[1].signal.aborted, true);
  requests[1].resolve({...data, obsolete:true}); await returning;
  assert.equal(current().data, data);
  requests[2].reject(new Error('offline')); await newest;
  assert.equal(current().data, null);
  assert.equal(current().error, 'offline');
  const retry = ctx.mountReservations(day);
  assert.equal(current().data, null);
  requests[3].resolve(data); await retry;
  ctx.csrfToken = 'second';
  const relogin = ctx.mountReservations(day);
  assert.equal(current().data, null);
  requests[4].resolve(data); await relogin;
});

test('slow week changes keep the displayed day intact and only commit the last request', async () => {
  const requests = [], frames = [];
  const sessions = {setAttribute(){}}, refresh = {}, announcement = {};
  const feedback = {classList:{toggle(){}}};
  const arrows = [-1,1].map(step => ({dataset:{bookStep:String(step)}, setAttribute(name,value){this[name]=value;}}));
  const host = {
    parentElement:{querySelector:selector => selector === '.booking-rules' ? {} : announcement},
    querySelectorAll:selector => selector === '[data-book-step]' ? arrows : [],
    querySelector:selector => ({'[data-calendar-mode="week"][aria-pressed="true"]':{},'.booking-sessions':sessions,
      '[data-book-refresh]':refresh,'.booking-feedback':feedback})[selector],
    set innerHTML(html) { frames.push(html); }
  };
  const ctx = vm.createContext({
    session:{id:'member'}, csrfToken:'token', AbortController, clearTimeout, setTimeout, escapeHTML:String,
    document:{querySelector:()=>host, addEventListener(){}, removeEventListener(){}},
    window:{matchMedia:()=>({matches:false, addEventListener(){}, removeEventListener(){}})},
    api(url, options) {
      return new Promise((resolve,reject) => requests.push({url,signal:options.signal,resolve,reject}));
    }
  });
  vm.runInContext(reservationSource, ctx);
  const day = date => ({date, today:'2026-11-28', classes:[], attendedDates:[], membership:{kind:'unassigned'}});
  const first = ctx.mountReservations('2026-11-28');
  requests[0].resolve(day('2026-11-28'));
  await first;
  const count = frames.length;
  const next = ctx.mountReservations('2026-12-05', 'week', true);
  const latest = ctx.mountReservations('2026-12-12', 'week', true);
  assert.equal(frames.length, count);
  assert.match(frames.at(-1), /href="#reservations\/2026-11-28"[^>]*aria-current="date"/);
  assert.equal(arrows[1].href, '#reservations/2026-12-19');
  assert.equal(sessions.inert, true);
  assert.equal(requests[1].signal.aborted, true);
  requests[2].resolve(day('2026-12-12'));
  await latest;
  requests[1].resolve(day('2026-12-05'));
  await next;
  assert.equal(frames.length, count + 1);
  assert.match(frames.at(-1), /12월 12일 토요일<\/h2>/);
  assert.match(frames.at(-1), /href="#reservations\/2026-12-12"[^>]*aria-current="date"/);
  const failed = ctx.mountReservations('2026-12-19', 'week', true);
  requests[3].reject(new Error('연결 끊김'));
  await failed;
  assert.match(frames.at(-1), /12월 19일 토요일<\/h2>/);
  assert.equal(feedback.textContent, '연결 끊김');
  assert.doesNotMatch(frames.at(-1), /data-book-action=/);
});

test('a future class can be browsed before bookings open at Korean midnight', () => {
  const row = slot({ notOpenYet: true });
  const html = ui.bookingClassRow(row, false, null);
  assert.match(html, /09:40/);
  assert.doesNotMatch(html, /data-book-action/);
  const notice = ui.bookingAvailabilityNotice({
    date: '2026-12-07', today: '2026-12-04', opensAt: '2026-12-06T00:00:00+09:00',
    notOpenYet: true, myClassStartTime: null, classes: [row]
  });
  assert.match(notice, /12월\s*6일/);
  assert.match(notice, /00:00|자정/);
});

test('an existing booking can be moved only while both classes are open and a confirmed seat is free', () => {
  assert.match(ui.bookingClassRow(slot(), false, null), /data-book-action="reserve"/);
  const original = slot({ startTime: '06:30', myStatus: 'confirmed' });
  assert.match(ui.bookingClassRow(slot(), false, original), /data-book-action="change"/);
  assert.doesNotMatch(ui.bookingClassRow(slot({ confirmedCount: 18 }), false, original), /data-book-action/);
  assert.doesNotMatch(ui.bookingClassRow(slot(), false, { ...original, closed: true }), /data-book-action/);
  assert.doesNotMatch(ui.bookingClassRow(slot({ closed: true }), false, original), /data-book-action/);
  const waiting = slot({ confirmedCount: 18, waitlistCount: 2, myStatus: 'waiting', myWaitlistPosition: 2 });
  const ownRow = ui.bookingClassRow(waiting, false, waiting);
  assert.match(ownRow, /대기\s*2번/);
  assert.match(ownRow, /data-book-action="cancel"/);
  assert.doesNotMatch(ui.bookingClassRow({ ...waiting, closed: true }, false, waiting), /data-book-action/);
});

test('the last waiting place is offered only while still available', () => {
  const lastPlace = slot({ confirmedCount: 18, waitlistCount: 1 });
  assert.match(ui.bookingClassRow(lastPlace, false, null), /대기 신청/);
  const fullRow = ui.bookingClassRow({ ...lastPlace, waitlistCount: 2 }, false, null);
  assert.doesNotMatch(fullRow, /data-book-action/);
  assert.match(fullRow, /마감/);
});

test('retry labels distinguish an unchanged request from a newly offered waitlist or confirmed seat', () => {
  const available = slot(), full = slot({ confirmedCount: 18 });
  const retry = (current, waitlist) => ui.bookingClassRow(current, false, null, null, '2026-12-07', '',
    { request: { action: 'reserve', waitlist }, status: 'error', message: '신청에 실패했습니다.' });
  assert.match(retry(available, false), />예약 다시 시도<\/button>/);
  assert.match(retry(full, true), />대기 신청 다시 시도<\/button>/);
  assert.match(retry(full, false), />대기 신청<\/button>/);
  assert.match(retry(available, true), />예약하기<\/button>/);
});

test('member rows hide the roster and admins can see the reserve and wait lists', () => {
  const row = slot({
    confirmed: [{ id: 'u1', name: '김회원' }],
    waiting: [{ id: 'u2', name: '이회원' }],
    confirmedCount: 18, waitlistCount: 1
  });
  assert.doesNotMatch(ui.bookingClassRow(row, false, null), /김회원|이회원/);
  const adminRow = ui.bookingClassRow(row, true, null);
  assert.match(adminRow, /김회원/);
  assert.match(adminRow, /이회원/);
  assert.doesNotMatch(adminRow, /data-book-action/);
});

test('weekly is the default and only visible attendance counts, including across a year boundary', () => {
  const page = { date:'2027-01-01', today:'2027-01-01', data:{attendedDates:['2026-12-28','2026-12-31','2027-01-01','2027-01-25']} };
  const week = ui.bookingCalendar(page);
  assert.match(week, /data-calendar-mode="week" aria-pressed="true"/);
  assert.equal((week.match(/class="booking-day"/g) || []).length, 7);
  assert.match(week, /주간 출석 <strong>3일/);
  const month = ui.bookingCalendar({...page, calendarMode:'month'});
  assert.match(month, /data-calendar-mode="month" aria-pressed="true"/);
  assert.equal((month.match(/class="booking-day"/g) || []).length, 31);
  assert.match(month, /1월 출석 <strong>2일/);
  assert.match(month, /href="#reservations\/2027-01-25" aria-label="[^"]*월요일[^"]*와드 출석/);
  assert.doesNotMatch(month, /class="booking-day" href="#reservations\/2026-12/);
  assert.match(month, /href="#reservations\/2026-12-01" class="booking-arrow" aria-label="이전 달"/);
});

test('week controls advance and return to the selected weekday across New Year', () => {
  const week = date => ui.bookingCalendar({ date, today: '2026-12-25', calendarMode: 'week' });
  function destination(html, label) {
    const links = [...html.matchAll(/<a href="#reservations\/([\d-]+)" aria-label="([^"]+)"/g)];
    return links.find(link => link[2] === label)?.[1];
  }
  const date = destination(week('2026-12-25'), '다음 주');
  assert.equal(date, '2027-01-01');
  const nextWeek = week(date);
  assert.match(nextWeek, /<h2>2026년 12월\s*~\s*2027년 1월<\/h2>/);
  assert.match(week('2026-11-28'), /<h2>2026년 11월<\/h2>/);
  assert.match(week('2026-12-01'), /<h2>2026년 11월\s*~\s*12월<\/h2>/);
  assert.match(nextWeek, /class="booking-day" href="#reservations\/2027-01-01"[^>]*aria-current="date"/);
  assert.equal(destination(nextWeek, '다음 주'), '2027-01-08');
  assert.equal(destination(nextWeek, '이전 주'), '2026-12-25');
});

test('monthly navigation clamps to month end and aligns leap day under Tuesday', () => {
  assert.equal(ui.shiftBookingMonth('2028-03-31', -1), '2028-02-29');
  assert.equal(ui.shiftBookingMonth('2027-01-31', 1), '2027-02-28');
  assert.equal(ui.shiftBookingMonth('2026-12-31', 1), '2027-01-31');
  const month = ui.bookingCalendar({calendarMode:'month',date:'2028-02-29',today:'2028-02-29'});
  assert.equal((month.match(/class="booking-day"/g) || []).length, 29);
  assert.match(month, /일<\/span><span aria-hidden="true"><\/span><a class="booking-day" href="#reservations\/2028-02-01"/);
  assert.match(month, /2028-02-29" aria-label="[^"]*화요일 오늘" aria-current="date"/);
});

test('the week distinguishes a holiday closure, a weekend special and a day without exceptions', () => {
  const calendar = ui.bookingCalendar({ date: '2027-01-01', today: '2026-12-31',
    data: { weekOverrides: { '2027-01-01': 'closed', '2027-01-02': 'special' } } });
  const calendarLink = day => calendar.match(new RegExp('<a[^>]*href="#reservations/' + day + '"[^>]*>[\\s\\S]*?</a>'))[0];
  assert.match(calendarLink('2027-01-01'), /휴강/);
  assert.match(calendarLink('2027-01-02'), /특별/);
  assert.doesNotMatch(calendarLink('2027-01-03'), /휴무|휴강|특별/);
  assert.match(calendar, /#reservations\/2026-12-28/);
});

test('a visible calendar refreshes at the member’s next class end even when another day is selected', () => {
  const page = { date:'2026-11-01', data:{date:'2026-11-01', classes:[], attendanceRefreshAfterMs:500} };
  let timer, refreshed;
  const context = vm.createContext({
    page, clearTimeout(){}, setTimeout(fn, delay){timer = {fn, delay};}, document:{hidden:false},
    refresh(value){refreshed = value;}
  });
  vm.runInContext(reservationSource, context);
  vm.runInContext('reservationPage = page; loadReservationDay = refresh; scheduleReservationRefresh(page)', context);
  assert.equal(timer.delay, 600);
  timer.fn();
  assert.equal(refreshed, page);
});

test('members can read a closure reason and special capacity in place of ordinary booking actions', () => {
  const cancelled = slot({ kind: 'special', label: '팀 와드 <1>', capacity: 8, waitlistCapacity: 1,
    cancelled: true, closed: true, cancelReason: '보수 <점검>' });
  const html = ui.bookingClassRow(cancelled, false, null);
  assert.match(html, /특별 수업/);
  assert.match(html, /팀 와드 &lt;1&gt;/);
  assert.match(html, /휴강 사유 · 보수 &lt;점검&gt;/);
  assert.match(html, /\/ 8/);
  assert.doesNotMatch(html, /data-book-action/);
  assert.match(ui.bookingAvailabilityNotice({ dayClosed: true, classes: [] }), /하루 휴강/);
  assert.match(ui.bookingAvailabilityNotice({ dayClosed: true, classes: [slot({ started: true }), cancelled] }), /남은 수업 휴강/);
});

test('visit and expiry cards match actions on the chosen class date, including cancellation at zero', () => {
  const date = '2027-01-05';
  const expired = { kind: 'period', expiresOn: '2027-01-04', remainingVisits: null };
  const empty = { kind: 'visits', remainingVisits: 0, expiresOn: date };
  const mine = slot({ myStatus: 'confirmed' });
  const next = slot({ startTime: '18:30' });
  assert.match(ui.bookingMembershipCard(empty, date), /잔여 0회/);
  assert.match(ui.bookingMembershipCard(expired, date), /유효기간이 지났습니다/);
  assert.doesNotMatch(ui.bookingClassRow(next, false, null, expired, date), /data-book-action/);
  assert.doesNotMatch(ui.bookingClassRow(next, false, null, empty, date), /data-book-action/);
  assert.match(ui.bookingClassRow(mine, false, mine, expired, date), /data-book-action="cancel"/);
  assert.match(ui.bookingClassRow(next, false, mine, empty, date), /data-book-action="change"/);
  assert.doesNotMatch(ui.bookingClassRow(next, false, { ...mine, myStatus: 'waiting' }, empty, date), /data-book-action/);
  assert.match(ui.bookingClassRow(next, false, null, { ...expired, expiresOn: date }, date), /data-book-action="reserve"/);
  assert.match(ui.bookingClassRow(next, false, null, { kind: 'unassigned' }, date), /data-book-action="reserve"/);
});

const bookingRequest = { date: '2026-12-07', startTime: '09:40', action: 'reserve' };
const storageConflict = Object.assign(new Error('store updated'), { status: 409, code: 'STORE_CONFLICT' });

function submitFixture(onAttempt, onBackoff) {
  const requests = [], delays = [];
  const page = {};
  const context = vm.createContext({
    page,
    async api(url, options) {
      requests.push({ url, method: options.method, body: JSON.parse(options.body) });
      return onAttempt(requests.length);
    },
    setTimeout(resume, milliseconds) {
      delays.push(milliseconds);
      if (onBackoff) onBackoff(context);
      queueMicrotask(resume);
    }
  });
  vm.runInContext(reservationSource, context);
  vm.runInContext('reservationPage = page', context);
  return { requests, delays, submit: () => context.submitReservation(page, bookingRequest) };
}

test('a known store conflict retries the same reservation and returns the final response', async () => {
  const saved = { date: bookingRequest.date, myClassStartTime: '09:40' };
  const fixture = submitFixture(attempt => {
    if (attempt < 3) throw storageConflict;
    return saved;
  });
  assert.equal(await fixture.submit(), saved);
  assert.deepEqual(fixture.requests, Array(3).fill({ url: '/api/reservations', method: 'POST', body: bookingRequest }));
  assert.equal(fixture.delays.length, 2);
  assert.ok(fixture.delays.every(delay => delay > 0));
});

test('persistent contention stops after four submissions', async () => {
  const fixture = submitFixture(() => { throw storageConflict; });
  await assert.rejects(fixture.submit(), storageConflict);
  assert.equal(fixture.requests.length, 4);
  assert.equal(fixture.delays.length, 3);
});

test('a full class or an unconfirmed network response never submits twice', async () => {
  const fullClass = Object.assign(new Error('수업 마감'), { status: 409 });
  for (const error of [fullClass, new TypeError('fetch failed')]) {
    const fixture = submitFixture(() => { throw error; });
    await assert.rejects(fixture.submit(), error);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.delays.length, 0);
  }
});

test('a rejected time change immediately refreshes both schedules and preserves the visible original booking', async () => {
  const previous = slot({ myStatus: 'confirmed', confirmedCount: 4 });
  const target = slot({ startTime: '18:30', endTime: '19:20', confirmedCount: 17 });
  const originalDay = { date: '2026-12-07', today: '2026-12-07', myClassStartTime: previous.startTime, classes: [previous, target] };
  const latestDay = { ...originalDay, classes: [previous, { ...target, confirmedCount: 18 }] };
  const requests = [];
  const feedback = { classList: { toggle() {} } };
  const host = { querySelectorAll: () => [], querySelector: () => feedback };
  const page = { host, data: originalDay, date: originalDay.date, today: originalDay.today, busy: false };
  const context = vm.createContext({
    page, session: { isAdmin: false }, confirm: () => true, escapeHTML: String,
    clearTimeout() {}, setTimeout() {},
    async api(url, options) {
      requests.push({url, body: options && JSON.parse(options.body)});
      if (options) throw Object.assign(new Error('확정 자리가 모두 찼습니다. 기존 신청은 유지됩니다.'), {status: 409});
      return latestDay;
    },
  });
  vm.runInContext(reservationSource, context);
  vm.runInContext('reservationPage = page', context);
  await context.changeReservation(page, { dataset: { bookTime: target.startTime, bookAction: 'change' } });
  assert.deepEqual(requests, [
    {url: '/api/reservations', body: {date: page.date, startTime: target.startTime, action: 'change', fromStartTime: previous.startTime}},
    {url: '/api/reservations?date=' + page.date, body: undefined},
  ]);
  assert.equal(page.busy, false);
  assert.equal(feedback.textContent, '');
  assert.match(host.innerHTML, /data-book-slot="18:30"[^]*?booking-slot-feedback is-error[^<]*>[^<]*기존 신청은 유지/);
  assert.match(host.innerHTML, /내 수업은 09:40 \(예약 확정\)/);
  assert.match(host.innerHTML, /변경할 자리 없음/);
  assert.doesNotMatch(host.innerHTML, /data-book-action="change"/);
});

test('uncertain submissions are checked with a read before the same card can be retried', async () => {
  const startTime = '21:30';
  const last = slot({ startTime, endTime: '22:20' });
  const day = {date: '2026-12-07', today: '2026-12-07', classes: [last]};
  const feedback = { classList: { toggle() {} } };
  const host = { querySelectorAll: () => [], querySelector: () => feedback };
  const page = { host, date: day.date, today: day.today, data: day };
  const methods = [];
  const context = vm.createContext({
    page, session: { isAdmin: false }, escapeHTML: String, clearTimeout() {}, setTimeout() {},
    async api(url, request) {
      methods.push(request?.method || 'GET');
      if (methods.length < 3) throw new Error('통신 오류');
      return { ...day, myClassStartTime: startTime, classes: [{ ...last, myStatus: 'waiting', myWaitlistPosition: 2 }] };
    }
  });
  vm.runInContext(reservationSource, context);
  vm.runInContext('reservationPage = page', context);
  const trigger = { dataset: {bookTime: startTime, bookAction: 'reserve'} };
  await context.changeReservation(page, trigger);
  assert.match(host.innerHTML, /data-book-verify>현황 다시 확인/);
  assert.doesNotMatch(host.innerHTML, /data-book-action="reserve"/);
  await context.changeReservation(page, trigger);
  assert.deepEqual(methods, ['POST', 'GET']);
  await context.loadReservationDay(page);
  assert.deepEqual(methods, ['POST', 'GET', 'GET']);
  assert.match(host.innerHTML, /booking-slot-feedback is-success[^<]*>21:30 수업 대기 2번/);
  assert.doesNotMatch(host.innerHTML, /다시 시도|data-book-verify/);
});

test('the current day lists upcoming classes before expandable past classes', () => {
  const context = vm.createContext({ escapeHTML: String, session: { isAdmin: false } });
  vm.runInContext(reservationSource, context);
  const date = '2026-12-07';
  const page = { data: { today: date, date, classes: [slot({started: true, closed: true}), slot({startTime: '21:30'})] } };
  const html = context.bookingClassList(page, false);
  assert.match(html, /data-book-slot="21:30"[^]*<details class="booking-past" data-past>[^]*data-book-slot="09:40"/);
  assert.match(context.bookingClassList(page, true), /data-past open>/);
});

test('leaving the schedule during a retry delay stops further mutations', async () => {
  const fixture = submitFixture(
    () => { throw storageConflict; },
    context => vm.runInContext('reservationPage = null', context)
  );
  await Promise.allSettled([fixture.submit()]);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.delays.length, 1);
});
