const ROLE_NAMES = {diet:'식단 담당',leader:'조장 (패널티 관리)',mission:'미션운동 담당',sns:'SNS 담당',other:'기타'};
const ROLE_DESCRIPTIONS = {diet:'팀의 식단 기록을 확인하고 서로의 실천을 챙겨요.',leader:'팀 진행 상황과 패널티 규칙을 챙겨요.',mission:'이번 주 미션운동을 안내하고 참여를 확인해요.',sns:'팀 활동을 정리하고 SNS 인증을 챙겨요.',other:'관리자가 지정한 역할로 팀에 힘을 보태요.'};
let adminDraft = null;
let adminRevision = null;
let adminSaved = '';
let teamFilter = 'all';
let memberSearch = '';
function resetAdminDraft() { adminDraft = null; adminRevision = null; adminSaved = ''; teamFilter = 'all'; memberSearch = ''; }
function initAdminDraft() { if(!adminDraft) { adminDraft = bootstrap.members.map(m=>({...m})); adminRevision = bootstrap.revision; adminSaved = JSON.stringify(adminDraft); } }
function adminIsDirty() { return Boolean(adminDraft && JSON.stringify(adminDraft) !== adminSaved); }
function teamName(id) { return bootstrap.teams.find(t=>t.id===id)?.name || '미배정'; }
function roleName(m) { return m.role === 'other' ? `기타 · ${m.customRole || '역할명 입력'}` : ROLE_NAMES[m.role] || '미배정'; }
function roleBadge(m) { return `<span class="role-pill role-${escapeHTML(m.role || 'none')}">${escapeHTML(roleName(m))}</span>`; }
function adminIssues() {
  const errors = [], warnings = [];
  for(const team of bootstrap.teams) {
    const members = adminDraft.filter(m=>m.teamId===team.id);
    if(members.length>6) errors.push(`${team.name}: 한 팀에 최대 6명까지 배정할 수 있어요.`);
    if(members.length && members.length<4) warnings.push(`${team.name} ${members.length}명`);
    for(const role of ['diet','leader','mission','sns']) {
      const count = members.filter(m=>m.role===role).length;
      if(count>1) errors.push(`${team.name}: ${ROLE_NAMES[role]}이 중복됐어요.`);
      if(members.length && count===0) warnings.push(`${team.name} ${ROLE_NAMES[role]} 미배정`);
    }
  }
  for(const m of adminDraft) {
    if(m.teamId && !m.role) errors.push(`${m.name}: 역할을 선택해주세요.`);
    if(m.role==='other' && !m.customRole.trim()) errors.push(`${m.name}: 기타 역할명을 입력해주세요.`);
  }
  return {errors,warnings};
}
function adminView() {
  initAdminDraft();
  return heading('TEAM BUILDER', '함께할 팀을 만들어주세요.', '팀을 나누고, 각자의 역할을 정해요. 변경한 내용은 저장 후 회원에게 반영됩니다.', '<span class="date-tag">관리자 전용</span>') +
  `<section class="program-strip"><div><span class="eyebrow">8-WEEK TEAM PROGRAM</span><h2>${escapeHTML(bootstrap.program.name)}</h2><p>${escapeHTML(bootstrap.program.startDate)} — ${escapeHTML(bootstrap.program.endDate)}</p></div><div class="program-numbers"><div><strong>${bootstrap.members.length}</strong><span>참여 회원</span></div><div><strong>${bootstrap.teams.length}</strong><span>팀</span></div><div><strong>8</strong><span>주간 여정</span></div></div></section>
  <div class="section-heading"><h2>팀 편성 현황</h2><span>팀당 최대 6명 · 기본 역할 4개 + 기타</span></div><div class="team-grid" id="team-summary">${teamSummaries()}</div>
  <section class="card assignment-card"><div class="card-heading"><div><h2>회원 배정 · 역할 설정</h2><p class="subtitle">기본 역할은 팀마다 한 명씩, 추가 인원은 기타 역할로 지정해요.</p></div><span class="badge">가상 회원 20명</span></div><div class="admin-toolbar"><div class="search-wrap"><label class="sr-only" for="member-search">회원 이름 또는 아이디 검색</label><input id="member-search" placeholder="이름 또는 아이디 검색" value="${escapeHTML(memberSearch)}"></div><label class="sr-only" for="team-filter">팀 필터</label><select id="team-filter"><option value="all">전체 팀</option>${bootstrap.teams.map(t=>`<option value="${escapeHTML(t.id)}" ${teamFilter===t.id?'selected':''}>${escapeHTML(t.name)}</option>`).join('')}<option value="none" ${teamFilter==='none'?'selected':''}>미배정</option></select></div><details class="preset-picker"><summary>인원별 팀 편성 예시 적용</summary><p>아래 예시는 현재 편집 내용을 바꿉니다. 저장하기 전까지 회원에게 반영되지 않습니다.</p><div><button type="button" data-preset="4,4,4,4,4">4명 × 5팀</button><button type="button" data-preset="5,5,5,5,0">5명 × 4팀</button><button type="button" data-preset="6,5,5,4,0">6명 / 5명 / 5명 / 4명</button></div></details><div class="assignment-head"><span>회원</span><span>소속 팀</span><span>팀 역할</span><span>기타 역할명</span></div><div id="assignment-list">${assignmentRows()}</div><div id="assignment-feedback" aria-live="polite">${assignmentFeedback()}</div></section><div class="save-bar"><div id="save-status">${saveStatus()}</div><div><button type="button" id="reset-assignments" class="button secondary">저장된 편성 불러오기</button><button type="button" id="save-assignments" class="button" ${!adminIsDirty()||adminIssues().errors.length?'disabled':''}>변경사항 저장 ↗</button></div></div><p class="admin-footnote">역할은 담당 업무를 표시합니다. 패널티 부과·SNS 게시·미션 등록 기능은 아직 연결되지 않았습니다.</p>`;
}
function teamSummaries() {
  return bootstrap.teams.map((team,i)=>{
    const members=adminDraft.filter(m=>m.teamId===team.id);
    const fullRoles=['diet','leader','mission','sns'].filter(role=>members.some(m=>m.role===role)).length;
    return `<button type="button" class="team-summary ${teamFilter===team.id?'selected':''}" data-filter="${escapeHTML(team.id)}"><div class="team-summary-top"><span class="team-dot color-${i}">${i+1}</span><strong>${members.length}<small> / 6명</small></strong></div><h3>${escapeHTML(team.name)}</h3><div class="team-mini-members">${members.length ? members.map(m=>`<span title="${escapeHTML(m.name)}">${escapeHTML(m.name.slice(-2))}</span>`).join('') : '<em>아직 배정된 회원이 없어요</em>'}</div><p>${members.length ? `기본 역할 ${fullRoles}/4 · 기타 ${members.filter(m=>m.role==='other').length}명` : '새로운 팀을 구성할 수 있어요'}</p></button>`;
  }).join('');
}
function assignmentRows() {
  const members = adminDraft.filter(m=>(teamFilter==='all'||(teamFilter==='none'?!m.teamId:m.teamId===teamFilter)) && `${m.name} ${m.username}`.toLowerCase().includes(memberSearch.toLowerCase()));
  if(!members.length) return '<p class="empty-state">조건에 맞는 회원이 없습니다.</p>';
  return members.map(m=>`<div class="assignment-row" data-member="${escapeHTML(m.id)}"><div class="member-identity"><span class="member-avatar">${escapeHTML(m.name.slice(-2))}</span><div><strong>${escapeHTML(m.name)}</strong><small>${escapeHTML(m.username)}</small></div></div><div><label class="sr-only" for="team-${m.id}">${escapeHTML(m.name)} 팀</label><select id="team-${m.id}" data-edit="teamId"><option value="">미배정</option>${bootstrap.teams.map(t=>`<option value="${t.id}" ${m.teamId===t.id?'selected':''}>${escapeHTML(t.name)}</option>`).join('')}</select></div><div><label class="sr-only" for="role-${m.id}">${escapeHTML(m.name)} 역할</label><select id="role-${m.id}" data-edit="role" ${!m.teamId?'disabled':''}><option value="">역할 선택</option>${Object.entries(ROLE_NAMES).map(([key,label])=>`<option value="${key}" ${m.role===key?'selected':''}>${label}</option>`).join('')}</select></div><div><label class="sr-only" for="custom-${m.id}">${escapeHTML(m.name)} 기타 역할명</label><input id="custom-${m.id}" data-edit="customRole" maxlength="40" value="${escapeHTML(m.customRole)}" ${m.role!=='other'?'disabled':''} placeholder="${m.role==='other'?'예: 기록 담당':'기타 선택 시 입력'}"></div></div>`).join('');
}
function assignmentFeedback() { const {errors,warnings}=adminIssues(); return errors.length ? `<div class="validation-box error"><strong>저장 전 확인해주세요</strong><ul>${errors.map(e=>`<li>${escapeHTML(e)}</li>`).join('')}</ul></div>` : warnings.length ? `<div class="validation-box"><strong>편성 중인 팀이 있어요 · 현재 상태로 저장할 수 있습니다</strong><p>${warnings.map(escapeHTML).join(' / ')}</p></div>` : '<p class="validation-ok">✓ 모든 팀의 인원과 역할 구성이 확인되었습니다.</p>'; }
function saveStatus() { return adminIsDirty() ? '<strong>저장하지 않은 변경사항</strong><span>회원에게는 아직 이전 편성이 표시됩니다.</span>' : '<strong>저장된 편성입니다</strong><span>회원은 자기 팀과 역할을 확인할 수 있어요.</span>'; }
function updateAdminSummary() {
  document.querySelector('#team-summary').innerHTML=teamSummaries();
  document.querySelector('#assignment-feedback').innerHTML=assignmentFeedback();
  document.querySelector('#save-status').innerHTML=saveStatus();
  document.querySelector('#save-assignments').disabled=!adminIsDirty()||adminIssues().errors.length>0;
}
function bindAdmin() {
  document.querySelector('#team-summary').addEventListener('click',event=>{ const target=event.target.closest('[data-filter]'); if(!target)return; teamFilter=teamFilter===target.dataset.filter?'all':target.dataset.filter; document.querySelector('#team-filter').value=teamFilter; document.querySelector('#assignment-list').innerHTML=assignmentRows(); updateAdminSummary(); });
  document.querySelector('#team-filter').addEventListener('change',event=>{teamFilter=event.target.value;document.querySelector('#assignment-list').innerHTML=assignmentRows();updateAdminSummary();});
  document.querySelector('#member-search').addEventListener('input',event=>{memberSearch=event.target.value;document.querySelector('#assignment-list').innerHTML=assignmentRows();});
  document.querySelector('#assignment-list').addEventListener('change',event=>{
    const field=event.target.dataset.edit; if(!field || field==='customRole')return;
    const member=adminDraft.find(m=>m.id===event.target.closest('[data-member]').dataset.member);
    member[field]=event.target.value || (field==='teamId'?null:'');
    if(!member.teamId) {member.role='';member.customRole='';}
    else if(field==='teamId') {const used=adminDraft.filter(m=>m.id!==member.id&&m.teamId===member.teamId).map(m=>m.role);if(!member.role||used.includes(member.role)) {member.role=['diet','leader','mission','sns'].find(r=>!used.includes(r))||'other';member.customRole='';}}
    if(member.role!=='other')member.customRole='';
    document.querySelector('#assignment-list').innerHTML=assignmentRows();updateAdminSummary();
  });
  document.querySelector('#assignment-list').addEventListener('input',event=>{if(event.target.dataset.edit!=='customRole')return;const member=adminDraft.find(m=>m.id===event.target.closest('[data-member]').dataset.member);member.customRole=event.target.value;updateAdminSummary();});
  document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{
    const counts=button.dataset.preset.split(',').map(Number);let cursor=0;
    counts.forEach((count,index)=>{for(let j=0;j<count;j++){const m=adminDraft[cursor++];m.teamId=bootstrap.teams[index].id;m.role=['diet','leader','mission','sns'][j]||'other';m.customRole=j===4?'기록 담당':j===5?'응원 담당':'';}});
    teamFilter='all';memberSearch='';document.querySelector('#team-filter').value='all';document.querySelector('#member-search').value='';document.querySelector('#assignment-list').innerHTML=assignmentRows();updateAdminSummary();toast('편성 예시를 적용했어요. 저장하면 회원에게 반영됩니다.');
  }));
  document.querySelector('#save-assignments').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;button.textContent='저장 중…';
    const roster=adminDraft.map(({id,teamId,role,customRole})=>({id,teamId,role,customRole:customRole.trim()}));
    document.querySelector('.assignment-card').inert=true;
    document.querySelector('#reset-assignments').disabled=true;
    try {const data=await api('/api/admin/assignments',{method:'PUT',body:JSON.stringify({revision:adminRevision,members:roster})});bootstrap=data;resetAdminDraft();render();toast('팀과 역할을 저장했어요. 회원 화면에도 반영됩니다.');}
    catch(error) {toast(error.status===409?'다른 관리 화면에서 편성이 변경됐어요. 저장된 편성을 불러온 후 다시 수정해주세요.':error.message);if(session && document.querySelector('.assignment-card')){document.querySelector('.assignment-card').inert=false;document.querySelector('#reset-assignments').disabled=false;button.textContent='변경사항 저장 ↗';updateAdminSummary();}}
  });
  document.querySelector('#reset-assignments').addEventListener('click',async()=>{if(adminIsDirty()&&!confirm('저장하지 않은 변경을 버리고 저장된 편성을 불러올까요?'))return;try{await loadBootstrap();resetAdminDraft();render();toast('저장된 편성을 불러왔어요.');}catch(error){toast(error.message);}});
}
function accountsView() {
  return heading('MEMBER DIRECTORY','함께하는 20명의 멤버.','관리자 계정은 팀 인원에 포함되지 않습니다. 아래 정보는 저장된 편성을 기준으로 표시됩니다.')+`<section class="card"><div class="card-heading"><h2>회원 계정 목록</h2><span class="badge">20명 · 가상 데이터</span></div><p class="account-info">초기 비밀번호는 전달받은 <strong>계정 안내 파일</strong>에 있습니다. 이 화면에는 비밀번호를 표시하지 않습니다.</p><div class="directory-head"><span>회원</span><span>아이디</span><span>소속 팀</span><span>역할</span></div>${bootstrap.members.map(m=>`<div class="directory-row"><strong>${escapeHTML(m.name)}</strong><code>${escapeHTML(m.username)}</code><span>${escapeHTML(teamName(m.teamId))}</span>${roleBadge(m)}</div>`).join('')}</section>`;
}
function memberTeamBanner() {
  const me=bootstrap.members.find(m=>m.id===session.id);
  return `<a class="member-team-banner" href="#team"><span><strong>${escapeHTML(bootstrap.program.name)} · ${escapeHTML(teamName(me?.teamId))}</strong><small>나의 역할: ${escapeHTML(me?roleName(me):'미배정')}</small></span><span>우리 팀 보기 ↗</span></a>`;
}
function memberTeamView() {
  const me=bootstrap.members.find(m=>m.id===session.id);
  const members=me?.teamId?bootstrap.members.filter(m=>m.teamId===me.teamId):[];
  return heading('MY TEAM',me?.teamId?`${escapeHTML(teamName(me.teamId))}, 함께하는 8주.`:'팀 배정을 기다리고 있어요.', '팀과 역할은 관리자가 지정합니다.', '<button type="button" class="button secondary" id="refresh-team">최신 편성 확인 ↻</button>')+
  `<section class="program-strip"><div><span class="eyebrow">MY RESPONSIBILITY</span><h2>${escapeHTML(me?roleName(me):'미배정')}</h2><p>${escapeHTML(me?.role?ROLE_DESCRIPTIONS[me.role]:'관리자가 배정하면 이곳에 팀과 역할이 표시됩니다.')}</p></div><div class="program-numbers"><div><strong>${members.length}</strong><span>우리 팀 멤버</span></div></div></section><div class="member-team-grid">${members.map(m=>`<section class="card teammate-card"><div class="member-identity"><span class="member-avatar">${escapeHTML(m.name.slice(-2))}</span><div><h2>${escapeHTML(m.name)} ${m.id===session.id?'<span class="badge">나</span>':''}</h2><small>${escapeHTML(bootstrap.program.name)}</small></div></div>${roleBadge(m)}<p>${escapeHTML(ROLE_DESCRIPTIONS[m.role]||'역할 배정을 기다리고 있어요.')}</p></section>`).join('')}</div><p class="privacy-note">팀원의 개인 체중과 식단 기록은 이 화면에 표시되지 않습니다.<br>현재는 팀 편성과 역할 확인 기능이 연결되어 있습니다.</p>`;
}
