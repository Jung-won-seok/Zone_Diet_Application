const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createMealService } = require('./meals-server');
const { createNaverAuth } = require('./naver-auth');
const { createNaverCafe } = require('./naver-cafe');
const { createNaverOnboarding } = require('./naver-onboarding');
const CORE_ROLES = ['diet', 'leader', 'mission', 'sns'];
const SESSION_AGE = 8 * 60 * 60 * 1000;
const STATIC = { '/mobile-nav.js': ['mobile-nav.js','text/javascript'], '/mobile-nav.css': ['mobile-nav.css','text/css'], '/naver-ui.js': ['naver-ui.js','text/javascript'], '/naver-ui.css': ['naver-ui.css','text/css'], '/meal-summary.js': ['meal-summary.js','text/javascript'], '/cafe-draft.js': ['cafe-draft.js','text/javascript'], '/cafe-draft.css': ['cafe-draft.css','text/css'], '/': ['index.html','text/html'], '/index.html': ['index.html','text/html'], '/styles.css': ['styles.css','text/css'], '/app.js': ['app.js','text/javascript'], '/admin.js': ['admin.js','text/javascript'], '/admin.css': ['admin.css','text/css'], '/meals.js': ['meals.js','text/javascript'], '/meals.css': ['meals.css','text/css'] };
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (condition, message) => { if (!condition) throw new ApiError(422, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
function makeUser(id, username, name, password, isAdmin = false) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { id, username, name, isAdmin, salt, passwordHash: hashPassword(password, salt) };
}
const blankPersonal = (name = '') => ({ settings: { name, startWeight: '', goalWeight: '' }, records: {} });
const publicUser = user => ({ id: user.id, username: user.username, name: user.name, isAdmin: user.isAdmin, ...(user.pendingApproval ? {pendingApproval:true} : {}) });
function seedStore(passwords = {}) {
  const names = ['김민준','이서연','박지훈','최수빈','정도윤','강하은','조현우','윤지우','장준서','임서윤','한시우','오지민','서예준','신채원','권도현','황민서','안건우','송수아','류정우','홍예린'];
  const users = [makeUser('admin', 'admin', '존다 관리자', passwords.admin || 'ZondaAdmin!Demo27', true)], members = [], personal = {};
  for (let i = 0; i < 20; i++) {
    const num = String(i + 1).padStart(2, '0'), id = `u${num}`;
    users.push(makeUser(id, `member${num}`, names[i], passwords[`member${num}`] || `Zonda${num}!Demo`));
    members.push({ id, teamId: `t${Math.floor(i / 4) + 1}`, role: CORE_ROLES[i % 4], customRole: '' });
    personal[id] = blankPersonal(names[i]);
  }
  return { version: 1, revision: 1, program: { id: 'zonda-1', name: '존다 1기', startDate: '2026-11-09', endDate: '2027-01-03' }, teams: ['그린','오렌지','블루','퍼플','레드'].map((name,i) => ({ id: `t${i+1}`, name: `${i+1}팀 · ${name}` })), users, members, personal, personalRevisions: {} };
}
function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;
}
function weight(value) {
  fail(typeof value === 'string' || typeof value === 'number', '체중을 올바르게 입력해주세요.');
  if (value === '') return '';
  const n = Number(value);
  fail(Number.isFinite(n) && n >= 1 && n <= 500 && Math.abs(n * 10 - Math.round(n * 10)) < 0.00001, '체중은 1~500 kg 범위에서 소수점 한 자리까지 입력해주세요.');
  return String(n);
}
function textValue(value, max, label) {
  fail(typeof value === 'string' && value.length <= max, `${label} 내용을 ${max}자 이내로 입력해주세요.`);
  return value.trim();
}
function validatePersonal(body) {
  fail(object(body) && object(body.settings) && object(body.records), '개인 기록 형식이 올바르지 않습니다.');
  const settings = { name: textValue(body.settings.name,30,'이름'), startWeight: weight(body.settings.startWeight), goalWeight: weight(body.settings.goalWeight) };
  const rows = Object.entries(body.records), records = {};
  fail(rows.length <= 400, '한 계정에 최대 400일의 기록을 저장할 수 있습니다.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const [date, r] of rows) {
    fail(isValidDate(date) && date <= today, '기록 날짜는 오늘 또는 지난 날짜여야 합니다.');
    fail(object(r) && typeof r.workout === 'boolean', '운동 기록 형식이 올바르지 않습니다.');
    records[date] = { weight: weight(r.weight), breakfast: textValue(r.breakfast,300,'아침 식단'), lunch: textValue(r.lunch,300,'점심 식단'), dinner: textValue(r.dinner,300,'저녁 식단'), workout: r.workout, workoutNote: textValue(r.workoutNote,1000,'운동 메모') };
  }
  return { settings, records };
}
function validateAssignments(body, store) {
  fail(object(body) && Number.isInteger(body.revision) && Array.isArray(body.members), '팀 배정 형식이 올바르지 않습니다.');
  if (body.revision !== store.revision) throw new ApiError(409, '다른 창에서 팀 배정이 변경되었습니다. 최신 현황을 불러온 뒤 다시 저장해주세요.');
  const ids = new Set(store.members.map(m => m.id)), seen = new Set();
  fail(body.members.length === ids.size, '모든 회원의 팀 배정을 함께 저장해주세요.');
  const teams = new Map(store.teams.map(t => [t.id, { count: 0, roles: new Set() }]));
  return body.members.map(row => {
    fail(object(row) && ids.has(row.id) && !seen.has(row.id), '중복되거나 알 수 없는 회원이 있습니다.'); seen.add(row.id);
    if (row.teamId === null) {
      fail(row.role === '' && row.customRole === '', '팀 미배정 회원의 역할은 비워주세요.');
      return { id: row.id, teamId: null, role: '', customRole: '' };
    }
    fail(teams.has(row.teamId), '존재하지 않는 팀입니다.');
    fail(CORE_ROLES.includes(row.role) || row.role === 'other', '회원의 역할을 선택해주세요.');
    const team = teams.get(row.teamId); team.count++;
    fail(team.count <= 6, '한 팀에는 최대 6명까지 배정할 수 있습니다.');
    let customRole = '';
    if (row.role === 'other') { customRole = textValue(row.customRole,40,'기타 역할'); fail(customRole.length > 0, '기타 역할의 이름을 입력해주세요.'); }
    else { fail(!team.roles.has(row.role), '같은 팀의 식단 담당, 조장, 미션운동 담당, SNS 담당은 한 명씩만 지정할 수 있습니다.'); team.roles.add(row.role); }
    return { id: row.id, teamId: row.teamId, role: row.role, customRole };
  });
}
function createServer({ dataDir = process.env.DATA_DIR || path.join(__dirname, '.data'), initialStore, persistStore, mediaStorage, cloud = false, allowedHosts = [], naverConfig, naverFetch = globalThis.fetch } = {}) {
  if (!initialStore) fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const storePath = path.join(dataDir, 'store.json');
  function persist(next) {
    if (persistStore) return persistStore(next);
    const temp = `${storePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try { fs.writeFileSync(temp, JSON.stringify(next,null,2), { mode: 0o600 }); fs.renameSync(temp,storePath); }
    catch (error) { try { fs.unlinkSync(temp); } catch {} throw error; }
  }
  let store;
  if (initialStore) { store = initialStore; }
  else if (fs.existsSync(storePath)) {
    store = JSON.parse(fs.readFileSync(storePath,'utf8'));
    if (store.version !== 1 || !Array.isArray(store.users) || !Array.isArray(store.members) || !object(store.personal)) throw new Error('저장된 데이터 형식을 확인해주세요.');
  } else { store = seedStore(); persist(store); }
  if (!object(store.personalRevisions)) store.personalRevisions = {};
  async function commit(next) {
    if (persistStore) { await persist(next); store = next; }
    else { persist(next); store = next; }
  }
  const meals = createMealService({ getStore: () => store, commit, mediaDir: path.join(dataDir, 'media'), mediaStorage, ApiError });
  const sessions = new Map(cloud ? Object.entries(store.authState?.sessions || {}) : []);
  const failures = new Map(cloud ? Object.entries(store.authState?.failures || {}) : []);
  async function persistAuth() {
    if (cloud) await commit({ ...store, authState: { sessions: Object.fromEntries(sessions), failures: Object.fromEntries(failures) } });
  }
  const naverAuth = createNaverAuth({ getStore: () => store, commit, ApiError, fetchImpl: naverFetch,
    config: naverConfig || { clientId: process.env.NAVER_CLIENT_ID, clientSecret: process.env.NAVER_CLIENT_SECRET, callbackUrl: process.env.NAVER_CALLBACK_URL, encryptionKey: process.env.NAVER_TOKEN_ENCRYPTION_KEY },
    isSessionActive: (userId, sessionHash) => [...sessions].some(([token,value]) => value.expires > Date.now() && crypto.createHash('sha256').update(token).digest('hex') === sessionHash && getSession({headers:{cookie:'zonda_session='+token}})?.user.id === userId),
    establishSession: async (userId, req, res, expectedIdentity) => {
      const identity = store.naverConnections?.[userId] || store.naverApplicants?.[userId];
      if (!identity?.connectionId || !identity.providerIdHash || !expectedIdentity || ['connectionId','providerIdHash','appHash'].some(key=>identity[key]!==expectedIdentity[key])) throw new ApiError(409, '네이버 로그인 정보를 다시 확인해주세요.');
      const token = crypto.randomBytes(32).toString('hex'), csrfToken = crypto.randomBytes(32).toString('hex');
      const old = getSession(req);
      if (old) sessions.delete(old.token);
      sessions.set(token,{userId,csrfToken,expires:Date.now()+SESSION_AGE,naverIdentity:{...expectedIdentity}});
      try { await persistAuth(); }
      catch (error) { sessions.delete(token); if(old)sessions.set(old.token,{userId:old.originUserId,csrfToken:old.csrfToken,expires:old.expires,...(old.naverIdentity?{naverIdentity:old.naverIdentity}:{})}); throw error; }
      res.setHeader('Set-Cookie',sessionCookie(token));
    },
  });
  const naverOnboarding = createNaverOnboarding({getStore:()=>store,commit,ApiError,auth:naverAuth});
  const naverCafe = createNaverCafe({ getStore: () => store, commit, ApiError, auth: naverAuth, fetchImpl: naverFetch,
    readPhoto: async (id, userId) => {
      const media = store.media?.[id];
      if (!/^[a-f0-9]{32}$/.test(id) || !media || media.memberId !== userId) throw new ApiError(403, '본인의 식단 사진만 카페에 게시할 수 있습니다.');
      const buffer = mediaStorage ? await mediaStorage.read(id) : await fs.promises.readFile(path.join(dataDir, 'media', id));
      return { buffer: Buffer.from(buffer), mime: media.mime };
    },
  });
  const dummySalt = crypto.randomBytes(16).toString('hex'), dummyHash = hashPassword(crypto.randomBytes(24).toString('hex'),dummySalt);
  const sessionCookie = (token, age = SESSION_AGE / 1000) => `zonda_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${cloud ? '; Secure' : ''}`;
  function getSession(req) {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('zonda_session='))?.slice('zonda_session='.length);
    const s = token && sessions.get(token);
    if (!s || s.expires <= Date.now()) { if (token) sessions.delete(token); return null; }
    const user = store.users.find(u => u.id === s.userId) || naverAuth.resolveApplicant(s.userId);
    if (!user) return null;
    if (s.naverIdentity) {
      const identity = user.pendingApproval ? store.naverApplicants?.[s.userId] : store.naverConnections?.[user.id];
      if (!identity || ['connectionId','providerIdHash','appHash'].some(key=>identity[key]!==s.naverIdentity[key])) return null;
    }
    return { ...s, token, originUserId:s.userId, user };
  }
  function bootstrap(s) {
    if(s.user.pendingApproval)return {user:publicUser(s.user),csrfToken:s.csrfToken,program:store.program,teams:[],members:[],personal:blankPersonal(s.user.name),personalRevision:0,photoMealCounts:{},revision:0,onboarding:naverOnboarding.state(s)};
    const own = store.members.find(m => m.id === s.user.id);
    const members = store.members.filter(m => s.user.isAdmin || m.id === s.user.id || (own?.teamId && m.teamId === own.teamId));
    return { user: publicUser(s.user), csrfToken: s.csrfToken, program: store.program, teams: store.teams, members: members.map(m => { const u = store.users.find(u => u.id === m.id); return { id: u.id, username: u.username, name: u.name, teamId: m.teamId, role: m.role, customRole: m.customRole }; }), personal: s.user.isAdmin ? blankPersonal() : store.personal[s.user.id], personalRevision: store.personalRevisions[s.user.id] || 0, photoMealCounts: meals.photoMealCounts(s.user), revision: store.revision };
  }
  function send(res,status,data,extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(data)); }
  async function readJson(req, limit = 1024 * 1024) {
    if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new ApiError(415,'JSON 형식으로 요청해주세요.');
    if (req.body !== undefined) {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(raw) > limit) throw new ApiError(413,'한 번에 저장할 수 있는 용량을 초과했습니다.');
      try { return JSON.parse(raw); } catch { throw new ApiError(400,'요청 내용을 확인해주세요.'); }
    }
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0, settled = false;
      const abort = error => { if (!settled) { settled = true; reject(error); } };
      req.on('data', chunk => {
        if (settled) return;
        size += chunk.length;
        if (size > limit) { chunks.length = 0; abort(new ApiError(413, '한 번에 저장할 수 있는 용량을 초과했습니다.')); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (settled) return;
        try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); settled = true; resolve(parsed); }
        catch { abort(new ApiError(400, '요청 내용을 확인해주세요.')); }
      });
      req.on('error', abort);
      req.on('aborted', () => abort(new ApiError(400, '요청이 중단되었습니다. 다시 시도해주세요.')));
    });
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','same-origin'); res.setHeader('X-Frame-Options','DENY');
    try {
      const host = req.headers.host || '';
      const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
      if (!(cloud ? allowedHosts.includes(host) : localHost)) throw new ApiError(403,'허용되지 않은 접속 주소입니다.');
      const origin = `${cloud ? 'https' : 'http'}://${host}`;
      const url = new URL(req.url,origin), route = url.pathname, mutation = !['GET','HEAD','OPTIONS'].includes(req.method);
      if (mutation && ((cloud && !req.headers.origin) || (req.headers.origin && req.headers.origin !== origin))) throw new ApiError(403,'같은 앱 화면에서 다시 시도해주세요.');
      if (mutation && req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403,'허용되지 않은 요청입니다.');
      for (const [token,s] of sessions) if (s.expires <= Date.now()) sessions.delete(token);
      for (const [key,a] of failures) if (a.until <= Date.now()) failures.delete(key);
      const session = getSession(req);
      if (route === '/api/naver/callback' && req.method === 'GET') { await naverAuth.callback(req, res, url, origin); return; }
      if (await naverAuth.publicHandle(req,res,url,readJson,send,origin,session)) return;
      if (route === '/api/session' && req.method === 'GET') { send(res,200,session ? { user: publicUser(session.user), csrfToken: session.csrfToken } : { user:null }); return; }
      if (route === '/api/login' && req.method === 'POST') {
        const body = await readJson(req);
        fail(object(body) && typeof body.username === 'string' && body.username.length <= 80 && typeof body.password === 'string' && body.password.length <= 200,'아이디와 비밀번호를 입력해주세요.');
        const key = cloud ? String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'remote').split(',')[0].trim() : req.socket.remoteAddress || 'local';
        if ((failures.get(key)?.count || 0) >= 20) throw new ApiError(429,'로그인 시도가 너무 많습니다. 10분 후 다시 시도해주세요.');
        const user = store.users.find(u => u.username === body.username.trim()), actual = hashPassword(body.password,user?.salt || dummySalt), expected = user?.passwordHash || dummyHash;
        if (!crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')) || !user) {
          const attempt = failures.get(key) || { count:0, until:Date.now() + 10 * 60 * 1000 }; attempt.count++; failures.set(key,attempt); await persistAuth(); throw new ApiError(401,'아이디 또는 비밀번호가 올바르지 않습니다.');
        }
        failures.delete(key); if (session) sessions.delete(session.token);
        const token = crypto.randomBytes(32).toString('hex'), csrfToken = crypto.randomBytes(32).toString('hex');
        sessions.set(token,{ userId:user.id, csrfToken, expires:Date.now() + SESSION_AGE });
        await persistAuth();
        send(res,200,{ user:publicUser(user), csrfToken },{ 'Set-Cookie':sessionCookie(token) }); return;
      }
      if (route.startsWith('/api/')) {
        if (!session) throw new ApiError(401,'로그인이 필요합니다.');
        if (mutation && req.headers['x-csrf-token'] !== session.csrfToken) throw new ApiError(403,'로그인 화면을 새로 불러온 후 다시 시도해주세요.');
        const readAuthenticatedJson = async (request, limit) => {
          const body = await readJson(request, limit);
          const latest = getSession(req);
          if (!latest || latest.token !== session.token || latest.user.id !== session.user.id || latest.user.isAdmin !== session.user.isAdmin || Boolean(latest.user.pendingApproval) !== Boolean(session.user.pendingApproval) || latest.csrfToken !== session.csrfToken) {
            throw new ApiError(401,'로그인 상태가 변경됐어요. 다시 로그인한 뒤 요청해주세요.');
          }
          return body;
        };
        if (route === '/api/logout' && req.method === 'POST') { sessions.delete(session.token); await persistAuth(); send(res,200,{ok:true},{'Set-Cookie':sessionCookie('',0)}); return; }
        if (route === '/api/bootstrap' && req.method === 'GET') { send(res,200,bootstrap(session)); return; }
        if (await naverOnboarding.handle(req,res,session,url,readAuthenticatedJson,send)) return;
        if(session.user.pendingApproval) {
          if(route==='/api/naver/status'&&req.method==='GET'){const state=naverOnboarding.state(session);send(res,200,{configuration:state.configuration,connection:state.connection});return;}
          throw new ApiError(403,'카페 연동 신청 후 관리자가 회원과 게시판을 연결하면 이용할 수 있습니다.');
        }
        if (await naverAuth.handle(req, res, session, url, readAuthenticatedJson, send, origin)) return;
        if (await naverCafe.handle(req, res, session, url, readAuthenticatedJson, send)) return;
        if (await meals.handle(req, res, session, url, readAuthenticatedJson, send)) return;
        if (route.startsWith('/api/admin/') && !session.user.isAdmin) throw new ApiError(403,'관리자만 팀과 역할을 변경할 수 있습니다.');
        if (route === '/api/admin/assignments' && req.method === 'PUT') {
          const members = validateAssignments(await readAuthenticatedJson(req),store), next = { ...store, members, revision:store.revision + 1 };
          await commit(next); send(res,200,bootstrap(session)); return;
        }
        if (route === '/api/personal' && req.method === 'PUT') {
          if (session.user.isAdmin) throw new ApiError(403,'회원 계정으로 개인 기록을 작성해주세요.');
          const body = await readAuthenticatedJson(req);
          fail(object(body) && Number.isInteger(body.personalRevision) && body.personalRevision >= 0, '개인 기록 버전을 확인해주세요. 화면을 새로 불러온 뒤 다시 시도해주세요.');
          const currentRevision = store.personalRevisions[session.user.id] || 0;
          if (body.personalRevision !== currentRevision) throw new ApiError(409, '다른 창에서 개인 기록이 변경되었습니다. 입력한 내용을 복사한 뒤 최신 기록을 불러와 다시 저장해주세요.');
          const personal = validatePersonal(body), next = { ...store, personal: { ...store.personal, [session.user.id]:personal }, personalRevisions: { ...store.personalRevisions, [session.user.id]:currentRevision + 1 } };
          await commit(next); send(res,200,bootstrap(session)); return;
        }
        throw new ApiError(404,'요청한 기능을 찾을 수 없습니다.');
      }
      const entry = STATIC[route];
      if (!entry || !['GET','HEAD'].includes(req.method)) throw new ApiError(404,'페이지를 찾을 수 없습니다.');
      const data = await fs.promises.readFile(path.join(__dirname,entry[0]));
      res.writeHead(200,{'Content-Type':`${entry[1]}; charset=utf-8`,'Cache-Control':'no-store'}); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      send(res,status,{error:error.status ? error.message : status === 404 ? '페이지를 찾을 수 없습니다.' : '저장 또는 처리 중 오류가 발생했습니다. 다시 시도해주세요.'});
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  return server;
}
if (require.main === module) { const port = Number(process.env.PORT || 3000); createServer().listen(port,'127.0.0.1',() => console.log(`Local: http://localhost:${port}`)); }
module.exports = { createServer, seedStore, ApiError };
