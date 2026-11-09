const crypto = require('node:crypto');
const DEFAULT_CAFE = {clubId:'31811778',url:'https://cafe.naver.com/mycaffelatte',name:'mycaffelatte'};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function createNaverOnboarding({getStore,commit,ApiError,auth}) {
  const assert = (ok,message,status=422) => {if(!ok)throw new ApiError(status,message);};
  const configOf = store => store.naverCafe || {revision:0,cafe:{...DEFAULT_CAFE},boards:{}};
  const requestsOf = store => store.naverCafeRequests || {};
  const publicConnection = record => ({connected:Boolean(record?.connectionId && record.encryptedTokens),displayName:record?.displayName||'',connectedAt:record?.connectedAt||null,connectionId:record?.connectionId||null,needsReconnect:Boolean(record?.needsReconnect)});
  const text = (value,max,label,required=false,multiline=false) => {
    const controls=multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/;
    assert(typeof value==='string' && value.length<=max && !controls.test(value),`${label}을 확인해주세요.`);
    const result=value.trim();assert(!required || result.length>0,`${label}을 입력해주세요.`);return result;
  };
  function context(session,store=getStore()) {
    assert(session?.user && !session.user.isAdmin,'회원 계정에서 본인의 카페 연결을 신청해주세요.',403);
    const user=session.user;
    if(user.pendingApproval) {
      const applicant=store.naverApplicants?.[user.id];
      assert(applicant && !applicant.memberId,'네이버 로그인 상태가 변경되었습니다. 다시 로그인해주세요.',401);
      const connection=auth.publicApplicant?auth.publicApplicant(user.id):publicConnection(applicant);
      return {requesterId:user.id,memberId:null,applicant,connection};
    }
    assert(store.members.some(m=>m.id===user.id),'연결할 회원 정보를 찾지 못했습니다.',403);
    const connection=auth.publicConnection(user.id), record=store.naverConnections?.[user.id];
    const matches=a=>a && a.memberId===user.id && a.connectionId===connection.connectionId && a.providerIdHash===record?.providerIdHash && a.appHash===record?.appHash;
    const original=store.naverApplicants?.[session.originUserId];
    const applicant=matches(original)?original:Object.values(store.naverApplicants||{}).find(matches);
    return {requesterId:applicant?.id||user.id,memberId:user.id,applicant:applicant||null,connection};
  }
  function isCurrent(request,store,connection) {
    const cafe=configOf(store).cafe;
    return Boolean(request && connection?.connected && !connection.needsReconnect && request.connectionId===connection.connectionId && request.programId===store.program.id && request.clubId===cafe.clubId && request.cafeUrl===cafe.url);
  }
  function publicRequest(request,store=getStore(),connection) {
    if(!request)return null;
    return {id:request.id,requesterId:request.requesterId,memberId:request.memberId||null,name:request.name,cafeNickname:request.cafeNickname,requestedBoardName:request.requestedBoardName,note:request.note,status:request.status,version:request.version,createdAt:request.createdAt,updatedAt:request.updatedAt,reviewedAt:request.reviewedAt||null,reason:request.reason||'',menuId:request.menuId||'',label:request.label||'',clubId:request.clubId,cafeUrl:request.cafeUrl,programId:request.programId,stale:!isCurrent(request,store,connection)};
  }
  function state(session) {
    const store=getStore(), info=context(session,store), config=configOf(store), request=requestsOf(store)[info.requesterId];
    const board=info.memberId?config.boards?.[info.memberId]:null;
    const approved=Boolean(info.memberId && info.connection.connected && !info.connection.needsReconnect && board?.menuId && board.approvedConnectionId===info.connection.connectionId);
    return {cafe:{...config.cafe},configuration:auth.configuration(),connection:info.connection,request:publicRequest(request,store,info.connection),approved,needsRequest:Boolean(info.connection.connected && !info.connection.needsReconnect && !approved && !(request?.status==='pending' && isCurrent(request,store,info.connection))),board:board?{menuId:board.menuId||'',label:board.label||''}:null};
  }
  function requestConnection(request,store) {
    if(request.memberId)return auth.publicConnection(request.memberId);
    const applicant=store.naverApplicants?.[request.requesterId];
    return auth.publicApplicant?auth.publicApplicant(request.requesterId):publicConnection(applicant);
  }
  function adminRequests() {
    const store=getStore(), cafe=configOf(store).cafe;
    return {cafe:{...cafe},configuration:auth.configuration(),requests:Object.values(requestsOf(store)).sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1)||(b.updatedAt||b.createdAt).localeCompare(a.updatedAt||a.createdAt)).slice(0,200).map(request=>{
      const connection=requestConnection(request,store);
      return {...publicRequest(request,store,connection),naverName:connection.displayName,connection};
    }),members:store.members.map(member=>{
      const user=store.users.find(u=>u.id===member.id);
      return {id:member.id,name:user.name,username:user.username,hasConnection:Boolean(store.naverConnections?.[member.id])};
    })};
  }
  async function submit(session,body) {
    assert(object(body) && Object.keys(body).every(k=>['name','cafeNickname','requestedBoardName','note','consent','expectedVersion'].includes(k)) && body.consent===true,'카페 연결에 동의한 뒤 신청해주세요.');
    assert(Number.isInteger(body.expectedVersion) && body.expectedVersion>=0,'신청 정보를 새로 불러온 뒤 다시 확인해주세요.');
    const store=getStore(), info=context(session,store), config=configOf(store), previous=requestsOf(store)[info.requesterId];
    assert(auth.configuration().ready && info.connection.connected && !info.connection.needsReconnect,'본인의 네이버 계정으로 먼저 로그인해주세요.',409);
    assert(body.expectedVersion===(previous?.version||0),'연결 신청이 다른 창에서 변경됐어요. 최신 상태를 확인해주세요.',409);
    const board=info.memberId?config.boards?.[info.memberId]:null;
    assert(!board?.approvedConnectionId || board.approvedConnectionId!==info.connection.connectionId,'이미 카페 게시판이 연결되었습니다.',409);
    const fields={name:text(body.name,30,'회원 이름',true),cafeNickname:text(body.cafeNickname,40,'카페 닉네임',true),requestedBoardName:text(body.requestedBoardName??'',80,'요청 게시판 이름'),note:text(body.note??'',500,'요청 메모',false,true)};
    if(previous?.status==='pending' && isCurrent(previous,store,info.connection) && Object.entries(fields).every(([key,value])=>previous[key]===value))return state(session);
    const now=new Date().toISOString();
    const request={id:previous?.id||crypto.randomUUID(),requesterId:info.requesterId,memberId:info.memberId,connectionId:info.connection.connectionId,programId:store.program.id,clubId:config.cafe.clubId,cafeUrl:config.cafe.url,...fields,status:'pending',version:(previous?.version||0)+1,createdAt:previous?.createdAt||now,updatedAt:now,consentedAt:now,reviewedAt:null,reason:'',menuId:'',label:''};
    await commit({...store,naverCafeRequests:{...requestsOf(store),[info.requesterId]:request}});
    return state(session);
  }
  async function review(session,body) {
    assert(session?.user?.isAdmin,'관리자만 연결 신청을 처리할 수 있습니다.',403);
    assert(object(body) && Object.keys(body).every(k=>['requestId','expectedVersion','decision','memberId','memberName','menuId','label','confirmed','reason'].includes(k)) && body.confirmed===true,'회원과 카페 게시판을 직접 확인한 뒤 처리해주세요.');
    assert(typeof body.requestId==='string' && Number.isInteger(body.expectedVersion) && ['approve','reject'].includes(body.decision),'연결 신청 처리 내용을 확인해주세요.');
    const store=getStore(), config=configOf(store), request=Object.values(requestsOf(store)).find(r=>r.id===body.requestId);
    assert(request && request.status==='pending' && request.version===body.expectedVersion,'신청이 변경됐거나 이미 처리되었습니다. 새로고침해주세요.',409);
    const now=new Date().toISOString(), reason=text(body.reason??'',300,'처리 메모',false,true);
    if(body.decision==='reject') {
      await commit({...store,naverCafeRequests:{...requestsOf(store),[request.requesterId]:{...request,status:'rejected',version:request.version+1,reviewedAt:now,reviewedBy:session.user.id,updatedAt:now,reason}}});
      return adminRequests();
    }
    assert(!Object.values(store.naverPublications||{}).some(p=>p.status==='pending'),'카페 게시 결과 확인을 마친 뒤 연결 신청을 승인해주세요.',409);
    const connection=requestConnection(request,store);
    assert(auth.configuration().ready && isCurrent(request,store,connection),'네이버 계정이나 카페·프로그램이 변경됐어요. 회원에게 다시 연결을 신청하도록 안내해주세요.',409);
    const memberId=text(body.memberId,100,'앱 회원',true), menuId=text(body.menuId,16,'게시판 번호',true), label=text(body.label,80,'게시판 이름',true);
    assert(/^[1-9]\d{0,15}$/.test(menuId),'게시판 번호는 숫자로 입력해주세요.');
    assert(store.members.some(m=>m.id===memberId),'등록된 앱 회원을 선택해주세요.');
    assert(!request.memberId || request.memberId===memberId,'기존 회원의 요청을 다른 회원 계정에 연결할 수 없습니다.',409);
    assert(!Object.entries(config.boards||{}).some(([id,b])=>id!==memberId && b.menuId===menuId),'이 게시판은 다른 회원에게 배정되어 있습니다.',409);
    let nextConnection, applicants=store.naverApplicants;
    if(request.memberId) {
      nextConnection=store.naverConnections?.[memberId];
      assert(nextConnection && connection.connectionId===request.connectionId,'연결된 네이버 계정을 다시 확인해주세요.',409);
    } else {
      const applicant=store.naverApplicants?.[request.requesterId];
      assert(applicant && !applicant.memberId,'이미 다른 회원 계정에 연결된 신청입니다.',409);
      assert(!store.naverConnections?.[memberId],'선택한 회원은 이미 네이버 계정이 연결되어 있습니다. 다른 계정을 선택하거나 기존 연결을 먼저 해제해주세요.',409);
      assert(!Object.values(store.naverConnections||{}).some(c=>c.providerIdHash===applicant.providerIdHash && c.appHash===applicant.appHash),'이미 다른 회원에게 연결된 네이버 계정입니다.',409);
      nextConnection=auth.approvalConnection(request.requesterId,memberId,request.connectionId);
      assert(nextConnection?.connectionId===request.connectionId,'네이버 계정 연결 정보가 변경되었습니다.',409);
      const mapped={...applicant,memberId,mappedAt:now};delete mapped.encryptedTokens;delete mapped.expiresAt;
      applicants={...store.naverApplicants,[request.requesterId]:mapped};
    }
    let users=store.users,personal=store.personal,personalRevisions=store.personalRevisions;
    if(body.memberName!==undefined) {
      const name=text(body.memberName,30,'앱 회원 이름',true), user=store.users.find(u=>u.id===memberId);
      users=store.users.map(u=>u.id===memberId?{...u,name}:u);
      const entry=store.personal?.[memberId];
      if(entry?.settings && (!entry.settings.name || entry.settings.name===user.name) && entry.settings.name!==name){
        personal={...store.personal,[memberId]:{...entry,settings:{...entry.settings,name}}};
        personalRevisions={...store.personalRevisions,[memberId]:(store.personalRevisions?.[memberId]||0)+1};
      }
    }
    const approved={...request,memberId,menuId,label,status:'approved',version:request.version+1,reviewedAt:now,reviewedBy:session.user.id,updatedAt:now,reason};
    await commit({...store,users,personal,personalRevisions,naverApplicants:applicants,naverConnections:{...store.naverConnections,[memberId]:nextConnection},naverCafe:{...config,revision:config.revision+1,boards:{...config.boards,[memberId]:{menuId,label,approvedConnectionId:nextConnection.connectionId}}},naverCafeRequests:{...requestsOf(store),[request.requesterId]:approved}});
    return adminRequests();
  }
  async function handle(req,res,session,url,readJson,send) {
    if(url.pathname==='/api/naver/onboarding' && req.method==='GET'){send(res,200,state(session));return true;}
    if(url.pathname==='/api/naver/link-request' && req.method==='POST'){send(res,200,await submit(session,await readJson(req)));return true;}
    if(url.pathname==='/api/admin/naver/requests' && req.method==='GET'){assert(session?.user?.isAdmin,'관리자만 연결 신청을 확인할 수 있습니다.',403);send(res,200,adminRequests());return true;}
    if(url.pathname==='/api/admin/naver/request-review' && req.method==='POST'){send(res,200,await review(session,await readJson(req)));return true;}
    return false;
  }
  return {handle,state,adminRequests};
}
module.exports={createNaverOnboarding};
