const crypto = require('node:crypto');
const MealSummary = require('./meal-summary');
const DEFAULT_CAFE = { clubId: '31811778', url: 'https://cafe.naver.com/mycaffelatte', name: 'mycaffelatte' };
const MEALS = ['breakfast', 'lunch', 'dinner'];
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

function createNaverCafe({getStore, commit, ApiError, auth, readPhoto, fetchImpl = fetch}) {
  const assert = (ok, message, status=422) => {if(!ok) throw new ApiError(status,message);};
  const conflict = () => new ApiError(409,'식단이나 카페 연결 정보가 변경됐어요. 미리보기를 다시 확인해주세요.');
  const text = (x,max,label) => {assert(typeof x === 'string' && x.length <= max,`${label}을 확인해주세요.`);return x.trim();};
  function validDate(x) {
    assert(typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x+'T00:00:00Z')) && new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x,'날짜를 확인해주세요.');
    return x;
  }
  const configOf = store => store.naverCafe || {revision:0,cafe:{...DEFAULT_CAFE},boards:{}};
  const recordsOf = store => store.naverPublications || {};
  const boardOf = (config,id) => config.boards?.[id] || {menuId:'',label:'',approvedConnectionId:''};
  const keyFor = (store,id,date) => `${store.program.id}|${id}|${date}`;
  const isActive = publication => publication?.status==='pending' && Date.now()-Date.parse(publication.createdAt)<120_000;
  function publicPublication(p) {
    if(!p)return null;
    return {memberId:p.memberId,date:p.date,title:p.title,status:p.status,target:p.target,articleUrl:p.articleUrl||null,articleId:p.articleId||null,createdAt:p.createdAt,updatedAt:p.updatedAt,message:p.message||'',manual:Boolean(p.manual)};
  }
  function safeCafe(value) {
    assert(object(value),'카페 정보를 확인해주세요.');
    const clubId=text(value.clubId,16,'카페 ID'), name=text(value.name,80,'카페 이름'), address=text(value.url,300,'카페 주소');
    assert(/^[1-9]\d{0,15}$/.test(clubId),'카페 ID는 숫자로 입력해주세요.');
    let u;try{u=new URL(address);}catch{throw new ApiError(422,'카페 주소를 확인해주세요.');}
    assert(u.protocol==='https:' && u.hostname==='cafe.naver.com' && !u.port && !u.username && !u.password && /^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) && !u.search && !u.hash,'https://cafe.naver.com/카페이름 형식의 메인 주소를 입력해주세요.');
    assert(name.length>0,'카페 이름을 입력해주세요.');
    return {clubId,url:u.origin+u.pathname.replace(/\/$/,''),name};
  }
  function articleLink(address,target) {
    let u;try{u=new URL(address);}catch{throw new ApiError(422,'게시된 카페 글 주소를 확인해주세요.');}
    assert(u.origin==='https://cafe.naver.com' && !u.username && !u.password,'네이버 카페의 HTTPS 게시글 주소를 입력해주세요.');
    const slug=new URL(target.cafeUrl).pathname.slice(1);
    let id;
    const old=u.pathname.match(/^\/([^/]+)\/(\d+)\/?$/);
    const modern=u.pathname.match(/^\/(?:ca-fe\/|f-e\/)?cafes\/(\d+)\/articles\/(\d+)\/?$/);
    if(old && old[1]===slug)id=old[2];
    else if(modern && modern[1]===target.clubId)id=modern[2];
    else if(u.pathname==='/ArticleRead.nhn' && u.searchParams.getAll('clubid').length===1 && u.searchParams.get('clubid')===target.clubId && u.searchParams.getAll('articleid').length===1)id=u.searchParams.get('articleid');
    assert(typeof id==='string' && /^[1-9]\d{0,15}$/.test(id),'현재 게시 대상 카페의 글 주소를 입력해주세요.');
    return {articleId:id,articleUrl:`https://cafe.naver.com/${slug}/${id}`};
  }
  function adminState() {
    const store=getStore(), config=configOf(store);
    return {revision:config.revision,cafe:clone(config.cafe),programStartDate:store.program.startDate,programEndDate:store.program.endDate,configuration:auth.configuration(),members:store.members.map(m=>{
      const user=store.users.find(u=>u.id===m.id);
      return {id:m.id,username:user.username,name:user.name,connection:auth.publicConnection(m.id),board:clone(boardOf(config,m.id))};
    }),publications:Object.values(recordsOf(store)).filter(p=>p.programId===store.program.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(p=>({...publicPublication(p),memberName:store.users.find(u=>u.id===p.memberId)?.name||p.memberId}))};
  }
  async function saveSettings(session,body) {
    assert(session.user.isAdmin,'관리자만 카페 연결을 설정할 수 있습니다.',403);
    assert(object(body) && Number.isInteger(body.revision) && Array.isArray(body.boards),'카페 설정 형식을 확인해주세요.');
    const store=getStore(), config=configOf(store);
    assert(body.revision===config.revision,'다른 창에서 카페 설정이 변경됐어요. 새로고침 후 다시 저장해주세요.',409);
    assert(!Object.values(recordsOf(store)).some(p=>p.status==='pending'),'카페 게시 결과 확인이 필요한 회원이 있어요. 게시 확인을 마친 뒤 설정을 변경해주세요.',409);
    const cafe=safeCafe(body.cafe), startDate=validDate(body.programStartDate), boards={};
    assert(body.boards.length===store.members.length,'모든 회원의 게시판 설정을 함께 저장해주세요.');
    const members=new Set(store.members.map(m=>m.id)),seen=new Set(),menus=new Set();
    for(const row of body.boards) {
      assert(object(row) && members.has(row.memberId) && !seen.has(row.memberId),'중복되거나 알 수 없는 회원입니다.');seen.add(row.memberId);
      const menuId=text(row.menuId,16,'게시판 ID'),label=text(row.label,80,'게시판 이름'),approvedConnectionId=text(row.approvedConnectionId,100,'계정 승인 정보');
      assert(!menuId || /^[1-9]\d{0,15}$/.test(menuId),'게시판 ID는 숫자로 입력해주세요.');
      assert(!menuId || !menus.has(menuId),'동일한 게시판을 여러 회원에게 배정할 수 없습니다.');if(menuId)menus.add(menuId);
      const connection=auth.publicConnection(row.memberId);
      assert(!approvedConnectionId || (menuId && label && connection.connected && !connection.needsReconnect && approvedConnectionId===connection.connectionId),'회원이 직접 연결한 현재 네이버 계정만 승인할 수 있습니다.');
      if(approvedConnectionId) {
        const previous=boardOf(config,row.memberId);
        const retained=previous.approvedConnectionId===approvedConnectionId && config.cafe.clubId===cafe.clubId && config.cafe.url===cafe.url;
        const consented=Object.values(store.naverCafeRequests||{}).some(r=>r.status==='approved' && r.memberId===row.memberId && r.connectionId===approvedConnectionId && r.clubId===cafe.clubId && r.cafeUrl===cafe.url && r.programId===store.program.id);
        assert(retained || consented,'회원의 카페 연결 신청을 먼저 확인하고 승인해주세요.');
      }
      boards[row.memberId]={menuId,label,approvedConnectionId};
    }
    const program={...store.program,startDate};
    if(startDate!==store.program.startDate)program.endDate=new Date(Date.parse(startDate+'T00:00:00Z')+55*86400000).toISOString().slice(0,10);
    assert(getStore()===store,'설정이 변경됐어요. 다시 불러온 뒤 저장해주세요.',409);
    await commit({...store,program,naverCafe:{revision:config.revision+1,cafe,boards}});
    return adminState();
  }
  function ownDraft(session,body) {
    assert(!session.user.isAdmin,'회원 계정에서 본인의 식단을 게시해주세요.',403);
    assert(object(body),'게시할 기록을 확인해주세요.');
    const date=validDate(body.date);assert(date<=today(),'오늘 또는 지난 날짜의 식단만 게시할 수 있습니다.');
    const store=getStore(), member=store.members.find(m=>m.id===session.user.id),config=configOf(store),board=boardOf(config,session.user.id),connection=auth.publicConnection(session.user.id);
    const own=(store.mealPosts||[]).filter(p=>p.memberId===session.user.id && p.date===date && member?.teamId && p.teamId===member.teamId && (!p.programId||p.programId===store.program.id)).sort((a,b)=>MEALS.indexOf(a.meal)-MEALS.indexOf(b.meal));
    const posts=own.map(p=>({...p,photos:(Array.isArray(p.mediaIds)?p.mediaIds:p.mediaId?[p.mediaId]:[]).map(id=>({id,url:`/api/media/${id}`}))}));
    const draft=MealSummary.buildDraft({date,startDate:store.program.startDate,memberId:session.user.id,name:session.user.name,posts});
    if(body.title!==undefined)draft.title=text(body.title,200,'글 제목');
    assert(draft.title.length>0 && !/[\u0000-\u001f]/.test(draft.title),'글 제목을 한 줄로 입력해주세요.');
    const target={clubId:config.cafe.clubId,cafeUrl:config.cafe.url,cafeName:config.cafe.name,menuId:board.menuId,boardName:board.label};
    const publication=recordsOf(store)[keyFor(store,session.user.id,date)];
    const reasons=[];
    if(!auth.configuration().ready)reasons.push('네이버 개발자 앱 설정이 아직 준비되지 않았어요.');
    if(!connection.connected||connection.needsReconnect)reasons.push('내 네이버 계정을 먼저 연결해주세요.');
    if(!member?.teamId)reasons.push('관리자가 팀을 배정해야 합니다.');
    if(!board.menuId)reasons.push('관리자가 내 카페 게시판을 지정해야 합니다.');
    if(!connection.connected||!board.approvedConnectionId||board.approvedConnectionId!==connection.connectionId)reasons.push('관리자가 현재 연결된 네이버 계정을 승인해야 합니다.');
    if(!own.length)reasons.push('선택한 날짜의 식단을 먼저 저장해주세요.');
    if(publication?.status==='published')reasons.push('이미 카페에 게시한 날짜입니다.');
    if(['pending','unknown'].includes(publication?.status))reasons.push('이전 게시 결과를 확인 중입니다. 카페 글 확인 후 관리자에게 알려주세요.');
    const previewVersion=hash({user:session.user.id,name:session.user.name,date,title:draft.title,program:store.program,teamId:member?.teamId,config,connectionId:connection.connectionId,posts});
    return {store,draft,own,target,connection,previewVersion,publication,readyToPublish:!reasons.length,reasons,key:keyFor(store,session.user.id,date)};
  }
  function preview(session,body) {
    const p=ownDraft(session,body);
    return {title:p.draft.title,date:p.draft.date,draft:p.draft,bodyHtml:MealSummary.bodyHTML(p.draft),summary:p.draft.summary,target:p.target,connection:p.connection,previewVersion:p.previewVersion,publication:publicPublication(p.publication),readyToPublish:p.readyToPublish,reasons:p.reasons};
  }
  async function updatePublication(key,attemptId,changes) {
    const store=getStore(), current=recordsOf(store)[key];
    assert(current?.attemptId===attemptId && current.status==='pending','게시 결과를 다시 확인해주세요.',409);
    await commit({...store,naverPublications:{...recordsOf(store),[key]:{...current,...changes,updatedAt:new Date().toISOString()}}});
    return publicPublication(recordsOf(getStore())[key]);
  }
  async function publish(session,body) {
    assert(object(body) && Object.keys(body).every(k=>['date','title','previewVersion','confirmed'].includes(k)) && body.confirmed===true,'미리보기와 게시 대상을 확인한 뒤 게시해주세요.');
    let p=ownDraft(session,body);
    if(p.publication?.status==='published')return {publication:publicPublication(p.publication)};
    assert(!['pending','unknown'].includes(p.publication?.status),'이전 게시 결과가 확정되지 않았어요. 중복 게시를 막기 위해 카페에서 먼저 확인해주세요.',409);
    assert(p.readyToPublish,p.reasons.join(' '),403);
    assert(typeof body.previewVersion==='string' && body.previewVersion===p.previewVersion,'식단이나 게시 대상이 바뀌었어요. 미리보기를 다시 확인해주세요.',409);
    const token=await auth.accessToken(session.user.id);
    const images=p.draft.meals.flatMap(m=>m.photos.map(photo=>({url:photo.url,id:photo.url.slice('/api/media/'.length)})));
    assert(images.length<=18,'하루 식단에는 사진을 최대 18장까지 게시할 수 있습니다.');
    const imageData=[];
    for(let i=0;i<images.length;i+=3)imageData.push(...await Promise.all(images.slice(i,i+3).map(async image=>{
      assert(/^[a-f0-9]{32}$/.test(image.id),'사진 정보를 확인해주세요.');
      const result=await readPhoto(image.id,session.user.id);
      assert(result && ['image/jpeg','image/png','image/webp'].includes(result.mime) && Buffer.isBuffer(result.buffer) && result.buffer.length<=2*1024*1024,'사진 파일을 확인해주세요.');
      return {...image,...result};
    })));
    p=ownDraft(session,body);
    if(p.publication?.status==='published')return {publication:publicPublication(p.publication)};
    assert(p.readyToPublish && body.previewVersion===p.previewVersion,'게시 준비 중 식단이나 계정 연결이 바뀌었어요. 미리보기를 다시 확인해주세요.',409);
    const store=p.store,attemptId=crypto.randomUUID(),now=new Date().toISOString();
    const pending={memberId:session.user.id,programId:store.program.id,date:p.draft.date,title:p.draft.title,target:p.target,connectionId:p.connection.connectionId,previewVersion:p.previewVersion,attemptId,status:'pending',createdAt:now,updatedAt:now,message:'네이버 게시 결과를 확인하고 있어요.'};
    if(getStore()!==store)throw conflict();
    await commit({...store,naverPublications:{...recordsOf(store),[p.key]:pending}});
    // A durable store commit may yield to another request. Recheck its snapshot
    // before the external side effect, while excluding our own pending status.
    const locked=ownDraft(session,body);
    if(locked.previewVersion!==p.previewVersion || locked.publication?.attemptId!==attemptId || locked.publication?.status!=='pending' || locked.reasons.length!==1) {
      try{await updatePublication(p.key,attemptId,{status:'failed',message:'게시 준비 중 식단이나 연결 정보가 변경되어 전송을 취소했어요.'});}catch{}
      throw conflict();
    }
    let html=MealSummary.bodyHTML(p.draft),position=0;
    html=html.replace(/src="\/api\/media\/[a-f0-9]{32}"/g,()=>`src="#${position++}"`);
    assert(position===imageData.length,'본문 사진을 다시 확인해주세요.');
    const form=new FormData();
    // Multipart values follow Naver's UTF-8 URL-encoded multipart example.
    form.append('subject',encodeURIComponent(p.draft.title));form.append('content',encodeURIComponent(html));
    for(const [i,image] of imageData.entries())form.append('image',new Blob([image.buffer],{type:image.mime}),`meal-${i+1}.${image.mime==='image/jpeg'?'jpg':image.mime.split('/')[1]}`);
    for(const [k,v] of Object.entries({openyn:'false',searchopen:'false',scrapyn:'false',metoo:'false',ccl:'false',replyyn:'true'}))form.append(k,v);
    let response,result;
    try {
      response=await fetchImpl(`https://openapi.naver.com/v1/cafe/${p.target.clubId}/menu/${p.target.menuId}/articles`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form,signal:AbortSignal.timeout(25_000),redirect:'error'});
      result=await response.json();
    } catch {
      try{await updatePublication(p.key,attemptId,{status:'unknown',message:'네이버 응답을 확인하지 못했어요. 카페에 글이 올라갔을 수 있으니 관리자에게 게시 확인을 요청해주세요.'});}catch{}
      throw new ApiError(409,'게시 결과를 확인하지 못했어요. 카페에서 확인하기 전에는 다시 게시하지 마세요.');
    }
    const payload=result?.message && typeof result.message==='object'?result.message:result;
    const code=String(payload?.error?.code||result?.errorCode||'');
    const knownFailure=['AP001','AP002','AP003','AP004','AP006','AP007','AP008','0005','024','028','403'].includes(code);
    const definitiveFailure=response.status<500 && code!=='AP005' && ([400,401,403,404,413,415,422,429].includes(response.status)||knownFailure);
    if(definitiveFailure) {
      const message=['AP002','AP003','AP004','0005'].includes(code)?'카페 가입 여부와 게시판 글쓰기 권한을 확인해주세요.':response.status===401?'네이버 계정을 다시 연결해주세요.':'네이버에서 게시 요청을 거절했어요. 게시판과 계정 권한을 확인한 뒤 다시 미리보기를 열어주세요.';
      await updatePublication(p.key,attemptId,{status:'failed',message});
      throw new ApiError(422,message);
    }
    let article;
    try {
      assert(response.ok && (!payload?.status||String(payload.status)==='200') && !payload?.error,'게시 결과를 확인할 수 없습니다.');
      const data=payload?.result||payload;
      article=articleLink(data.articleUrl,p.target);
      assert(String(data.articleId)===article.articleId,'게시글 번호를 확인할 수 없습니다.');
    } catch {
      try{await updatePublication(p.key,attemptId,{status:'unknown',message:'게시 결과가 불확실해요. 카페에서 글을 확인한 뒤 관리자에게 글 주소를 전달해주세요.'});}catch{}
      throw new ApiError(409,'게시 결과가 불확실해요. 중복 게시를 막기 위해 카페에서 먼저 확인해주세요.');
    }
    try { return {publication:await updatePublication(p.key,attemptId,{status:'published',...article,message:'카페에 게시했어요.'})}; }
    catch { throw new ApiError(409,'네이버에는 게시됐지만 앱에 결과를 저장하지 못했어요. 카페에서 글 주소를 확인해 관리자에게 전달해주세요.'); }
  }
  async function reconcile(session,body) {
    assert(session.user.isAdmin,'관리자만 게시 결과를 확인할 수 있습니다.',403);
    assert(object(body) && body.confirmed===true,'실제 카페 게시글을 확인한 뒤 저장해주세요.');
    const store=getStore(),date=validDate(body.date),key=keyFor(store,body.memberId,date),record=recordsOf(store)[key];
    assert(record && ['pending','unknown'].includes(record.status),'확인이 필요한 게시 기록을 찾지 못했습니다.');
    const outcome=body.outcome||'published';
    assert(['published','not_published'].includes(outcome),'게시 확인 결과를 선택해주세요.');
    assert(!isActive(record),'아직 게시 요청을 처리 중입니다. 잠시 후 다시 확인해주세요.',409);
    let changes;
    if(outcome==='not_published') {
      assert(Number.isFinite(Date.parse(record.createdAt)) && Date.now()-Date.parse(record.createdAt)>=120_000,'게시 요청 후 2분이 지난 뒤 카페 게시글과 스팸 보관함을 확인해주세요.',409);
      changes={status:'failed',articleUrl:null,articleId:null,message:'관리자가 카페 게시글과 스팸 보관함에 글이 없음을 확인했습니다. 회원이 미리보기를 확인한 뒤 다시 게시할 수 있어요.'};
    } else {
      const article=articleLink(text(body.articleUrl,500,'게시글 주소'),record.target);
      assert(!Object.values(recordsOf(store)).some(p=>p!==record && p.status==='published' && p.articleUrl===article.articleUrl),'다른 기록에 연결된 글 주소입니다.');
      changes={...article,status:'published',message:'관리자가 실제 카페 글을 확인했습니다.'};
    }
    const updated={...record,...changes,manual:true,updatedAt:new Date().toISOString()};
    await commit({...store,naverPublications:{...recordsOf(store),[key]:updated}});
    return {publication:publicPublication(updated)};
  }
  async function handle(req,res,session,url,readJson,send) {
    const route=url.pathname;
    if(route==='/api/admin/naver' && req.method==='GET') {assert(session.user.isAdmin,'관리자만 카페 연결을 확인할 수 있습니다.',403);send(res,200,adminState());return true;}
    if(route==='/api/admin/naver' && req.method==='PUT'){send(res,200,await saveSettings(session,await readJson(req)));return true;}
    if(route==='/api/admin/naver/reconcile' && req.method==='POST'){send(res,200,await reconcile(session,await readJson(req)));return true;}
    if(route==='/api/naver/preview' && req.method==='POST'){const body=await readJson(req);assert(object(body)&&Object.keys(body).every(k=>['date','title'].includes(k)),'미리보기 요청을 확인해주세요.');send(res,200,preview(session,body));return true;}
    if(route==='/api/naver/publish' && req.method==='POST'){send(res,200,await publish(session,await readJson(req)));return true;}
    return false;
  }
  return {handle,adminState,preview};
}
module.exports={createNaverCafe};
