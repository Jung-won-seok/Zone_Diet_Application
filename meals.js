const MEAL_NAMES = {breakfast:'아침',lunch:'점심',dinner:'저녁'};
const MEAL_BLOCK_NAMES = {carbs:'탄수화물',protein:'단백질',fat:'지방'};
function postBlocks(post) {
  return Object.fromEntries(Object.keys(MEAL_BLOCK_NAMES).map(key=>[key,typeof post?.blocks?.[key]==='number'&&Number.isFinite(post.blocks[key])?post.blocks[key]:null]));
}
function formatMealBlock(value) { return value===null || value===undefined?'—':String(Math.round(value*100)/100); }
function readMealBlocksDraft() {
  return Object.fromEntries(Object.keys(MEAL_BLOCK_NAMES).map(key=>[key,document.querySelector(`#meal-block-${key}`)?.value ?? mealPage?.blocksDraft?.[key] ?? '']));
}
function blocksChanged() {
  const saved=postBlocks(ownMeal()),draft=readMealBlocksDraft();
  return Object.keys(MEAL_BLOCK_NAMES).some(key=>{
    const input=document.querySelector(`#meal-block-${key}`);
    if(input && !input.validity.valid)return true;
    return (draft[key]===''?null:Number(draft[key]))!==saved[key];
  });
}
const MAX_MEAL_PHOTOS = 6;
const MAX_PHOTO_ENCODED = 2600000;
const MAX_MEAL_ENCODED = 2800000;
let mealPhotoSequence = 0;
function postPhotos(post) {
  if(Array.isArray(post?.photos) && post.photos.length) return post.photos.map(photo=>({id:photo.id,url:photo.url}));
  if(post?.imageUrl) return [{id:post.mediaId || post.imageUrl.split('/').pop(),url:post.imageUrl}];
  return [];
}
function ensureMealDraft() {
  if(mealPage.draftPhotos !== null)return;
  const post=ownMeal();
  mealPage.draftPhotos=postPhotos(post);
  mealPage.captionDraft=post?.caption||'';
  mealPage.blocksDraft=Object.fromEntries(Object.entries(postBlocks(post)).map(([key,value])=>[key,value===null?'':String(value)]));
}
function photosChanged() {
  if(!mealPage?.draftPhotos)return false;
  return JSON.stringify(mealPage.draftPhotos.map(photo=>photo.id||photo.key)) !== JSON.stringify(postPhotos(ownMeal()).map(photo=>photo.id));
}
let mealEpoch = 0;
let mealPage = null;
function mealsHasUnsaved() {
  if(!mealPage || mealPage.board || !mealPage.data?.team) return false;
  const caption=document.querySelector('#meal-caption')?.value ?? mealPage.captionDraft ?? '';
  return Boolean(photosChanged() || blocksChanged() || mealPage.busy || mealPage.converting || caption!==(ownMeal()?.caption||''));
}
function confirmMealDiscard() {
  if(mealPage?.busy){toast('식단을 저장하고 있어요. 저장이 끝난 뒤 이동해주세요.');return Promise.resolve(false);}
  return new Promise(resolve=>{
    const dialog=createMealDialog(`<div class="dialog-heading"><h2>아직 저장하지 않은 식단이 있어요.</h2></div><div class="report-preview-body"><p class="report-scope">선택한 사진과 입력한 블록·메모를 버리고 이동할까요?</p></div><div class="dialog-footer"><button type="button" class="button secondary" id="keep-meal-draft">계속 작성하기</button><button type="button" class="button" id="discard-meal-draft">버리고 이동하기</button></div>`);
    dialog.querySelector('#keep-meal-draft').onclick=()=>dialog.close('keep');
    dialog.querySelector('#discard-meal-draft').onclick=()=>dialog.close('discard');
    dialog.addEventListener('close',()=>resolve(dialog.returnValue==='discard'),{once:true});
  });
}
function cleanupMeals() {
  mealEpoch++;
  document.querySelector('#meal-dialog')?.remove();
  document.querySelector('#meal-gallery-dialog')?.remove();
  mealPage = null;
}
function mealLoadingView(board=false) {
  return heading(board?'ALL TEAMS, ONE TABLE':'OUR TEAM TABLE',board?'우리 조 오늘 식단입니다.':'오늘도, 함께 잘 먹기.',board?'각 팀 식단 담당이 공유한 하루 식단 모음을 확인해요.':'아침부터 저녁까지, 팀원들의 식단을 한곳에 모아요.')+'<div id="meal-content"><div class="card empty-state" role="status">식단을 불러오고 있어요…</div></div>';
}
async function mountMeals(board,date) {
  const epoch=mealEpoch;
  mealPage={epoch,board,date,data:null,selectedMeal:'breakfast',draftPhotos:null,captionDraft:'',blocksDraft:null,busy:false,converting:false,fileToken:0};
  try {
    const data=await api(`${board?'/api/reports':'/api/meals'}?date=${encodeURIComponent(date)}`);
    if(mealEpoch!==epoch)return;
    mealPage.data=data; paintMeals();
  } catch(error) {
    if(mealEpoch!==epoch||!document.querySelector('#meal-content'))return;
    document.querySelector('#meal-content').innerHTML=`<div class="card empty-state"><p>${escapeHTML(error.message)}</p><button type="button" class="button secondary" id="retry-meals">다시 불러오기</button></div>`;
    document.querySelector('#retry-meals').onclick=()=>mountMeals(board,date);
  }
}
function dateControls() {
  return `<div class="meal-date-bar"><div><label for="meal-date">확인할 날짜</label><input id="meal-date" type="date" max="${todayKey()}" value="${escapeHTML(mealPage.date)}" required></div><button class="button secondary" type="button" id="refresh-meals">새로고침 ↻</button></div>`;
}
function ownMeal() { return mealPage?.data?.posts?.find(p=>p.memberId===session.id && p.meal===mealPage.selectedMeal); }
function blockBadges(post) {
  const blocks=postBlocks(post);
  return `<div class="meal-block-badges" aria-label="끼니별 블록">${Object.entries(MEAL_BLOCK_NAMES).map(([key,label])=>`<span><small>${label}</small><strong>${formatMealBlock(blocks[key])}</strong></span>`).join('')}</div>`;
}
function photoTile(post,name,meal,report=false) {
  const photos=postPhotos(post);
  const caption=`${name} · ${MEAL_NAMES[meal]}${post?.caption?' · '+post.caption:''}`;
  return `<div class="meal-photo-tile ${photos.length?'has-photo':'missing-photo'}"><div class="meal-tile-label">${MEAL_NAMES[meal]}<span>${photos.length?`사진 ${photos.length}장`:post?'블록 기록':'미등록'}</span></div>${photos.length?`<div class="meal-photo-collage count-${photos.length}">${photos.map((photo,index)=>`<button type="button" class="photo-open" data-photo="${escapeHTML(photo.url)}" data-photos="${escapeHTML(JSON.stringify(photos.map(item=>item.url)))}" data-photo-index="${index}" data-photo-caption="${escapeHTML(caption)}" aria-label="${escapeHTML(name)} ${MEAL_NAMES[meal]} 사진 ${index+1}/${photos.length} 크게 보기"><img src="${escapeHTML(photo.url)}" alt="${escapeHTML(name)}의 ${MEAL_NAMES[meal]} 식단 사진 ${index+1}" loading="lazy"><span class="tile-photo-number">${index+1}</span></button>`).join('')}</div>`:`<div class="photo-placeholder"><span>▧</span><small>${report?'공유 당시 사진 없음':'아직 사진이 없어요'}</small></div>`}${blockBadges(post)}${post?.caption?`<p class="photo-caption">${escapeHTML(post.caption)}</p>`:''}</div>`;
}
function mealGrid(data,report=false) {
  return `<div class="meal-member-list">${data.members.map(m=>{
    const posts=data.posts.filter(p=>p.memberId===m.id);
    return `<section class="meal-member-row"><div class="meal-member-header"><div class="member-identity"><span class="member-avatar">${escapeHTML(m.name.slice(-2))}</span><div><strong>${escapeHTML(m.name)} ${m.id===session.id?'<span class="badge">나</span>':''}</strong>${!report&&m.role?`<small>${escapeHTML(roleName(m))}</small>`:''}</div></div><span class="meal-completion">${posts.length}<span> / 3끼</span></span></div><div class="three-meals">${Object.keys(MEAL_NAMES).map(meal=>photoTile(posts.find(p=>p.meal===meal),m.name,meal,report)).join('')}</div></section>`;
  }).join('')}</div>`;
}
function draftPhotoMarkup() {
  const photos=mealPage.draftPhotos;
  if(!photos.length)return '<div class="draft-photo-empty"><span>＋</span><p>한 끼의 사진을 모아보세요</p><small>한 번에 선택하거나 촬영해서 추가해요</small></div>';
  return `<div class="draft-photo-grid">${photos.map((photo,index)=>`<div class="draft-photo-item"><img src="${escapeHTML(photo.url || photo.imageData)}" alt="${MEAL_NAMES[mealPage.selectedMeal]} 사진 ${index+1} 미리보기"><span class="draft-photo-badge">${index+1} · ${photo.id?'등록된 사진':'새 사진'}</span><button type="button" class="remove-meal-photo" data-remove-photo="${index}" aria-label="사진 ${index+1} 제거" ${mealPage.busy||mealPage.converting?'disabled':''}>×</button></div>`).join('')}</div>`;
}
function blockInputsView() {
  return `<fieldset class="meal-block-fields"><legend>이번 끼니 블록 <span>선택</span></legend><div class="meal-block-inputs">${Object.entries(MEAL_BLOCK_NAMES).map(([key,label])=>`<div class="field"><label for="meal-block-${key}">${label} <small>블록</small></label><input id="meal-block-${key}" name="${key}" type="number" inputmode="decimal" min="0" max="100" step="0.01" placeholder="미입력" value="${escapeHTML(mealPage.blocksDraft[key])}" aria-describedby="meal-block-help"></div>`).join('')}</div><p id="meal-block-help">0블록도 입력할 수 있어요. 빈칸은 미입력으로 남으며, 사진 없이 블록만 저장할 수도 있어요.</p></fieldset>`;
}
function dailyBlocksView() {
  const posts=mealPage.data.posts.filter(post=>post.memberId===session.id);
  const summary=MealSummary.summarize(posts);
  return `<section class="card daily-block-summary"><div class="card-heading"><div><div class="eyebrow">MY DAILY BLOCKS</div><h2>나의 하루 블록 합계</h2></div><span class="badge">${summary.completeMeals} / 3끼 입력 완료</span></div><div class="daily-block-totals">${Object.entries(MEAL_BLOCK_NAMES).map(([key,label])=>`<div><span>${label}</span><strong>${summary.counts[key]?formatMealBlock(summary.totals[key]):'—'}<small>블록</small></strong><p>${summary.counts[key]} / 3끼 입력${summary.counts[key]<3?` · ${3-summary.counts[key]}끼 미입력`:''}</p></div>`).join('')}</div><div class="daily-block-table-wrap"><table class="daily-block-table"><caption class="sr-only">${escapeHTML(mealPage.date)} 나의 끼니별 블록</caption><thead><tr><th scope="col">끼니</th>${Object.values(MEAL_BLOCK_NAMES).map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${Object.entries(MEAL_NAMES).map(([meal,label])=>{const blocks=postBlocks(posts.find(post=>post.meal===meal));return `<tr><th scope="row">${label}</th>${Object.keys(MEAL_BLOCK_NAMES).map(key=>`<td>${blocks[key]===null?'<span class="unentered-block">미입력</span>':formatMealBlock(blocks[key])}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div><div class="daily-block-footer"><p>저장한 내 식단의 입력된 항목만 합산해요.<br>사진 ${summary.photoCount}장과 블록 기록으로 카페 글을 만들 수 있어요.</p><button type="button" class="button" id="preview-cafe-draft" ${posts.length?'':'disabled'}>네이버 카페에 올리기 ↗</button></div></section>`;
}
function composerView() {
  ensureMealDraft();
  const post=ownMeal();
  return `<section class="card meal-composer"><div class="card-heading"><div><div class="eyebrow">MY DAILY PLATE</div><h2>내 식단 기록하기</h2></div><span class="badge">한 끼 최대 ${MAX_MEAL_PHOTOS}장</span></div><div class="meal-tabs" role="group" aria-label="등록할 끼니">${Object.entries(MEAL_NAMES).map(([key,label])=>`<button type="button" data-meal="${key}" aria-pressed="${mealPage.selectedMeal===key}" class="${mealPage.selectedMeal===key?'active':''}">${label}${mealPage.data.posts.some(p=>p.memberId===session.id&&p.meal===key)?' ✓':''}</button>`).join('')}</div><form id="meal-upload-form"><div class="upload-layout"><div class="upload-collection"><div class="upload-collection-heading"><span>선택한 사진</span><strong id="meal-photo-count">${mealPage.draftPhotos.length} / ${MAX_MEAL_PHOTOS}장</strong></div><div class="upload-photo multi-photo-upload" id="upload-preview">${draftPhotoMarkup()}</div><p class="draft-photo-help">사진을 추가하거나 ×로 빼고 저장해주세요.</p></div><div class="upload-fields"><div class="photo-actions"><label class="button secondary file-button">사진 선택<input id="meal-file" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="식단 사진 선택"></label><label class="button secondary file-button">카메라로 촬영<input id="meal-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="식단 사진 촬영"></label></div><p class="photo-selection-help">여러 장을 한 번에 선택할 수 있어요. 촬영한 사진도 이어서 추가됩니다.</p><p id="meal-photo-status" class="photo-processing-status" role="status" aria-live="polite"></p>${blockInputsView()}<div class="field"><label for="meal-caption">한 끼 메모 <small>선택</small></label><textarea id="meal-caption" maxlength="300" placeholder="예: 닭가슴살, 현미밥, 샐러드">${escapeHTML(mealPage.captionDraft)}</textarea></div><p class="meal-upload-note">사진·블록·한 끼 메모는 팀원과 관리자에게 보이며, 식단 담당이 전체 회원에게 공유할 수 있어요. 체중과 개인 메모는 포함되지 않아요.</p><p class="form-error" id="meal-upload-error" role="alert"></p><button type="submit" class="button" id="upload-meal">${post?'식단 수정하기':'우리 팀에 올리기'} ↗</button></div></div></form></section>`;
}
function updateDraftPhotos() {
  if(!mealPage || !document.querySelector('#upload-preview'))return;
  document.querySelector('#upload-preview').innerHTML=draftPhotoMarkup();
  document.querySelector('#meal-photo-count').textContent=`${mealPage.draftPhotos.length} / ${MAX_MEAL_PHOTOS}장`;
}
function updatePhotoControls() {
  if(!mealPage)return;
  const locked=mealPage.busy||mealPage.converting;
  document.querySelectorAll('#meal-file, #meal-camera, [data-remove-photo], #upload-meal, #meal-caption, .meal-block-inputs input').forEach(input=>{input.disabled=locked;});
  const preview=document.querySelector('#preview-cafe-draft');
  if(preview)preview.disabled=locked || !mealPage.data.posts.some(post=>post.memberId===session.id);
}
function shareStatus() {
  const d=mealPage.data, report=d.report, changed=report&&report.sourceRevision!==d.revision;
  return `<section class="meal-share-strip"><div><div class="eyebrow">TEAM DAILY REPORT</div><h2>${report?(changed?'공유 이후 식단이 변경됐어요.':'오늘의 팀 식단을 공유했어요.'):'우리 조 오늘 식단, 한 번에 공유.'}</h2><p>${d.canPublish?'식단 담당인 내가 사진 모음을 확인한 후 전체 회원에게 공유해요.':'식단 담당이 팀의 하루 식단을 모아 전체 게시판에 공유합니다.'}</p><p class="share-meta">${d.posts.length} / ${d.members.length*3}끼 기록${report?` · ${escapeHTML(report.publishedBy.name)} 공유 · ${report.version}차`:''}</p></div><div>${d.canPublish?`<button type="button" id="preview-report" class="button" ${d.posts.length?'':'disabled'}>${report?'수정 모음 미리보기':'전체 공유 미리보기'} ↗</button>`:`<span class="badge">${report?'전체 공유 완료':'식단 담당 공유 대기'}</span>`}${report?`<a class="button text" href="#board/${mealPage.date}">전체 게시판 보기 ↗</a>`:''}</div></section>`;
}
function teamMealContent() {
  const d=mealPage.data;
  if(!d.team)return dateControls()+'<section class="card empty-state">아직 팀이 배정되지 않았어요.<br>관리자가 팀을 배정하면 식단 사진과 블록을 함께 기록할 수 있습니다.</section>';
  return dateControls()+`<div class="team-table-heading"><div><span class="eyebrow">${escapeHTML(bootstrap.program.name)}</span><h2>${escapeHTML(d.team.name)}의 식탁</h2></div><span class="badge">${d.members.length}명이 함께해요</span></div>`+composerView()+dailyBlocksView()+shareStatus()+`<div class="section-heading"><h2>팀원들의 하루 식단</h2><span>${dateLabel(mealPage.date)}</span></div>`+mealGrid(d)+`<details class="team-role-details"><summary>우리 팀 역할 확인</summary><div>${d.members.map(m=>`<div><strong>${escapeHTML(m.name)}</strong>${roleBadge(m)}</div>`).join('')}</div></details>`;
}
function reportCard(report) {
  return `<article class="card report-card"><div class="report-card-header"><div><span class="eyebrow">${escapeHTML(report.teamName)}</span><h2>우리 조 오늘 식단입니다.</h2><p>${escapeHTML(report.publishedBy.name)} · 식단 담당 <span>· ${report.version}차 공유</span></p></div><span class="badge">${report.completedCount} / ${report.expectedCount}끼</span></div>${report.caption?`<p class="report-message">${escapeHTML(report.caption)}</p>`:''}${mealGrid(report,true)}<div class="report-footer"><span>${new Date(report.publishedAt).toLocaleString('ko-KR',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})} 공유</span><span>공유할 때의 식단·블록 기록</span></div></article>`;
}
function boardContent() {
  const reports=mealPage.data.reports;
  return dateControls()+`<section class="board-banner"><div><span class="eyebrow">DAILY TEAM ROUNDUP</span><h2>각자의 한 끼가 모여,<br>우리의 하루가 됩니다.</h2><p>식단 담당이 확인하고 공유한 팀별 식단이에요.</p></div><div class="board-count"><strong>${reports.length}<small> / ${bootstrap.teams.length}</small></strong><span>공유한 팀</span></div></section><div class="section-heading"><h2>${dateLabel(mealPage.date)} 식단 모음</h2><span>전체 회원 · 관리자에게 공개</span></div>${reports.length?reports.map(reportCard).join(''):`<section class="card empty-state"><div class="empty-food">▧</div><h2>아직 공유된 팀 식단이 없어요.</h2><p>팀원들이 사진을 올리고 식단 담당이 공유하면<br>이곳에 하루 식단 모음이 나타납니다.</p>${!session.isAdmin?`<a class="button secondary" href="#team/${mealPage.date}">우리 팀 식단 보러 가기 ↗</a>`:''}</section>`}`;
}
function paintMeals() {
  const host=document.querySelector('#meal-content'); if(!host||!mealPage)return;
  host.innerHTML=mealPage.board?boardContent():teamMealContent();
  document.querySelector('#meal-date').addEventListener('change',event=>{if(event.target.checkValidity()){location.hash=`${mealPage.board?'board':'team'}/${event.target.value}`;}});
  document.querySelector('#refresh-meals').onclick=async()=>{if(mealsHasUnsaved()&&!await confirmMealDiscard())return;const {board,date}=mealPage;cleanupMeals();mountMeals(board,date);};
  bindPhotoViewers(host);
  if(mealPage.board||!mealPage.data.team)return;
  document.querySelectorAll('[data-meal]').forEach(button=>button.onclick=async()=>{
    if(mealPage.busy || mealPage.selectedMeal===button.dataset.meal)return;
    if(mealsHasUnsaved()&&!await confirmMealDiscard())return;
    mealPage.draftPhotos=null;mealPage.captionDraft='';mealPage.blocksDraft=null;mealPage.fileToken++;mealPage.converting=false;mealPage.selectedMeal=button.dataset.meal;paintMeals();
  });
  document.querySelector('#meal-file').onchange=selectMealPhoto;
  document.querySelector('#meal-camera').onchange=selectMealPhoto;
  document.querySelector('#meal-caption').oninput=event=>{mealPage.captionDraft=event.target.value;};
  Object.keys(MEAL_BLOCK_NAMES).forEach(key=>{document.querySelector(`#meal-block-${key}`).oninput=event=>{mealPage.blocksDraft[key]=event.target.value;};});
  document.querySelector('#preview-cafe-draft').onclick=()=>{if(mealsHasUnsaved()){toast('먼저 작성 중인 식단을 저장해주세요. 저장된 기록으로 카페 글을 만들어요.');return;}openCafeDraft();};
  document.querySelector('#upload-preview').onclick=event=>{
    const button=event.target.closest('[data-remove-photo]');if(!button||mealPage.busy||mealPage.converting)return;
    mealPage.draftPhotos.splice(Number(button.dataset.removePhoto),1);
    document.querySelector('#meal-upload-error').textContent='';updateDraftPhotos();
  };
  document.querySelector('#meal-upload-form').onsubmit=uploadMeal;
  document.querySelector('#preview-report')?.addEventListener('click',previewReport);
}
async function loadMealImage(source) {
  return new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('사진을 읽지 못했어요. 다른 사진으로 다시 시도해주세요.'));img.src=source;
  });
}
function compressMealImage(photo,limit) {
  if(!photo.naturalWidth||!photo.naturalHeight)throw new Error('사진 크기를 확인할 수 없습니다.');
  const canvas=document.createElement('canvas');
  for(const maximum of [1280,1024,800,640,480]) {
    const scale=Math.min(1,maximum/Math.max(photo.naturalWidth,photo.naturalHeight));
    canvas.width=Math.max(1,Math.round(photo.naturalWidth*scale));canvas.height=Math.max(1,Math.round(photo.naturalHeight*scale));
    const context=canvas.getContext('2d');
    if(!context)throw new Error('이 브라우저에서 사진을 준비하지 못했어요. 다시 시도해주세요.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(photo,0,0,canvas.width,canvas.height);
    for(const quality of [.8,.68,.56,.44]) {
      const data=canvas.toDataURL('image/jpeg',quality);
      if(data.startsWith('data:image/jpeg;base64,')&&data.length<=limit)return data;
    }
  }
  throw new Error('사진 용량이 너무 큽니다. 더 작은 사진을 선택해주세요.');
}
async function prepareMealPhoto(file) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('JPG, PNG, WebP 사진을 선택해주세요. HEIC 사진은 JPG로 변환해주세요.');
  if(file.size>20*1024*1024)throw new Error('사진 한 장당 20MB 이하로 선택해주세요.');
  const source=URL.createObjectURL(file);
  try {return compressMealImage(await loadMealImage(source),MAX_PHOTO_ENCODED);}
  finally {URL.revokeObjectURL(source);}
}
async function fitMealPhotoBudget(photos) {
  const total=photos.reduce((sum,photo)=>sum+(photo.imageData?.length||0),0);
  if(total<=MAX_MEAL_ENCODED)return photos;
  const newCount=photos.filter(photo=>photo.imageData).length;
  const allowance=Math.floor(MAX_MEAL_ENCODED/newCount);
  const result=[];
  for(const photo of photos) {
    if(!photo.imageData || photo.imageData.length<=allowance){result.push(photo);continue;}
    const imageData=compressMealImage(await loadMealImage(photo.imageData),allowance);
    result.push({...photo,imageData});
  }
  return result;
}
async function selectMealPhoto(event) {
  const files=Array.from(event.target.files||[]);event.target.value='';
  if(!files.length || !mealPage || mealPage.busy || mealPage.converting)return;
  const current=mealPage, token=++current.fileToken;
  const errorNode=document.querySelector('#meal-upload-error');errorNode.textContent='';
  const available=MAX_MEAL_PHOTOS-current.draftPhotos.length;
  if(files.length>available){errorNode.textContent=available?`사진은 한 끼에 ${MAX_MEAL_PHOTOS}장까지 올릴 수 있어요. ${available}장 이하로 추가해주세요.`:'사진이 6장 있어요. 기존 사진을 빼면 새 사진을 추가할 수 있어요.';return;}
  current.converting=true;updatePhotoControls();
  const additions=[],errors=[];
  try {
    for(const [index,file] of files.entries()) {
      if(mealPage!==current||current.fileToken!==token)return;
      document.querySelector('#meal-photo-status').textContent=`사진 준비 중 ${index+1} / ${files.length}장…`;
      try {additions.push({key:`new-${++mealPhotoSequence}`,imageData:await prepareMealPhoto(file)});}
      catch(error){errors.push(`${file.name}: ${error.message}`);}
    }
    if(mealPage!==current||current.fileToken!==token)return;
    const photos=await fitMealPhotoBudget([...current.draftPhotos,...additions]);
    if(mealPage!==current||current.fileToken!==token)return;
    current.draftPhotos=photos;updateDraftPhotos();
    errorNode.textContent=errors.join(' ');
    document.querySelector('#meal-photo-status').textContent=additions.length?`${additions.length}장을 추가했어요. 저장하면 팀원에게 보여요.`:'';
  } catch(error) {
    if(mealPage===current&&current.fileToken===token){errorNode.textContent=error.message;document.querySelector('#meal-photo-status').textContent='';}
  } finally {
    if(mealPage===current&&current.fileToken===token){current.converting=false;updatePhotoControls();}
  }
}
async function uploadMeal(event) {
  event.preventDefault();const current=mealPage,post=ownMeal(),form=event.currentTarget;
  const errorNode=document.querySelector('#meal-upload-error');errorNode.textContent='';
  if(current.busy||current.converting)return;
  if(!form.reportValidity())return;
  current.blocksDraft=readMealBlocksDraft();
  const blocks=Object.fromEntries(Object.entries(current.blocksDraft).map(([key,value])=>[key,value===''?null:Number(value)]));
  if(!current.draftPhotos.length&&!Object.values(blocks).some(value=>value!==null)){errorNode.textContent='사진을 선택하거나 탄수화물·단백질·지방 블록을 하나 이상 입력해주세요.';return;}
  current.captionDraft=document.querySelector('#meal-caption').value;
  const photos=current.draftPhotos.map(photo=>photo.id?{id:photo.id}:{imageData:photo.imageData});
  if(photos.reduce((sum,photo)=>sum+(photo.imageData?.length||0),0)>MAX_MEAL_ENCODED){errorNode.textContent='사진 용량이 너무 큽니다. 사진을 다시 선택해주세요.';return;}
  current.busy=true;form.inert=true;updatePhotoControls();
  document.querySelector('#upload-meal').textContent='식단을 저장하고 있어요…';
  try {
    const body={expectedTeamId:current.data.team.id,date:current.date,meal:current.selectedMeal,caption:current.captionDraft.trim(),expectedVersion:post?.version||0,photos,blocks};
    const data=await api('/api/meals',{method:'POST',body:JSON.stringify(body)});
    if(mealPage!==current)return;
    current.data=data;current.draftPhotos=null;current.captionDraft='';current.blocksDraft=null;current.busy=false;paintMeals();
    const mine=data.posts.filter(p=>p.memberId===session.id&&postPhotos(p).length>0).length;bootstrap.photoMealCounts={...bootstrap.photoMealCounts,[current.date]:mine};
    toast('식단 사진과 블록 기록을 저장했어요.');
  } catch(error) {
    if(mealPage!==current)return;
    errorNode.textContent=error.status===409?'팀 배정이나 식단이 바뀌었어요. 새로고침하여 내 팀과 식단을 확인한 후 다시 올려주세요.':error.message;
    form.inert=false;current.busy=false;updatePhotoControls();document.querySelector('#upload-meal').textContent=post?'식단 수정하기 ↗':'우리 팀에 올리기 ↗';
  }
}
function createMealDialog(content,className='') {
  document.querySelector('#meal-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.id='meal-dialog';dialog.className=`meal-dialog ${className}`;dialog.innerHTML=content;document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-close-dialog]')?.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());return dialog;
}
function showMealGallery(urls,caption,startIndex=0) {
  document.querySelector('#meal-gallery-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.id='meal-gallery-dialog';dialog.className='meal-dialog photo-dialog';
  dialog.innerHTML=`<div class="dialog-heading"><h2>식단 사진</h2><button type="button" class="dialog-close" data-close-gallery aria-label="사진 닫기">×</button></div><img class="full-meal-photo" alt=""><div class="gallery-controls"><button type="button" class="button secondary" data-gallery-previous aria-label="이전 사진">← 이전</button><span class="gallery-counter" aria-live="polite"></span><button type="button" class="button secondary" data-gallery-next aria-label="다음 사진">다음 →</button></div><p class="full-meal-caption"></p>`;
  let index=Math.min(Math.max(startIndex,0),urls.length-1);
  const paint=()=>{
    const image=dialog.querySelector('.full-meal-photo');image.src=urls[index];image.alt=`${caption} · ${index+1}/${urls.length}`;
    dialog.querySelector('.gallery-counter').textContent=`${index+1} / ${urls.length}장`;
    dialog.querySelector('[data-gallery-previous]').disabled=index===0;
    dialog.querySelector('[data-gallery-next]').disabled=index===urls.length-1;
  };
  dialog.querySelector('.full-meal-caption').textContent=caption;
  dialog.querySelector('[data-close-gallery]').onclick=()=>dialog.close();
  dialog.querySelector('[data-gallery-previous]').onclick=()=>{if(index>0){index--;paint();}};
  dialog.querySelector('[data-gallery-next]').onclick=()=>{if(index<urls.length-1){index++;paint();}};
  dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'&&index>0){event.preventDefault();index--;paint();}if(event.key==='ArrowRight'&&index<urls.length-1){event.preventDefault();index++;paint();}});
  dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);paint();dialog.showModal();
}
function bindPhotoViewers(host) {
  host.querySelectorAll('[data-photo]').forEach(button=>button.onclick=()=>{
    const urls=button.dataset.photos?JSON.parse(button.dataset.photos):[button.dataset.photo];
    if(urls.length)showMealGallery(urls,button.dataset.photoCaption,Number(button.dataset.photoIndex)||0);
  });
}
function previewReport() {
  if(mealsHasUnsaved()){toast('먼저 작성 중인 식단을 저장해주세요. 저장된 사진과 블록으로 모음을 만들어요.');return;}
  const current=mealPage,d=current.data;
  if(!d.canPublish||!d.posts.length)return;
  const missing=d.members.length*3-d.posts.length;
  const dialog=createMealDialog(`<div class="dialog-heading"><div><span class="eyebrow">BEFORE YOU SHARE</span><h2>전체에 공유할 식단 모음</h2></div><button class="dialog-close" type="button" data-close-dialog aria-label="미리보기 닫기">×</button></div><div class="report-preview-body"><div class="preview-team-heading"><h3>${escapeHTML(d.team.name)} · ${dateLabel(current.date)}</h3><span class="badge">${d.posts.length} / ${d.members.length*3}끼</span></div><p class="report-scope">이 사진·블록·메모는 전체 회원 20명과 관리자에게 공개됩니다.</p>${missing?`<p class="missing-notice">아직 ${missing}끼의 기록이 없습니다. 현재 저장된 식단만 공유할 수 있어요.</p>`:''}<div class="field"><label for="report-caption">전체에 전할 한마디 <small>선택</small></label><textarea id="report-caption" maxlength="500" placeholder="우리 조 오늘 식단입니다. 모두 수고하셨어요!">${escapeHTML(d.report?.caption||'')}</textarea></div>${mealGrid(d,true)}<p id="report-error" class="form-error" role="alert"></p></div><div class="dialog-footer"><p>공유 뒤 수정된 식단은<br>다시 공유해야 반영됩니다.</p><button id="publish-report" class="button" type="button">${d.report?'전체 공유 갱신하기':'20명 전체에 공유하기'} ↗</button></div>`);
  bindPhotoViewers(dialog);
  let publishing=false;dialog.addEventListener('cancel',event=>{if(publishing)event.preventDefault();});
  dialog.querySelector('#publish-report').onclick=async event=>{
    const button=event.currentTarget;publishing=true;button.disabled=true;button.textContent='공유하고 있어요…';dialog.querySelector('[data-close-dialog]').disabled=true;
    try {
      const result=await api('/api/reports',{method:'POST',body:JSON.stringify({date:current.date,expectedRevision:d.revision,expectedReportVersion:d.report?.version||0,caption:dialog.querySelector('#report-caption').value.trim()})});
      if(mealPage!==current)return;
      current.data.report=result.report;dialog.close();paintMeals();toast('전체 게시판에 우리 팀 식단을 공유했어요.');
    } catch(error) {
      publishing=false;if(!dialog.isConnected)return;
      dialog.querySelector('#report-error').textContent=error.status===409?'새 식단이 올라왔거나 팀 편성이 바뀌었어요. 미리보기를 닫고 새로고침한 후 다시 확인해주세요.':error.message;
      button.disabled=error.status===409;button.textContent='전체에 공유하기 ↗';dialog.querySelector('[data-close-dialog]').disabled=false;
    }
  };
}
