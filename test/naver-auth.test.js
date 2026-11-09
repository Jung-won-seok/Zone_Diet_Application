const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createNaverAuth}=require('../naver-auth');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
const BASE='https://app.example.test';
const config={clientId:'test-client',clientSecret:'test-client-secret',callbackUrl:BASE+'/api/naver/callback',encryptionKey:Buffer.alloc(32,7).toString('base64')};
function harness(overrides={}) {
 let store={users:[{id:'u01',name:'김민준'},{id:'u02',name:'이서연'}],members:[{id:'u01'},{id:'u02'}],naverPublications:{keep:{status:'posted',memberId:'u01',articleUrl:'https://cafe.naver.com/sample/1'}}},active=true,failCommit=false;
 const requests=[],issuedSessions=[];
 const sessions={u01:{user:{id:'u01',isAdmin:false},token:'app-session-u01'},u02:{user:{id:'u02',isAdmin:false},token:'app-session-u02'},admin:{user:{id:'admin',isAdmin:true},token:'app-session-admin'}};
 let profileId='provider-private-identity', fetchHook=null, refreshError=false;
 const fetchImpl=async(url,options)=>{
  const body=options.body?Object.fromEntries(new URLSearchParams(options.body)):null;requests.push({url,body,headers:options.headers});
  if(fetchHook)await fetchHook(url,body);
  if(url.endsWith('/revoke'))return new Response(null,{status:200});
  if(url.endsWith('/token')){
   if(body.grant_type==='refresh_token'&&refreshError)return Response.json({error:'invalid_grant',error_description:'private-provider-error-access-secret'},{status:401});
   return Response.json(body.grant_type==='refresh_token'?{access_token:'refreshed-access-secret',expires_in:3600,token_type:'bearer'}:{access_token:'initial-access-secret',refresh_token:'refresh-secret',expires_in:3600,token_type:'bearer'});
  }
  return Response.json({resultcode:'00',response:{id:profileId,nickname:'김민준',name:'민준'}});
 };
 const make=(extra={})=>createNaverAuth({getStore:()=>store,commit:async next=>{if(failCommit)throw new ApiError(409,'test conflict');store=next;},ApiError,config:{...config,...overrides},fetchImpl,isSessionActive:(id,digest)=>active&&sessions[id]&&hash(sessions[id].token)===digest,establishSession:async(id,req,res)=>{issuedSessions.push(id);res.setHeader('Set-Cookie','zonda_session=test-session-'+id+'; Path=/; HttpOnly; SameSite=Strict; Secure');},...extra});
 const response=()=>({headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},writeHead(code,headers){this.status=code;for(const [k,v]of Object.entries(headers))this.headers[k.toLowerCase()]=v;},end(body){this.body=body;}});
 const send=(res,status,data)=>{res.status=status;res.data=data;};
 const auth=make();
 async function handle(path,method='GET',id='u01',origin=BASE){const res=response();const matched=await auth.handle({method,headers:{}},res,sessions[id],new URL(path,BASE),async()=>({}),send,origin);return{...res,matched};}
 async function start(id='u01'){const r=await handle('/api/naver/connect','POST',id);const url=new URL(r.data.authorizeUrl);return{state:url.searchParams.get('state'),cookie:r.headers['set-cookie'].split(';')[0],response:r};}
 async function publicHandle(path,options={}){const res=response();const matched=await auth.publicHandle({method:options.method||'POST',headers:{origin:BASE,'content-type':'application/json',...(options.cookie?{cookie:options.cookie}:{}),...options.headers}},res,new URL(path,BASE),async()=>options.body===undefined?{}:options.body,send,options.origin||BASE,options.session);return{...res,matched};}
 async function startLogin(options={}){const r=await publicHandle('/api/naver/login',options),url=new URL(r.data.authorizeUrl);return{state:url.searchParams.get('state'),cookie:r.headers['set-cookie'].split(';')[0],response:r};}
 async function callback(flow,extra={}) {const res=response(),url=new URL('/api/naver/callback',BASE);url.searchParams.set('state',flow.state);url.searchParams.set('code','authorization-private-code');for(const[k,v]of Object.entries(extra.params||{}))url.searchParams.set(k,v);await (extra.auth||auth).callback({method:'GET',headers:{cookie:flow.cookie,...extra.headers}},res,url,extra.origin||BASE);return res;}
 return{auth,make,handle,publicHandle,start,startLogin,callback,requests,issuedSessions,get store(){return store;},set store(next){store=next;},sessions,set active(v){active=v;},set failCommit(v){failCommit=v;},set profileId(v){profileId=v;},set fetchHook(v){fetchHook=v;},set refreshError(v){refreshError=v;}};
}
test('Naver configuration fails closed and status never exposes secrets',async()=>{
 const h=harness({clientSecret:'',encryptionKey:'not-a-key',callbackUrl:'http://remote.test/api/naver/callback'});
 const status=await h.handle('/api/naver/status');assert.equal(status.data.configuration.ready,false);assert.deepEqual(status.data.configuration.missing,['NAVER_CLIENT_SECRET','NAVER_CALLBACK_URL','NAVER_TOKEN_ENCRYPTION_KEY']);assert.doesNotMatch(JSON.stringify(status.data),/test-client|not-a-key/);
 await assert.rejects(h.start(),e=>e.status===503);assert.equal(h.requests.length,0);
 const ready=harness();await assert.rejects(ready.handle('/api/naver/connect','POST','u01','https://untrusted.example'),e=>e.status===403);await assert.rejects(ready.start('admin'),e=>e.status===403);
});
test('OAuth uses browser-bound state and encrypted tokens while leaving the app cookie unchanged',async()=>{
 const h=harness(),flow=await h.start();assert.match(flow.response.headers['set-cookie'],/Path=\/api\/naver\/callback; HttpOnly; SameSite=Lax/);assert.match(flow.response.headers['set-cookie'],/; Secure/);assert.ok(!JSON.stringify(h.store).includes(flow.state));assert.ok(!JSON.stringify(h.store).includes(flow.cookie.split('=')[1]));
 const response=await h.callback(flow);assert.equal(response.status,303);assert.equal(response.headers.location,'/#settings/naver-success');assert.match(response.headers['set-cookie'],/Max-Age=0/);assert.equal(Object.keys(h.store.naverOAuthStates).length,0);
 const stored=JSON.stringify(h.store);for(const secret of ['initial-access-secret','refresh-secret','provider-private-identity','test-client-secret','authorization-private-code'])assert.ok(!stored.includes(secret));
 const c=h.auth.publicConnection('u01');assert.equal(c.connected,true);assert.equal(c.displayName,'김민준');assert.ok(c.connectionId);assert.deepEqual(Object.keys(c).sort(),['connected','connectedAt','connectionId','displayName','needsReconnect']);assert.equal(await h.auth.accessToken('u01'),'initial-access-secret');assert.equal(h.requests.length,2);
 const recreated=h.make();assert.equal(await recreated.accessToken('u01'),'initial-access-secret');assert.ok(!JSON.stringify(response).includes('access-secret'));
});
test('wrong nonce, expired state, logged out session and replay never exchange an authorization code',async()=>{
 for(const kind of ['nonce','expired','logout','missing']){
  const h=harness(),flow=await h.start();if(kind==='nonce')flow.cookie='zonda_naver_oauth='+'f'.repeat(64);if(kind==='expired')Object.values(h.store.naverOAuthStates)[0].expiresAt=0;if(kind==='logout')h.active=false;if(kind==='missing')flow.state='0'.repeat(64);
  const r=await h.callback(flow);assert.equal(r.headers.location,'/#settings/naver-error');assert.equal(h.requests.length,0);assert.ok(!h.auth.publicConnection('u01').connected);
 }
 const h=harness(),flow=await h.start();await h.callback(flow);assert.equal((await h.callback(flow)).headers.location,'/#settings/naver-error');assert.equal(h.requests.length,2);
});
test('cancelled OAuth consumes state; one Naver identity cannot connect to two app members',async()=>{
 const h=harness(),cancel=await h.start();assert.equal((await h.callback(cancel,{params:{error:'access_denied',error_description:'do-not-reflect'}})).headers.location,'/#settings/naver-error');assert.equal(Object.keys(h.store.naverOAuthStates).length,0);assert.equal(h.requests.length,0);
 await h.callback(await h.start());const first=h.auth.publicConnection('u01').connectionId;
 const second=await h.callback(await h.start('u02'));assert.equal(second.headers.location,'/#settings/naver-error');assert.equal(h.auth.publicConnection('u02').connected,false);assert.equal(h.auth.publicConnection('u01').connectionId,first);
});
test('expired access token refreshes and persists encryption; failed refresh requests reconnection without exposing provider errors',async()=>{
 const h=harness();await h.callback(await h.start());h.store.naverConnections.u01.expiresAt=0;const id=h.auth.publicConnection('u01').connectionId;
 assert.equal(await h.auth.accessToken('u01'),'refreshed-access-secret');assert.equal(h.auth.publicConnection('u01').connectionId,id);assert.ok(!JSON.stringify(h.store).includes('refreshed-access-secret'));assert.equal(await h.make().accessToken('u01'),'refreshed-access-secret');
 h.store.naverConnections.u01.expiresAt=0;h.refreshError=true;await assert.rejects(h.auth.accessToken('u01'),e=>e.status===502&&!e.message.includes('private-provider'));assert.equal(h.auth.publicConnection('u01').needsReconnect,true);
});
test('ciphertext is bound to the app member; changing encryption key requires reconnect',async()=>{
 const h=harness();await h.callback(await h.start());h.profileId='another-naver-id';await h.callback(await h.start('u02'));
 h.store.naverConnections.u02.encryptedTokens=h.store.naverConnections.u01.encryptedTokens;await assert.rejects(h.auth.accessToken('u02'),e=>e.status===409);assert.equal(h.auth.publicConnection('u02').needsReconnect,true);
 const differentKey=h.make({config:{...config,encryptionKey:Buffer.alloc(32,8).toString('base64')}});await assert.rejects(differentKey.accessToken('u01'),e=>e.status===409);
});
test('disconnect invalidates pending requests, preserves publication history, and calls provider revocation',async()=>{
 const h=harness();await h.callback(await h.start());const flow=await h.start();const old=h.auth.publicConnection('u01').connectionId;
 const r=await h.handle('/api/naver/disconnect','POST');assert.equal(r.data.connection.connected,false);assert.equal(Object.keys(h.store.naverOAuthStates).length,0);assert.ok(h.store.naverPublications.keep);assert.equal(h.requests.at(-1).url,'https://nid.naver.com/oauth2.0/revoke');assert.equal(h.requests.at(-1).body.token_type_hint,'refresh_token');
 assert.equal((await h.callback(flow)).headers.location,'/#settings/naver-error');await h.callback(await h.start());assert.notEqual(h.auth.publicConnection('u01').connectionId,old);
});
test('CAS failures and disconnect during OAuth cannot create a usable connection',async()=>{
 const h=harness(),flow=await h.start();h.failCommit=true;assert.equal((await h.callback(flow)).headers.location,'/#settings/naver-error');assert.equal(h.requests.length,0);assert.equal(h.auth.publicConnection('u01').connected,false);
 const race=harness(),pending=await race.start();let fired=false;race.fetchHook=async url=>{if(!fired&&url.endsWith('/v1/nid/me')){fired=true;await race.handle('/api/naver/disconnect','POST');}};
 assert.equal((await race.callback(pending)).headers.location,'/#settings/naver-error');assert.equal(race.auth.publicConnection('u01').connected,false);
});
test('pending publication blocks connect, disconnect and final OAuth identity replacement',async()=>{
 const h=harness();await h.callback(await h.start());const c=h.auth.publicConnection('u01').connectionId;const flow=await h.start();h.store.naverPublications.inflight={memberId:'u01',status:'pending'};
 await assert.rejects(h.start(),e=>e.status===409);await assert.rejects(h.handle('/api/naver/disconnect','POST'),e=>e.status===409);assert.equal((await h.callback(flow)).headers.location,'/#settings/naver-error');assert.equal(h.auth.publicConnection('u01').connectionId,c);
});

test('refresh merges into the latest store and cannot revive a disconnected account',async()=>{
 const h=harness();await h.callback(await h.start());h.store.naverConnections.u01.expiresAt=0;
 h.fetchHook=async(url,body)=>{if(body?.grant_type==='refresh_token')h.store={...h.store,naverCafeSettings:{cafeId:'updated-during-refresh'}};};
 assert.equal(await h.auth.accessToken('u01'),'refreshed-access-secret');assert.equal(h.store.naverCafeSettings.cafeId,'updated-during-refresh');
 h.store.naverConnections.u01.expiresAt=0;h.fetchHook=async(url,body)=>{if(body?.grant_type==='refresh_token')await h.handle('/api/naver/disconnect','POST');};
 await assert.rejects(h.auth.accessToken('u01'),e=>e.status===409);assert.equal(h.auth.publicConnection('u01').connected,false);assert.ok(h.store.naverPublications.keep);
});

test('public Naver login configuration is redacted and login starts require same-origin JSON without an existing session',async()=>{
 const h=harness();const result=await h.publicHandle('/api/naver/login-config',{method:'GET'});assert.equal(result.data.configuration.ready,true);assert.doesNotMatch(JSON.stringify(result.data),/test-client|secret/);
 for(const options of [{headers:{origin:undefined}},{headers:{origin:'https://evil.example'}},{headers:{'sec-fetch-site':'cross-site'}},{headers:{'content-type':'text/plain'}},{body:{memberId:'u01'}},{body:[]},{session:h.sessions.u01}])await assert.rejects(h.startLogin(options),e=>[403,409,422].includes(e.status));
 assert.equal(h.requests.length,0);assert.equal(h.store.naverOAuthStates,undefined);
 const disabled=harness({clientId:''});await assert.rejects(disabled.startLogin(),e=>e.status===503);
});

test('first Naver login creates an encrypted restricted applicant without matching an existing member by name',async()=>{
 const h=harness(),flow=await h.startLogin();const pending=Object.values(h.store.naverOAuthStates)[0];assert.equal(pending.mode,'login');assert.equal(pending.userId,undefined);assert.equal(pending.sessionHash,undefined);
 assert.match(flow.response.headers['set-cookie'],/^zonda_naver_login_oauth=login_[a-f0-9]{64}; Path=\/api\/naver\/; HttpOnly; SameSite=Lax/);
 assert.ok(!JSON.stringify(h.store).includes(flow.state));assert.ok(!JSON.stringify(h.store).includes(flow.cookie.split('=')[1]));
 const r=await h.callback(flow);assert.equal(r.headers.location,'/#connect');assert.equal(r.status,303);
 const id=h.issuedSessions[0];assert.match(id,/^na_/);assert.equal(h.store.users.length,2);assert.equal(h.store.naverConnections,undefined);assert.equal(h.store.naverApplicants[id].memberId,null);
 assert.deepEqual(h.auth.resolveApplicant(id),{id,username:'',name:'김민준',isAdmin:false,pendingApproval:true});
 assert.equal(h.auth.publicApplicant(id).connected,true);assert.equal(h.auth.publicApplicant(id).displayName,'김민준');
 assert.ok(r.headers['set-cookie'].some(c=>c.startsWith('zonda_session=')&&c.includes('SameSite=Strict')));assert.ok(r.headers['set-cookie'].some(c=>c.startsWith('zonda_naver_login_oauth=')&&c.includes('Max-Age=0')));
 for(const secret of ['initial-access-secret','refresh-secret','provider-private-identity','test-client-secret','authorization-private-code'])assert.ok(!JSON.stringify(h.store).includes(secret));
 assert.doesNotMatch(JSON.stringify(h.auth.publicApplicant(id)),/providerIdHash|encryptedTokens|appHash/);
});

test('anonymous callbacks require the originating nonce and consume state once before provider calls',async()=>{
 for(const kind of ['nonce','expired','code','origin','cancel']){
  const h=harness(),flow=await h.startLogin();if(kind==='nonce')flow.cookie='zonda_naver_login_oauth=login_'+'f'.repeat(64);if(kind==='expired')Object.values(h.store.naverOAuthStates)[0].expiresAt=0;
  const extra=kind==='code'?{params:{code:''}}:kind==='origin'?{origin:'https://evil.example'}:kind==='cancel'?{params:{error:'access_denied'}}:{};
  const r=await h.callback(flow,extra);assert.equal(r.headers.location,'/#naver-login-error');assert.equal(h.requests.length,0);assert.equal(h.issuedSessions.length,0);
 }
 const h=harness(),flow=await h.startLogin();await h.callback(flow);assert.equal((await h.callback(flow)).headers.location,'/#naver-login-error');assert.equal(h.requests.length,2);assert.equal(h.issuedSessions.length,1);
});

test('anonymous state capacity is bounded and a repeat start replaces only that browser login state',async()=>{
 const h=harness(),first=await h.startLogin(),second=await h.startLogin({cookie:first.cookie});assert.equal(Object.keys(h.store.naverOAuthStates).length,1);assert.equal((await h.callback(first)).headers.location,'/#naver-login-error');assert.ok(h.store.naverOAuthStates[hash(second.state)]);
 const linked=await h.start('u01');assert.equal(Object.keys(h.store.naverOAuthStates).length,2);
 h.store={...h.store,naverOAuthStates:Object.fromEntries(Array.from({length:200},(_,i)=>[String(i),{mode:'login',nonceHash:hash('other-'+i),expiresAt:Date.now()+60000,origin:BASE}]))};
 await assert.rejects(h.startLogin(),e=>e.status===429);await assert.rejects(h.start(),e=>e.status===429);assert.equal(h.requests.length,0);assert.ok(linked.state);
});

test('repeat pending login preserves applicant request and connection identity; approval reencrypts tokens for the selected member',async()=>{
 const h=harness();await h.callback(await h.startLogin());const id=h.issuedSessions[0],old=h.store.naverApplicants[id];
 h.store.naverApplicants[id].request={status:'pending',requestedBoardName:'김민준 게시판'};
 await h.callback(await h.startLogin());assert.equal(h.issuedSessions.at(-1),id);assert.equal(h.store.naverApplicants[id].connectionId,old.connectionId);assert.equal(h.store.naverApplicants[id].request.status,'pending');
 assert.throws(()=>h.auth.approvalConnection(id,'u01','stale'),e=>e.status===409);assert.throws(()=>h.auth.approvalConnection(id,'missing',old.connectionId),e=>e.status===409);
 const connection=h.auth.approvalConnection(id,'u01',old.connectionId);assert.equal(connection.connectionId,old.connectionId);assert.notEqual(connection.encryptedTokens,h.store.naverApplicants[id].encryptedTokens);
 const approved={...h.store.naverApplicants[id],memberId:'u01'};delete approved.encryptedTokens;
 h.store={...h.store,naverConnections:{u01:connection},naverApplicants:{[id]:approved}};
 assert.equal(await h.auth.accessToken('u01'),'initial-access-secret');assert.equal(h.auth.resolveApplicant(id).id,'u01');assert.equal(h.auth.publicApplicant(id).connectionId,old.connectionId);
 assert.throws(()=>h.auth.approvalConnection(id,'u02',old.connectionId),e=>e.status===409);
});

test('returning linked Naver users sign in as their member and keep board approval valid',async()=>{
 const h=harness();await h.callback(await h.start('u01'));const connectionId=h.auth.publicConnection('u01').connectionId;
 h.store.naverCafe={boards:{u01:{menuId:'7',approvedConnectionId:connectionId}}};
 const r=await h.callback(await h.startLogin());assert.equal(r.headers.location,'/#connect');assert.equal(h.issuedSessions[0],'u01');assert.equal(h.auth.publicConnection('u01').connectionId,connectionId);assert.equal(h.store.naverCafe.boards.u01.approvedConnectionId,connectionId);assert.equal(h.store.naverApplicants,undefined);
 h.store.naverPublications.pending={memberId:'u01',status:'pending'};assert.equal((await h.callback(await h.startLogin())).headers.location,'/#naver-login-error');assert.equal(h.issuedSessions.length,1);
});

test('disconnect and relink invalidate approved applicant aliases and cannot transfer an occupied identity',async()=>{
 const h=harness();await h.callback(await h.startLogin());const id=h.issuedSessions[0],a=h.store.naverApplicants[id],c=h.auth.approvalConnection(id,'u01',a.connectionId);
 const mapped={...a,memberId:'u01'};delete mapped.encryptedTokens;h.store={...h.store,naverConnections:{u01:c},naverApplicants:{[id]:mapped}};
 assert.equal(h.auth.resolveApplicant(id).id,'u01');await h.handle('/api/naver/disconnect','POST','u01');assert.equal(h.auth.resolveApplicant(id),null);
 await h.callback(await h.start('u01'));assert.notEqual(h.auth.publicConnection('u01').connectionId,a.connectionId);assert.equal(h.auth.resolveApplicant(id),null);
 h.profileId='second-provider';await h.callback(await h.startLogin());const next=h.issuedSessions.at(-1),nextRecord=h.store.naverApplicants[next];assert.throws(()=>h.auth.approvalConnection(next,'u01',nextRecord.connectionId),e=>e.status===409);
 h.store.naverConnections.u01={...h.store.naverConnections.u01,providerIdHash:nextRecord.providerIdHash};assert.throws(()=>h.auth.approvalConnection(next,'u02',nextRecord.connectionId),e=>e.status===409);
});

test('anonymous callback storage or session failures never report login success',async()=>{
 const h=harness(),flow=await h.startLogin();h.failCommit=true;assert.equal((await h.callback(flow)).headers.location,'/#naver-login-error');assert.equal(h.requests.length,0);assert.equal(h.issuedSessions.length,0);
 const race=harness(),pending=await race.startLogin();race.fetchHook=async url=>{if(url.endsWith('/v1/nid/me'))race.failCommit=true;};assert.equal((await race.callback(pending)).headers.location,'/#naver-login-error');assert.equal(race.issuedSessions.length,0);assert.equal(race.store.naverApplicants,undefined);
 const session=harness(),f=await session.startLogin(),auth=session.make({establishSession:async()=>{throw new Error('session store failed');}});assert.equal((await session.callback(f,{auth})).headers.location,'/#naver-login-error');assert.equal(session.issuedSessions.length,0);
});

test('session issuance rejects an identity replaced after the verified login was saved',async()=>{
 const h=harness();await h.callback(await h.start('u01'));const flow=await h.startLogin();
 let writes=0,saved;
 const app=require('../server').createServer({initialStore:{...h.store,personal:{}},cloud:true,allowedHosts:[new URL(BASE).host],naverConfig:config,
  naverFetch:async url=>url.endsWith('/token')?Response.json({access_token:'race-access',refresh_token:'race-refresh',expires_in:3600}):Response.json({resultcode:'00',response:{id:'provider-private-identity',nickname:'김민준'}}),
  persistStore:async next=>{
   saved=next;
   // Reproduce a replacement at the identity-commit/session-issuance boundary.
   if(++writes===2)next.naverConnections.u01={...next.naverConnections.u01,connectionId:'replacement-connection',providerIdHash:'another-provider'};
  }
 });
 const response={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},writeHead(status,headers){this.status=status;for(const[k,v]of Object.entries(headers))this.setHeader(k,v);},end(){}};
 await app.listeners('request')[0]({method:'GET',url:'/api/naver/callback?'+new URLSearchParams({state:flow.state,code:'race-code'}),headers:{host:new URL(BASE).host,cookie:flow.cookie}},response);
 assert.equal(response.status,303);assert.equal(response.headers.location,'/#naver-login-error');assert.equal(writes,2);
 assert.equal(saved.authState,undefined);assert.ok(!JSON.stringify(response.headers['set-cookie']).includes('zonda_session='));
});
