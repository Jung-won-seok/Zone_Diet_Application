const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createServer,seedStore} = require('../server');

test('Naver-first login, explicit cafe request, manual assignment and photo publication', async t => {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'zonda-first-flow-'));
  const listener=http.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{await new Promise(resolve=>listener.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${listener.address().port}`;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const seed=seedStore();seed.program.startDate=new Date(Date.parse(date+'T00:00:00Z')-19*86400000).toISOString().slice(0,10);
  const providerCalls=[], publications=[];
  const naverFetch=async(url,options={})=>{
    providerCalls.push(url);
    if(url==='https://nid.naver.com/oauth2.0/token') {
      const form=new URLSearchParams(options.body), person=form.get('code')||'alice';
      return Response.json({access_token:'secret-access-'+person,refresh_token:'secret-refresh-'+person,expires_in:3600,token_type:'bearer'});
    }
    if(url==='https://openapi.naver.com/v1/nid/me') {
      const person=options.headers.Authorization.replace('Bearer secret-access-','');
      return Response.json({resultcode:'00',response:{id:'private-provider-'+person,nickname:person==='alice'?'민준네이버':'다른네이버'}});
    }
    if(url==='https://nid.naver.com/oauth2.0/revoke')return new Response(null,{status:200});
    if(url==='https://openapi.naver.com/v1/cafe/31811778/menu/7/articles') {
      publications.push({url,options});
      return Response.json({message:{status:'200',result:{articleId:'101',articleUrl:'https://cafe.naver.com/mycaffelatte/101'}}});
    }
    throw Error('Unexpected mocked provider URL');
  };
  const app=createServer({dataDir,initialStore:seed,naverFetch,naverConfig:{clientId:'first-flow-client',clientSecret:'first-flow-secret',callbackUrl:base+'/api/naver/callback',encryptionKey:Buffer.alloc(32,19).toString('base64')}});
  listener.on('request',app.listeners('request')[0]);
  function client() {
    const cookies=new Map(); let csrf='';
    return {
      async request(route,method='GET',body,overrides={}) {
        const response=await fetch(base+route,{method,redirect:'manual',headers:{Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'}),Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(csrf?{'X-CSRF-Token':csrf}:{}),...overrides},body:body===undefined?undefined:JSON.stringify(body)});
        for(const raw of response.headers.getSetCookie()) {const pair=raw.split(';')[0],i=pair.indexOf('=');if(/Max-Age=0(?:;|$)/.test(raw))cookies.delete(pair.slice(0,i));else cookies.set(pair.slice(0,i),pair.slice(i+1));}
        const raw=await response.text(),data=response.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):null;
        if(data?.csrfToken)csrf=data.csrfToken;
        return {status:response.status,data,raw,headers:response.headers};
      },
      async signIn(person) {
        const start=await this.request('/api/naver/login','POST',{});assert.equal(start.status,200,start.raw);
        const authorization=new URL(start.data.authorizeUrl);
        const callback=await this.request('/api/naver/callback?'+new URLSearchParams({state:authorization.searchParams.get('state'),code:person}));
        assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/#connect');
        assert.ok(callback.headers.getSetCookie().some(c=>c.startsWith('zonda_session=')&&c.includes('HttpOnly; SameSite=Strict')));
        return this.request('/api/bootstrap');
      }
    };
  }
  const alice=client(),admin=client(),bob=client(),visitor=client();
  let request,originalConnection;
  assert.equal((await admin.request('/api/login','POST',{username:'admin',password:'ZondaAdmin!Demo27'})).status,200);

  await t.test('anonymous login requires same-origin JSON and exposes no key values',async()=>{
    const config=await visitor.request('/api/naver/login-config');assert.equal(config.data.configuration.ready,true);assert.ok(!config.raw.includes('first-flow-secret'));
    assert.equal((await visitor.request('/api/naver/login','POST',{}, {Origin:'https://other.example'})).status,403);
    assert.equal((await visitor.request('/api/naver/login','POST',{}, {'Content-Type':'text/plain'})).status,403);
    assert.equal(providerCalls.length,0);
  });
  await t.test('new Naver user sees only onboarding until manual approval',async()=>{
    const boot=await alice.signIn('alice');assert.equal(boot.status,200,boot.raw);assert.equal(boot.data.user.pendingApproval,true);
    assert.deepEqual(boot.data.members,[]);assert.deepEqual(boot.data.teams,[]);
    for(const route of ['/api/meals?date='+date,'/api/admin/naver','/api/admin/naver/requests'])assert.equal((await alice.request(route)).status,403,route);
    assert.equal((await alice.request('/api/naver/publish','POST',{date,confirmed:true})).status,403);
    const state=await alice.request('/api/naver/onboarding');assert.equal(state.data.cafe.clubId,'31811778');assert.equal(state.data.request,null);
    originalConnection=state.data.connection.connectionId;
    assert.doesNotMatch(boot.raw+state.raw,/private-provider-|secret-access-|secret-refresh-|encryptedTokens|providerIdHash/);
  });
  await t.test('explicit consent creates one versioned request; applicant cannot approve itself',async()=>{
    const body={name:'김민준',cafeNickname:'민준카페',requestedBoardName:'2026년 2기 · 김민준',note:'제 개인 게시판에 연결해주세요.',consent:true,expectedVersion:0};
    assert.equal((await alice.request('/api/naver/link-request','POST',{...body,consent:false})).status,422);
    assert.equal((await alice.request('/api/naver/link-request','POST',body,{'X-CSRF-Token':''})).status,403);
    const sent=await alice.request('/api/naver/link-request','POST',body);assert.equal(sent.status,200,sent.raw);request=sent.data.request;assert.equal(request.status,'pending');
    assert.equal((await alice.request('/api/naver/link-request','POST',body)).status,409);
    assert.equal((await alice.request('/api/admin/naver/request-review','POST',{requestId:request.id,expectedVersion:request.version,decision:'approve',memberId:'u01',menuId:'7',label:'김민준',confirmed:true})).status,403);
    const queue=await admin.request('/api/admin/naver/requests');assert.equal(queue.status,200);assert.equal(queue.data.requests.filter(r=>r.status==='pending').length,1);
    assert.doesNotMatch(queue.raw,/secret-access-|private-provider-|encryptedTokens|providerIdHash/);
  });
  await t.test('admin explicitly maps member and board; the same Naver cookie gains only that member access',async()=>{
    const reviewed=await admin.request('/api/admin/naver/request-review','POST',{requestId:request.id,expectedVersion:request.version,decision:'approve',memberId:'u01',memberName:'김민준',menuId:'7',label:'2026년 2기 · 김민준',confirmed:true});
    assert.equal(reviewed.status,200,reviewed.raw);
    const boot=await alice.request('/api/bootstrap');assert.equal(boot.data.user.id,'u01');assert.equal(boot.data.user.pendingApproval,undefined);assert.equal(boot.data.members.length,4);
    const state=await alice.request('/api/naver/onboarding');assert.equal(state.data.approved,true);assert.equal(state.data.request.status,'approved');
    const mapped=await admin.request('/api/admin/naver');assert.equal(mapped.data.members.find(m=>m.id==='u01').board.menuId,'7');assert.equal(mapped.data.members.find(m=>m.id==='u01').connection.connectionId,originalConnection);
    assert.equal((await alice.request('/api/admin/naver')).status,403);
  });
  await t.test('saved photos and daily block totals become one reviewed Cafe post',async()=>{
    const image=await fs.readFile(path.join(__dirname,'fixtures/meal.png'));
    const upload=await alice.request('/api/meals','POST',{date,meal:'breakfast',caption:'테스트 아침',blocks:{carbs:3,protein:3,fat:2},imageData:'data:image/png;base64,'+image.toString('base64'),expectedTeamId:'t1',expectedVersion:0});
    assert.equal(upload.status,200,upload.raw);
    const preview=await alice.request('/api/naver/preview','POST',{date});assert.equal(preview.status,200,preview.raw);assert.equal(preview.data.readyToPublish,true);assert.match(preview.data.title,/존다 20일차/);
    const body={date,title:preview.data.title,previewVersion:preview.data.previewVersion,confirmed:true};
    assert.equal((await alice.request('/api/naver/publish','POST',{...body,confirmed:false})).status,422);
    const published=await alice.request('/api/naver/publish','POST',body);assert.equal(published.status,200,published.raw);assert.equal(published.data.publication.articleUrl,'https://cafe.naver.com/mycaffelatte/101');
    assert.equal(publications.length,1);assert.equal(publications[0].options.body.getAll('image').length,1);
    const html=decodeURIComponent(publications[0].options.body.get('content'));assert.match(html,/탄수화물 3블록/);assert.match(html,/src="#0"/);assert.ok(!html.includes('/api/media/'));
    assert.equal((await alice.request('/api/naver/publish','POST',body)).status,200);assert.equal(publications.length,1);
  });
  await t.test('subsequent Naver login preserves approval; another Naver user cannot see member records',async()=>{
    assert.equal((await alice.request('/api/logout','POST')).status,200);
    const boot=await alice.signIn('alice');assert.equal(boot.data.user.id,'u01');
    const state=await alice.request('/api/naver/onboarding');assert.equal(state.data.approved,true);assert.equal(state.data.connection.connectionId,originalConnection);
    const other=await bob.signIn('bob');assert.equal(other.data.user.pendingApproval,true);assert.deepEqual(other.data.members,[]);
    assert.equal((await bob.request('/api/meals?date='+date)).status,403);
    const disk=await fs.readFile(path.join(dataDir,'store.json'),'utf8');assert.ok(!disk.includes('secret-access-alice'));assert.ok(!disk.includes('private-provider-alice'));
  });
});
