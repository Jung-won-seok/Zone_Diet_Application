const test=require('node:test');
const assert=require('node:assert/strict');
const {createNaverOnboarding}=require('../naver-onboarding');
const {createNaverCafe}=require('../naver-cafe');
class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
const CAFE={clubId:'31811778',url:'https://cafe.naver.com/mycaffelatte',name:'mycaffelatte'};
const PUBLIC_CONNECTION=r=>({connected:Boolean(r?.encryptedTokens),displayName:r?.displayName||'',connectionId:r?.connectionId||null,connectedAt:r?.connectedAt||null,needsReconnect:Boolean(r?.needsReconnect)});
function fixture() {
  let store={program:{id:'cohort-1',startDate:'2026-11-09',endDate:'2027-01-03'},users:[{id:'admin',name:'관리자',isAdmin:true},{id:'u01',name:'김민준',username:'member01'},{id:'u02',name:'이서연',username:'member02'}],members:[{id:'u01',teamId:'t1'},{id:'u02',teamId:'t1'}],personal:{u01:{settings:{name:'김민준'},records:{}},u02:{settings:{name:'나만의 별명'},records:{}}},personalRevisions:{u01:2,u02:4},naverApplicants:{na_one:{id:'na_one',providerIdHash:'PRIVATE_PROVIDER_HASH',appHash:'APP_HASH',connectionId:'connection-one',displayName:'네이버 민준',encryptedTokens:'PRIVATE_ENCRYPTED_TOKENS',expiresAt:Date.now()+3600000,connectedAt:new Date().toISOString(),memberId:null}}};
  const commits=[],approvals=[];let failCommit=false;
  const auth={configuration:()=>({ready:true,missing:[]}),publicApplicant:id=>PUBLIC_CONNECTION(store.naverApplicants?.[id]),publicConnection:id=>PUBLIC_CONNECTION(store.naverConnections?.[id]),approvalConnection:(applicantId,memberId,id)=>{
    approvals.push({applicantId,memberId,id});const a=store.naverApplicants[applicantId];
    return {providerIdHash:a.providerIdHash,appHash:a.appHash,connectionId:id,displayName:a.displayName,connectedAt:a.connectedAt,encryptedTokens:'RE_ENCRYPTED_MEMBER_TOKENS',expiresAt:a.expiresAt};
  }};
  const commit=async next=>{if(failCommit)throw new ApiError(409,'store conflict');commits.push(next);store=next;};
  const service=createNaverOnboarding({getStore:()=>store,commit,ApiError,auth});
  const sessions={applicant:()=>({user:{id:'na_one',name:'네이버 민준',pendingApproval:true,isAdmin:false},originUserId:'na_one'}),admin:()=>({user:store.users[0]}),member:()=>({user:store.users[1]})};
  async function invoke(path,method='GET',body={},identity='applicant',override) {
    const res={};const matched=await service.handle({method},res,override||sessions[identity](),new URL(path,'http://localhost'),async()=>body,(_res,status,data)=>Object.assign(res,{status,data}));return {...res,matched};
  }
  const submit=(body={})=>invoke('/api/naver/link-request','POST',{name:'김민준',cafeNickname:'민준카페',requestedBoardName:'2026년 2기 김민준',note:'1팀입니다.',consent:true,expectedVersion:0,...body});
  const review=(request,body={})=>invoke('/api/admin/naver/request-review','POST',{requestId:request.id,expectedVersion:request.version,decision:'approve',memberId:'u01',menuId:'7',label:'김민준 게시판',confirmed:true,...body},'admin');
  return {service,invoke,submit,review,auth,commit,commits,approvals,get store(){return store;},set store(v){store=v;},set failCommit(v){failCommit=v;}};
}

test('signed-in applicants see only their own redacted cafe request and must explicitly consent',async()=>{
  const h=fixture(),s=(await h.invoke('/api/naver/onboarding')).data;
  assert.deepEqual(s.cafe,CAFE);assert.equal(s.approved,false);assert.equal(s.needsRequest,true);assert.equal(s.request,null);
  assert.doesNotMatch(JSON.stringify(s),/PRIVATE_|APP_HASH|expiresAt/);
  await assert.rejects(h.submit({consent:false}),e=>e.status===422);assert.equal(h.commits.length,0);
  await assert.rejects(h.submit({memberId:'u02'}),e=>e.status===422);
  await assert.rejects(h.submit({name:''}),e=>e.status===422);await assert.rejects(h.submit({cafeNickname:'x'.repeat(41)}),e=>e.status===422);
  await assert.rejects(h.submit({note:false}),e=>e.status===422);await assert.rejects(h.submit({name:'김\n민준'}),e=>e.status===422);
  await assert.rejects(h.invoke('/api/naver/onboarding','GET',{},'admin'),e=>e.status===403);
  const multiline=(await h.submit({note:'1팀입니다.\n오후 수업 참여'})).data;assert.equal(multiline.request.note,'1팀입니다.\n오후 수업 참여');
});

test('one versioned request reaches the admin queue; stale double clicks and review snapshots fail',async()=>{
  const h=fixture(),first=(await h.submit()).data;
  assert.equal(first.request.status,'pending');assert.equal(first.request.version,1);assert.equal(first.needsRequest,false);
  await assert.rejects(h.submit(),e=>e.status===409);
  const same=(await h.submit({expectedVersion:1})).data;assert.equal(same.request.version,1);assert.equal(h.commits.length,1);
  const updated=(await h.submit({expectedVersion:1,note:'수정된 요청'})).data;assert.equal(updated.request.version,2);
  await assert.rejects(h.review(first.request),e=>e.status===409);
  const admin=(await h.invoke('/api/admin/naver/requests','GET',{},'admin')).data;
  assert.equal(admin.requests.length,1);assert.equal(admin.requests[0].naverName,'네이버 민준');assert.equal(admin.requests[0].stale,false);assert.equal(admin.members.length,2);
  assert.doesNotMatch(JSON.stringify(admin),/PRIVATE_|APP_HASH|RE_ENCRYPTED/);
});

test('only admin can map a consented current request to a free member and unique board',async()=>{
  const h=fixture(),request=(await h.submit()).data.request;
  await assert.rejects(h.invoke('/api/admin/naver/requests'),e=>e.status===403);
  await assert.rejects(h.invoke('/api/admin/naver/request-review','POST',{requestId:request.id,expectedVersion:1,decision:'approve',confirmed:true}),e=>e.status===403);
  for(const body of [{confirmed:false},{memberId:'admin'},{menuId:'7/path'},{label:''},{requestId:'missing'}])await assert.rejects(h.review(request,body),e=>[409,422].includes(e.status));
  h.store={...h.store,naverConnections:{u01:{connectionId:'occupied',encryptedTokens:'PRIVATE_OTHER'}}};
  await assert.rejects(h.review(request),e=>e.status===409);delete h.store.naverConnections.u01;
  h.store.naverCafe={revision:0,cafe:CAFE,boards:{u02:{menuId:'7',label:'다른 회원'}}};await assert.rejects(h.review(request),e=>e.status===409);
  h.store.naverCafe.boards={};h.store.naverConnections.u02={providerIdHash:'PRIVATE_PROVIDER_HASH',appHash:'APP_HASH',connectionId:'other',encryptedTokens:'PRIVATE_OTHER'};
  await assert.rejects(h.review(request),e=>e.status===409);assert.equal(h.approvals.length,0);
});

test('approval transfers encrypted connection atomically and the original applicant session resolves its approved state',async()=>{
  const h=fixture(),request=(await h.submit()).data.request;
  const result=await h.review(request,{memberName:'김실제'});
  assert.equal(result.data.requests[0].status,'approved');assert.equal(result.data.requests[0].memberId,'u01');
  assert.equal(h.store.naverConnections.u01.encryptedTokens,'RE_ENCRYPTED_MEMBER_TOKENS');assert.equal(h.store.naverApplicants.na_one.encryptedTokens,undefined);assert.equal(h.store.naverApplicants.na_one.memberId,'u01');
  assert.equal(h.store.naverCafe.boards.u01.approvedConnectionId,'connection-one');assert.equal(h.store.naverCafe.boards.u01.menuId,'7');assert.equal(h.store.naverCafe.revision,1);
  assert.equal(h.store.users[1].name,'김실제');assert.equal(h.store.personal.u01.settings.name,'김실제');assert.equal(h.store.personalRevisions.u01,3);
  const resolved={user:h.store.users[1],originUserId:'na_one'};
  const s=(await h.invoke('/api/naver/onboarding','GET',{},'member',resolved)).data;assert.equal(s.approved,true);assert.equal(s.request.id,request.id);assert.equal(s.request.stale,false);assert.equal(s.needsRequest,false);
  const normal=(await h.invoke('/api/naver/onboarding','GET',{},'member')).data;assert.equal(normal.request.id,request.id);assert.equal(normal.approved,true);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|APP_HASH|RE_ENCRYPTED|reviewedBy/);
  await assert.rejects(h.review(request),e=>e.status===409);
});

test('explicit member rename preserves a custom nickname and omitting it preserves the app name',async()=>{
  const h=fixture(),r=(await h.submit()).data.request;await h.review(r,{memberId:'u02',memberName:'새 이름'});
  assert.equal(h.store.users[2].name,'새 이름');assert.equal(h.store.personal.u02.settings.name,'나만의 별명');assert.equal(h.store.personalRevisions.u02,4);
  const noName=fixture(),q=(await noName.submit({name:'요청 이름'})).data.request;await noName.review(q);assert.equal(noName.store.users[1].name,'김민준');
});

test('approval fails closed for changed cafe, cohort, connection, or active publication',async()=>{
  for(const mutate of [h=>{h.store.naverCafe={revision:0,cafe:{...CAFE,clubId:'99'},boards:{}};},h=>{h.store.program.id='new-cohort';},h=>{h.store.naverApplicants.na_one.connectionId='new-connection';},h=>{h.store.naverApplicants.na_one.needsReconnect=true;},h=>{h.store.naverPublications={p:{status:'pending'}};}]) {
    const h=fixture(),request=(await h.submit()).data.request;mutate(h);await assert.rejects(h.review(request),e=>e.status===409);assert.equal(h.store.naverConnections,undefined);
  }
});

test('rejection is visible to its requester and requires a new explicit consent before approval',async()=>{
  const h=fixture(),request=(await h.submit()).data.request;
  await h.review(request,{decision:'reject',reason:'카페 닉네임을 다시 확인해주세요.'});
  const rejected=(await h.invoke('/api/naver/onboarding')).data;assert.equal(rejected.request.status,'rejected');assert.equal(rejected.needsRequest,true);assert.equal(rejected.request.reason,'카페 닉네임을 다시 확인해주세요.');
  await assert.rejects(h.review(rejected.request),e=>e.status===409);
  await assert.rejects(h.submit({expectedVersion:2,consent:false}),e=>e.status===422);
  const second=(await h.submit({expectedVersion:2,cafeNickname:'정정 닉네임'})).data;assert.equal(second.request.status,'pending');assert.equal(second.request.version,3);assert.equal(second.request.reason,'');await h.review(second.request);
});

test('legacy member requests cannot be remapped to another app member',async()=>{
  const h=fixture();h.store.naverConnections={u01:{...h.store.naverApplicants.na_one,connectionId:'member-connection'}};delete h.store.naverApplicants.na_one;
  const r=(await h.invoke('/api/naver/link-request','POST',{name:'김민준',cafeNickname:'민준',requestedBoardName:'김민준',note:'',expectedVersion:0,consent:true},'member')).data.request;
  assert.equal(r.memberId,'u01');await assert.rejects(h.review(r,{memberId:'u02'}),e=>e.status===409);await h.review(r);assert.equal(h.approvals.length,0);assert.equal(h.store.naverCafe.boards.u01.approvedConnectionId,'member-connection');
});

test('storage conflicts never leave a partial mapping or lose applicant tokens',async()=>{
  const h=fixture(),r=(await h.submit()).data.request,original=h.store;h.failCommit=true;
  await assert.rejects(h.review(r),e=>e.status===409);assert.equal(h.store,original);assert.equal(h.store.naverApplicants.na_one.memberId,null);assert.equal(h.store.naverConnections,undefined);assert.equal(h.store.naverCafeRequests.na_one.status,'pending');
});

test('legacy settings cannot approve a connection before consent, but retains preexisting approvals',async()=>{
  const h=fixture();h.store.naverConnections={u01:{...h.store.naverApplicants.na_one}};const cafe=createNaverCafe({getStore:()=>h.store,commit:h.commit,ApiError,auth:h.auth,readPhoto:async()=>{}});
  async function save(body){return cafe.handle({method:'PUT'},{},{user:h.store.users[0]},new URL('/api/admin/naver','http://localhost'),async()=>body,()=>{});}
  const body={revision:0,cafe:CAFE,programStartDate:h.store.program.startDate,boards:[{memberId:'u01',menuId:'7',label:'김민준',approvedConnectionId:'connection-one'},{memberId:'u02',menuId:'',label:'',approvedConnectionId:''}]};
  await assert.rejects(save(body),e=>e.status===422 && /신청/.test(e.message));
  h.store.naverCafe={revision:0,cafe:CAFE,boards:{u01:{menuId:'7',label:'김민준',approvedConnectionId:'connection-one'}}};await save(body);assert.equal(h.store.naverCafe.revision,1);
  const changed={...body,revision:1,cafe:{...CAFE,clubId:'99',url:'https://cafe.naver.com/another'}};await assert.rejects(save(changed),e=>e.status===422);
});
