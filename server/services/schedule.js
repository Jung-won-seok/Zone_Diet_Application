const CAPACITY = 18;
const WAITLIST_CAPACITY = 2;
const WEEKDAY_CLASSES = [
  ['09:40', '10:30'], ['11:50', '12:40'], ['17:30', '18:20'], ['18:30', '19:20'],
  ['19:30', '20:20'], ['20:30', '21:30'], ['21:30', '22:20'],
];
const EARLY_CLASS = ['06:30', '07:20'];
const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const seoulCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});
const startsAt = (date, time) => Date.parse(`${date}T${time}:00+09:00`);

function scheduleDay(store, date, instant) {
  const settings = store.classSchedules?.[date] || {};
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  let regular = [];
  if (weekday !== 0 && weekday !== 6) regular = [1, 3, 5].includes(weekday) ? [EARLY_CLASS, ...WEEKDAY_CLASSES] : WEEKDAY_CLASSES;
  const classes = [
    ...regular.map(([startTime, endTime]) => ({ kind: 'regular', label: '', startTime, endTime, capacity: CAPACITY, waitlistCapacity: WAITLIST_CAPACITY })),
    ...(settings.specials || []).map(slot => ({ ...slot, kind: 'special' })),
  ].sort((a, b) => a.startTime.localeCompare(b.startTime)).map(slot => {
    const start = startsAt(date, slot.startTime);
    const individual = settings.cancelled?.[slot.startTime];
    const holiday = settings.closure && start > settings.closure.from;
    const cancelled = Boolean(individual || holiday);
    return { ...slot, started: instant >= start, cancelled, cancelReason: individual?.reason ?? (holiday ? settings.closure.reason : '') };
  });
  const dayClosed = Boolean(settings.closure);
  const editable = date >= seoulCalendar.format(instant);
  return {
    classes, dayClosed, scheduleReason: settings.closure?.reason || '',
    scheduleRevision: settings.revision || 0, rosterRevision: store.classRosterRevisions?.[date] || 0,
    canOpenDay: editable && dayClosed,
    canCloseDay: editable && !dayClosed && (!classes.length || classes.some(slot => !slot.started && !slot.cancelled)),
  };
}

function getClassCapacity(store, date, startTime) {
  return store.classSchedules?.[date]?.specials?.find(slot => slot.startTime === startTime)?.capacity ?? CAPACITY;
}

function boundedText(value, max, label, ApiError) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError(422, `${label}은(는) ${max}자 이내로 입력해주세요.`);
  }
  return value.trim();
}

function prepareScheduleChange(store, body, instant, ApiError) {
  const { date, action, revision, startTime } = body;
  const day = scheduleDay(store, date, instant);
  const actions = {
    closeDay: ['reason', 'rosterRevision', 'expectedBookings', 'expectedConfirmed', 'expectedWaiting'],
    openDay: [],
    cancelClass: ['startTime', 'reason', 'rosterRevision', 'expectedBookings', 'expectedConfirmed', 'expectedWaiting'],
    restoreClass: ['startTime'], addClass: ['startTime', 'endTime', 'capacity', 'waitlistCapacity', 'label'],
  };
  const common = ['date', 'action', 'revision'];
  if (typeof action !== 'string' || !Object.hasOwn(actions, action) || !Number.isSafeInteger(revision) || Object.keys(body).some(k => !common.includes(k) && !actions[action].includes(k))) {
    throw new ApiError(422, '시간표 변경 내용을 확인해주세요.');
  }
  if (date < seoulCalendar.format(instant)) throw new ApiError(409, '지난 날짜의 시간표는 변경할 수 없습니다.');
  if (revision !== day.scheduleRevision) throw new ApiError(409, '시간표가 변경되었습니다. 최신 현황을 확인한 뒤 다시 시도해주세요.');
  const settings = { ...store.classSchedules?.[date], revision: revision + 1 };
  let affected = [];
  const reason = boundedText(body.reason, 100, '휴관·휴강 사유', ApiError);
  if (action === 'closeDay') {
    if (!day.canCloseDay) throw new ApiError(409, '휴관으로 변경할 수 있는 수업이 없습니다.');
    affected = day.classes.filter(slot => !slot.cancelled && !slot.started);
    settings.closure = { reason, from: Number(instant) };
  } else if (action === 'openDay') {
    if (!day.canOpenDay) throw new ApiError(409, '휴관으로 설정한 날짜를 선택해주세요.');
    // Classes that passed during the holiday remain cancelled in historical rosters.
    settings.cancelled = { ...settings.cancelled };
    for (const slot of day.classes) {
      if (slot.started && slot.cancelled) settings.cancelled[slot.startTime] = { reason: slot.cancelReason };
    }
    delete settings.closure;
  } else {
    if (day.dayClosed) throw new ApiError(409, '휴관을 해제한 뒤 수업을 변경해주세요.');
    if (typeof startTime !== 'string' || !clockTime.test(startTime)) throw new ApiError(422, '수업 시작 시간을 확인해주세요.');
    if (startsAt(date, startTime) <= instant) throw new ApiError(409, '이미 시작한 수업은 변경할 수 없습니다.');
    if (action === 'addClass') {
      const { endTime, capacity = CAPACITY, waitlistCapacity = WAITLIST_CAPACITY } = body;
      if (typeof endTime !== 'string' || !clockTime.test(endTime) || endTime <= startTime) throw new ApiError(422, '종료 시간은 같은 날 시작 시간 이후여야 합니다.');
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100 || !Number.isInteger(waitlistCapacity) || waitlistCapacity < 0 || waitlistCapacity > 20) {
        throw new ApiError(422, '수업 정원은 1~100명, 대기는 0~20명으로 입력해주세요.');
      }
      if (day.classes.some(slot => startTime < slot.endTime && endTime > slot.startTime)) throw new ApiError(409, '기존 수업과 시간이 겹칩니다.');
      const label = boundedText(body.label, 40, '수업 이름', ApiError) || '특별 수업';
      settings.specials = [...(settings.specials || []), { startTime, endTime, capacity, waitlistCapacity, label }];
    } else {
      const slot = day.classes.find(item => item.startTime === startTime);
      if (!slot) throw new ApiError(422, '선택한 수업이 없습니다.');
      settings.cancelled = { ...settings.cancelled };
      if (action === 'restoreClass') {
        if (!slot.cancelled) throw new ApiError(409, '현재 휴강 중인 수업을 선택해주세요.');
        delete settings.cancelled[startTime];
      } else {
        if (slot.cancelled) throw new ApiError(409, '이미 휴강한 수업입니다.');
        settings.cancelled[startTime] = { reason };
        affected = [slot];
      }
    }
  }
  if (action === 'cancelClass' || action === 'closeDay') {
    const bookings = store.classReservations?.[date] || {};
    const total = affected.reduce((sum, slot) => sum + (bookings[slot.startTime]?.length || 0), 0);
    const confirmed = affected.reduce((sum, slot) => sum + Math.min(bookings[slot.startTime]?.length || 0, slot.capacity), 0);
    if (!Number.isInteger(body.expectedBookings) || !Number.isInteger(body.rosterRevision)) throw new ApiError(422, '현재 예약 인원을 확인한 뒤 휴강·휴관을 진행해주세요.');
    if (body.expectedBookings !== total || body.rosterRevision !== day.rosterRevision ||
        (body.expectedConfirmed !== undefined && body.expectedConfirmed !== confirmed) ||
        (body.expectedWaiting !== undefined && body.expectedWaiting !== total - confirmed)) {
      throw new ApiError(409, '예약 명단이 변경되었습니다. 최신 인원과 명단을 확인한 뒤 다시 시도해주세요.');
    }
  }
  return { settings, affected, reason };
}

module.exports = { CAPACITY, WAITLIST_CAPACITY, seoulCalendar, scheduleDay, getClassCapacity, prepareScheduleChange };
