const CAPACITY = 18;
const WAITLIST_CAPACITY = 2;
const WEEKDAY_CLASSES = [
  ['09:40', '10:30'],
  ['11:50', '12:40'],
  ['17:30', '18:20'],
  ['18:30', '19:20'],
  ['19:30', '20:20'],
  ['20:30', '21:30'],
  ['21:30', '22:20'],
];
const EARLY_CLASS = ['06:30', '07:20'];
const seoulCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

function classesOn(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return [];
  if ([1, 3, 5].includes(weekday)) return [EARLY_CLASS, ...WEEKDAY_CLASSES];
  return WEEKDAY_CLASSES;
}

function classHasStarted(date, startTime, instant) {
  return instant >= Date.parse(`${date}T${startTime}:00+09:00`);
}

function bookingOpensAt(date) {
  const previousDay = new Date(`${date}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  return previousDay.toISOString().split('T')[0] + 'T00:00:00+09:00';
}

function bookedClass(day, memberId) {
  return Object.keys(day).find(startTime => day[startTime].includes(memberId)) || null;
}

function createReservationService({ getStore, commit, ApiError, now = Date.now }) {
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
    const classes = classesOn(date).map(([startTime, endTime]) => {
      // The first 18 IDs are confirmed. Removing one promotes the first waiting ID.
      const queue = day[startTime] || [];
      const position = queue.indexOf(user.id);
      const slot = {
        startTime, endTime, capacity: CAPACITY, waitlistCapacity: WAITLIST_CAPACITY,
        confirmedCount: Math.min(queue.length, CAPACITY),
        waitlistCount: Math.max(0, queue.length - CAPACITY),
        myStatus: position < 0 ? null : position < CAPACITY ? 'confirmed' : 'waiting',
        myWaitlistPosition: position >= CAPACITY ? position - CAPACITY + 1 : null,
        notOpenYet, closed: classHasStarted(date, startTime, instant),
      };
      if (names) {
        const roster = queue.map(id => ({ id, name: names.get(id) || '탈퇴한 회원' }));
        slot.confirmed = roster.slice(0, CAPACITY);
        slot.waiting = roster.slice(CAPACITY);
      }
      return slot;
    });
    return { date, today: seoulCalendar.format(instant), opensAt, notOpenYet, myClassStartTime: bookedClass(day, user.id), classes };
  }

  async function changeBooking(user, body) {
    if (user.isAdmin) throw new ApiError(403, '회원 계정으로 수업을 예약해주세요.');
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !['reserve', 'cancel'].includes(body.action) ||
        Object.keys(body).some(key => !['date', 'startTime', 'action'].includes(key))) {
      throw new ApiError(422, '예약 또는 취소할 수업을 확인해주세요.');
    }
    const { date, startTime, action } = body;
    validateDate(date);
    if (!classesOn(date).some(([start]) => start === startTime)) {
      throw new ApiError(422, '선택한 날짜에 운영하는 수업이 아닙니다.');
    }
    const instant = now();
    if (classHasStarted(date, startTime, instant)) throw new ApiError(409, '수업 시작 후에는 예약이나 취소를 할 수 없습니다.');

    const store = getStore();
    const day = store.classReservations?.[date] || {};
    const queue = day[startTime] || [];
    const alreadyBooked = queue.includes(user.id);
    const reserving = action === 'reserve';
    if (reserving === alreadyBooked) return dayView(store, user, date, instant);
    if (reserving && instant < Date.parse(bookingOpensAt(date))) {
      throw new ApiError(409, '예약은 수업 전날 00:00부터 가능합니다.');
    }
    if (reserving && bookedClass(day, user.id)) {
      throw new ApiError(409, '하루 한 수업만 예약하거나 대기할 수 있습니다.');
    }
    if (reserving && queue.length >= CAPACITY + WAITLIST_CAPACITY) {
      throw new ApiError(409, '정원과 대기 2자리가 모두 찼습니다.');
    }
    const nextDay = { ...day };
    const nextQueue = reserving ? [...queue, user.id] : queue.filter(id => id !== user.id);
    if (nextQueue.length) nextDay[startTime] = nextQueue;
    else delete nextDay[startTime];
    const reservations = { ...store.classReservations };
    if (Object.keys(nextDay).length) reservations[date] = nextDay;
    else delete reservations[date];

    await commit({ ...store, classReservations: reservations });
    return dayView(getStore(), user, date, now());
  }

  async function handle(req, res, session, url, readJson, send) {
    if (url.pathname !== '/api/reservations') return false;
    if (!session?.user) throw new ApiError(401, '로그인이 필요합니다.');
    if (session.user.pendingApproval) throw new ApiError(403, '관리자가 등록한 회원만 수업 예약을 이용할 수 있습니다.');
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
      const changed = pendingChange.then(() => changeBooking(session.user, body));
      pendingChange = changed.catch(() => {});
      send(res, 200, await changed);
      return true;
    }
    return false;
  }

  return { handle };
}

module.exports = { createReservationService };
