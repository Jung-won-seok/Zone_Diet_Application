let reservationPage = null;
let recentReservationDay = null;

const bookingWeekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'UTC' });
const bookingDayLabel = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' });
const bookingWeekRange = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
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
      <details class="booking-rules"><summary>예약 안내</summary>
        <p>수업 전날 <strong>00:00</strong>에 예약이 열려요. <small>한국 시간 기준</small></p>
        <p>대기 포함 하루 한 수업을 신청할 수 있어요.<br>취소 자리는 대기 순서대로 확정돼요.</p></details>
    </header>
    <div id="box-schedule"></div>
    <div class="booking-utilities"><div id="booking-notifications"></div><div id="coach-schedule"></div></div>
    <p class="sr-only" data-book-announcement role="status" aria-live="polite"></p></div>`;
}

function cleanupReservations() {
  if (!reservationPage) return;
  reservationPage.readController?.abort();
  const mode = reservationPage.calendarMode;
  clearTimeout(reservationPage.refreshTimer);
  document.removeEventListener('visibilitychange', reservationPage.onVisible);
  reservationPage.rulesLayout.removeEventListener('change', reservationPage.onRulesLayout);
  reservationPage = null;
  return mode;
}

function shiftBookingMonth(date, delta) {
  const end = new Date(date.slice(0, 7) + '-01T12:00:00Z');
  end.setUTCMonth(end.getUTCMonth() + delta + 1, 0);
  end.setUTCDate(Math.min(Number(date.slice(-2)), end.getUTCDate()));
  return end.toISOString().slice(0, 10);
}

function bookingCalendar(page) {
  const selected = new Date(page.date + 'T12:00:00Z');
  const monthly = page.calendarMode === 'month';
  const period = monthly ? '달' : '주';
  const first = monthly ? page.date.slice(0, 7) + '-01' : shiftBookingDate(page.date, -((selected.getUTCDay() + 6) % 7));
  const monthEnd = new Date(first + 'T12:00:00Z');
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  const length = monthly ? monthEnd.getUTCDate() : 7;
  const attended = new Set(page.data?.attendedDates);
  let attendanceCount = 0;
  const days = Array.from({ length }, (_, offset) => {
    const date = shiftBookingDate(first, offset);
    const day = new Date(date + 'T12:00:00Z');
    const current = date === page.date;
    const today = date === page.today;
    const override = page.data?.calendarOverrides?.[date] ?? page.data?.weekOverrides?.[date];
    const scheduleLabel = override === 'closed' ? '휴강' : override === 'special' ? '특별' : '';
    const dayLabels = [today ? '오늘' : '', scheduleLabel].filter(Boolean).join('·');
    const marked = attended.has(date);
    if (marked) attendanceCount++;
    const label = [bookingDayLabel.format(day), dayLabels, marked ? '와드 출석' : ''].filter(Boolean).join(' ');
    return `<a class="booking-day" href="#reservations/${date}" aria-label="${label}" ${current ? 'aria-current="date"' : ''}>
      ${monthly ? '' : `<span>${bookingWeekday.format(day)}</span>`}<strong>${day.getUTCDate()}</strong>
      <small>${marked ? '<i class="booking-attendance-dot" aria-hidden="true"></i>' : ''}${dayLabels}</small></a>`;
  }).join('');
  const weekdays = monthly ? ['월','화','수','목','금','토','일'].map(label => `<span class="booking-weekday" aria-hidden="true">${label}</span>`).join('') : '';
  const blanks = monthly ? (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7 : 0;
  const step = delta => monthly ? shiftBookingMonth(page.date, delta) : shiftBookingDate(page.date, delta * 7);
  const periodLabel = monthly ? `${selected.getUTCFullYear()}년 ${selected.getUTCMonth() + 1}월`
    : bookingWeekRange.formatRange(new Date(first + 'T12:00:00Z'), new Date(shiftBookingDate(first, 6) + 'T12:00:00Z'));
  return `<section class="booking-calendar" aria-label="예약 날짜 선택" data-no-swipe>
    <div class="booking-calendar-toolbar"><div class="booking-calendar-modes" role="group" aria-label="달력 보기">
      <button type="button" data-calendar-mode="week" aria-pressed="${!monthly}">주간</button>
      <button type="button" data-calendar-mode="month" aria-pressed="${monthly}">월간</button></div>
      ${page.data?.attendedDates ? `<span class="booking-attendance-total" aria-live="polite">${monthly ? (selected.getUTCMonth() + 1) + '월' : '주간'} 출석 <strong>${attendanceCount}일</strong></span>` : ''}</div>
    <div class="booking-calendar-head"><div class="booking-week-controls${monthly ? '' : ' booking-week-pager'}">
      <a href="#reservations/${step(-1)}" class="booking-arrow" aria-label="이전 ${period}">${monthly ? '‹' : '‹ 이전 주'}</a>
      <span>${periodLabel}</span>
      <a href="#reservations/${step(1)}" class="booking-arrow" aria-label="다음 ${period}">${monthly ? '›' : '다음 주 ›'}</a></div>
      <div class="booking-date-tools"><a href="#reservations/${page.today}" class="booking-today">오늘</a>
      <label><span class="sr-only">날짜 직접 선택</span><input type="date" id="booking-date" value="${page.date}" required></label></div></div>
    <div class="booking-week${monthly ? ' booking-month' : ''}">${weekdays}${'<span aria-hidden="true"></span>'.repeat(blanks)}${days}</div>
    ${page.data?.attendedDates ? '<p class="booking-attendance-key"><i class="booking-attendance-dot" aria-hidden="true"></i>출석 · 확정 예약한 수업이 끝나면 표시돼요.</p>' : ''}</section>`;
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
  const restriction = expired ? `${escapeHTML(date)} 기준으로 회원권 유효기간이 지났습니다.`
    : exhausted ? '남은 횟수가 없어 새 수업을 신청할 수 없습니다.' : '';
  return `<section class="booking-membership" aria-label="내 회원권"><h2>내 회원권</h2>
    <p>${description}</p>${restriction ? '<p class="booking-membership-limit">' + restriction + '</p>' : ''}</section>`;
}

function bookingClassRow(slot, isAdmin, booked, membership, date, dayReason, feedback) {
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
    if (feedback?.status === 'error' && feedback.request.action === operation &&
        (operation !== 'change' || feedback.request.fromStartTime === booked.startTime)) {
      if (operation === 'reserve') {
        if (available) label = feedback.request.waitlist ? '예약하기' : '예약 다시 시도';
        else label = feedback.request.waitlist ? '대기 신청 다시 시도' : '대기 신청';
      }
      else label = operation === 'change' ? '변경 다시 시도' : '취소 다시 시도';
    }
    action = `<button type="button" class="button booking-action ${mine ? 'secondary' : ''}"
      data-book-time="${escapeHTML(slot.startTime)}" data-book-action="${operation}"
      aria-label="${escapeHTML(slot.startTime)} 수업 ${label}">${label}</button>`;
  }
  if (feedback?.status === 'unknown') {
    action = `<button type="button" class="button booking-action secondary" data-book-verify>현황 다시 확인</button>`;
  }
  const result = feedback ? `<p class="booking-slot-feedback is-${feedback.status}">${escapeHTML(feedback.message)}</p>` : '';
  const special = slot.kind === 'special'
    ? `<p class="booking-special"><strong>특별 수업</strong>${slot.label && slot.label !== '특별 수업' ? ' · ' + escapeHTML(slot.label) : ''}</p>` : '';
  const reason = slot.cancelled && slot.cancelReason && slot.cancelReason !== dayReason
    ? `<p class="booking-cancel-reason">휴강 사유 · ${escapeHTML(slot.cancelReason)}</p>` : '';
  return `<li class="booking-row${mine ? ' is-mine' : ''}${slot.closed ? ' is-closed' : ''}${slot.cancelled ? ' is-cancelled' : ''}" data-book-slot="${escapeHTML(slot.startTime)}" tabindex="-1">
    ${special}
    <div class="booking-row-main">
      <div class="booking-time"><strong>${escapeHTML(slot.startTime)}</strong><span>– ${escapeHTML(slot.endTime)}</span></div>
      <div class="booking-occupancy"><span>예약 <b>${slot.confirmedCount}</b> / ${slot.capacity}</span><span>대기 <b>${slot.waitlistCount}</b> / ${slot.waitlistCapacity}</span>
        <meter class="booking-capacity" aria-hidden="true" min="0" max="${escapeHTML(slot.capacity)}" value="${escapeHTML(slot.confirmedCount)}"></meter></div>
      <div class="booking-state"><span>${status}</span></div>
      ${action}</div>${reason}${result}${isAdmin && !slot.cancelled ? bookingRoster(slot) : ''}</li>`;
}

function bookingClassList(page, pastOpen) {
  const data = page.data;
  const booked = data.classes.find(slot => slot.startTime === data.myClassStartTime);
  const list = slots => `<ul class="booking-list">${slots.map(slot => bookingClassRow(slot, session.isAdmin, booked,
    data.membership, data.date, data.scheduleReason, slot.startTime === page.slotFeedback?.request.startTime ? page.slotFeedback : null)).join('')}</ul>`;
  const past = data.date === data.today ? data.classes.filter(slot => slot.started) : [];
  if (!past.length || past.length === data.classes.length) return list(data.classes);
  const showingResult = past.some(slot => slot.startTime === page.slotFeedback?.request.startTime);
  return list(data.classes.filter(slot => !slot.started)) +
    `<details class="booking-past" data-past${pastOpen || showingResult ? ' open' : ''}>
      <summary>지난 수업 ${past.length}개</summary>${list(past)}</details>`;
}

function paintReservationDay(page) {
  if (reservationPage !== page) return;
  const host = page.host;
  const openRosters = new Set([...host.querySelectorAll('details[data-roster][open]')].map(node => node.dataset.roster));
  const focused = host.ownerDocument?.activeElement;
  const focusedRow = focused?.closest('[data-book-slot]');
  const activeTime = page.slotFeedback?.request.startTime;
  const activeRow = activeTime && host.querySelector(`[data-book-slot="${activeTime}"]`);
  const anchor = activeRow?.getBoundingClientRect?.();
  const label = bookingDayLabel.format(new Date(page.date + 'T12:00:00Z'));
  let schedule;
  if (page.data) {
    schedule = bookingAvailabilityNotice(page.data);
    if (page.data.classes.length) {
      schedule += bookingClassList(page, Boolean(host.querySelector('details[data-past][open]')));
    } else if (!page.data.dayClosed) {
      schedule += '<p class="booking-empty">이 날짜에는 등록된 수업이 없습니다.</p>';
    }
  } else {
    schedule = page.error ? '' : '<p class="booking-empty" role="status">수업을 불러오는 중입니다.</p>';
  }
  const membership = session.isAdmin ? '' : bookingMembershipCard(page.data?.membership, page.date);
  host.innerHTML = bookingCalendar(page) +
    `<section class="booking-sessions" aria-label="선택한 날짜의 수업"><div class="booking-list-head"><h2>${label}</h2>
      <button type="button" class="booking-refresh" data-book-refresh>${page.showingSnapshot ? '현황 확인 중…' : '새로고침'}</button></div>
      <p class="booking-feedback" role="status" aria-live="polite"></p>${schedule}</section>` + membership;
  host.querySelectorAll('details[data-roster]').forEach(node => { node.open = openRosters.has(node.dataset.roster); });
  const feedback = host.querySelector('.booking-feedback');
  const orphaned = activeTime && !page.data?.classes.some(slot => slot.startTime === activeTime);
  feedback.textContent = page.error || (orphaned ? page.slotFeedback.message : '');
  feedback.classList.toggle('is-error', Boolean(feedback.textContent));
  feedback.hidden = !feedback.textContent;
  host.querySelectorAll('button').forEach(button => {
    if (!button.hasAttribute('data-calendar-mode') && (page.busy || (page.slotFeedback?.status === 'unknown' && button.hasAttribute('data-book-action')))) {
      button.setAttribute('aria-disabled', 'true');
    }
  });
  if (focusedRow) {
    const row = host.querySelector(`[data-book-slot="${focusedRow.dataset.bookSlot}"]`);
    const selector = focused.dataset.bookAction ? `[data-book-action="${focused.dataset.bookAction}"]` :
      focused.matches('summary') ? 'summary' : '[data-book-verify]';
    (row?.querySelector(selector) || row)?.focus({ preventScroll: true });
  } else if (focused && host.ownerDocument && !focused.isConnected) {
    const selector = focused.dataset.calendarMode ? `[data-calendar-mode="${focused.dataset.calendarMode}"]` :
      focused.id === 'booking-date' ? '#booking-date' : focused.matches('[data-book-refresh]') ? '[data-book-refresh]' :
      focused.matches('a[href]') ? `a[href="${focused.getAttribute('href')}"]` : focused.matches('.booking-past summary') ? '.booking-past summary' : null;
    if (selector) host.querySelector(selector)?.focus({ preventScroll: true });
  }
  if (anchor && anchor.bottom > 0 && anchor.top < window.innerHeight) {
    const row = host.querySelector(`[data-book-slot="${activeTime}"]`);
    const result = row?.querySelector('.booking-slot-feedback');
    const nav = window.matchMedia('(max-width: 580px)').matches && document.querySelector('.sidebar');
    const bottom = (nav ? nav.getBoundingClientRect().top : window.innerHeight) - 8;
    if (result && anchor.top < bottom) {
      const layoutShift = row.getBoundingClientRect().top - anchor.top;
      const revealResult = result.getBoundingClientRect().bottom - bottom;
      window.scrollBy({top: Math.max(layoutShift, revealResult), behavior: 'instant'});
    }
  }
  const announcement = host.parentElement?.querySelector('[data-book-announcement]');
  const message = page.slotFeedback?.message || '';
  if (announcement && announcement.textContent !== message) announcement.textContent = message;
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
  if (data.attendanceRefreshAfterMs > 0) boundaries.push(now + data.attendanceRefreshAfterMs);
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
  if (page.slotFeedback?.status === 'unknown') page.slotFeedback.message = '최신 예약 현황을 확인하고 있습니다.';
  paintReservationDay(page);
  try {
    const data = await api('/api/reservations' + (page.useServerDate ? '' : '?date=' + encodeURIComponent(page.date)), {signal: page.readController?.signal});
    if (reservationPage !== page) return;
    page.data = data;
    if (!session.isAdmin) recentReservationDay = { data, receivedAt: Date.now(), user: page.user, token: page.token };
    page.date = data.date;
    page.today = data.today;
    page.slotFeedback = page.slotFeedback?.status === 'unknown' && page.slotFeedback.request.date === data.date
      ? reconcileBooking(page.slotFeedback.request, data, page.slotFeedback.errorMessage) : null;
  } catch (error) {
    if (reservationPage !== page) return;
    recentReservationDay = null;
    if (page.showingSnapshot) page.data = null;
    if (page.slotFeedback?.status === 'unknown') page.slotFeedback.message = '최신 예약 현황을 확인하지 못했습니다. 다시 확인해 주세요.';
    else page.error = error.message || '수업을 불러오지 못했습니다. 새로고침해주세요.';
  } finally {
    page.busy = false;
    page.showingSnapshot = false;
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

function reconcileBooking(request, data, errorMessage = '') {
  const slot = data.classes.find(item => item.startTime === request.startTime);
  const waiting = slot?.myStatus === 'waiting';
  const confirmed = slot?.myStatus === 'confirmed';
  const applied = request.action === 'cancel' ? !waiting && !confirmed : request.action === 'change' ? confirmed : waiting || confirmed;
  if (!applied) return { request, status: 'error', message: errorMessage || '신청 상태가 변경되었습니다. 최신 현황을 확인해 주세요.' };
  let message;
  if (request.action === 'cancel') message = errorMessage ? `${request.startTime} 수업의 신청 내역이 없습니다.` : `${request.startTime} 수업 신청을 취소했습니다.`;
  else if (waiting) message = `${request.startTime} 수업 대기 ${slot.myWaitlistPosition}번입니다.`;
  else if (request.action === 'change') message = `${request.fromStartTime}에서 ${request.startTime} 수업으로 변경되었습니다.`;
  else message = `${request.startTime} 수업 예약이 확정되었습니다.`;
  return { request, status: 'success', message };
}

async function changeReservation(page, button) {
  if (page.busy || page.slotFeedback?.status === 'unknown' || !page.data || reservationPage !== page) return;
  const startTime = button.dataset.bookTime;
  const action = button.dataset.bookAction;
  const body = { date: page.data.date, startTime, action };
  if (action === 'change') {
    body.fromStartTime = page.data.myClassStartTime;
    if (!confirm(`${bookingDayLabel.format(new Date(page.date + 'T12:00:00Z'))} 수업을 ${body.fromStartTime}에서 ${startTime}으로 변경할까요?`)) return;
  }
  if (action === 'cancel' && !confirm(`${bookingDayLabel.format(new Date(page.date + 'T12:00:00Z'))} ${startTime} 수업 신청을 취소할까요?`)) return;
  recentReservationDay = null;
  page.busy = true;
  page.error = '';
  const original = page.data.classes.find(slot => slot.startTime === startTime);
  const request = { ...body, waitlist: action === 'reserve' && original && original.confirmedCount >= original.capacity };
  const pending = action === 'cancel' ? '취소 중…' : action === 'change' ? '시간 변경 중…' : request.waitlist ? '대기 신청 중…' : '예약 중…';
  page.slotFeedback = { request, status: 'pending', message: `${startTime} 수업 ${pending}` };
  paintReservationDay(page);
  try {
    const data = await submitReservation(page, body);
    page.data = data;
    page.today = data.today;
    page.slotFeedback = reconcileBooking(request, data);
  } catch (error) {
    const errorMessage = error.code === 'STORE_CONFLICT'
      ? '요청이 몰려 예약 변경을 저장하지 못했습니다. 현황을 확인한 뒤 다시 시도해주세요.'
      : error.message || '신청이 반영되지 않았습니다.';
    page.slotFeedback = { request, status: 'unknown', errorMessage,
      message: '예약 결과를 확인하지 못했습니다. 최신 현황을 확인해 주세요.' };
    if (reservationPage === page && error.status !== 401) {
      try {
        page.data = await api('/api/reservations?date=' + encodeURIComponent(page.date));
        page.today = page.data.today;
        page.slotFeedback = reconcileBooking(request, page.data, errorMessage);
      } catch {
        // Retain the original card so the member can safely check the result with a read.
      }
    }
  } finally {
    page.busy = false;
    paintReservationDay(page);
    scheduleReservationRefresh(page);
  }
}

function mountReservations(date, calendarMode = 'week') {
  cleanupReservations();
  const host = document.querySelector('#box-schedule');
  if (!host) return;
  const today = bookingKoreaDate.format(new Date());
  const hasDate = validBookingDate(date);
  const page = { host, calendarMode, date: hasDate ? date : today, today, useServerDate: !hasDate, data: null, busy: false, error: '', slotFeedback: null };
  page.user = session.id;
  page.token = csrfToken;
  page.readController = new AbortController();
  const previous = recentReservationDay;
  if (!session.isAdmin && previous && previous.user === page.user && previous.token === page.token &&
      previous.data.date === page.date && previous.data.today === today && Date.now() - previous.receivedAt < 30000) {
    page.data = previous.data;
    page.showingSnapshot = true;
  }
  const rules = host.parentElement.querySelector('.booking-rules');
  page.rulesLayout = window.matchMedia('(min-width: 851px)');
  page.onRulesLayout = () => { rules.open = page.rulesLayout.matches; };
  page.onRulesLayout();
  page.rulesLayout.addEventListener('change', page.onRulesLayout);
  if (session.isAdmin) page.coachHost = document.querySelector('#coach-schedule');
  reservationPage = page;
  host.onchange = event => {
    if (event.target.id === 'booking-date' && validBookingDate(event.target.value)) location.hash = 'reservations/' + event.target.value;
  };
  host.onclick = event => {
    const mode = event.target.closest('[data-calendar-mode]')?.dataset.calendarMode;
    if (mode) {
      if (mode !== page.calendarMode) { page.calendarMode = mode; paintReservationDay(page); }
      return;
    }
    const action = event.target.closest('[data-book-action]');
    if (action) return changeReservation(page, action);
    if (event.target.closest('[data-book-refresh], [data-book-verify]')) return loadReservationDay(page);
  };
  page.onVisible = () => { if (!document.hidden) loadReservationDay(page); };
  document.addEventListener('visibilitychange', page.onVisible);
  return loadReservationDay(page);
}
