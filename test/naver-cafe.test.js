const test = require('node:test');
const assert = require('node:assert/strict');
const {createNaverCafe} = require('../naver-cafe');
class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
const DATE='2026-05-10', KEY=`program-1|u01|${DATE}`;
const A='a'.repeat(32),B='b'.repeat(32),C='c'.repeat(32);
const target={clubId:'31811778',cafeUrl:'https://cafe.naver.com/mycaffelatte',cafeName:'mycaffelatte',menuId:'7',boardName:'김민준'};
const publicationResponse=(id=123)=>Response.json({message:{'@type':'response',status:'200',result:{msg:'Success',articleId:id,articleUrl:`https://cafe.naver.com/mycaffelatte/${id}`}}});
function harness() {
  let store={
    users:[{id:'admin',username:'admin',name:'관리자',isAdmin:true},{id:'u01',username:'member01',name:'김민준',isAdmin:false},{id:'u02',username:'member02',name:'이지우',isAdmin:false}],
    program:{id:'program-1',startDate:'2026-04-21',endDate:'2026-06-15'},
    members:[{id:'u01',teamId:'t1'},{id:'u02',teamId:'t2'}],
    naverCafeRequests:{u01:{status:'approved',memberId:'u01',connectionId:'connection-1',clubId:'31811778',cafeUrl:'https://cafe.naver.com/mycaffelatte',programId:'program-1'},u02:{status:'approved',memberId:'u02',connectionId:'connection-2',clubId:'31811778',cafeUrl:'https://cafe.naver.com/mycaffelatte',programId:'program-1'}},
    personal:{u01:{weight:70,privateNote:'PRIVATE WEIGHT NOTE'}},
    mealPosts:[
      {id:'meal-1',memberId:'u01',teamId:'t1',date:DATE,meal:'breakfast',caption:'달걀 <script>unsafe()</script>',blocks:{carbs:3,protein:2.5,fat:1},mediaIds:[A,B],version:1},
      {id:'meal-2',memberId:'u01',teamId:'t1',date:DATE,meal:'lunch',caption:'점심',blocks:{carbs:2,protein:3,fat:0},mediaIds:[],version:1},
      {id:'meal-foreign',memberId:'u02',teamId:'t2',date:DATE,meal:'dinner',caption:'OTHER MEMBER PRIVATE',blocks:{carbs:99,protein:99,fat:99},mediaIds:[C]},
      {id:'meal-past',memberId:'u01',teamId:'t1',date:'2026-05-09',meal:'dinner',caption:'OTHER DATE PRIVATE',mediaIds:[A]},
      {id:'meal-team',memberId:'u01',teamId:'old-team',date:DATE,meal:'dinner',caption:'OTHER TEAM PRIVATE',mediaIds:[A]},
      {id:'meal-program',memberId:'u01',teamId:'t1',programId:'old-program',date:DATE,meal:'dinner',caption:'OTHER PROGRAM PRIVATE',mediaIds:[A]},
    ],
  };
  const connections={u01:{connected:true,displayName:'김민준',connectedAt:'2026-05-01T00:00:00Z',connectionId:'connection-1',needsReconnect:false},u02:{connected:true,displayName:'이지우',connectedAt:'2026-05-01T00:00:00Z',connectionId:'connection-2',needsReconnect:false}};
  let configuration={ready:true,missing:[],callbackUrl:'http://localhost:3000/api/naver/callback'}, fetchHook=null,photoHook=null,tokenHook=null,commitHook=null;
  const calls=[],photos=[],commits=[];
  const auth={configuration:()=>configuration,publicConnection:id=>connections[id]||{connected:false,connectionId:null,needsReconnect:false},accessToken:async id=>{if(tokenHook)await tokenHook(id);return 'fixture-access-token';}};
  const service=createNaverCafe({getStore:()=>store,ApiError,auth,
    commit:async next=>{commits.push(next);if(commitHook)await commitHook(next);store=next;},
    readPhoto:async(id,userId)=>{photos.push({id,userId});if(photoHook)return photoHook(id,userId);if(![A,B].includes(id)||userId!=='u01')throw new ApiError(403,'본인 사진만');return{buffer:Buffer.from('fixture-image'),mime:'image/png'};},
    fetchImpl:async(url,options)=>{calls.push({url,options});return fetchHook?fetchHook(url,options):publicationResponse();},
  });
  async function invoke(path,method='GET',body={},userId='u01') {
    const session={user:store.users.find(u=>u.id===userId)},res={};
    const matched=await service.handle({method},res,session,new URL(path,'http://localhost:3000'),async()=>body,(_res,status,data)=>{res.status=status;res.data=data;});
    return {...res,matched};
  }
  const settings=()=>({revision:store.naverCafe?.revision||0,cafe:{clubId:'31811778',url:'https://cafe.naver.com/mycaffelatte',name:'mycaffelatte'},programStartDate:store.program.startDate,boards:[{memberId:'u01',menuId:'7',label:'김민준',approvedConnectionId:connections.u01.connectionId},{memberId:'u02',menuId:'8',label:'이지우',approvedConnectionId:connections.u02.connectionId}]});
  const setup=async()=>{await invoke('/api/admin/naver','PUT',settings(),'admin');};
  const preview=async(extra={})=>(await invoke('/api/naver/preview','POST',{date:DATE,...extra})).data;
  const publish=async p=>invoke('/api/naver/publish','POST',{date:DATE,title:p.title,previewVersion:p.previewVersion,confirmed:true});
  return {service,invoke,settings,setup,preview,publish,calls,photos,commits,connections,get store(){return store;},set store(v){store=v;},set configuration(v){configuration=v;},set fetchHook(v){fetchHook=v;},set photoHook(v){photoHook=v;},set tokenHook(v){tokenHook=v;},set commitHook(v){commitHook=v;}};
}

test('admin defaults include the confirmed cafe without assigning the example board to any member',async()=>{
  const h=harness(),r=await h.invoke('/api/admin/naver','GET',{},'admin');
  assert.equal(r.data.cafe.clubId,'31811778');assert.equal(r.data.cafe.url,target.cafeUrl);
  assert.ok(r.data.members.every(m=>m.board.menuId===''&&m.board.approvedConnectionId===''));
  assert.deepEqual(r.data.publications,[]);
  for(const method of ['GET','PUT'])await assert.rejects(h.invoke('/api/admin/naver',method,h.settings()),e=>e.status===403);
  assert.equal((await h.invoke('/api/elsewhere')).matched,false);
});

test('admin saves every member with current connection approval, rejects malformed mappings and revision conflicts',async()=>{
  const h=harness();
  const cases=[body=>body.boards.pop(),body=>body.boards[1].memberId='unknown',body=>body.boards[1].memberId='u01',body=>body.boards[1].menuId='7',body=>body.boards[0].menuId='7/../../escape',body=>body.boards[0].approvedConnectionId='connection-2',body=>body.cafe.url='https://cafe.naver.com.evil.invalid/mycaffelatte',body=>body.cafe.url='https://cafe.naver.com/mycaffelatte?redirect=evil',body=>body.cafe.clubId='31811778/path',body=>body.programStartDate='2026-02-30'];
  for(const mutate of cases){const body=h.settings();mutate(body);await assert.rejects(h.invoke('/api/admin/naver','PUT',body,'admin'),e=>e.status===422);}
  const body=h.settings();body.programStartDate='2026-05-01';
  const r=await h.invoke('/api/admin/naver','PUT',body,'admin');
  assert.equal(r.data.revision,1);assert.equal(r.data.members[0].board.approvedConnectionId,'connection-1');assert.equal(h.store.program.endDate,'2026-06-25');
  await assert.rejects(h.invoke('/api/admin/naver','PUT',body,'admin'),e=>e.status===409);
  h.connections.u01={...h.connections.u01,needsReconnect:true};await assert.rejects(h.invoke('/api/admin/naver','PUT',h.settings(),'admin'),e=>e.status===422);
});

test('preview uses only saved own current team/program meals, escapes text, and excludes private personal data',async()=>{
  const h=harness();await h.setup();const p=await h.preview();
  assert.equal(p.title,'5.10일 존다 20일차');assert.equal(p.readyToPublish,true);assert.equal(p.connection.displayName,'김민준');assert.deepEqual(p.target,target);
  assert.deepEqual(p.summary.totals,{carbs:5,protein:5.5,fat:1});assert.equal(p.summary.photoCount,2);assert.equal(p.summary.completeMeals,2);
  assert.equal(p.draft.title,p.title);assert.deepEqual(p.draft.summary,p.summary);assert.equal(p.draft.name,'김민준');assert.equal(p.draft.meals[0].photos.length,2);assert.doesNotMatch(JSON.stringify(p.draft),/OTHER |PRIVATE WEIGHT|fixture-access-token/);
  assert.match(p.bodyHtml,/&lt;script&gt;unsafe/);assert.doesNotMatch(p.bodyHtml,/<script>|OTHER |PRIVATE WEIGHT/);
  assert.equal((p.bodyHtml.match(/<img /g)||[]).length,2);assert.match(p.bodyHtml,new RegExp(A));assert.match(p.bodyHtml,new RegExp(B));
  await assert.rejects(h.invoke('/api/naver/preview','POST',{date:DATE,bodyHtml:'<img src="foreign">',memberId:'u02'}),e=>e.status===422);
  await assert.rejects(h.invoke('/api/naver/preview','POST',{date:DATE},'admin'),e=>e.status===403);
  const empty=await h.preview({date:'2026-05-01'});assert.equal(empty.readyToPublish,false);assert.match(empty.reasons.join(' '),/저장/);
});

test('publishing is blocked until configuration, own connection, board and current approval exist',async()=>{
  for(const kind of ['configuration','connection','reconnect','board','approval','team']){
    const h=harness();await h.setup();
    if(kind==='configuration')h.configuration={ready:false,missing:['NAVER_CLIENT_ID']};
    if(kind==='connection')h.connections.u01.connected=false;
    if(kind==='reconnect')h.connections.u01.needsReconnect=true;
    if(kind==='board')h.store.naverCafe.boards.u01.menuId='';
    if(kind==='approval')h.store.naverCafe.boards.u01.approvedConnectionId='old-connection';
    if(kind==='team')h.store.members[0].teamId=null;
    const p=await h.preview();assert.equal(p.readyToPublish,false,kind);await assert.rejects(h.publish(p),e=>e.status===403);assert.equal(h.calls.length,0);
  }
});

test('publish binds the exact preview to saved meals, destination, program, connection, and title',async()=>{
  for(const mutate of [h=>h.store.mealPosts[0].version++,h=>h.store.naverCafe.boards.u01.menuId='9',h=>h.store.program.startDate='2026-04-22',h=>{h.connections.u01.connectionId='replacement';h.store.naverCafe.boards.u01.approvedConnectionId='replacement';}]){
    const h=harness();await h.setup();const p=await h.preview();mutate(h);
    await assert.rejects(h.publish(p),e=>e.status===409);assert.equal(h.calls.length,0);
  }
  const h=harness();await h.setup();const p=await h.preview();
  await assert.rejects(h.publish({...p,title:'unreviewed title'}),e=>e.status===409);
  await assert.rejects(h.invoke('/api/naver/publish','POST',{date:DATE,title:p.title,previewVersion:p.previewVersion,confirmed:false}),e=>e.status===422);
  await assert.rejects(h.invoke('/api/naver/publish','POST',{date:DATE,title:p.title,previewVersion:p.previewVersion,confirmed:true,imageIds:[C]}),e=>e.status===422);
});

test('refresh and photo loading rebase unrelated changes and reject changed meal snapshots before external posting',async()=>{
  const h=harness();await h.setup();const p=await h.preview();
  h.tokenHook=async()=>{h.store={...h.store,authMarker:'refreshed'};};
  h.photoHook=async()=>{h.store={...h.store,concurrentUnrelated:'preserved'};return{buffer:Buffer.from('image'),mime:'image/jpeg'};};
  await h.publish(p);assert.equal(h.store.authMarker,'refreshed');assert.equal(h.store.concurrentUnrelated,'preserved');
  for(const stage of ['token','photos']){
    const changed=harness();await changed.setup();const draft=await changed.preview();
    const mutate=()=>{changed.store={...changed.store,mealPosts:changed.store.mealPosts.map(p=>({...p,version:2}))};};
    if(stage==='token')changed.tokenHook=async()=>mutate();else changed.photoHook=async()=>{mutate();return{buffer:Buffer.from('image'),mime:'image/png'};};
    await assert.rejects(changed.publish(draft),e=>e.status===409);assert.equal(changed.calls.length,0);assert.equal(changed.store.naverPublications,undefined);
  }
});

test('multipart posting sends all own photos, UTF-8 text and member-only privacy then returns a validated article link',async()=>{
  const h=harness();await h.setup();const p=await h.preview({title:'5.10일 존다 20일차 & 식단'});const result=await h.publish(p);
  assert.equal(result.data.publication.status,'published');assert.equal(result.data.publication.articleUrl,'https://cafe.naver.com/mycaffelatte/123');
  assert.equal(h.calls[0].url,'https://openapi.naver.com/v1/cafe/31811778/menu/7/articles');
  const options=h.calls[0].options,form=options.body;
  assert.equal(options.headers.Authorization,'Bearer fixture-access-token');assert.equal(options.redirect,'error');assert.equal(decodeURIComponent(form.get('subject')),p.title);
  const html=decodeURIComponent(form.get('content'));assert.match(html,/src="#0"/);assert.match(html,/src="#1"/);assert.doesNotMatch(html,/\/api\/media|OTHER |PRIVATE WEIGHT|fixture-access-token/);
  assert.equal(form.getAll('image').length,2);assert.equal(form.get('openyn'),'false');assert.equal(form.get('searchopen'),'false');assert.equal(form.get('scrapyn'),'false');
  assert.deepEqual(h.photos,[{id:A,userId:'u01'},{id:B,userId:'u01'}]);assert.doesNotMatch(JSON.stringify(result),/fixture-access-token|attemptId|connectionId/);
  const repeated=await h.publish(p);assert.deepEqual(repeated.data,result.data);assert.equal(h.calls.length,1);
  const admin=(await h.invoke('/api/admin/naver','GET',{},'admin')).data;assert.equal(admin.publications[0].memberName,'김민준');assert.equal(admin.publications[0].status,'published');
});

test('double-click publication creates one durable pending lock and only one external request',async()=>{
  const h=harness();await h.setup();const p=await h.preview();let release,entered;
  const wait=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  h.fetchHook=async()=>{entered();await wait;return publicationResponse();};
  const first=h.publish(p);await started;
  assert.equal(h.store.naverPublications[KEY].status,'pending');await assert.rejects(h.publish(p),e=>e.status===409);
  await assert.rejects(h.invoke('/api/admin/naver','PUT',h.settings(),'admin'),e=>e.status===409);
  release();await first;assert.equal(h.calls.length,1);
});

test('photo ownership is checked before a publication lock or external request',async()=>{
  const h=harness();await h.setup();h.store.mealPosts[0].mediaIds=[C];const p=await h.preview();
  await assert.rejects(h.publish(p),e=>e.status===403);assert.equal(h.store.naverPublications,undefined);assert.equal(h.calls.length,0);assert.deepEqual(h.photos,[{id:C,userId:'u01'}]);
});

test('all 18 photos are sent without truncation and image loading is bounded to three at once',async()=>{
  const h=harness();await h.setup();const ids=Array.from({length:18},(_,i)=>(i+1).toString(16).padStart(32,'0'));
  h.store.mealPosts=['breakfast','lunch','dinner'].map((meal,i)=>({id:'meal-'+meal,memberId:'u01',teamId:'t1',date:DATE,meal,mediaIds:ids.slice(i*6,i*6+6),blocks:{carbs:3,protein:3,fat:3}}));
  let active=0,max=0;h.photoHook=async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));active--;return{buffer:Buffer.from('photo'),mime:'image/png'};};
  await h.publish(await h.preview());assert.equal(h.calls[0].options.body.getAll('image').length,18);assert.equal(max,3);
  const extra=harness();await extra.setup();extra.store.mealPosts[0].mediaIds=Array(19).fill(A);await assert.rejects(extra.publish(await extra.preview()),e=>e.status===422);assert.equal(extra.calls.length,0);
});

test('ambiguous network, provider 5xx, spam-folder success and untrusted success links prevent retry',async()=>{
  const responses=[async()=>{throw new Error('private upstream failure fixture-access-token');},async()=>Response.json({message:{status:'500',error:{code:'SE001',message:'private-error'}}},{status:500}),async()=>Response.json({message:{status:'500',error:{code:'AP005',message:'spam saved'}}}),async()=>Response.json({message:{status:'200',result:{articleId:123,articleUrl:'https://evil.invalid/123'}}}),async()=>Response.json({message:{status:'200',result:{articleId:123,articleUrl:'https://cafe.naver.com/othercafe/123'}}})];
  for(const response of responses){
    const h=harness();await h.setup();const p=await h.preview();h.fetchHook=response;
    await assert.rejects(h.publish(p),e=>e.status===409&&!/private|fixture-access-token/.test(e.message));assert.equal(h.store.naverPublications[KEY].status,'unknown');
    await assert.rejects(h.publish(await h.preview()),e=>e.status===409);assert.equal(h.calls.length,1);
  }
});

test('definitive provider rejection permits a reviewed explicit retry',async()=>{
  const h=harness();await h.setup();h.fetchHook=async()=>Response.json({message:{status:'500',error:{code:'AP003',message:'private forbidden'}}},{status:403});
  await assert.rejects(h.publish(await h.preview()),e=>e.status===422&&!e.message.includes('private'));assert.equal(h.store.naverPublications[KEY].status,'failed');
  const p=await h.preview();assert.equal(p.readyToPublish,true);h.fetchHook=null;await h.publish(p);assert.equal(h.calls.length,2);assert.equal(h.store.naverPublications[KEY].status,'published');
});

test('failed pending persistence never posts; failed success persistence keeps the durable lock against duplicates',async()=>{
  const failed=harness();await failed.setup();failed.commitHook=async()=>{throw new ApiError(409,'fixture CAS failure');};
  await assert.rejects(failed.publish(await failed.preview()),e=>e.status===409);assert.equal(failed.calls.length,0);
  const h=harness();await h.setup();const p=await h.preview();h.commitHook=async next=>{if(next.naverPublications?.[KEY]?.status==='published')throw new ApiError(409,'fixture metadata CAS failure');};
  await assert.rejects(h.publish(p),e=>e.status===409&&e.message.includes('네이버에는 게시'));assert.equal(h.store.naverPublications[KEY].status,'pending');
  await assert.rejects(h.publish(p),e=>e.status===409);assert.equal(h.calls.length,1);
});

test('pending commit checks the current preview again before external posting',async()=>{
  const h=harness();await h.setup();const p=await h.preview();
  h.commitHook=async next=>{if(next.naverPublications?.[KEY]?.status==='pending')next.mealPosts=next.mealPosts.map(p=>({...p,version:100}));};
  await assert.rejects(h.publish(p),e=>e.status===409);assert.equal(h.calls.length,0);assert.equal(h.store.naverPublications[KEY].status,'failed');
  const revoked=harness();await revoked.setup();const ready=await revoked.preview();
  revoked.commitHook=async next=>{if(next.naverPublications?.[KEY]?.status==='pending')revoked.connections.u01.needsReconnect=true;};
  await assert.rejects(revoked.publish(ready),e=>e.status===409);assert.equal(revoked.calls.length,0);assert.equal(revoked.store.naverPublications[KEY].status,'failed');
});

test('admin reconciliation requires manual confirmation and a matching cafe link, waits for in-flight requests',async()=>{
  const h=harness();await h.setup();const now=new Date().toISOString();h.store.naverPublications={[KEY]:{memberId:'u01',programId:'program-1',date:DATE,title:'식단',status:'pending',attemptId:'attempt',target,createdAt:now,updatedAt:now}};
  const body={memberId:'u01',date:DATE,articleUrl:'https://cafe.naver.com/mycaffelatte/124',confirmed:true};
  await assert.rejects(h.invoke('/api/admin/naver/reconcile','POST',body),e=>e.status===403);
  await assert.rejects(h.invoke('/api/admin/naver/reconcile','POST',body,'admin'),e=>e.status===409);
  h.store.naverPublications[KEY].createdAt=new Date(Date.now()-121_000).toISOString();
  await assert.rejects(h.invoke('/api/admin/naver','PUT',h.settings(),'admin'),e=>e.status===409);
  for(const address of ['https://cafe.naver.com/other/124','javascript:alert(1)','https://cafe.naver.com.evil.test/mycaffelatte/124','https://cafe.naver.com/f-e/cafes/999/menus/7'])await assert.rejects(h.invoke('/api/admin/naver/reconcile','POST',{...body,articleUrl:address},'admin'),e=>e.status===422);
  await assert.rejects(h.invoke('/api/admin/naver/reconcile','POST',{...body,confirmed:false},'admin'),e=>e.status===422);
  const r=await h.invoke('/api/admin/naver/reconcile','POST',{...body,articleUrl:'https://cafe.naver.com/f-e/cafes/31811778/articles/124?referrer=menu'},'admin');
  assert.equal(r.data.publication.status,'published');assert.equal(r.data.publication.manual,true);assert.equal(r.data.publication.articleUrl,body.articleUrl);assert.equal(h.calls.length,0);
  await h.invoke('/api/admin/naver','PUT',h.settings(),'admin');
});

test('only a delayed explicit admin verification of no post can unlock an ambiguous attempt for member retry',async()=>{
  for(const status of ['pending','unknown']){
    const h=harness();await h.setup();const now=new Date().toISOString();
    h.store.naverPublications={[KEY]:{memberId:'u01',programId:'program-1',date:DATE,title:'식단',status,attemptId:'attempt',target,createdAt:now,updatedAt:now}};
    const body={memberId:'u01',date:DATE,outcome:'not_published',confirmed:true};
    await assert.rejects(h.invoke('/api/admin/naver/reconcile','POST',body),e=>e.status===403);
    await assert.rejects(h.invoke('/api/admin/naver/reconcile','POST',body,'admin'),e=>e.status===409);
    await assert.rejects(h.publish(await h.preview()),e=>e.status===409);assert.equal(h.calls.length,0);
    h.store.naverPublications[KEY].createdAt=new Date(Date.now()-121_000).toISOString();
    await assert.rejects(h.invoke('/api/admin/naver/reconcile','POST',{...body,confirmed:false},'admin'),e=>e.status===422);
    const reconciled=await h.invoke('/api/admin/naver/reconcile','POST',body,'admin');
    assert.equal(reconciled.data.publication.status,'failed');assert.equal(reconciled.data.publication.manual,true);assert.equal(reconciled.data.publication.articleUrl,null);assert.equal(h.calls.length,0);
    const p=await h.preview();assert.equal(p.readyToPublish,true);await h.publish(p);assert.equal(h.calls.length,1);assert.equal(h.store.naverPublications[KEY].status,'published');
  }
});
