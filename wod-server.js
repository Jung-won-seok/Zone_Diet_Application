const { randomUUID } = require('node:crypto');

const seoulDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
});
const HISTORY_PAGE_SIZE = 10;

function createWodService({ getStore, commit, ApiError, isValidDate, now = Date.now }) {
  function requireDate(date) {
    if (!isValidDate(date)) throw new ApiError(422, '와드 날짜를 확인해주세요.');
    return date;
  }

  function field(value, max, label, required = false) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
      throw new ApiError(422, label + (required ? ' 항목은 1~' : ' 항목은 최대 ') + max + '자로 입력해주세요.');
    }
    return value.trim();
  }

  function requireRevision(submitted, current) {
    if (!Number.isSafeInteger(submitted) || submitted < 0) throw new ApiError(422, '기록 버전을 확인해주세요.');
    if (submitted !== current) throw new ApiError(409, '와드 또는 기록이 바뀌었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.');
  }

  // A benchmark keeps its ID across dates, including when a coach corrects its title.
  function benchmarks(store) {
    const latest = new Map();
    for (const date of Object.keys(store.wods || {}).sort()) {
      const { benchmarkId, title, description } = store.wods[date];
      latest.set(benchmarkId, { benchmarkId, title, description });
    }
    return [...latest.values()].sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  }

  function resultItem(store, memberRecords, date) {
    return { date, title: store.wods[date].title, ...memberRecords[date] };
  }

  function dayView(store, user, date, today) {
    const wod = store.wods?.[date] || null;
    const view = { date, today, wod, result: null, previous: null };
    if (user.isAdmin) {
      view.benchmarks = benchmarks(store);
    } else if (wod) {
      const records = store.wodResults?.[user.id] || {};
      view.result = records[date] || null;
      const previousDate = Object.keys(records).sort().reverse().find(day =>
        day < date && records[day].benchmarkId === wod.benchmarkId && store.wods?.[day]
      );
      if (previousDate) view.previous = resultItem(store, records, previousDate);
    }
    return view;
  }

  function history(store, user, before) {
    const records = store.wodResults?.[user.id] || {};
    const dates = Object.keys(records).filter(date => (!before || date < before) && store.wods?.[date]).sort().reverse();
    const items = dates.slice(0, HISTORY_PAGE_SIZE).map(date => resultItem(store, records, date));
    return { items, nextBefore: dates.length > items.length ? items.at(-1).date : null };
  }

  function publish(store, date, body) {
    const current = store.wods?.[date];
    requireRevision(body?.revision, current?.revision || 0);
    const title = field(body.title, 80, '와드 이름', true);
    const description = field(body.description, 4000, '운동 구성', true);
    const available = benchmarks(store);
    const requestedId = body.benchmarkId;
    if (typeof requestedId !== 'string' || (requestedId && !available.some(row => row.benchmarkId === requestedId))) {
      throw new ApiError(422, '목록에 있는 와드를 선택하거나 새 와드로 등록해주세요.');
    }
    // Blank means a distinct workout, even when coaches reuse a generic daily title.
    const benchmarkId = requestedId || randomUUID();
    if (current && current.benchmarkId !== benchmarkId && Object.values(store.wodResults || {}).some(records => records[date])) {
      throw new ApiError(409, '회원 기록이 있는 날짜는 다른 와드로 바꿀 수 없습니다. 기존 와드의 이름이나 구성은 수정할 수 있습니다.');
    }
    const wod = { benchmarkId, title, description, revision: (current?.revision || 0) + 1 };
    return { ...store, wods: { ...store.wods, [date]: wod } };
  }

  function saveResult(store, user, date, today, body) {
    if (date > today) throw new ApiError(422, '오늘 또는 지난 수업의 기록을 입력해주세요.');
    const wod = store.wods?.[date];
    if (!wod) throw new ApiError(404, '이 날짜에 게시된 와드가 없습니다.');
    requireRevision(body?.wodRevision, wod.revision);
    const records = store.wodResults?.[user.id] || {};
    const current = records[date];
    requireRevision(body.revision, current?.revision || 0);
    let time = field(body.time ?? '', 6, '완료 시간');
    if (time) {
      if (!/^\d{1,3}:[0-5]\d$/.test(time)) throw new ApiError(422, '완료 시간은 분:초 형식으로 입력해주세요.');
      const [minutes, seconds] = time.split(':');
      if (Number(minutes) + Number(seconds) === 0) throw new ApiError(422, '완료 시간은 0초보다 길어야 합니다.');
      time = Number(minutes) + ':' + seconds;
    }
    let weight = field(body.weight ?? '', 8, '무게');
    if (weight) {
      if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(weight) || Number(weight) <= 0) throw new ApiError(422, '무게는 양수로 소수 둘째 자리까지 입력해주세요.');
      weight = String(Number(weight));
    }
    const unit = body.unit ?? 'kg';
    if (!['kg', 'lb'].includes(unit)) throw new ApiError(422, '무게 단위를 확인해주세요.');
    const score = field(body.score ?? '', 80, '라운드·횟수');
    const scaling = field(body.scaling ?? '', 160, '스케일링');
    if (!(time || weight || score || scaling)) throw new ApiError(422, '저장할 운동 기록을 하나 이상 입력해주세요.');
    const result = { benchmarkId: wod.benchmarkId, revision: (current?.revision || 0) + 1, time, weight, unit, score, scaling };
    return { ...store, wodResults: { ...store.wodResults, [user.id]: { ...records, [date]: result } } };
  }

  async function handle(req, res, session, url, readJson, send) {
    const route = url.pathname;
    if (!['/api/wod', '/api/wod/result', '/api/wod/history'].includes(route)) return false;
    const user = session?.user;
    if (!user || user.pendingApproval) throw new ApiError(403, '박스 회원 로그인 후 이용해주세요.');
    const today = seoulDate.format(now());
    if (route === '/api/wod/history' && req.method === 'GET') {
      if (user.isAdmin) throw new ApiError(403, '회원 계정에서 내 기록을 확인해주세요.');
      const before = url.searchParams.get('before');
      if (before !== null) requireDate(before);
      send(res, 200, history(getStore(), user, before));
      return true;
    }
    const dateValue = url.searchParams.get('date');
    const date = req.method === 'GET' && dateValue === null ? today : requireDate(dateValue);
    if (route === '/api/wod' && req.method === 'GET') {
      send(res, 200, dayView(getStore(), user, date, today));
      return true;
    }
    if (req.method !== 'PUT' || route === '/api/wod/history') throw new ApiError(405, '지원하지 않는 요청입니다.');
    if (route === '/api/wod' && !user.isAdmin) throw new ApiError(403, '관리자만 수업 와드를 게시할 수 있습니다.');
    if (route === '/api/wod/result' && user.isAdmin) throw new ApiError(403, '회원 계정에서 내 기록을 입력해주세요.');
    const body = await readJson(req, 32 * 1024);
    const store = getStore();
    const next = route === '/api/wod' ? publish(store, date, body) : saveResult(store, user, date, today, body);
    await commit(next);
    send(res, 200, dayView(next, user, date, today));
    return true;
  }

  return { handle };
}

module.exports = { createWodService };
