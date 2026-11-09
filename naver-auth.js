const crypto = require('node:crypto');
const TOKEN_URL = 'https://nid.naver.com/oauth2.0/token';
const PROFILE_URL = 'https://openapi.naver.com/v1/nid/me';
const REVOKE_URL = 'https://nid.naver.com/oauth2.0/revoke';
const COOKIE = 'zonda_naver_oauth';
const LOGIN_COOKIE = 'zonda_naver_login_oauth';
const CALLBACK_PATH = '/api/naver/callback';
const STATE_AGE = 10 * 60 * 1000;
const MAX_OAUTH_STATES = 200;
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function createNaverAuth({ getStore, commit, ApiError, config = {}, fetchImpl = fetch, isSessionActive = () => false, establishSession }) {
  const fields = {clientId:'NAVER_CLIENT_ID',clientSecret:'NAVER_CLIENT_SECRET',callbackUrl:'NAVER_CALLBACK_URL',encryptionKey:'NAVER_TOKEN_ENCRYPTION_KEY'};
  let key = null, callbackURL = null;
  try {
    const raw = String(config.encryptionKey || '').trim();
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/,'') === raw.replace(/=+$/,'')) key = decoded;
  } catch {}
  try {
    const url = new URL(config.callbackUrl);
    const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if ((url.protocol === 'https:' || (url.protocol === 'http:' && local)) && url.pathname === CALLBACK_PATH && !url.search && !url.hash && !url.username && !url.password) callbackURL = url;
  } catch {}
  function configuration() {
    const missing = Object.entries(fields).filter(([field]) => field === 'encryptionKey' ? !key : field === 'callbackUrl' ? !callbackURL : typeof config[field] !== 'string' || !config[field].trim()).map(([,name]) => name);
    return {ready:missing.length === 0,missing,callbackUrl:callbackURL?.href || ''};
  }
  function requireConfigured(origin) {
    if (!configuration().ready) throw new ApiError(503, '네이버 연결 설정이 아직 준비되지 않았습니다. 관리자에게 문의해주세요.');
    if (origin && callbackURL.origin !== origin) throw new ApiError(403, '네이버 연결은 등록된 앱 주소에서 시작해주세요.');
  }
  const applicationHash = () => hash(config.clientId || '');
  function publicConnection(userId) {
    const record = getStore().naverConnections?.[userId];
    const connected = Boolean(record?.connectionId && record.appHash === applicationHash() && record.encryptedTokens);
    return {connected,displayName:connected ? record.displayName : '',connectedAt:connected ? record.connectedAt : null,connectionId:connected ? record.connectionId : null,needsReconnect:Boolean(record && (!connected || record.needsReconnect))};
  }
  function publicApplicant(applicantId) {
    const record = getStore().naverApplicants?.[applicantId];
    if (record?.memberId) return resolveApplicant(applicantId) ? publicConnection(record.memberId) : {connected:false,displayName:'',connectedAt:null,connectionId:null,needsReconnect:true};
    const connected = Boolean(record?.connectionId && record.appHash === applicationHash() && record.encryptedTokens);
    return {connected,displayName:connected ? record.displayName : '',connectedAt:connected ? record.connectedAt : null,connectionId:connected ? record.connectionId : null,needsReconnect:Boolean(record && (!connected || record.needsReconnect))};
  }
  function resolveApplicant(applicantId) {
    const store=getStore(), applicant=store.naverApplicants?.[applicantId];
    if (!applicant || applicant.id!==applicantId || applicant.appHash!==applicationHash()) return null;
    if (applicant.memberId) {
      const connection=store.naverConnections?.[applicant.memberId];
      if (!connection?.encryptedTokens || connection.appHash!==applicant.appHash || connection.providerIdHash!==applicant.providerIdHash || connection.connectionId!==applicant.connectionId) return null;
      const user=store.users.find(u=>u.id===applicant.memberId && !u.isAdmin);
      return user || null;
    }
    if (!applicant.connectionId || !applicant.encryptedTokens) return null;
    return {id:applicantId,username:'',name:applicant.displayName,isAdmin:false,pendingApproval:true};
  }
  function encrypt(userId, tokens) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm',key,iv);
    cipher.setAAD(Buffer.from('naver:'+userId));
    const data = Buffer.concat([cipher.update(JSON.stringify(tokens),'utf8'),cipher.final()]);
    return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');
  }
  function decrypt(userId, ciphertext) {
    const [version,iv,tag,data,...extra] = String(ciphertext || '').split('.');
    if (version !== 'v1' || extra.length || !iv || !tag || !data) throw new Error('invalid encrypted token');
    const decipher = crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));
    decipher.setAAD(Buffer.from('naver:'+userId));decipher.setAuthTag(Buffer.from(tag,'base64url'));
    const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8'));
    if (!validToken(parsed.accessToken) || !validToken(parsed.refreshToken)) throw new Error('invalid token data');
    return parsed;
  }
  const validToken = token => typeof token === 'string' && token.length > 0 && token.length <= 16384;
  const expiresAt = value => Date.now() + (Number.isInteger(Number(value)) && Number(value)>0 ? Math.min(Number(value),30*86400) : 300)*1000;
  function cookie(value, origin, maxAge = STATE_AGE/1000, login=false) {
    return `${login?LOGIN_COOKIE:COOKIE}=${value}; Path=${login?'/api/naver/':CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.startsWith('https:')?'; Secure':''}`;
  }
  function nonceFrom(req, login=false) {
    const name=login?LOGIN_COOKIE:COOKIE;
    return (req.headers?.cookie || '').split(';').map(p=>p.trim()).find(p=>p.startsWith(name+'='))?.slice(name.length+1) || '';
  }
  function approvalConnection(applicantId,memberId,expectedConnectionId) {
    requireConfigured();
    const store=getStore(), applicant=store.naverApplicants?.[applicantId];
    const member=store.users.find(u=>u.id===memberId && !u.isAdmin);
    if (!member || !store.members?.some(m=>m.id===memberId) || !applicant || applicant.memberId || applicant.appHash!==applicationHash() || applicant.connectionId!==expectedConnectionId || !applicant.encryptedTokens || applicant.needsReconnect) throw new ApiError(409,'연결 요청이나 회원 정보가 변경됐어요. 다시 확인해주세요.');
    if (store.naverConnections?.[memberId] || Object.values(store.naverConnections || {}).some(c=>c.appHash===applicationHash() && c.providerIdHash===applicant.providerIdHash)) throw new ApiError(409,'이미 연결된 회원이나 네이버 계정입니다. 현재 연결을 먼저 확인해주세요.');
    requireNoPublication(memberId);
    let tokens; try { tokens=decrypt(applicantId,applicant.encryptedTokens); } catch { throw new ApiError(409,'회원이 네이버에 다시 로그인해야 합니다.'); }
    return {connectionId:applicant.connectionId,providerIdHash:applicant.providerIdHash,appHash:applicant.appHash,displayName:applicant.displayName,connectedAt:applicant.connectedAt,needsReconnect:false,encryptedTokens:encrypt(memberId,tokens),expiresAt:applicant.expiresAt};
  }
  async function jsonRequest(url, options) {
    let response;
    try { response = await fetchImpl(url, {...options,redirect:'error',signal:AbortSignal.timeout(12000)}); }
    catch { throw new ApiError(502,'네이버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    let data; try { data = await response.json(); } catch { throw new ApiError(502,'네이버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    if (!response.ok || !object(data) || data.error) {
      const error = new ApiError(502,'네이버 인증을 완료하지 못했습니다. 네이버 계정을 다시 연결해주세요.');
      error.reconnect = response.status === 401 || ['invalid_grant','invalid_request','unauthorized_client','invalid_token'].includes(data?.error);
      throw error;
    }
    return data;
  }
  function tokenRequest(parameters) {
    return jsonRequest(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,...parameters}).toString()});
  }
  function requireNoPublication(userId) {
    if (Object.values(getStore().naverPublications || {}).some(p => p.memberId === userId && p.status === 'pending')) throw new ApiError(409,'카페에 글을 게시하고 있어요. 게시 결과를 확인한 뒤 네이버 연결을 변경해주세요.');
  }
  async function markReconnect(userId, connectionId, expectedTokens) {
    const current = getStore(), record = current.naverConnections?.[userId];
    if (!record || record.connectionId !== connectionId || (expectedTokens && record.encryptedTokens !== expectedTokens)) return;
    await commit({...current,naverConnections:{...current.naverConnections,[userId]:{...record,needsReconnect:true}}});
  }
  async function accessToken(userId) {
    requireConfigured();
    const record = getStore().naverConnections?.[userId];
    if (!record || !publicConnection(userId).connected || record.needsReconnect) throw new ApiError(409,'본인의 네이버 계정을 연결하거나 다시 인증해주세요.');
    let tokens;
    try { tokens=decrypt(userId,record.encryptedTokens); }
    catch { await markReconnect(userId,record.connectionId,record.encryptedTokens);throw new ApiError(409,'네이버 계정을 다시 연결해주세요.'); }
    if (record.expiresAt > Date.now()+60000) return tokens.accessToken;
    let refreshed;
    try { refreshed=await tokenRequest({grant_type:'refresh_token',refresh_token:tokens.refreshToken}); }
    catch (error) { if(error.reconnect)await markReconnect(userId,record.connectionId,record.encryptedTokens);throw error; }
    if (!validToken(refreshed.access_token) || (refreshed.token_type && (typeof refreshed.token_type !== 'string' || refreshed.token_type.toLowerCase() !== 'bearer'))) throw new ApiError(502,'네이버 인증 응답을 확인하지 못했습니다. 다시 연결해주세요.');
    const current=getStore(), latest=current.naverConnections?.[userId];
    if (!latest || latest.connectionId !== record.connectionId) throw new ApiError(409,'네이버 연결이 변경되었습니다. 다시 확인해주세요.');
    // If another local request refreshed first, do not overwrite its token pair.
    if (latest.encryptedTokens !== record.encryptedTokens) return accessToken(userId);
    const nextTokens={accessToken:refreshed.access_token,refreshToken:validToken(refreshed.refresh_token)?refreshed.refresh_token:tokens.refreshToken};
    await commit({...current,naverConnections:{...current.naverConnections,[userId]:{...latest,encryptedTokens:encrypt(userId,nextTokens),expiresAt:expiresAt(refreshed.expires_in),needsReconnect:false}}});
    return nextTokens.accessToken;
  }
  async function start(session, origin, res) {
    requireConfigured(origin);
    if (session.user.isAdmin) throw new ApiError(403,'네이버 계정은 회원 본인이 연결해주세요.');
    requireNoPublication(session.user.id);
    const current=getStore(), state=crypto.randomBytes(32).toString('hex'), nonce=crypto.randomBytes(32).toString('hex');
    const revision=(current.naverLinkRevisions?.[session.user.id] || 0)+1;
    const pending=Object.fromEntries(Object.entries(current.naverOAuthStates || {}).filter(([,s])=>s.expiresAt>Date.now() && s.userId !== session.user.id));
    if (Object.keys(pending).length>=MAX_OAUTH_STATES) throw new ApiError(429,'네이버 로그인 요청이 많습니다. 잠시 후 다시 시도해주세요.');
    pending[hash(state)]={userId:session.user.id,sessionHash:hash(session.token),nonceHash:hash(nonce),origin,expiresAt:Date.now()+STATE_AGE,revision};
    await commit({...current,naverOAuthStates:pending,naverLinkRevisions:{...current.naverLinkRevisions,[session.user.id]:revision}});
    res.setHeader('Set-Cookie',cookie(nonce,origin));
    const url=new URL('https://nid.naver.com/oauth2.0/authorize');
    url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:callbackURL.href,state}).toString();
    return {authorizeUrl:url.href};
  }
  async function startLogin(req,res,origin) {
    requireConfigured(origin);
    if (typeof establishSession!=='function') throw new ApiError(503,'네이버 로그인 설정을 확인해주세요.');
    const oldNonce=nonceFrom(req,true), current=getStore(), state=crypto.randomBytes(32).toString('hex'), nonce='login_'+crypto.randomBytes(32).toString('hex');
    const pending=Object.fromEntries(Object.entries(current.naverOAuthStates || {}).filter(([,s])=>s.expiresAt>Date.now() && !(s.mode==='login' && oldNonce && s.nonceHash===hash(oldNonce))));
    if (Object.keys(pending).length>=MAX_OAUTH_STATES) throw new ApiError(429,'네이버 로그인 요청이 많습니다. 잠시 후 다시 시도해주세요.');
    pending[hash(state)]={mode:'login',nonceHash:hash(nonce),origin,expiresAt:Date.now()+STATE_AGE};
    await commit({...current,naverOAuthStates:pending});
    res.setHeader('Set-Cookie',cookie(nonce,origin,STATE_AGE/1000,true));
    const url=new URL('https://nid.naver.com/oauth2.0/authorize');
    url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:callbackURL.href,state}).toString();
    return {authorizeUrl:url.href};
  }
  async function signInIdentity(profile,token) {
    const current=getStore(), providerIdHash=crypto.createHmac('sha256',key).update('naver:'+profile.id).digest('hex');
    const appHash=applicationHash(), displayName=String(profile.nickname || profile.name || '네이버 회원').slice(0,80);
    const linked=Object.entries(current.naverConnections || {}).filter(([,c])=>c.providerIdHash===providerIdHash && c.appHash===appHash);
    if (linked.length>1) throw new ApiError(409,'네이버 계정 연결 정보를 관리자에게 확인해주세요.');
    const tokens={accessToken:token.access_token,refreshToken:token.refresh_token};
    if (linked.length) {
      const [memberId,record]=linked[0], member=current.users.find(u=>u.id===memberId && !u.isAdmin);
      if (!member || !current.members?.some(m=>m.id===memberId)) throw new ApiError(409,'연결된 회원 정보를 확인해주세요.');
      requireNoPublication(memberId);
      const identity={connectionId:record.connectionId,providerIdHash,appHash};
      await commit({...current,naverConnections:{...current.naverConnections,[memberId]:{...record,displayName,needsReconnect:false,encryptedTokens:encrypt(memberId,tokens),expiresAt:expiresAt(token.expires_in)}}});
      return {userId:memberId,identity};
    }
    const applicants=Object.values(current.naverApplicants || {}).filter(a=>!a.memberId && a.providerIdHash===providerIdHash && a.appHash===appHash);
    if (applicants.length>1) throw new ApiError(409,'네이버 로그인 요청 정보를 관리자에게 확인해주세요.');
    const existing=applicants[0], id=existing?.id || 'na_'+crypto.randomUUID();
    const applicant={...existing,id,providerIdHash,appHash,displayName,connectionId:existing?.connectionId || crypto.randomUUID(),connectedAt:existing?.connectedAt || new Date().toISOString(),needsReconnect:false,encryptedTokens:encrypt(id,tokens),expiresAt:expiresAt(token.expires_in),memberId:null};
    const identity={connectionId:applicant.connectionId,providerIdHash,appHash};
    await commit({...current,naverApplicants:{...current.naverApplicants,[id]:applicant}});
    return {userId:id,identity};
  }
  async function callback(req,res,url,origin) {
    let success=false, loginMode=Boolean(nonceFrom(req,true));
    try {
      requireConfigured(origin);
      const state=url.searchParams.get('state') || '', code=url.searchParams.get('code') || '';
      const current=getStore(), stateKey=hash(state), pending=current.naverOAuthStates?.[stateKey];
      if (pending) loginMode=pending.mode==='login';
      const nonce=nonceFrom(req,loginMode), validNonce=loginMode?/^login_[a-f0-9]{64}$/.test(nonce):/^[a-f0-9]{64}$/.test(nonce);
      if (!/^[a-f0-9]{64}$/.test(state) || !validNonce || !pending || pending.expiresAt<=Date.now() || pending.origin!==origin || pending.nonceHash!==hash(nonce) || (!loginMode && !isSessionActive(pending.userId,pending.sessionHash))) throw new ApiError(403,'네이버 연결 요청이 만료되었거나 일치하지 않습니다.');
      if (!loginMode && (current.naverLinkRevisions?.[pending.userId] || 0)!==pending.revision) throw new ApiError(409,'네이버 연결 요청이 변경되었습니다.');
      const remaining={...current.naverOAuthStates};delete remaining[stateKey];
      await commit({...current,naverOAuthStates:remaining});
      if (url.searchParams.has('error') || !code || code.length>4096) throw new ApiError(403,'네이버 연결을 완료하지 못했습니다.');
      const token=await tokenRequest({grant_type:'authorization_code',code,state});
      if (!validToken(token.access_token) || !validToken(token.refresh_token) || (token.token_type && (typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer'))) throw new ApiError(502,'네이버 인증 응답을 확인하지 못했습니다.');
      const profile=await jsonRequest(PROFILE_URL,{headers:{Authorization:'Bearer '+token.access_token}});
      if (profile.resultcode!=='00' || !object(profile.response) || typeof profile.response.id!=='string' || !profile.response.id || profile.response.id.length>512) throw new ApiError(502,'네이버 회원을 확인하지 못했습니다.');
      if (loginMode) {
        if (typeof establishSession!=='function') throw new ApiError(503,'네이버 로그인 설정을 확인해주세요.');
        const signedIn=await signInIdentity(profile.response,token);
        await establishSession(signedIn.userId,req,res,signedIn.identity);
      } else {
        requireNoPublication(pending.userId);
        const latest=getStore();
        if ((latest.naverLinkRevisions?.[pending.userId] || 0)!==pending.revision || !isSessionActive(pending.userId,pending.sessionHash)) throw new ApiError(409,'네이버 연결 요청이 변경되었습니다.');
        const providerIdHash=crypto.createHmac('sha256',key).update('naver:'+profile.response.id).digest('hex');
        if (Object.entries(latest.naverConnections || {}).some(([id,c])=>id!==pending.userId && c.providerIdHash===providerIdHash && c.appHash===applicationHash())) throw new ApiError(409,'이미 다른 회원에게 연결된 네이버 계정입니다.');
        const displayName=String(profile.response.nickname || profile.response.name || '네이버 회원').slice(0,80);
        const record={connectionId:crypto.randomUUID(),providerIdHash,appHash:applicationHash(),displayName,connectedAt:new Date().toISOString(),needsReconnect:false,encryptedTokens:encrypt(pending.userId,{accessToken:token.access_token,refreshToken:token.refresh_token}),expiresAt:expiresAt(token.expires_in)};
        await commit({...latest,naverConnections:{...latest.naverConnections,[pending.userId]:record}});
      }
      success=true;
    } catch { /* Keep OAuth codes, access tokens and provider errors out of URLs and logs. */ }
    const previous=res.getHeader?.('Set-Cookie'), cookies=previous?(Array.isArray(previous)?previous:[previous]):[];
    cookies.push(cookie('',origin,0,loginMode));
    res.writeHead(303,{'Location':loginMode?(success?'/#connect':'/#naver-login-error'):(success?'/#settings/naver-success':'/#settings/naver-error'),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':cookies.length===1?cookies[0]:cookies});res.end();
  }
  async function disconnect(userId) {
    requireNoPublication(userId);
    const current=getStore(), old=current.naverConnections?.[userId], connections={...current.naverConnections};delete connections[userId];
    const pending=Object.fromEntries(Object.entries(current.naverOAuthStates || {}).filter(([,s])=>s.userId!==userId));
    await commit({...current,naverConnections:connections,naverOAuthStates:pending,naverLinkRevisions:{...current.naverLinkRevisions,[userId]:(current.naverLinkRevisions?.[userId] || 0)+1}});
    // Local access is removed first. Provider revocation is best effort and cannot
    // resurrect a connection if the provider is temporarily unavailable.
    if (old && configuration().ready && old.appHash===applicationHash()) {
      try {
        const tokens=decrypt(userId,old.encryptedTokens);
        await fetchImpl(REVOKE_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,token:tokens.refreshToken,token_type_hint:'refresh_token'}).toString(),redirect:'error',signal:AbortSignal.timeout(5000)});
      } catch {}
    }
  }
  async function handle(req,res,session,url,readJson,send,origin) {
    if (url.pathname==='/api/naver/status' && req.method==='GET') { send(res,200,{configuration:configuration(),connection:publicConnection(session.user.id)});return true; }
    if (url.pathname==='/api/naver/connect' && req.method==='POST') { send(res,200,await start(session,origin,res));return true; }
    if (url.pathname==='/api/naver/disconnect' && req.method==='POST') {
      if(session.user.isAdmin)throw new ApiError(403,'네이버 계정은 회원 본인이 관리해주세요.');
      await disconnect(session.user.id);send(res,200,{configuration:configuration(),connection:publicConnection(session.user.id)});return true;
    }
    return false;
  }
  async function publicHandle(req,res,url,readJson,send,origin,session) {
    if (url.pathname==='/api/naver/login-config' && req.method==='GET') { send(res,200,{configuration:configuration()});return true; }
    if (url.pathname==='/api/naver/login' && req.method==='POST') {
      if (session) throw new ApiError(409,'현재 계정에서 로그아웃한 뒤 네이버로 로그인해주세요.');
      if (req.headers?.origin!==origin || req.headers?.['sec-fetch-site']==='cross-site' || !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) throw new ApiError(403,'앱의 로그인 화면에서 다시 시도해주세요.');
      const body=await readJson(req);if(!object(body)||Object.keys(body).length)throw new ApiError(422,'로그인 요청을 확인해주세요.');
      send(res,200,await startLogin(req,res,origin));return true;
    }
    return false;
  }
  return {configuration,publicConnection,publicApplicant,resolveApplicant,approvalConnection,accessToken,handle,publicHandle,callback};
}
module.exports={createNaverAuth};
