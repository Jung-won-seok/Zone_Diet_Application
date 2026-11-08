let naverUIEpoch = 0;
let naverAdminPage = null;
function cleanupNaverUI() { naverUIEpoch++; naverAdminPage = null; }
function naverFormSignature() {
  const form = document.querySelector('#naver-admin-form');
  return form ? JSON.stringify(Array.from(new FormData(form).entries())) : '';
}
function naverIsDirty() { return Boolean(naverAdminPage && (naverAdminPage.busy || naverFormSignature() !== naverAdminPage.saved)); }
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
function naverAdminView() {
  return heading('NAVER CAFE CONNECTION', '회원과 카페 게시판을 연결해요.', '회원이 직접 인증한 네이버 계정을 확인하고, 글을 올릴 게시판을 지정해주세요.')+'<div id="naver-admin-content"><section class="card empty-state" role="status">네이버 연결 설정을 불러오고 있어요…</section></div>';
}
function naverSetupView(configuration) {
  const ready=configuration?.ready;
  const callback=configuration?.callbackUrl || 'https://zone-diet-application.vercel.app/api/naver/callback';
  return `<section class="card naver-setup-card"><div class="card-heading"><h2>네이버 앱 설정</h2><span class="badge ${ready?'naver-approved':'naver-unlinked'}">${ready?'환경설정 준비됨':'환경설정 필요'}</span></div><p>${ready?'회원이 직접 네이버 로그인을 진행할 수 있습니다. 실제 카페 가입 상태와 게시판 글쓰기 권한은 게시할 때 확인됩니다.':'네이버 개발자센터에서 앱을 등록하고, 서버 환경변수를 설정하면 회원 계정 연결을 사용할 수 있습니다. 게시판 지정은 먼저 저장할 수 있어요.'}</p><details class="naver-setup-details" ${ready?'':'open'}><summary>개발자 등록 · 환경변수 안내</summary><ol><li><a href="https://developers.naver.com/apps/#/register" target="_blank" rel="noopener noreferrer">네이버 개발자센터에서 앱 등록</a> 후 네이버 로그인과 카페 글쓰기 권한을 설정해주세요.</li><li>웹 서비스 URL은 <code>https://zone-diet-application.vercel.app</code>, Callback URL은 아래 값을 등록해주세요.<p class="naver-callback"><code>${escapeHTML(callback)}</code></p></li><li>Vercel 프로젝트의 Settings → Environment Variables에서 Production 환경변수를 등록하고 다시 배포해주세요. 비밀값은 이 화면이나 채팅에 입력하지 않습니다.</li></ol><dl class="naver-env-list"><div><dt>NAVER_CLIENT_ID</dt><dd>네이버 앱의 Client ID</dd></div><div><dt>NAVER_CLIENT_SECRET</dt><dd>네이버 앱의 Client Secret · 비공개</dd></div><div><dt>NAVER_CALLBACK_URL</dt><dd>등록한 Callback URL과 동일한 주소</dd></div><div><dt>NAVER_TOKEN_ENCRYPTION_KEY</dt><dd>연결 정보 암호화용 32바이트 키의 Base64 값 · 비공개</dd></div></dl>${!ready?`<p class="naver-missing">확인이 필요한 설정: ${escapeHTML((configuration?.missing||[]).join(', ')||'서버 설정을 확인해주세요.')}</p>`:''}<p>개발 중에는 네이버 개발자센터의 테스터로 등록된 계정으로 시험합니다. 정식 사용에는 네이버 로그인 검수가 필요합니다.</p></details></section>`;
}
function naverMemberRow(member) {
  const c=member.connection||{}, b=member.board||{};
  const enabled=c.connected && !c.needsReconnect && Boolean(c.connectionId);
  const approved=enabled && b.approvedConnectionId===c.connectionId && Boolean(b.menuId);
  return `<section class="naver-member-row" data-naver-member="${escapeHTML(member.id)}"><div class="naver-member-heading"><div class="member-identity"><span class="member-avatar">${escapeHTML(member.name.slice(-2))}</span><div><strong>${escapeHTML(member.name)}</strong><small>${escapeHTML(member.username)}</small></div></div>${naverConnectionBadge(c,b)}</div><p class="naver-member-account">${c.connected?`회원이 연결한 네이버 계정: <strong>${escapeHTML(c.displayName||'네이버 회원')}</strong>${c.needsReconnect?' · 회원의 재로그인이 필요합니다.':''}`:'회원이 앱의 프로그램 설정에서 네이버 계정을 연결하면 표시됩니다.'}</p><div class="naver-board-fields"><div class="field"><label for="naver-board-${escapeHTML(member.id)}">게시판 번호 또는 링크</label><input id="naver-board-${escapeHTML(member.id)}" name="board-${escapeHTML(member.id)}" data-naver-board maxlength="500" value="${escapeHTML(b.menuId||'')}" placeholder="예: 7 또는 회원 게시판 링크" autocomplete="off"></div><div class="field"><label for="naver-label-${escapeHTML(member.id)}">게시판 이름</label><input id="naver-label-${escapeHTML(member.id)}" name="label-${escapeHTML(member.id)}" data-naver-label maxlength="100" value="${escapeHTML(b.label||'')}" placeholder="예: 2026년 2기 · 김민준" autocomplete="off"></div></div><label class="check-field naver-approval"><input type="checkbox" name="approve-${escapeHTML(member.id)}" data-naver-approve ${approved?'checked':''} ${enabled&&b.menuId?'':'disabled'}> 위 네이버 계정과 게시판을 확인했고, 이 회원의 게시를 승인합니다.</label></section>`;
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
  host.innerHTML=naverSetupView(d.configuration)+`<form id="naver-admin-form"><section class="card naver-cafe-config"><div class="card-heading"><h2>카페 · 프로그램 정보</h2><span class="badge">관리자 설정</span></div><div class="naver-board-fields"><div class="field"><label for="naver-cafe-url">카페 주소</label><input id="naver-cafe-url" name="cafeUrl" type="url" required maxlength="300" value="${escapeHTML(d.cafe?.url||'')}"></div><div class="field"><label for="naver-club-id">카페 ID</label><input id="naver-club-id" name="clubId" type="text" inputmode="numeric" pattern="[1-9][0-9]*" required value="${escapeHTML(d.cafe?.clubId||'')}"></div><div class="field"><label for="naver-cafe-name">카페 이름</label><input id="naver-cafe-name" name="cafeName" required maxlength="100" value="${escapeHTML(d.cafe?.name||'')}"></div><div class="field"><label for="naver-program-start">프로그램 시작일</label><input id="naver-program-start" name="programStartDate" type="date" required value="${escapeHTML(d.programStartDate||'')}"></div></div><p class="naver-muted">시작일을 1일차로 계산해 글 제목을 만듭니다. 카페 ID를 바꾸면 모든 회원의 게시판 배정과 승인을 다시 확인해주세요.</p></section><div class="section-heading"><h2>회원별 네이버 연결 · 게시판 배정</h2><span>${d.members.length}명</span></div><p class="naver-muted">이름만으로 네이버 계정을 연결하지 않습니다. 회원이 직접 인증한 계정에 대해 게시판을 지정하고 승인해주세요.</p><div class="naver-member-list">${d.members.map(naverMemberRow).join('')}</div><p class="form-error" id="naver-admin-error" role="alert"></p><div class="naver-save-bar"><p id="naver-save-status">저장된 설정입니다.</p><div><button type="button" id="refresh-naver-admin" class="button secondary">설정 새로고침</button><button type="submit" id="save-naver-admin" class="button" disabled>연결 설정 저장 ↗</button></div></div></form>`+naverPublicationsView(d.publications);
  const form=host.querySelector('#naver-admin-form');current.saved=naverFormSignature();
  const update=()=>{const dirty=naverIsDirty();host.querySelector('#save-naver-admin').disabled=!dirty||current.busy;host.querySelector('#naver-save-status').textContent=dirty?'저장하지 않은 변경사항이 있습니다.':'저장된 설정입니다.';};
  form.oninput=event=>{
    const row=event.target.closest('[data-naver-member]');
    if(row && (event.target.hasAttribute('data-naver-board') || event.target.hasAttribute('data-naver-label'))){const checkbox=row.querySelector('[data-naver-approve]');checkbox.checked=false;const member=d.members.find(m=>m.id===row.dataset.naverMember);checkbox.disabled=!member?.connection?.connected||member.connection.needsReconnect||!row.querySelector('[data-naver-board]').value.trim();}
    if(event.target.id==='naver-club-id'||event.target.id==='naver-cafe-url')form.querySelectorAll('[data-naver-approve]').forEach(c=>{c.checked=false;});
    update();
  };
  form.onchange=update;
  host.querySelector('#refresh-naver-admin').onclick=()=>{if(naverIsDirty()&&!confirm('저장하지 않은 연결 설정을 버리고 새로 불러올까요?'))return;mountNaverAdmin();};
  form.onsubmit=async event=>{
    event.preventDefault();if(current.busy)return;const errorNode=host.querySelector('#naver-admin-error');errorNode.textContent='';
    try {
      const clubId=form.elements.clubId.value.trim(), seen=new Set();
      const boards=Array.from(form.querySelectorAll('[data-naver-member]')).map(row=>{
        const member=d.members.find(m=>m.id===row.dataset.naverMember), menuId=naverBoardId(row.querySelector('[data-naver-board]').value,clubId), label=row.querySelector('[data-naver-label]').value.trim();
        if(menuId&&seen.has(menuId))throw new Error('여러 회원에게 같은 게시판이 지정되어 있어요. 회원별 게시판을 확인해주세요.');
        if(menuId)seen.add(menuId);
        if(menuId&&!label)throw new Error(`${member.name} 회원의 게시판 이름을 입력해주세요.`);
        return {memberId:member.id,menuId,label,approvedConnectionId:menuId&&row.querySelector('[data-naver-approve]').checked?member.connection.connectionId:''};
      });
      const body={revision:d.revision,cafe:{clubId,url:form.elements.cafeUrl.value.trim(),name:form.elements.cafeName.value.trim()},programStartDate:form.elements.programStartDate.value,boards};
      current.busy=true;form.inert=true;update();
      const data=await api('/api/admin/naver',{method:'PUT',body:JSON.stringify(body)});
      if(naverAdminPage!==current)return;
      current.data=data;current.busy=false;paintNaverAdmin();
      if(bootstrap?.program && data.programStartDate){bootstrap.program.startDate=data.programStartDate;bootstrap.program.endDate=data.programEndDate||bootstrap.program.endDate;}
      toast('카페 게시판과 계정 승인 설정을 저장했어요.');
    }catch(error){if(naverAdminPage!==current)return;current.busy=false;form.inert=false;errorNode.textContent=error.status===409?'다른 창에서 회원 연결이나 설정이 변경됐어요. 작성 내용을 확인한 뒤 설정을 새로 불러와주세요.':error.message;update();}
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
async function mountNaverAdmin() {
  const epoch=++naverUIEpoch; naverAdminPage=null;
  try {const data=await api('/api/admin/naver');if(epoch!==naverUIEpoch||!document.querySelector('#naver-admin-content'))return;naverAdminPage={data,saved:'',busy:false};paintNaverAdmin();}
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
    host.innerHTML=result+`<div class="naver-member-heading"><strong>${c.connected?escapeHTML(c.displayName||'연결된 네이버 계정'):'아직 네이버 계정이 연결되지 않았어요.'}</strong><span class="badge">${c.connected?(c.needsReconnect?'재연결 필요':'계정 연결됨'):'연결 대기'}</span></div><p class="naver-muted">${c.connected?'본인 계정으로 카페에 글을 올립니다. 게시판은 관리자가 지정하고 승인합니다.':'본인의 네이버 계정으로 로그인하고 연결에 동의해주세요. 이름이 같아도 로그인 인증을 마친 계정만 연결됩니다.'}</p>${!ready?'<p class="naver-missing">관리자가 네이버 로그인 설정을 준비하고 있어요. 설정이 완료되면 연결할 수 있습니다.</p>':''}<div class="naver-connect-actions"><button type="button" class="button naver-connect-button" id="connect-naver" ${ready?'':'disabled'}>${c.connected?'네이버 계정 다시 연결':'네이버 계정 연결'}</button>${c.connected?'<button type="button" class="button secondary" id="disconnect-naver">연결 해제</button>':''}</div><p class="naver-muted">네이버 비밀번호는 네이버 로그인 화면에서만 입력합니다. 계정을 다시 연결하면 관리자의 게시 승인도 다시 확인받아야 합니다.</p><p class="form-error" id="naver-member-error" role="alert"></p>`;
    host.querySelector('#connect-naver').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;const errorNode=host.querySelector('#naver-member-error');errorNode.textContent='';
      try {const result=await api('/api/naver/connect',{method:'POST',body:'{}'});if(epoch!==naverUIEpoch||!host.isConnected)return;const url=new URL(result.authorizeUrl);if(url.origin!=='https://nid.naver.com'||url.pathname!=='/oauth2.0/authorize'||url.username||url.password)throw new Error('네이버 로그인 주소를 확인하지 못했어요. 관리자에게 문의해주세요.');location.assign(url.href);}
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
