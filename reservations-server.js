const { randomUUID } = require('node:crypto');

const { CAPACITY, seoulCalendar, scheduleDay, weekOverrides, getClassCapacity, prepareScheduleChange } = require('./schedule-server');
const { membershipView, membershipIssue, chargeVisit, refundVisit } = require('./memberships-server');

function bookingOpensAt(date) {
  const previousDay = new Date(`${date}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  return previousDay.toISOString().split('T')[0] + 'T00:00:00+09:00';
}

function bookedClass(day, memberId) {
  return Object.keys(day).find(startTime => day[startTime].includes(memberId)) || null;
}

function withQueues(store, date, day) {
  const reservations = { ...store.classReservations };
  if (Object.keys(day).length) reservations[date] = day;
  else delete reservations[date];
  const revisions = store.classRosterRevisions || {};
  return { ...store, classReservations: reservations, classRosterRevisions: { ...revisions, [date]: (revisions[date] || 0) + 1 } };
}

function eventFor(memberId, date, startTime, instant, fields) {
  return { id: randomUUID(), memberId, date, startTime, createdAt: new Date(instant).toISOString(), ...fields };
}

function createReservationService({ getStore, commit, ApiError, now = Date.now, recordPromotion, deliverPromotion, deliverPromotions }) {
  let pendingChange = Promise.resolve();

  function validateDate(date) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const time = Date.parse(`${date}T00:00:00Z`);
      if (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date) return;
    }
    throw new ApiError(422, '수업 날짜를 확인해주세요.');
  }

  function dayView(store, user, date, instant) {
    const day = store.classReservations?.[date] || {};
    const opensAt = bookingOpensAt(date);
    const notOpenYet = instant < Date.parse(opensAt);
    const names = user.isAdmin ? new Map(store.users.map(member => [member.id, member.name])) : null;
    const schedule = scheduleDay(store, date, instant);
    const classes = schedule.classes.map(definition => {
      const { startTime, capacity } = definition;
      const queue = day[startTime] || [];
      const position = queue.indexOf(user.id);
      const slot = {
        ...definition, confirmedCount: Math.min(queue.length, capacity),
        waitlistCount: Math.max(0, queue.length - capacity),
        myStatus: position < 0 ? null : position < capacity ? 'confirmed' : 'waiting',
        myWaitlistPosition: position >= capacity ? position - capacity + 1 : null,
        notOpenYet, closed: definition.started || definition.cancelled,
      };
      if (names) {
        const roster = queue.map(id => ({ id, name: names.get(id) || '탈퇴한 회원' }));
        slot.confirmed = roster.slice(0, capacity);
        slot.waiting = roster.slice(capacity);
      }
      return slot;
    });
    return { ...schedule, classes, date, today: seoulCalendar.format(instant), opensAt, notOpenYet,
      weekOverrides: weekOverrides(store, date, instant), myClassStartTime: bookedClass(day, user.id),
      ...(!user.isAdmin && { membership: membershipView(store, user.id) }) };
  }

  async function changeBooking(user, body) {
    if (user.isAdmin) throw new ApiError(403, '회원 계정으로 수업을 예약해주세요.');
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !['reserve', 'cancel', 'change'].includes(body.action) ||
        Object.keys(body).some(key => !['date', 'startTime', 'action'].includes(key) && !(body.action === 'change' && key === 'fromStartTime'))) {
      throw new ApiError(422, '예약할 수업과 신청 내용을 확인해주세요.');
    }
    const { date, startTime, action, fromStartTime } = body;
    validateDate(date);
    const instant = now();
    const store = getStore();
    const slots = scheduleDay(store, date, instant).classes;
    const target = slots.find(slot => slot.startTime === startTime);
    const source = action === 'change' ? slots.find(slot => slot.startTime === fromStartTime) : target;
    if (!target || !source || (action === 'change' && fromStartTime === startTime)) {
      throw new ApiError(422, '선택한 날짜에 운영하는 수업이 아닙니다.');
    }
    if (target.cancelled || source.cancelled) throw new ApiError(409, '휴강한 수업입니다. 최신 시간표를 확인해주세요.');
    const day = store.classReservations?.[date] || {};
    const queue = day[startTime] || [];
    const current = bookedClass(day, user.id);
    if (action === 'change' && current === startTime && queue.indexOf(user.id) < target.capacity) {
      return { view: dayView(store, user, date, instant) };
    }
    if (target.started || source.started) {
      throw new ApiError(409, '수업 시작 후에는 예약·변경·취소할 수 없습니다.');
    }
    if ((action === 'reserve' && current === startTime) || (action === 'cancel' && current !== startTime)) {
      return { view: dayView(store, user, date, instant) };
    }
    if (action !== 'cancel' && instant < Date.parse(bookingOpensAt(date))) {
      throw new ApiError(409, '예약은 수업 전날 00:00부터 가능합니다.');
    }
    if (action === 'reserve' && current) {
      throw new ApiError(409, '하루 한 수업만 예약하거나 대기할 수 있습니다.');
    }
    if (action === 'reserve' && queue.length >= target.capacity + target.waitlistCapacity) {
      throw new ApiError(409, '정원과 대기 자리가 모두 찼습니다.');
    }
    if (action === 'change' && current !== fromStartTime) {
      throw new ApiError(409, '기존 신청이 달라졌습니다. 현재 수업을 확인한 뒤 다시 변경해주세요.');
    }
    if (action === 'change' && queue.length >= target.capacity) {
      throw new ApiError(409, '변경하려는 수업의 확정 자리가 모두 찼습니다. 기존 신청은 유지됩니다.');
    }

    const original = day[current] || [];
    const previouslyConfirmed = current !== null && original.indexOf(user.id) < source.capacity;
    if (action !== 'cancel') {
      const issue = membershipIssue(store, user.id, date, { alreadyConfirmed: action === 'change' && previouslyConfirmed });
      if (issue) throw new ApiError(409, issue);
    }
    const nextDay = { ...day }, events = [];
    let next = store;
    if (action !== 'reserve') {
      const remaining = original.filter(id => id !== user.id);
      if (previouslyConfirmed) {
        if (action === 'cancel') next = refundVisit(next, user.id, date);
        // One seat is open. Remove now-ineligible waiters before selecting the FIFO successor.
        while (remaining.length >= source.capacity) {
          const waitingId = remaining[source.capacity - 1];
          const reason = membershipIssue(next, waitingId, date);
          if (!reason) {
            next = chargeVisit(next, waitingId, date);
            events.push(eventFor(waitingId, date, current, instant));
            break;
          }
          remaining.splice(source.capacity - 1, 1);
          events.push(eventFor(waitingId, date, current, instant, { type: 'waitlist_removed', reason, previousStatus: 'waiting' }));
        }
      }
      if (remaining.length) nextDay[current] = remaining;
      else delete nextDay[current];
    }
    if (action !== 'cancel') {
      if (!previouslyConfirmed && queue.length < target.capacity) next = chargeVisit(next, user.id, date);
      nextDay[startTime] = [...queue, user.id];
    }
    return saveBooking(withQueues(next, date, nextDay), events, date, user);
  }

  async function changeSchedule(user, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(422, '시간표 변경 내용을 확인해주세요.');
    const { date } = body;
    validateDate(date);
    const instant = now(), store = getStore();
    const { settings, affected, reason } = prepareScheduleChange(store, body, instant, ApiError);
    const events = [], nextDay = { ...store.classReservations?.[date] };
    let next = { ...store, classSchedules: { ...store.classSchedules, [date]: settings } };
    for (const slot of affected) {
      const queue = nextDay[slot.startTime] || [];
      for (const [index, memberId] of queue.entries()) {
        const previousStatus = index < slot.capacity ? 'confirmed' : 'waiting';
        if (previousStatus === 'confirmed') next = refundVisit(next, memberId, date);
        events.push(eventFor(memberId, date, slot.startTime, instant, { type: 'class_cancelled', reason, previousStatus, dayClosed: body.action === 'closeDay' }));
      }
      delete nextDay[slot.startTime];
    }
    return saveBooking(events.length ? withQueues(next, date, nextDay) : next, events, date, user);
  }

  async function saveBooking(next, events, date, user) {
    if (recordPromotion) for (const event of events) next = recordPromotion(next, event);
    await commit(next);
    return { view: dayView(getStore(), user, date, now()), events };
  }

  async function handle(req, res, session, url, readJson, send) {
    const adminSchedule = url.pathname === '/api/admin/schedule';
    if (url.pathname !== '/api/reservations' && !adminSchedule) return false;
    if (!session?.user) throw new ApiError(401, '로그인이 필요합니다.');
    if (session.user.pendingApproval) throw new ApiError(403, '관리자가 등록한 회원만 수업 예약을 이용할 수 있습니다.');
    if (adminSchedule && !session.user.isAdmin) throw new ApiError(403, '관리자만 시간표를 변경할 수 있습니다.');
    if (req.method === 'GET') {
      const instant = now();
      const date = url.searchParams.get('date') ?? seoulCalendar.format(instant);
      validateDate(date);
      send(res, 200, dayView(getStore(), session.user, date, instant));
      return true;
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      // Evaluate limits against the previous completed write on long-lived servers.
      // Independent cloud instances additionally use the store's conditional commit.
      const changed = pendingChange.then(() => adminSchedule ? changeSchedule(session.user, body) : changeBooking(session.user, body));
      pendingChange = changed.catch(() => {});
      const { view, events } = await changed;
      if (events?.length) {
        try {
          if (deliverPromotions) await deliverPromotions(events);
          else if (deliverPromotion) await Promise.all(events.map(event => deliverPromotion(event)));
        } catch { console.warn('Booking notification push delivery failed.'); }
      }
      send(res, 200, view);
      return true;
    }
    return false;
  }

  return { handle };
}

module.exports = { createReservationService, CAPACITY, getClassCapacity };
