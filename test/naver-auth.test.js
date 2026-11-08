const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createNaverAuth}=require('../naver-auth');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
const BASE='https://app.example.test';
const config={clientId:'test-client',clientSecret:'test-client-secret',callbackUrl:BASE+'/api/naver/callback',encryptionKey:Buffer.alloc(32,7).toString('base64')};
function harness(overrides={}) {
 let store={users:[{id:'u01'},{id:'u02'}],naverPublications:{keep:{status:'posted',memberId:'u01',articleUrl:'https://cafe.naver.com/sample/1'}}},active=true,failCommit=false;
 const requests=[];
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
 const make=(extra={})=>createNaverAuth({getStore:()=>store,commit:async next=>{if(failCommit)throw new ApiError(409,'test conflict');store=next;},ApiError,config:{...config,...overrides},fetchImpl,isSessionActive:(id,digest)=>active&&sessions[id]&&hash(sessions[id].token)===digest,...extra});
 const response=()=>({headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(code,headers){this.status=code;for(const [k,v]of Object.entries(headers))this.headers[k.toLowerCase()]=v;},end(body){this.body=body;}});
 const send=(res,status,data)=>{res.status=status;res.data=data;};
 const auth=make();
 async function handle(path,method='GET',id='u01',origin=BASE){const res=response();const matched=await auth.handle({method,headers:{}},res,sessions[id],new URL(path,BASE),async()=>({}),send,origin);return{...res,matched};}
 async function start(id='u01'){const r=await handle('/api/naver/connect','POST',id);const url=new URL(r.data.authorizeUrl);return{state:url.searchParams.get('state'),cookie:r.headers['set-cookie'].split(';')[0],response:r};}
 async function callback(flow,extra={}) {const res=response(),url=new URL('/api/naver/callback',BASE);url.searchParams.set('state',flow.state);url.searchParams.set('code','authorization-private-code');for(const[k,v]of Object.entries(extra.params||{}))url.searchParams.set(k,v);await auth.callback({method:'GET',headers:{cookie:flow.cookie,...extra.headers}},res,url,extra.origin||BASE);return res;}
 return{auth,make,handle,start,callback,requests,get store(){return store;},set store(next){store=next;},sessions,set active(v){active=v;},set failCommit(v){failCommit=v;},set profileId(v){profileId=v;},set fetchHook(v){fetchHook=v;},set refreshError(v){refreshError=v;}};
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
