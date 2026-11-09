const test = require('node:test');
const assert = require('node:assert/strict');
const {createServer,seedStore} = require('../server');

const HOST='naver-cloud.example.test', ORIGIN='https://'+HOST;
const config={clientId:'cloud-test-client',clientSecret:'cloud-test-client-secret',callbackUrl:ORIGIN+'/api/naver/callback',encryptionKey:Buffer.alloc(32,23).toString('base64')};

function cloudFixture() {
  let persisted=seedStore(), generation=0, instances=0, writes=0, rejectWrite=0;
  const providerCalls=[];
  const naverFetch=async(url,options={})=>{
    providerCalls.push(url);
    if(url==='https://nid.naver.com/oauth2.0/token') {
      const person=new URLSearchParams(options.body).get('code');
      return Response.json({access_token:'private-cloud-access-'+person,refresh_token:'private-cloud-refresh-'+person,expires_in:3600,token_type:'bearer'});
    }
    if(url==='https://openapi.naver.com/v1/nid/me') {
      const person=options.headers.Authorization.replace('Bearer private-cloud-access-','');
      return Response.json({resultcode:'00',response:{id:'private-cloud-provider-'+person,nickname:'김민준'}});
    }
    if(url==='https://nid.naver.com/oauth2.0/revoke')return new Response(null,{status:200});
    throw Error('Unexpected mocked provider URL');
  };
  async function invoke(req) {
    instances++;
    let expectedGeneration=generation;
    const app=createServer({initialStore:structuredClone(persisted),cloud:true,allowedHosts:[HOST],naverConfig:config,naverFetch,
      async persistStore(next) {
        await new Promise(resolve=>setImmediate(resolve));
        writes++;
        if(writes===rejectWrite || expectedGeneration!==generation)throw Object.assign(new Error('Mock cloud storage conflict'),{status:409});
        persisted=structuredClone(next);
        // The real cloud adapter updates its ETag after every successful write.
        expectedGeneration=++generation;
      }
    });
    const response={status:200,headers:{},raw:''};
    const res={headersSent:false,destroyed:false,
      setHeader(name,value){response.headers[name.toLowerCase()]=value;},
      getHeader(name){return response.headers[name.toLowerCase()];},
      writeHead(status,headers){response.status=status;this.headersSent=true;for(const [name,value] of Object.entries(headers))this.setHeader(name,value);},
      end(body){response.raw=body===undefined?'':String(body);}
    };
    // Vercel also invokes the request listener directly with a parsed req.body.
    await app.listeners('request')[0](req,res);
    return response;
  }
  function client() {
    const cookies=new Map();let csrf='';
    return {
      get cookie(){return [...cookies].map(([name,value])=>name+'='+value).join('; ');},
      get csrf(){return csrf;},
      async request(route,method='GET',body,options={}) {
        const headers={host:HOST,cookie:options.cookie??this.cookie};
        if(options.origin!==false)headers.origin=ORIGIN;
        if(csrf)headers['x-csrf-token']=csrf;
        if(body!==undefined)headers['content-type']='application/json';
        const response=await invoke({url:route,method,headers,body,socket:{remoteAddress:'127.0.0.1'}});
        const rawSetCookies=response.headers['set-cookie'];
        const setCookies=rawSetCookies?(Array.isArray(rawSetCookies)?rawSetCookies:[rawSetCookies]):[];
        for(const raw of setCookies) {
          const pair=raw.split(';')[0],index=pair.indexOf('='),name=pair.slice(0,index);
          if(/Max-Age=0(?:;|$)/.test(raw))cookies.delete(name);else cookies.set(name,pair.slice(index+1));
        }
        const data=response.headers['content-type']?.includes('application/json')?JSON.parse(response.raw):null;
        if(data?.csrfToken)csrf=data.csrfToken;
        return {...response,data,setCookies};
      },
      async start() {
        const response=await this.request('/api/naver/login','POST',{});assert.equal(response.status,200,response.raw);
        return new URL(response.data.authorizeUrl).searchParams.get('state');
      },
      finish(state,person='alice') {return this.request('/api/naver/callback?'+new URLSearchParams({state,code:person}),'GET',undefined,{origin:false});},
      async signIn(person='alice') {
        const response=await this.finish(await this.start(),person);assert.equal(response.headers.location,'/#connect',response.raw);
        return this.request('/api/bootstrap');
      },
      async adminLogin() {
        const response=await this.request('/api/login','POST',{username:'admin',password:'ZondaAdmin!Demo27'});assert.equal(response.status,200,response.raw);
      }
    };
  }
  return {client,providerCalls,get store(){return persisted;},get instances(){return instances;},get writes(){return writes;},rejectCommitAfter(count){rejectWrite=writes+count;}};
}

const consent={name:'김민준',cafeNickname:'민준카페',requestedBoardName:'김민준 게시판',note:'개인 게시판 연결 요청',consent:true,expectedVersion:0};
const approval=request=>({requestId:request.id,expectedVersion:request.version,decision:'approve',memberId:'u01',menuId:'7',label:'김민준 게시판',confirmed:true});

test('Naver cloud login and approval survive a new server instance for every request',async()=>{
  const h=cloudFixture(),member=h.client(),admin=h.client();
  await admin.adminLogin();
  const state=await member.start(),before=h.writes,callback=await member.finish(state);
  assert.equal(callback.status,303);assert.equal(callback.headers.location,'/#connect');
  assert.equal(h.writes-before,3,'callback durably consumes state, saves identity, and saves its session');
  assert.ok(callback.setCookies.some(c=>/^zonda_session=/.test(c)&&/HttpOnly; SameSite=Strict/.test(c)&&/; Secure/.test(c)));
  assert.ok(callback.setCookies.some(c=>/^zonda_naver_login_oauth=/.test(c)&&/Max-Age=0/.test(c)));
  assert.equal(Object.keys(h.store.naverOAuthStates).length,0);
  const cookie=member.cookie,token=cookie.split('=')[1],applicantId=h.store.authState.sessions[token].userId;
  assert.match(applicantId,/^na_/);assert.equal(h.store.naverApplicants[applicantId].memberId,null);
  const connectionId=h.store.naverApplicants[applicantId].connectionId;
  assert.deepEqual(h.store.authState.sessions[token].naverIdentity,{connectionId,providerIdHash:h.store.naverApplicants[applicantId].providerIdHash,appHash:h.store.naverApplicants[applicantId].appHash});
  const instances=h.instances,boot=await member.request('/api/bootstrap');
  assert.equal(h.instances,instances+1);assert.equal(boot.data.user.pendingApproval,true);assert.deepEqual(boot.data.members,[]);assert.deepEqual(boot.data.teams,[]);
  const csrf=member.csrf;
  assert.equal((await member.request('/api/meals')).status,403);assert.equal((await member.request('/api/admin/naver/requests')).status,403);
  const submitted=await member.request('/api/naver/link-request','POST',consent);assert.equal(submitted.status,200,submitted.raw);
  const queue=await admin.request('/api/admin/naver/requests');assert.equal(queue.data.requests.length,1);assert.equal(queue.data.requests[0].status,'pending');
  const reviewed=await admin.request('/api/admin/naver/request-review','POST',approval(submitted.data.request));assert.equal(reviewed.status,200,reviewed.raw);
  assert.equal(h.store.naverApplicants[applicantId].memberId,'u01');assert.equal(h.store.naverApplicants[applicantId].encryptedTokens,undefined);
  assert.equal(h.store.naverConnections.u01.connectionId,connectionId);assert.equal(h.store.naverCafe.boards.u01.approvedConnectionId,connectionId);
  assert.equal(member.cookie,cookie,'approval does not replace the member browser cookie');
  const session=await member.request('/api/session');assert.equal(session.data.user.id,'u01');assert.equal(session.data.user.pendingApproval,undefined);assert.equal(session.data.csrfToken,csrf);
  const approvedBoot=await member.request('/api/bootstrap');assert.equal(approvedBoot.data.user.id,'u01');assert.equal(approvedBoot.data.members.length,4);
  const onboard=await member.request('/api/naver/onboarding');assert.equal(onboard.data.approved,true);assert.equal(onboard.data.request.status,'approved');assert.equal(onboard.data.request.id,submitted.data.request.id);
  assert.equal((await member.request('/api/admin/naver/requests')).status,403);
  assert.doesNotMatch(JSON.stringify(h.store),/private-cloud-access-|private-cloud-refresh-|private-cloud-provider-|cloud-test-client-secret/);
  assert.doesNotMatch(boot.raw+queue.raw+reviewed.raw+onboard.raw,/encryptedTokens|providerIdHash|private-cloud-/);
  assert.equal((await member.request('/api/logout','POST',{})).status,200);
  const returning=await member.signIn();assert.equal(returning.data.user.id,'u01');assert.equal((await member.request('/api/naver/onboarding')).data.approved,true);
  assert.equal(h.store.naverConnections.u01.connectionId,connectionId);assert.equal(Object.keys(h.store.naverApplicants).length,1);
  assert.equal((await member.request('/api/naver/disconnect','POST',{})).status,200);
  assert.equal((await member.request('/api/session')).data.user,null);
  assert.equal((await member.request('/api/session','GET',undefined,{cookie})).data.user,null,'old applicant aliases stay invalid in later instances after disconnect');
});

test('failed cloud OAuth commits cannot issue a usable session and later fresh login can recover',async t=>{
  for(const failedCommit of [1,2,3])await t.test('callback write '+failedCommit,async()=>{
    const h=cloudFixture(),member=h.client(),state=await member.start();
    h.rejectCommitAfter(failedCommit);
    const callback=await member.finish(state);assert.equal(callback.status,303);assert.equal(callback.headers.location,'/#naver-login-error');
    assert.ok(callback.setCookies.every(c=>!c.startsWith('zonda_session=')));assert.equal((await member.request('/api/session')).data.user,null);
    assert.equal(Object.keys(h.store.authState?.sessions||{}).length,0);
    assert.equal(Object.keys(h.store.naverApplicants||{}).length,failedCommit===3?1:0);
    const savedApplicant=Object.keys(h.store.naverApplicants||{})[0];
    const recovery=await member.signIn();assert.equal(recovery.data.user.pendingApproval,true);assert.equal(Object.keys(h.store.naverApplicants).length,1);
    if(savedApplicant)assert.equal(recovery.data.user.id,savedApplicant,'a durable identity is reused after its session write failed');
  });
});

test('cloud approval conflicts keep the same cookie restricted until an atomic retry succeeds',async()=>{
  const h=cloudFixture(),member=h.client(),admin=h.client();
  const boot=await member.signIn(),applicantId=boot.data.user.id,cookie=member.cookie;
  await admin.adminLogin();
  const submitted=await member.request('/api/naver/link-request','POST',consent),body=approval(submitted.data.request);
  const before=structuredClone(h.store);h.rejectCommitAfter(1);
  const rejected=await admin.request('/api/admin/naver/request-review','POST',body);assert.equal(rejected.status,409);assert.deepEqual(h.store,before);
  assert.equal((await member.request('/api/session')).data.user.pendingApproval,true);assert.equal(h.store.naverApplicants[applicantId].memberId,null);assert.ok(h.store.naverApplicants[applicantId].encryptedTokens);
  assert.equal((await admin.request('/api/admin/naver/request-review','POST',body)).status,200);
  assert.equal(member.cookie,cookie);assert.equal((await member.request('/api/session')).data.user.id,'u01');
});

test('two cloud instances cannot consume the same anonymous OAuth state',async()=>{
  const h=cloudFixture(),member=h.client(),state=await member.start();
  const responses=await Promise.all([member.finish(state),member.finish(state)]);
  assert.deepEqual(responses.map(response=>response.headers.location).sort(),['/#connect','/#naver-login-error']);
  assert.equal(h.providerCalls.length,2,'only the winning state consumer exchanges the code and reads the profile');
  assert.equal(Object.keys(h.store.naverOAuthStates).length,0);
  assert.equal(Object.keys(h.store.naverApplicants).length,1);
  assert.equal(Object.keys(h.store.authState.sessions).length,1);
  assert.equal((await member.request('/api/session')).data.user.pendingApproval,true);
});
