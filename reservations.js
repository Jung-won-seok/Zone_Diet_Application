let reservationPage = null;

const bookingWeekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'UTC' });
const bookingDayLabel = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' });
const bookingKoreaDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' });
const bookingOpeningLabel = new Intl.DateTimeFormat('ko-KR', {
  month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul'
});

function validBookingDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(value + 'T12:00:00Z');
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

function shiftBookingDate(date, days) {
  const day = new Date(date + 'T12:00:00Z');
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function reservationsView() {
  return `<div class="booking-dashboard"><header class="box-schedule-heading">
      <h1>수업 예약</h1>
      <p>수업 전날 <strong>00:00</strong>에 예약이 열려요. <small>한국 시간 기준</small></p>
      <p>대기 포함 하루 한 수업을 신청할 수 있어요.<br>취소 자리는 대기 순서대로 확정돼요.</p>
    </header>
    <div class="booking-utilities"><div id="booking-notifications"></div><div id="coach-schedule"></div></div>
    <div id="box-schedule"></div></div>`;
}

function cleanupReservations() {
  if (!reservationPage) return;
  clearTimeout(reservationPage.refreshTimer);
  document.removeEventListener('visibilitychange', reservationPage.onVisible);
  reservationPage = null;
}

function bookingCalendar(page) {
  const selected = new Date(page.date + 'T12:00:00Z');
  const monday = shiftBookingDate(page.date, -((selected.getUTCDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, offset) => {
    const date = shiftBookingDate(monday, offset);
    const day = new Date(date + 'T12:00:00Z');
    const current = date === page.date;
    const today = date === page.today;
    const override = page.data?.weekOverrides?.[date];
    const scheduleLabel = override === 'closed' ? '휴강' : override === 'special' ? '특별' : '';
    const dayLabels = [today ? '오늘' : '', scheduleLabel].filter(Boolean).join('·');
    const label = bookingDayLabel.format(day) + (dayLabels ? ' ' + dayLabels : '');
    return `<a class="booking-day" href="#reservations/${date}" aria-label="${label}" ${current ? 'aria-current="date"' : ''}>
      <span>${bookingWeekday.format(day)}</span><strong>${day.getUTCDate()}</strong><small>${dayLabels}</small></a>`;
  }).join('');
  return `<section class="booking-calendar" aria-label="예약 날짜 선택" data-no-swipe>
    <div class="booking-calendar-head"><div class="booking-week-controls">
      <a href="#reservations/${shiftBookingDate(page.date, -7)}" class="booking-arrow" aria-label="이전 주">‹</a>
      <span>${selected.getUTCFullYear()}년 ${selected.getUTCMonth() + 1}월</span>
      <a href="#reservations/${shiftBookingDate(page.date, 7)}" class="booking-arrow" aria-label="다음 주">›</a></div>
      <div class="booking-date-tools"><a href="#reservations/${page.today}" class="booking-today">오늘</a>
      <label><span class="sr-only">날짜 직접 선택</span><input type="date" id="booking-date" value="${page.date}" required></label></div></div>
    <div class="booking-week">${week}</div></section>`;
}

function bookingRoster(slot) {
  const names = (group, empty) => group.length
    ? '<ol>' + group.map(member => `<li>${escapeHTML(member.name)}</li>`).join('') + '</ol>'
    : `<p>${empty}</p>`;
  return `<details class="booking-roster" data-roster="${escapeHTML(slot.startTime)}">
    <summary aria-label="${escapeHTML(slot.startTime)} 수업 명단 보기">명단 보기</summary><div class="booking-roster-lists">
    <div><h3>예약 확정 ${slot.confirmedCount}명</h3>${names(slot.confirmed, '예약자가 없습니다.')}</div>
    <div><h3>대기 순번 ${slot.waitlistCount}명</h3>${names(slot.waiting, '대기자가 없습니다.')}</div></div></details>`;
}

function bookingAvailabilityNotice(data) {
  if (data?.dayClosed) {
    const label = data.classes?.some(slot => slot.started && !slot.cancelled) ? '남은 수업 휴강' : '하루 휴강';
    return `<p class="booking-day-notice is-cancelled"><strong>${label}</strong>${data.scheduleReason ? ' · ' + escapeHTML(data.scheduleReason) : ''}</p>`;
  }
  if (!data?.classes.length) return '';
  let text = '';
  if (data.notOpenYet) {
    text = bookingOpeningLabel.format(new Date(data.opensAt)) + ' (한국 시간)에 예약이 열립니다.';
  } else if (data.myClassStartTime) {
    const booked = data.classes.find(slot => slot.startTime === data.myClassStartTime);
    if (booked) {
      const status = booked.myStatus === 'waiting' ? `대기 ${booked.myWaitlistPosition}번` : '예약 확정';
      const { expired, exhausted } = bookingMembershipStatus(data.membership, data.date);
      let next = '확정 자리가 있는 다른 수업으로 시간을 변경할 수 있습니다.';
      if (expired || (exhausted && booked.myStatus === 'waiting')) next = '수업 시작 전까지 신청을 취소할 수 있습니다.';
      if (booked.closed) next = '수업이 시작되어 변경할 수 없습니다.';
      text = `이날 내 수업은 ${booked.startTime} (${status})입니다. ${next}`;
    }
  }
  return text ? `<p class="booking-day-notice">${escapeHTML(text)}</p>` : '';
}

function bookingMembershipStatus(membership, date) {
  if (!membership || membership.kind === 'unassigned') return { expired: false, exhausted: false };
  return {
    expired: Boolean(membership.expiresOn && membership.expiresOn < date),
    exhausted: membership.kind === 'visits' && membership.remainingVisits === 0
  };
}

function bookingMembershipCard(membership, date) {
  if (!membership) return '';
  const { expired, exhausted } = bookingMembershipStatus(membership, date);
  let description = '등록된 회원권이 없습니다. 수업 예약은 가능합니다.';
  if (membership.kind === 'period') description = '기간권';
  if (membership.kind === 'visits') description = `횟수권 · 잔여 ${escapeHTML(membership.remainingVisits)}회`;
  if (membership.expiresOn) description += ` · ${escapeHTML(membership.expiresOn)}까지`;
  const restriction = expired ? '선택한 수업일은 회원권 유효기간이 지났습니다.'
    : exhausted ? '남은 횟수가 없어 새 수업을 신청할 수 없습니다.' : '';
  return `<section class="booking-membership" aria-label="내 회원권"><h2>내 회원권</h2>
    <p>${description}</p>${restriction ? '<p class="booking-membership-limit">' + restriction + '</p>' : ''}</section>`;
}

function bookingClassRow(slot, isAdmin, booked, membership, date, dayReason) {
  const waiting = slot.myStatus === 'waiting';
  const mine = waiting || slot.myStatus === 'confirmed';
  const available = slot.confirmedCount < slot.capacity;
  const full = !available && slot.waitlistCount >= slot.waitlistCapacity;
  const otherClass = Boolean(booked && booked.startTime !== slot.startTime);
  const { expired, exhausted } = bookingMembershipStatus(membership, date);
  const membershipBlocked = !isAdmin && (expired || (exhausted && booked?.myStatus !== 'confirmed'));
  let status = available ? '예약 가능' : full ? '정원·대기 마감' : '대기 가능';
  if (otherClass && !available) status = '변경할 자리 없음';
  if (slot.notOpenYet) status = '예약 오픈 전';
  if (slot.closed) status = '접수 종료';
  if (mine) {
    status = waiting ? `내 대기 ${slot.myWaitlistPosition}번` : '내 예약 확정';
    if (slot.closed) status += ' · 접수 종료';
  }
  if (!mine && !slot.closed && !slot.notOpenYet && membershipBlocked) status = expired ? '회원권 만료' : '잔여 횟수 없음';
  if (slot.cancelled) status = '휴강';
  let action = '';
  const canChange = otherClass && !booked.closed && available;
  if (!isAdmin && !slot.cancelled && !slot.notOpenYet && !slot.closed && (mine || (!membershipBlocked && (canChange || (!full && !otherClass))))) {
    let operation = 'reserve';
    let label = available ? '예약하기' : '대기 신청';
    if (mine) {
      operation = 'cancel';
      label = waiting ? '대기 취소' : '예약 취소';
    } else if (canChange) {
      operation = 'change';
      label = '이 시간으로 변경';
    }
    action = `<button type="button" class="button booking-action ${mine ? 'secondary' : ''}"
      data-book-time="${escapeHTML(slot.startTime)}" data-book-action="${operation}"
      aria-label="${escapeHTML(slot.startTime)} 수업 ${label}">${label}</button>`;
  }
  const special = slot.kind === 'special'
    ? `<p class="booking-special"><strong>특별 수업</strong>${slot.label && slot.label !== '특별 수업' ? ' · ' + escapeHTML(slot.label) : ''}</p>` : '';
  const reason = slot.cancelled && slot.cancelReason && slot.cancelReason !== dayReason
    ? `<p class="booking-cancel-reason">휴강 사유 · ${escapeHTML(slot.cancelReason)}</p>` : '';
  return `<li class="booking-row${mine ? ' is-mine' : ''}${slot.closed ? ' is-closed' : ''}${slot.cancelled ? ' is-cancelled' : ''}">
    ${special}
    <div class="booking-row-main">
      <div class="booking-time"><strong>${escapeHTML(slot.startTime)}</strong><span>– ${escapeHTML(slot.endTime)}</span></div>
      <div class="booking-occupancy"><span>예약 <b>${slot.confirmedCount}</b> / ${slot.capacity}</span><span>대기 <b>${slot.waitlistCount}</b> / ${slot.waitlistCapacity}</span>
        <meter class="booking-capacity" aria-hidden="true" min="0" max="${escapeHTML(slot.capacity)}" value="${escapeHTML(slot.confirmedCount)}"></meter></div>
      <div class="booking-state"><span>${status}</span></div>
      ${action}</div>${reason}${isAdmin && !slot.cancelled ? bookingRoster(slot) : ''}</li>`;
}

function paintReservationDay(page) {
  if (reservationPage !== page) return;
  const host = page.host;
  const openRosters = new Set([...host.querySelectorAll('details[open]')].map(node => node.dataset.roster));
  const label = bookingDayLabel.format(new Date(page.date + 'T12:00:00Z'));
  let schedule;
  if (page.data) {
    const booked = page.data.classes.find(slot => slot.startTime === page.data.myClassStartTime);
    schedule = bookingAvailabilityNotice(page.data);
    if (page.data.classes.length) {
      schedule += `<ul class="booking-list">${page.data.classes.map(slot =>
        bookingClassRow(slot, session.isAdmin, booked, page.data.membership, page.date, page.data.scheduleReason)
      ).join('')}</ul>`;
    } else if (!page.data.dayClosed) {
      schedule += '<p class="booking-empty">이 날짜에는 등록된 수업이 없습니다.</p>';
    }
  } else {
    schedule = page.error ? '' : '<p class="booking-empty" role="status">수업을 불러오는 중입니다.</p>';
  }
  const membership = session.isAdmin ? '' : bookingMembershipCard(page.data?.membership, page.date);
  host.innerHTML = `<div class="booking-planner">${bookingCalendar(page)}${membership}</div>` +
    `<section class="booking-sessions" aria-label="선택한 날짜의 수업"><div class="booking-list-head"><h2>${label}</h2>
      <button type="button" class="booking-refresh" data-book-refresh>새로고침</button></div>
      <p class="booking-feedback" role="status" aria-live="polite"></p>${schedule}</section>`;
  host.querySelectorAll('details[data-roster]').forEach(node => { node.open = openRosters.has(node.dataset.roster); });
  const feedback = host.querySelector('.booking-feedback');
  feedback.textContent = page.error || page.message;
  feedback.classList.toggle('is-error', Boolean(page.error));
  feedback.hidden = !feedback.textContent;
  host.querySelectorAll('button').forEach(button => { button.disabled = page.busy; });
  if (page.coachHost) paintCoachSchedule(page.coachHost, page, () => loadReservationDay(page));
}

function scheduleReservationRefresh(page) {
  clearTimeout(page.refreshTimer);
  if (reservationPage !== page || !page.data) return;
  const data = page.data;
  const boundaries = [];
  if (data.notOpenYet && data.classes.length) boundaries.push(Date.parse(data.opensAt));
  if (page.useServerDate) boundaries.push(Date.parse(shiftBookingDate(data.today, 1) + 'T00:00:00+09:00'));
  for (const slot of data.classes) {
    if (!slot.closed) boundaries.push(Date.parse(data.date + 'T' + slot.startTime + ':00+09:00'));
  }
  const now = Date.now();
  const next = Math.min(...boundaries.filter(instant => instant > now));
  if (Number.isFinite(next)) {
    page.refreshTimer = setTimeout(() => {
      if (!document.hidden) loadReservationDay(page);
    }, Math.min(next - now + 100, 2_147_483_647));
  }
}

async function loadReservationDay(page) {
  if (page.busy || reservationPage !== page) return;
  page.busy = true;
  page.error = '';
  page.message = '';
  paintReservationDay(page);
  try {
    const data = await api('/api/reservations' + (page.useServerDate ? '' : '?date=' + encodeURIComponent(page.date)));
    page.data = data;
    page.date = data.date;
    page.today = data.today;
  } catch (error) {
    page.error = error.message || '수업을 불러오지 못했습니다. 새로고침해주세요.';
  } finally {
    page.busy = false;
    paintReservationDay(page);
    scheduleReservationRefresh(page);
  }
}

async function submitReservation(page, body) {
  const request = { method: 'POST', body: JSON.stringify(body) };
  for (let attempt = 1; ; attempt++) {
    try {
      return await api('/api/reservations', request);
    } catch (error) {
      // This code is returned only when the store rejected the write before saving it.
      if (error.code !== 'STORE_CONFLICT' || attempt >= 4 || reservationPage !== page) throw error;
      const backoff = 150 * 2 ** (attempt - 1);
      await new Promise(resolve => setTimeout(resolve, backoff * (1 + Math.random())));
      if (reservationPage !== page) throw error;
    }
  }
}

async function changeReservation(page, button) {
  if (page.busy || !page.data || reservationPage !== page) return;
  const startTime = button.dataset.bookTime;
  const action = button.dataset.bookAction;
  const body = { date: page.data.date, startTime, action };
  if (action === 'change') {
    body.fromStartTime = page.data.myClassStartTime;
    if (!confirm(`${bookingDayLabel.format(new Date(page.date + 'T12:00:00Z'))} 수업을 ${body.fromStartTime}에서 ${startTime}으로 변경할까요?`)) return;
  }
  if (action === 'cancel' && !confirm(`${bookingDayLabel.format(new Date(page.date + 'T12:00:00Z'))} ${startTime} 수업 신청을 취소할까요?`)) return;
  page.busy = true;
  page.error = '';
  page.message = '예약 정보를 저장하는 중입니다.';
  paintReservationDay(page);
  try {
    const data = await submitReservation(page, body);
    page.data = data;
    page.today = data.today;
    const changed = data.classes.find(slot => slot.startTime === startTime);
    if (action === 'cancel') page.message = `${startTime} 수업 신청을 취소했습니다.`;
    else if (action === 'change') page.message = `${body.fromStartTime}에서 ${startTime} 수업으로 변경했습니다. 예약이 확정되었습니다.`;
    else if (changed?.myStatus === 'waiting') page.message = `${startTime} 수업 대기 ${changed.myWaitlistPosition}번입니다.`;
    else page.message = `${startTime} 수업 예약이 확정되었습니다.`;
  } catch (error) {
    page.message = '';
    page.error = error.code === 'STORE_CONFLICT'
      ? '요청이 몰려 예약 변경을 저장하지 못했습니다. 현황을 확인한 뒤 다시 시도해주세요.'
      : error.message || '요청 결과를 확인할 수 없습니다. 새로고침해주세요.';
    if (reservationPage === page && error.status !== 401) {
      try {
        page.data = await api('/api/reservations?date=' + encodeURIComponent(page.date));
        page.today = page.data.today;
      } catch {
        page.data = null;
        page.error += ' 최신 현황을 보려면 새로고침해주세요.';
      }
    }
  } finally {
    page.busy = false;
    paintReservationDay(page);
    scheduleReservationRefresh(page);
  }
}

function mountReservations(date) {
  cleanupReservations();
  const host = document.querySelector('#box-schedule');
  if (!host) return;
  const today = bookingKoreaDate.format(new Date());
  const hasDate = validBookingDate(date);
  const page = { host, date: hasDate ? date : today, today, useServerDate: !hasDate, data: null, busy: false, error: '', message: '' };
  if (session.isAdmin) page.coachHost = document.querySelector('#coach-schedule');
  reservationPage = page;
  host.onchange = event => {
    if (event.target.id === 'booking-date' && validBookingDate(event.target.value)) location.hash = 'reservations/' + event.target.value;
  };
  host.onclick = event => {
    const action = event.target.closest('[data-book-action]');
    if (action) return changeReservation(page, action);
    if (event.target.closest('[data-book-refresh]')) return loadReservationDay(page);
  };
  page.onVisible = () => { if (!document.hidden) loadReservationDay(page); };
  document.addEventListener('visibilitychange', page.onVisible);
  return loadReservationDay(page);
}
