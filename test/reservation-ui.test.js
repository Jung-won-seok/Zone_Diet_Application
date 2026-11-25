const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const reservationSource = fs.readFileSync(require.resolve('../reservations'), 'utf8');
const ui = vm.createContext({ escapeHTML: value => String(value) });
vm.runInContext(reservationSource, ui);

function slot(changes = {}) {
  return {
    startTime: '09:40', endTime: '10:30', capacity: 18, waitlistCapacity: 2,
    myStatus: null, myWaitlistPosition: null, confirmedCount: 0, waitlistCount: 0,
    notOpenYet: false, closed: false, ...changes
  };
}

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

test('one confirmed or waitlisted class blocks a second class on that date', () => {
  assert.match(ui.bookingClassRow(slot(), false, null), /data-book-action="reserve"/);
  assert.doesNotMatch(ui.bookingClassRow(slot(), false, '06:30'), /data-book-action/);
  const waiting = slot({ confirmedCount: 18, waitlistCount: 2, myStatus: 'waiting', myWaitlistPosition: 2 });
  const ownRow = ui.bookingClassRow(waiting, false, '09:40');
  assert.match(ownRow, /대기\s*2번/);
  assert.match(ownRow, /data-book-action="cancel"/);
  assert.doesNotMatch(ui.bookingClassRow({ ...waiting, closed: true }, false, '09:40'), /data-book-action/);
});

test('the last waiting place is offered only while still available', () => {
  const lastPlace = slot({ confirmedCount: 18, waitlistCount: 1 });
  assert.match(ui.bookingClassRow(lastPlace, false, null), /대기 신청/);
  const fullRow = ui.bookingClassRow({ ...lastPlace, waitlistCount: 2 }, false, null);
  assert.doesNotMatch(fullRow, /data-book-action/);
  assert.match(fullRow, /마감/);
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

test('the week view labels both weekend days as closed', () => {
  const calendar = ui.bookingCalendar({ date: '2027-01-01', today: '2026-12-31' });
  for (const day of ['2027-01-02', '2027-01-03']) {
    const weekend = calendar.match(new RegExp('<a[^>]*href="#reservations/' + day + '"[^>]*>[\\s\\S]*?</a>'));
    assert.ok(weekend);
    assert.match(weekend[0], /휴무/);
  }
  assert.match(calendar, /#reservations\/2026-12-28/);
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

test('leaving the schedule during a retry delay stops further mutations', async () => {
  const fixture = submitFixture(
    () => { throw storageConflict; },
    context => vm.runInContext('reservationPage = null', context)
  );
  await Promise.allSettled([fixture.submit()]);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.delays.length, 1);
});
