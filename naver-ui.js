let naverUIEpoch = 0;
let naverAdminPage = null;
let naverOnboardingPage = null;
function cleanupNaverUI() { naverUIEpoch++; naverAdminPage = null; naverOnboardingPage = null; }
function naverFormSignature() {
  const form = document.querySelector('#naver-admin-form');
  return form ? JSON.stringify(Array.from(new FormData(form).entries())) : '';
}
function naverReviewSignature() { return JSON.stringify(Array.from(document.querySelectorAll('.naver-request-review')).map(form=>Array.from(new FormData(form).entries()))); }
function naverReviewDrafts() {
  return Array.from(document.querySelectorAll('.naver-request-review')).map(form=>({id:form.dataset.requestId,version:naverAdminPage?.requestsData.requests.find(r=>r.id===form.dataset.requestId)?.version,fields:Array.from(form.elements).filter(field=>field.name&&field.type!=='submit').map(field=>({name:field.name,value:field.value,checked:field.checked}))}));
}
function restoreNaverReviewDrafts(drafts) {
  const forms=Array.from(document.querySelectorAll('.naver-request-review'));
  drafts.forEach(draft=>{const form=forms.find(f=>f.dataset.requestId===draft.id), request=naverAdminPage?.requestsData.requests.find(r=>r.id===draft.id);if(!form||request?.version!==draft.version)return;draft.fields.forEach(field=>{const node=form.elements.namedItem(field.name);if(node){node.value=field.value;if(node.type==='checkbox')node.checked=field.checked;}});if(form.elements.memberId.selectedOptions[0]?.disabled){form.elements.memberId.value='';form.elements.confirmed.checked=false;}});
}
function naverOnboardingSignature() { const form=document.querySelector('#naver-link-request');return form?JSON.stringify(Array.from(new FormData(form).entries())):''; }
function naverIsDirty() { return Boolean(naverAdminPage && (naverAdminPage.busy || naverFormSignature() !== naverAdminPage.saved || naverReviewSignature() !== naverAdminPage.reviewSaved) || naverOnboardingPage && (naverOnboardingPage.busy || naverOnboardingSignature() !== naverOnboardingPage.saved)); }
function naverAuthorizeUrl(value) {
  const url=new URL(value);
  if(url.origin!=='https://nid.naver.com'||url.pathname!=='/oauth2.0/authorize'||url.username||url.password)throw new Error('네이버 로그인 주소를 확인하지 못했어요. 관리자에게 문의해주세요.');
  return url.href;
}
function naverLoginView() {
  return `<div class="naver-login-section"><button type="button" class="button naver-connect-button" id="naver-login-button" disabled><span aria-hidden="true" class="naver-logo">N</span> 네이버로 시작하기</button><p class="naver-login-help">처음 로그인한 뒤 카페 연동에 동의하면 관리자에게 요청을 보낼 수 있어요.</p><p id="naver-login-status" role="status">네이버 로그인 설정을 확인하고 있어요…</p><p id="naver-login-error" class="form-error" role="alert">${typeof location!=='undefined'&&location.hash==='#naver-login-error'?'네이버 로그인을 완료하지 못했어요. 로그인과 동의를 완료한 뒤 다시 시도해주세요.':''}</p></div>`;
}
async function mountNaverLogin() {
  const epoch=naverUIEpoch, button=document.querySelector('#naver-login-button'), status=document.querySelector('#naver-login-status'), errorNode=document.querySelector('#naver-login-error');
  if(!button)return;
  try {
    const data=await api('/api/naver/login-config');if(epoch!==naverUIEpoch||!button.isConnected)return;
    button.disabled=!data.configuration?.ready;
    status.textContent=data.configuration?.ready?'네이버 비밀번호는 네이버 로그인 화면에서만 입력합니다.':'관리자가 네이버 로그인 설정을 준비하고 있어요. 기존 계정은 아래에서 로그인할 수 있습니다.';
    button.onclick=async()=>{
      if(button.disabled)return;button.disabled=true;errorNode.textContent='';
      try {const result=await api('/api/naver/login',{method:'POST',body:'{}'});if(epoch!==naverUIEpoch||!button.isConnected)return;location.assign(naverAuthorizeUrl(result.authorizeUrl));}
      catch(error){if(epoch===naverUIEpoch&&button.isConnected){errorNode.textContent=error.message;button.disabled=false;}}
    };
  }catch(error){if(epoch===naverUIEpoch&&button.isConnected)status.textContent='네이버 로그인 준비 상태를 확인하지 못했어요. 새로고침하거나 기존 계정으로 로그인해주세요.';}
}
function naverSafeArticleUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'cafe.naver.com' && !url.username && !url.password && !url.port ? url.href : ''; } catch { return ''; }
}
function naverBoardId(value, clubId) {
  const input=String(value||'').trim();
  if (!input) return '';
  if (/^[1-9]\d*$/.test(input)) return input;
  let url; try { url = new URL(input); } catch { throw new Error('게시판 번호 또는 네이버 카페 게시판 링크를 입력해주세요.'); }
  if (!['https:','http:'].includes(url.protocol) || url.hostname!=='cafe.naver.com' || url.username || url.password || url.port) throw new Error('네이버 카페의 게시판 링크를 입력해주세요.');
  const match=url.pathname.match(/\/(?:f-e\/|ca-fe\/)?cafes\/(\d+)\/menus\/(\d+)\/?$/);
  const linkedClub=match?.[1] || url.searchParams.get('search.clubid') || url.searchParams.get('clubid');
  const menu=match?.[2] || url.searchParams.get('search.menuid') || url.searchParams.get('menuid');
  if (!linkedClub || !menu || !/^[1-9]\d*$/.test(menu)) throw new Error('게시판 번호를 찾지 못했어요. 주소 대신 게시판 번호를 입력해주세요.');
  if (String(linkedClub)!==String(clubId)) throw new Error('이 게시판은 위에 지정한 카페와 다릅니다. 카페 ID와 게시판 링크를 확인해주세요.');
  return menu;
}
function naverConnectionBadge(connection, board) {
  if (!connection?.connected) return '<span class="badge naver-unlinked">회원 연결 대기</span>';
  if (connection.needsReconnect) return '<span class="badge naver-unlinked">회원 재연결 필요</span>';
  return `<span class="badge ${board?.approvedConnectionId===connection.connectionId?'naver-approved':'naver-unlinked'}">${board?.approvedConnectionId===connection.connectionId?'게시 승인됨':'관리자 승인 대기'}</span>`;
}
function naverOnboardingView() {
  return heading('CONNECT YOUR CAFE', '카페와 연동하시겠습니까?', '회원님의 네이버 계정과 전용 게시판을 관리자가 확인해 연결합니다.')+'<div id="naver-onboarding-content"><section class="card empty-state" role="status">카페 연결 상태를 확인하고 있어요…</section></div>';
}
function naverOnboardingContent(data, deferred=false, pendingMember=false) {
  const c=data.connection||{}, r=data.request, cafe=data.cafe||{}, approved=data.approved, waiting=r?.status==='pending'&&!r.stale;
  const cafeUrl=naverSafeArticleUrl(cafe.url), canRequest=data.configuration?.ready&&c.connected&&!c.needsReconnect;
  const steps=`<ol class="naver-onboarding-steps"><li class="${c.connected?'complete':''}"><span>01</span> 네이버 로그인</li><li class="${waiting||approved?'complete':''}"><span>02</span> 카페 연동 신청</li><li class="${approved?'complete':''}"><span>03</span> 관리자 게시판 연결</li></ol>`;
  const info=`<section class="card naver-onboarding-card"><div class="card-heading"><h2>${escapeHTML(cafe.name||'네이버 카페')}</h2><span class="badge ${approved?'naver-approved':'naver-unlinked'}">${approved?'게시판 연결 완료':waiting?'관리자 확인 대기':'연동 신청 전'}</span></div>${cafeUrl?`<a class="naver-cafe-link" href="${escapeHTML(cafeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(cafeUrl)} ↗</a>`:''}<p class="naver-muted">로그인한 네이버 계정: <strong>${escapeHTML(c.displayName||'연결 전')}</strong></p>`;
  const refresh='<button type="button" class="button secondary" id="refresh-naver-onboarding">연결 상태 새로고침</button>';
  let content;
  if(approved) {
    content=`<div class="naver-onboarding-message"><h3>내 카페 게시판이 연결됐어요.</h3><p>연결 게시판: <strong>${escapeHTML(data.board?.label||r?.label||'내 게시판')}</strong> · ${escapeHTML(data.board?.menuId||r?.menuId||'')}번</p><p>우리 팀 식단에서 아침·점심·저녁 사진과 탄단지 블럭을 기록한 뒤, <strong>네이버 카페에 올리기</strong>로 미리보기를 확인하고 게시해주세요.</p></div><div class="naver-connect-actions"><a class="button" href="#team">식단 기록하러 가기 ↗</a>${refresh}</div>`;
  } else if(waiting) {
    content=`<div class="naver-onboarding-message"><h3>관리자에게 연결 요청을 보냈어요.</h3><p>관리자가 회원님과 카페 게시판을 직접 확인하고 있습니다. 연결이 끝나면 식단을 카페에 올릴 수 있어요.</p><dl class="naver-request-info"><div><dt>신청 이름</dt><dd>${escapeHTML(r.name)}</dd></div><div><dt>카페 닉네임</dt><dd>${escapeHTML(r.cafeNickname)}</dd></div><div><dt>요청 게시판</dt><dd>${escapeHTML(r.requestedBoardName||'관리자가 확인 후 지정')}</dd></div></dl></div><div class="naver-connect-actions">${refresh}</div>`;
  } else if(!canRequest) {
    content=`<div class="naver-onboarding-message"><h3>${c.needsReconnect?'네이버 로그인을 다시 확인해주세요.':'본인의 네이버 계정을 연결해주세요.'}</h3><p>네이버 인증을 마친 뒤 카페 연동에 동의하면 관리자에게 연결 요청을 보낼 수 있습니다.</p></div>${!data.configuration?.ready?'<p class="naver-missing">관리자가 네이버 개발자 앱 등록과 로그인 설정을 준비하고 있어요. 설정이 완료되면 연동을 신청할 수 있습니다.</p>':''}<div class="naver-connect-actions"><button type="button" id="onboarding-connect-naver" class="button naver-connect-button" ${data.configuration?.ready?'':'disabled'}>${pendingMember?'로그아웃 후 다시 시작':'네이버 계정 연결'}</button>${refresh}</div>`;
  } else if(deferred) {
    content='<div class="naver-onboarding-message"><h3>원할 때 카페 연동을 신청해주세요.</h3><p>아직 관리자에게 요청을 보내지 않았습니다. 다시 로그인해도 이 화면에서 신청할 수 있어요.</p></div><div class="naver-connect-actions"><button type="button" class="button" id="resume-naver-onboarding">카페 연동 신청하기</button></div>';
  } else {
    const prior=r?.status==='rejected'&&!r.stale?`<p class="naver-missing">관리자가 신청 내용을 다시 확인해달라고 요청했어요.${r.reason?`<br>관리자 메모: ${escapeHTML(r.reason)}`:''} 내용을 수정하고 다시 신청해주세요.</p>`:r?'<p class="naver-missing">네이버 계정 또는 게시판 연결을 다시 확인해야 해요. 카페 연동을 새로 신청해주세요.</p>':'';
    content=`${prior}<p class="naver-muted">이름과 카페 닉네임을 알려주세요. 관리자가 앱 회원과 카페 게시판을 직접 연결하며, 이름이 같다는 이유로 자동 연결하지 않습니다.</p><form id="naver-link-request"><div class="naver-board-fields"><div class="field"><label for="naver-request-name">회원 이름</label><input id="naver-request-name" name="name" required maxlength="30" autocomplete="name" value="${escapeHTML(r?.name||'')}" placeholder="예: 김민준"></div><div class="field"><label for="naver-request-nickname">카페 닉네임</label><input id="naver-request-nickname" name="cafeNickname" required maxlength="40" value="${escapeHTML(r?.cafeNickname||'')}" placeholder="카페에서 사용하는 닉네임"></div></div><div class="field"><label for="naver-request-board">내 카페 게시판 이름 <small>선택</small></label><input id="naver-request-board" name="requestedBoardName" maxlength="80" value="${escapeHTML(r?.requestedBoardName||'')}" placeholder="예: 2026년 2기 · 김민준"></div><div class="field"><label for="naver-request-note">관리자에게 남길 메모 <small>선택</small></label><input id="naver-request-note" name="note" maxlength="500" value="${escapeHTML(r?.note||'')}" placeholder="관리자가 회원님을 확인하는 데 필요한 내용"></div><label class="check-field naver-consent"><input name="consent" type="checkbox" required><span>이 네이버 계정으로 카페를 연동하고, 위 정보를 관리자에게 보내 게시판 연결을 요청하는 데 동의합니다.</span></label><p class="naver-muted">카페 글은 연결 후에도 회원님이 직접 올리기 버튼을 눌러야 게시됩니다.</p><div class="naver-connect-actions"><button class="button" type="submit">관리자에게 연결 요청 ↗</button><button class="button secondary" type="button" id="skip-naver-onboarding">나중에</button>${refresh}</div></form>`;
  }
  return steps+info+content+'<p class="form-error" id="naver-onboarding-error" role="alert"></p></section>';
}
async function acceptNaverOnboardingState(current, data) {
  if(naverOnboardingPage!==current)return;
  if(data.approved&&session.pendingApproval) {
    await loadBootstrap();if(naverOnboardingPage!==current)return;
    if(!session.pendingApproval){current.busy=false;current.saved=naverOnboardingSignature();history.replaceState(null,'','#today');render();toast('관리자가 카페 게시판을 연결했어요. 이제 식단을 기록할 수 있습니다.');return;}
  }
  current.data=data;current.busy=false;paintNaverOnboarding();
}
function paintNaverOnboarding() {
  const current=naverOnboardingPage, host=document.querySelector('#naver-onboarding-content');if(!current||!host)return;
  host.innerHTML=naverOnboardingContent(current.data,current.deferred,Boolean(session.pendingApproval));current.saved=naverOnboardingSignature();
  const errorNode=host.querySelector('#naver-onboarding-error');
  host.querySelector('#refresh-naver-onboarding')?.addEventListener('click',async()=>{
    if(current.busy)return;
    if(naverIsDirty()&&!confirm('입력한 신청 내용을 버리고 연결 상태를 다시 불러올까요?'))return;
    await mountNaverOnboarding();
  });
  host.querySelector('#onboarding-connect-naver')?.addEventListener('click',async event=>{
    if(session.pendingApproval){document.querySelector('#logout-button')?.click();return;}
    const button=event.currentTarget;button.disabled=true;errorNode.textContent='';
    try {const result=await api('/api/naver/connect',{method:'POST',body:'{}'});if(naverOnboardingPage!==current||!host.isConnected)return;location.assign(naverAuthorizeUrl(result.authorizeUrl));}
    catch(error){if(naverOnboardingPage===current&&host.isConnected){errorNode.textContent=error.message;button.disabled=false;}}
  });
  host.querySelector('#skip-naver-onboarding')?.addEventListener('click',()=>{
    if(current.busy)return;
    if(session.pendingApproval){current.deferred=true;paintNaverOnboarding();}
    else {current.saved=naverOnboardingSignature();location.hash='today';}
  });
  host.querySelector('#resume-naver-onboarding')?.addEventListener('click',()=>{current.deferred=false;paintNaverOnboarding();});
  const form=host.querySelector('#naver-link-request');
  if(form)form.onsubmit=async event=>{
    event.preventDefault();if(current.busy||!form.reportValidity())return;errorNode.textContent='';
    const fields=new FormData(form);if(fields.get('consent')!=='on')return;
    const body={...Object.fromEntries(['name','cafeNickname','requestedBoardName','note'].map(key=>[key,String(fields.get(key)||'').trim()])),consent:true,expectedVersion:current.data.request?.version||0};
    try {current.busy=true;form.inert=true;form.querySelector('[type="submit"]').disabled=true;const data=await api('/api/naver/link-request',{method:'POST',body:JSON.stringify(body)});if(naverOnboardingPage!==current)return;await acceptNaverOnboardingState(current,data);toast('관리자에게 카페 연결 요청을 보냈어요.');}
    catch(error){if(naverOnboardingPage===current){current.busy=false;form.inert=false;form.querySelector('[type="submit"]').disabled=false;errorNode.textContent=error.status===409?'연결 상태가 변경됐어요. 새로고침한 뒤 신청 내용을 다시 확인해주세요.':error.message;}}
  };
}
async function mountNaverOnboarding() {
  const epoch=++naverUIEpoch, current={data:null,saved:'',busy:false,deferred:false};naverOnboardingPage=current;
  try {const data=await api('/api/naver/onboarding');if(epoch!==naverUIEpoch||!document.querySelector('#naver-onboarding-content'))return;await acceptNaverOnboardingState(current,data);}
  catch(error){if(epoch!==naverUIEpoch)return;const host=document.querySelector('#naver-onboarding-content');if(!host)return;naverOnboardingPage=null;host.innerHTML=`<section class="card empty-state"><p>${escapeHTML(error.message)}</p><button type="button" class="button secondary" id="retry-naver-onboarding">다시 확인하기</button></section>`;host.querySelector('button').onclick=mountNaverOnboarding;}
}
function naverAdminView() {
  return heading('NAVER CAFE CONNECTION', '회원과 카페 게시판을 연결해요.', '회원이 직접 인증한 네이버 계정을 확인하고, 글을 올릴 게시판을 지정해주세요.')+'<div id="naver-admin-content"><section class="card empty-state" role="status">네이버 연결 설정을 불러오고 있어요…</section></div>';
}
function naverSetupView(configuration) {
  const ready=configuration?.ready;
  const callback=configuration?.callbackUrl || 'https://zone-diet-application.vercel.app/api/naver/callback';
  return `<section class="card naver-setup-card"><div class="card-heading"><h2>네이버 앱 설정</h2><span class="badge ${ready?'naver-approved':'naver-unlinked'}">${ready?'환경설정 준비됨':'환경설정 필요'}</span></div><p>${ready?'회원이 직접 네이버 로그인을 진행할 수 있습니다. 실제 카페 가입 상태와 게시판 글쓰기 권한은 게시할 때 확인됩니다.':'네이버 개발자센터에서 앱을 등록하고, 서버 환경변수를 설정하면 회원 계정 연결을 사용할 수 있습니다. 게시판 지정은 먼저 저장할 수 있어요.'}</p><details class="naver-setup-details" ${ready?'':'open'}><summary>개발자 등록 · 환경변수 안내</summary><ol><li><a href="https://developers.naver.com/apps/#/register" target="_blank" rel="noopener noreferrer">네이버 개발자센터에서 앱 등록</a>에서 사용 API에 <strong>카페</strong>를 추가하고, 함께 추가되는 네이버 로그인과 카페 글쓰기 권한을 확인해주세요.</li><li>웹 서비스 URL은 <code>https://zone-diet-application.vercel.app</code>, Callback URL은 아래 값을 등록해주세요.<p class="naver-callback"><code>${escapeHTML(callback)}</code></p></li><li>Vercel 프로젝트의 Settings → Environment Variables에서 Production 환경변수를 등록하고 다시 배포해주세요. 비밀값은 이 화면이나 채팅에 입력하지 않습니다.</li></ol><dl class="naver-env-list"><div><dt>NAVER_CLIENT_ID</dt><dd>네이버 앱의 Client ID</dd></div><div><dt>NAVER_CLIENT_SECRET</dt><dd>네이버 앱의 Client Secret · 비공개</dd></div><div><dt>NAVER_CALLBACK_URL</dt><dd>등록한 Callback URL과 동일한 주소</dd></div><div><dt>NAVER_TOKEN_ENCRYPTION_KEY</dt><dd>연결 정보 암호화용 32바이트 키의 Base64 값 · 비공개</dd></div></dl>${!ready?`<p class="naver-missing">확인이 필요한 설정: ${escapeHTML((configuration?.missing||[]).join(', ')||'서버 설정을 확인해주세요.')}</p>`:''}<p>개발 중에는 네이버 개발자센터의 테스터로 등록된 계정으로 시험합니다. 정식 사용에는 네이버 로그인 검수가 필요합니다.</p></details></section>`;
}
function naverRequestsView(data) {
  const requests=data.requests||[], pending=requests.filter(r=>r.status==='pending'), completed=requests.filter(r=>r.status!=='pending');
  return `<section class="card naver-requests-card"><div class="card-heading"><div><span class="eyebrow">MEMBER CONNECTION REQUESTS</span><h2>카페 연결 요청</h2></div><div class="naver-request-tools"><span class="badge">확인 대기 ${pending.length}명</span><button type="button" class="button secondary" id="refresh-naver-requests">요청 새로고침</button></div></div><p class="naver-muted">회원이 직접 동의한 신청입니다. 인증한 네이버 계정, 회원 이름과 카페 닉네임을 확인한 뒤 앱 회원과 게시판을 직접 선택해주세요.</p>${pending.length?pending.map((r,index)=>{
    const locked=Boolean(r.memberId), disabled=r.stale||!data.configuration?.ready, memberOptions=(data.members||[]).map(m=>`<option value="${escapeHTML(m.id)}" ${locked&&m.id===r.memberId?'selected':''} ${(!locked&&m.hasConnection)||(locked&&m.id!==r.memberId)?'disabled':''}>${escapeHTML(m.username)} · ${escapeHTML(m.name)}${!locked&&m.hasConnection?' · 연결됨':''}</option>`).join('');
    return `<article class="naver-request-card"><div class="naver-member-heading"><h3>${escapeHTML(r.name)}님의 요청</h3><span class="badge naver-unlinked">${r.stale?'다시 신청 필요':'확인 대기'}</span></div><dl class="naver-request-info"><div><dt>인증한 네이버 이름</dt><dd>${escapeHTML(r.naverName||r.connection?.displayName||'네이버 회원')}</dd></div><div><dt>회원이 입력한 이름</dt><dd>${escapeHTML(r.name)}</dd></div><div><dt>카페 닉네임</dt><dd>${escapeHTML(r.cafeNickname)}</dd></div><div><dt>요청 게시판</dt><dd>${escapeHTML(r.requestedBoardName||'미입력')}</dd></div>${r.note?`<div class="naver-request-note"><dt>요청 메모</dt><dd>${escapeHTML(r.note)}</dd></div>`:''}</dl>${r.stale?'<p class="naver-missing">네이버 계정 또는 카페·프로그램이 변경되어 승인할 수 없어요. 회원에게 다시 신청하도록 안내해주세요.</p>':''}<form class="naver-request-review" data-request-id="${escapeHTML(r.id)}"><div class="naver-board-fields"><div class="field"><label for="naver-review-member-${index}">연결할 앱 회원</label><select id="naver-review-member-${index}" name="memberId" required ${locked?'aria-describedby="naver-locked-'+index+'"':''}><option value="" ${locked?'':'selected'} disabled>앱 회원을 직접 선택해주세요</option>${memberOptions}</select>${locked?`<small id="naver-locked-${index}">기존 계정으로 신청한 회원입니다. 다른 회원으로 바꿀 수 없습니다.</small>`:'<small>기존 회원 계정의 팀·역할·기록이 이 네이버 회원에게 연결됩니다.</small>'}</div><div class="field"><label for="naver-review-name-${index}">앱 회원 이름</label><input id="naver-review-name-${index}" name="memberName" required maxlength="30" value="${escapeHTML(r.name)}"><small>승인하면 선택한 앱 회원의 이름을 이 이름으로 변경합니다.</small></div><div class="field"><label for="naver-review-board-${index}">게시판 번호 또는 링크</label><input id="naver-review-board-${index}" name="menuId" required maxlength="500" placeholder="예: 7 또는 회원 게시판 링크" autocomplete="off"></div><div class="field"><label for="naver-review-label-${index}">연결할 게시판 이름</label><input id="naver-review-label-${index}" name="label" required maxlength="80" placeholder="카페 게시판에 표시된 이름" autocomplete="off"></div></div><div class="field"><label for="naver-review-reason-${index}">회원에게 전달할 메모 <small>선택</small></label><input id="naver-review-reason-${index}" name="reason" maxlength="300" placeholder="다시 확인이 필요한 내용 등을 알려주세요"></div><label class="check-field naver-consent"><input name="confirmed" type="checkbox" required><span>네이버 신청자와 카페 게시판을 직접 확인했습니다. 승인하면 선택한 기존 앱 회원 계정과 그 기록을 이 네이버 회원에게 연결하는 데 동의합니다.</span></label><p class="form-error" data-review-error role="alert"></p><div class="naver-connect-actions"><button type="submit" class="button" name="decision" value="approve" ${disabled?'disabled':''}>회원 · 게시판 연결 승인</button><button type="submit" class="button secondary" name="decision" value="reject" formnovalidate>다시 확인 요청</button></div></form></article>`;
  }).join(''):'<p class="naver-request-empty">대기 중인 요청이 없습니다. 회원이 네이버로 로그인하고 카페 연동을 신청하면 여기에 표시됩니다.</p>'}${completed.length?`<details class="naver-request-history"><summary>처리한 요청 ${completed.length}건</summary>${completed.map(r=>`<div><strong>${escapeHTML(r.name)}</strong><span class="badge ${r.status==='approved'?'naver-approved':'naver-unlinked'}">${r.status==='approved'?'연결 승인':'다시 확인 요청'}</span><p>${r.status==='approved'?`${escapeHTML(r.label||'게시판')} · ${escapeHTML(r.menuId)}번`:escapeHTML(r.reason||'회원에게 신청 내용 확인을 요청했습니다.')}</p></div>`).join('')}</details>`:''}</section>`;
}
function bindNaverRequests(host,current) {
  const forms=Array.from(host.querySelectorAll('.naver-request-review'));
  current.reviewInitial=new Map(forms.map(form=>[form.dataset.requestId,JSON.stringify(Array.from(new FormData(form).entries()))]));
  current.reviewSaved=naverReviewSignature();
  host.querySelector('#refresh-naver-requests').onclick=()=>{if(current.busy)return;if(naverIsDirty()&&!confirm('저장하지 않은 연결 설정과 요청 입력을 버리고 다시 불러올까요?'))return;mountNaverAdmin();};
  forms.forEach(form=>{
    form.onsubmit=async event=>{
      event.preventDefault();if(current.busy)return;
      const errorNode=form.querySelector('[data-review-error]');errorNode.textContent='';
      const request=current.requestsData.requests.find(r=>r.id===form.dataset.requestId), decision=event.submitter?.value||'approve';
      if(!request)return;
      if(naverFormSignature()!==current.saved){errorNode.textContent='아래 카페 설정의 변경사항을 먼저 저장하거나 새로고침해주세요.';return;}
      if(!form.elements.confirmed.checked){errorNode.textContent='신청 내용을 직접 확인한 뒤 확인란에 체크해주세요.';return;}
      try {
        const preservedDrafts=naverReviewDrafts().filter(draft=>draft.id!==request.id);
        const fields=new FormData(form), body={requestId:request.id,expectedVersion:request.version,decision,confirmed:true,reason:String(fields.get('reason')||'').trim()};
        if(decision==='approve') {
          if(!form.reportValidity())return;
          Object.assign(body,{memberId:fields.get('memberId'),memberName:String(fields.get('memberName')||'').trim(),menuId:naverBoardId(fields.get('menuId'),current.requestsData.cafe.clubId),label:String(fields.get('label')||'').trim()});
        }
        current.busy=true;host.inert=true;
        await api('/api/admin/naver/request-review',{method:'POST',body:JSON.stringify(body)});if(naverAdminPage!==current)return;
        current.busy=false;current.saved=naverFormSignature();current.reviewSaved=naverReviewSignature();host.inert=false;
        toast(decision==='approve'?'회원과 카페 게시판을 연결했어요. 회원이 연결 상태를 새로고침하면 시작할 수 있습니다.':'회원에게 신청 내용을 다시 확인하도록 요청했어요.');
        await mountNaverAdmin(preservedDrafts);
      } catch(error) {if(naverAdminPage===current){current.busy=false;host.inert=false;errorNode.textContent=error.status===409?'신청이나 회원 연결 상태가 변경됐어요. 설정을 새로고침하고 다시 확인해주세요.':error.message;}}
    };
  });
}
function naverMemberRow(member) {
  const c=member.connection||{}, b=member.board||{};
  const enabled=c.connected && !c.needsReconnect && Boolean(c.connectionId);
  const approved=enabled && b.approvedConnectionId===c.connectionId && Boolean(b.menuId);
  return `<section class="naver-member-row" data-naver-member="${escapeHTML(member.id)}"><div class="naver-member-heading"><div class="member-identity"><span class="member-avatar">${escapeHTML(member.name.slice(-2))}</span><div><strong>${escapeHTML(member.name)}</strong><small>${escapeHTML(member.username)}</small></div></div>${naverConnectionBadge(c,b)}</div><p class="naver-member-account">${c.connected?`회원이 연결한 네이버 계정: <strong>${escapeHTML(c.displayName||'네이버 회원')}</strong>${c.needsReconnect?' · 회원의 재로그인이 필요합니다.':''}`:'회원이 네이버로 로그인하고 카페 연동을 신청하면 위 요청 목록에서 연결할 수 있습니다.'}</p><div class="naver-board-fields"><div class="field"><label for="naver-board-${escapeHTML(member.id)}">게시판 번호 또는 링크</label><input id="naver-board-${escapeHTML(member.id)}" name="board-${escapeHTML(member.id)}" data-naver-board maxlength="500" value="${escapeHTML(b.menuId||'')}" placeholder="예: 7 또는 회원 게시판 링크" autocomplete="off"></div><div class="field"><label for="naver-label-${escapeHTML(member.id)}">게시판 이름</label><input id="naver-label-${escapeHTML(member.id)}" name="label-${escapeHTML(member.id)}" data-naver-label maxlength="100" value="${escapeHTML(b.label||'')}" placeholder="예: 2026년 2기 · 김민준" autocomplete="off"></div></div><label class="check-field naver-approval"><input type="checkbox" name="approve-${escapeHTML(member.id)}" data-naver-approve ${approved?'checked':''} ${approved?'':'disabled'}> ${approved?'현재 게시 승인됨 · 체크를 해제하고 저장하면 승인을 취소합니다.':'미승인 · 새 승인은 위의 카페 연결 요청을 검토해 처리해주세요.'}</label><p class="naver-muted">게시판 번호나 이름을 변경하면 승인이 해제됩니다. 회원의 새 연동 신청을 확인한 뒤 다시 승인해주세요.</p></section>`;
}
const NAVER_PUBLICATION_LABELS={published:'게시 완료',failed:'게시 실패',pending:'게시 처리 중 · 결과 확인 필요',unknown:'게시 결과 확인 필요'};
function naverPublicationsView(publications=[]) {
  if (!publications.length) return '<section class="card"><div class="card-heading"><h2>카페 게시 내역</h2></div><p class="naver-muted">아직 앱에서 게시를 요청한 기록이 없습니다.</p></section>';
  return `<section class="card naver-publication-history"><div class="card-heading"><h2>카페 게시 내역</h2><span class="badge">${publications.length}건</span></div><p class="naver-muted">결과 확인이 필요한 요청은 중복 게시를 막기 위해 다시 보내지 않습니다. 실제 카페에서 글을 확인한 뒤 해당 링크를 연결해주세요.</p>${publications.map((p,index)=>{
    const link=naverSafeArticleUrl(p.articleUrl), reconcile=['pending','unknown'].includes(p.status), active=p.status==='pending' && Date.now()-Date.parse(p.createdAt)<120000;
    return `<article class="naver-publication-row"><div class="naver-member-heading"><div><strong>${escapeHTML(p.memberName||p.memberId)} · ${escapeHTML(p.date)}</strong><p>${escapeHTML(p.title||'식단 게시글')}</p></div><span class="badge">${escapeHTML(NAVER_PUBLICATION_LABELS[p.status]||p.status)}</span></div>${p.message?`<p class="naver-muted">${escapeHTML(p.message)}</p>`:''}${link?`<a class="button text" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">게시글 보기 ↗</a>`:''}${reconcile?`<form class="naver-reconcile-form" data-publication-index="${index}"><label for="naver-outcome-${index}">카페 확인 결과</label><select id="naver-outcome-${index}" name="outcome" ${active?'disabled':''}><option value="published">글이 게시됨 · 주소 연결</option><option value="not_published" ${Date.now()-Date.parse(p.createdAt)<120000?'disabled':''}>카페에 글이 없는 것을 확인함 · 재시도 허용</option></select><label for="naver-article-${index}" data-article-label>카페에서 확인한 게시글 주소</label><input id="naver-article-${index}" type="url" name="articleUrl" required maxlength="1000" placeholder="https://cafe.naver.com/..." ${active?'disabled':''}><label class="check-field"><input type="checkbox" name="confirmed" required ${active?'disabled':''}><span data-confirmation-label>이 회원의 해당 날짜 식단이 실제로 게시된 것을 확인했습니다.</span></label><p class="form-error" data-reconcile-error role="alert"></p><button type="submit" class="button secondary" ${active?'disabled':''}>카페에서 확인한 게시글 연결</button>${active?'<p class="naver-muted">게시 요청을 처리하고 있어요. 잠시 후 설정 새로고침으로 결과를 확인해주세요.</p>':''}</form>`:''}</article>`;
  }).join('')}</section>`;
}
function paintNaverAdmin() {
  const current=naverAdminPage, host=document.querySelector('#naver-admin-content'); if(!current||!host)return;
  const d=current.data;
  host.innerHTML=naverRequestsView(current.requestsData)+naverSetupView(d.configuration)+`<form id="naver-admin-form"><section class="card naver-cafe-config"><div class="card-heading"><h2>카페 · 프로그램 정보</h2><span class="badge">관리자 설정</span></div><div class="naver-board-fields"><div class="field"><label for="naver-cafe-url">카페 주소</label><input id="naver-cafe-url" name="cafeUrl" type="url" required maxlength="300" value="${escapeHTML(d.cafe?.url||'')}"></div><div class="field"><label for="naver-club-id">카페 ID</label><input id="naver-club-id" name="clubId" type="text" inputmode="numeric" pattern="[1-9][0-9]*" required value="${escapeHTML(d.cafe?.clubId||'')}"></div><div class="field"><label for="naver-cafe-name">카페 이름</label><input id="naver-cafe-name" name="cafeName" required maxlength="100" value="${escapeHTML(d.cafe?.name||'')}"></div><div class="field"><label for="naver-program-start">프로그램 시작일</label><input id="naver-program-start" name="programStartDate" type="date" required value="${escapeHTML(d.programStartDate||'')}"></div></div><p class="naver-muted">시작일을 1일차로 계산해 글 제목을 만듭니다. 카페 ID를 바꾸면 모든 회원의 게시판 배정과 승인을 다시 확인해주세요.</p></section><div class="section-heading"><h2>회원별 네이버 연결 · 게시판 배정</h2><span>${d.members.length}명</span></div><p class="naver-muted">연결된 계정과 게시판을 확인하거나 승인을 해제할 수 있습니다. 새 연결 승인은 위의 회원 요청 목록에서 처리해주세요.</p><div class="naver-member-list">${d.members.map(naverMemberRow).join('')}</div><p class="form-error" id="naver-admin-error" role="alert"></p><div class="naver-save-bar"><p id="naver-save-status">저장된 설정입니다.</p><div><button type="button" id="refresh-naver-admin" class="button secondary">설정 새로고침</button><button type="submit" id="save-naver-admin" class="button" disabled>연결 설정 저장 ↗</button></div></div></form>`+naverPublicationsView(d.publications);
  const form=host.querySelector('#naver-admin-form');current.saved=naverFormSignature();bindNaverRequests(host,current);
  const update=()=>{const dirty=naverFormSignature()!==current.saved;host.querySelector('#save-naver-admin').disabled=!dirty||current.busy;host.querySelector('#naver-save-status').textContent=dirty?'저장하지 않은 변경사항이 있습니다.':'저장된 설정입니다.';};
  form.oninput=event=>{
    const row=event.target.closest('[data-naver-member]');
    if(row && (event.target.hasAttribute('data-naver-board') || event.target.hasAttribute('data-naver-label'))){const checkbox=row.querySelector('[data-naver-approve]');checkbox.checked=false;checkbox.disabled=true;}
    if(event.target.id==='naver-club-id'||event.target.id==='naver-cafe-url')form.querySelectorAll('[data-naver-approve]').forEach(c=>{c.checked=false;c.disabled=true;});
    update();
  };
  form.onchange=event=>{if(event.target.hasAttribute('data-naver-approve')&&!event.target.checked)event.target.disabled=true;update();};
  host.querySelector('#refresh-naver-admin').onclick=()=>{if(current.busy)return;if(naverIsDirty()&&!confirm('저장하지 않은 연결 설정을 버리고 새로 불러올까요?'))return;mountNaverAdmin();};
  form.onsubmit=async event=>{
    event.preventDefault();if(current.busy)return;const errorNode=host.querySelector('#naver-admin-error');errorNode.textContent='';
    try {
      const reviewDrafts=naverReviewDrafts();
      const clubId=form.elements.clubId.value.trim(), seen=new Set();
      const boards=Array.from(form.querySelectorAll('[data-naver-member]')).map(row=>{
        const member=d.members.find(m=>m.id===row.dataset.naverMember), menuId=naverBoardId(row.querySelector('[data-naver-board]').value,clubId), label=row.querySelector('[data-naver-label]').value.trim();
        if(menuId&&seen.has(menuId))throw new Error('여러 회원에게 같은 게시판이 지정되어 있어요. 회원별 게시판을 확인해주세요.');
        if(menuId)seen.add(menuId);
        if(menuId&&!label)throw new Error(`${member.name} 회원의 게시판 이름을 입력해주세요.`);
        return {memberId:member.id,menuId,label,approvedConnectionId:menuId&&row.querySelector('[data-naver-approve]').checked?member.connection.connectionId:''};
      });
      const body={revision:d.revision,cafe:{clubId,url:form.elements.cafeUrl.value.trim(),name:form.elements.cafeName.value.trim()},programStartDate:form.elements.programStartDate.value,boards};
      current.busy=true;host.inert=true;form.inert=true;update();
      const data=await api('/api/admin/naver',{method:'PUT',body:JSON.stringify(body)});
      if(naverAdminPage!==current)return;
      current.data=data;current.busy=false;host.inert=false;paintNaverAdmin();restoreNaverReviewDrafts(reviewDrafts);
      if(bootstrap?.program && data.programStartDate){bootstrap.program.startDate=data.programStartDate;bootstrap.program.endDate=data.programEndDate||bootstrap.program.endDate;}
      toast('카페 게시판과 계정 승인 설정을 저장했어요.');
    }catch(error){if(naverAdminPage!==current)return;current.busy=false;host.inert=false;form.inert=false;errorNode.textContent=error.status===409?'다른 창에서 회원 연결이나 설정이 변경됐어요. 작성 내용을 확인한 뒤 설정을 새로 불러와주세요.':error.message;update();}
  };
  host.querySelectorAll('.naver-reconcile-form').forEach(reconcileForm=>{
    reconcileForm.elements.outcome.onchange=()=>{
      const absent=reconcileForm.elements.outcome.value==='not_published';
      reconcileForm.elements.articleUrl.required=!absent;reconcileForm.elements.articleUrl.hidden=absent;reconcileForm.querySelector('[data-article-label]').hidden=absent;
      reconcileForm.elements.confirmed.checked=false;
      reconcileForm.querySelector('[data-confirmation-label]').textContent=absent?'카페 게시글과 스팸·검수 대기함을 확인했고, 이 회원의 해당 날짜 글이 어디에도 없는 것을 확인했습니다.':'이 회원의 해당 날짜 식단이 실제로 게시된 것을 확인했습니다.';
      reconcileForm.querySelector('button').textContent=absent?'게시 안 됨 확인 · 회원 재시도 허용':'카페에서 확인한 게시글 연결';
    };
    reconcileForm.onsubmit=async event=>{
    event.preventDefault();const p=d.publications[Number(reconcileForm.dataset.publicationIndex)], errorNode=reconcileForm.querySelector('[data-reconcile-error]');errorNode.textContent='';
    const outcome=reconcileForm.elements.outcome.value, articleUrl=naverSafeArticleUrl(reconcileForm.elements.articleUrl.value.trim());if(outcome!=='not_published'&&!articleUrl){errorNode.textContent='https://cafe.naver.com/ 으로 시작하는 게시글 주소를 입력해주세요.';return;}
    if(!reconcileForm.elements.confirmed.checked)return;
    const button=reconcileForm.querySelector('button');button.disabled=true;
    try {const result=await api('/api/admin/naver/reconcile',{method:'POST',body:JSON.stringify({memberId:p.memberId,date:p.date,...(outcome==='not_published'?{outcome}:{articleUrl}),confirmed:true})});if(naverAdminPage!==current)return;const link=naverSafeArticleUrl(result.publication?.articleUrl);reconcileForm.closest('.naver-publication-row').querySelector('.badge').textContent=outcome==='not_published'?'미게시 확인 · 회원 재시도 가능':'게시 완료';reconcileForm.innerHTML=outcome==='not_published'?'<p class="naver-success">게시되지 않은 기록으로 확인했습니다. 회원이 미리보기를 다시 확인하고 직접 게시할 수 있습니다.</p>':link?`<p class="naver-success">카페 게시글을 연결했습니다.</p><a class="button text" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">게시글 보기 ↗</a>`:'<p class="naver-success">게시 기록을 연결했습니다. 설정을 새로고침해주세요.</p>';}
    catch(error){if(naverAdminPage===current){errorNode.textContent=error.message;button.disabled=false;}}
    };
  });
}
async function mountNaverAdmin(preservedDrafts=[]) {
  const epoch=++naverUIEpoch; naverAdminPage=null;
  try {const [data,requestsData]=await Promise.all([api('/api/admin/naver'),api('/api/admin/naver/requests')]);if(epoch!==naverUIEpoch||!document.querySelector('#naver-admin-content'))return;naverAdminPage={data,requestsData,saved:'',reviewSaved:'',busy:false};paintNaverAdmin();if(Array.isArray(preservedDrafts))restoreNaverReviewDrafts(preservedDrafts);}
  catch(error){if(epoch!==naverUIEpoch)return;const host=document.querySelector('#naver-admin-content');if(!host)return;host.innerHTML=`<section class="card empty-state"><p>${escapeHTML(error.message)}</p><button type="button" class="button secondary" id="retry-naver-admin">다시 불러오기</button></section>`;host.querySelector('button').onclick=mountNaverAdmin;}
}
function naverMemberView() {
  return '<section class="card naver-member-connect"><div class="card-heading"><div><span class="eyebrow">MY NAVER ACCOUNT</span><h2>내 네이버 계정 연결</h2></div></div><div id="naver-member-content" role="status">연결 상태를 불러오고 있어요…</div></section>';
}
async function mountNaverMember() {
  const epoch=naverUIEpoch, host=document.querySelector('#naver-member-content');if(!host)return;
  try {
    const data=await api('/api/naver/status');if(epoch!==naverUIEpoch||!host.isConnected)return;
    const c=data.connection||{}, ready=data.configuration?.ready;
    const result=location.hash==='#settings/naver-success'?'<p class="naver-success">네이버 계정을 연결했습니다. 관리자의 게시판 배정과 승인이 완료되면 게시할 수 있어요.</p>':location.hash==='#settings/naver-error'?'<p class="form-error">네이버 계정을 연결하지 못했어요. 로그인과 동의를 완료한 뒤 다시 시도해주세요. 이미 다른 회원에게 연결된 계정은 사용할 수 없습니다.</p>':'';
    host.innerHTML=result+`<div class="naver-member-heading"><strong>${c.connected?escapeHTML(c.displayName||'연결된 네이버 계정'):'아직 네이버 계정이 연결되지 않았어요.'}</strong><span class="badge">${c.connected?(c.needsReconnect?'재연결 필요':'계정 연결됨'):'연결 대기'}</span></div><p class="naver-muted">${c.connected?'본인 계정으로 카페에 글을 올립니다. 게시판은 관리자가 지정하고 승인합니다.':'본인의 네이버 계정으로 로그인하고 연결에 동의해주세요. 이름이 같아도 로그인 인증을 마친 계정만 연결됩니다.'}</p>${!ready?'<p class="naver-missing">관리자가 네이버 로그인 설정을 준비하고 있어요. 설정이 완료되면 연결할 수 있습니다.</p>':''}<p><a class="button secondary" href="#connect">카페 연동 신청 · 승인 상태 확인 ↗</a></p><div class="naver-connect-actions"><button type="button" class="button naver-connect-button" id="connect-naver" ${ready?'':'disabled'}>${c.connected?'네이버 계정 다시 연결':'네이버 계정 연결'}</button>${c.connected?'<button type="button" class="button secondary" id="disconnect-naver">연결 해제</button>':''}</div><p class="naver-muted">네이버 비밀번호는 네이버 로그인 화면에서만 입력합니다. 계정을 다시 연결하면 관리자의 게시 승인도 다시 확인받아야 합니다.</p><p class="form-error" id="naver-member-error" role="alert"></p>`;
    host.querySelector('#connect-naver').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;const errorNode=host.querySelector('#naver-member-error');errorNode.textContent='';
      try {const result=await api('/api/naver/connect',{method:'POST',body:'{}'});if(epoch!==naverUIEpoch||!host.isConnected)return;location.assign(naverAuthorizeUrl(result.authorizeUrl));}
      catch(error){if(host.isConnected&&epoch===naverUIEpoch){errorNode.textContent=error.message;button.disabled=false;}}
    };
    host.querySelector('#disconnect-naver')?.addEventListener('click',async event=>{
      if(!confirm('네이버 계정 연결을 해제할까요? 다시 연결하면 관리자의 게시 승인이 필요합니다.'))return;
      const button=event.currentTarget;button.disabled=true;
      try {await api('/api/naver/disconnect',{method:'POST',body:'{}'});if(epoch!==naverUIEpoch||!host.isConnected)return;await mountNaverMember();toast('네이버 계정 연결을 해제했어요.');}
      catch(error){if(host.isConnected&&epoch===naverUIEpoch){host.querySelector('#naver-member-error').textContent=error.message;button.disabled=false;}}
    });
  }catch(error){if(epoch!==naverUIEpoch||!host.isConnected)return;host.innerHTML=`<p class="form-error">${escapeHTML(error.message)}</p><button type="button" class="button secondary" id="retry-naver-member">다시 확인</button>`;host.querySelector('button').onclick=mountNaverMember;}
}
