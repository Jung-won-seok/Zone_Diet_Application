function openCafeDraft() {
  if (!mealPage || mealPage.board || session?.isAdmin) return;
  if (mealsHasUnsaved()) { toast('작성 중인 식단을 먼저 저장해주세요. 저장된 기록으로 초안을 만들어요.'); return; }
  const current=mealPage;
  let draft = MealSummary.buildDraft({date:current.date,startDate:bootstrap.program.startDate,memberId:session.id,name:session.name,posts:current.data.posts});
  const dialog = createMealDialog(`<div class="dialog-heading"><div><span class="eyebrow">MY CAFE JOURNAL</span><h2>카페에 올릴 하루 식단</h2></div><button type="button" class="dialog-close" data-close-dialog aria-label="카페 초안 닫기">×</button></div><div class="report-preview-body">
    <p class="report-scope">저장된 내 식단으로 만든 초안입니다. 제목과 사진·블록을 확인한 뒤 카페에 게시해주세요.</p>
    <div class="field"><label for="cafe-draft-title">글 제목 <small>수정 가능</small></label><input id="cafe-draft-title" maxlength="200" value="${escapeHTML(draft.title)}"></div>
    <p id="cafe-date-note" class="cafe-date-note">프로그램 시작일: ${escapeHTML(draft.startDate||'미설정')} · ${draft.dayNumber===null?'시작일이 없어 일차를 계산하지 못했어요.':draft.dayNumber<1?'프로그램 시작 전 기록입니다.':'시작일을 1일차로 계산합니다.'}</p>
    <section class="cafe-publish-panel" aria-labelledby="cafe-publish-heading"><div class="cafe-publish-heading"><div><span class="eyebrow">PUBLISH TO NAVER CAFE</span><h3 id="cafe-publish-heading">내 카페 게시판에 올리기</h3></div><button type="button" class="button secondary" id="prepare-cafe-publish">게시 대상 확인</button></div><p class="cafe-publish-help">네이버 연결 계정, 관리자가 지정한 게시판과 최신 식단을 확인합니다. 확인만으로 글이 올라가지는 않아요.</p><div id="cafe-publish-target"></div><p id="cafe-publish-status" role="status" aria-live="polite"></p></section>
    <article id="cafe-draft-body" class="cafe-draft-body">${MealSummary.bodyHTML(draft)}</article>
    <label for="cafe-draft-text" class="cafe-text-label">복사할 본문 텍스트</label><textarea id="cafe-draft-text" class="cafe-draft-text" readonly>${escapeHTML(MealSummary.bodyText(draft))}</textarea><p class="cafe-export-note">본문 복사는 텍스트만 복사합니다. 사진 포함 HTML은 기기에 저장하는 미리보기 파일입니다. 카페 게시에는 위의 게시 대상 확인과 게시 버튼을 사용해주세요.</p><p id="cafe-draft-status" role="status" aria-live="polite"></p></div><div class="dialog-footer cafe-draft-actions"><button type="button" class="button secondary" id="copy-cafe-title">제목 복사</button><button type="button" class="button secondary" id="copy-cafe-text">본문 텍스트 복사</button><button type="button" class="button" id="download-cafe-html">사진 포함 HTML 저장 ↓</button></div>`,'cafe-draft-dialog');
  const titleInput = dialog.querySelector('#cafe-draft-title');
  const status = dialog.querySelector('#cafe-draft-status');
  const prepareButton=dialog.querySelector('#prepare-cafe-publish'), target=dialog.querySelector('#cafe-publish-target'), publishStatus=dialog.querySelector('#cafe-publish-status');
  let prepared=null, preparing=false, publishing=false;
  function publicationView(publication) {
    if(!publication)return '';
    const link=naverSafeArticleUrl(publication.articleUrl);
    const label=NAVER_PUBLICATION_LABELS[publication.status]||'게시 결과 확인';
    return `<div class="cafe-publication-result"><strong>${escapeHTML(label)}</strong><p>${escapeHTML(publication.message||'')}</p>${link?`<a class="button text" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">카페 게시글 보기 ↗</a>`:''}${['pending','unknown'].includes(publication.status)?'<p>다시 게시하지 말고 카페에서 글을 확인해주세요. 글이 올라왔다면 관리자에게 해당 게시글 주소를 전달해주세요.</p>':''}</div>`;
  }
  function paintPrepared() {
    const p=prepared;
    if(!p)return;
    const cafeLink=naverSafeArticleUrl(p.target?.cafeUrl), boardName=p.target?.boardName||'미지정 게시판';
    target.innerHTML=`<dl class="cafe-publish-destination"><div><dt>네이버 계정</dt><dd>${escapeHTML(p.connection?.connected?(p.connection.displayName||'연결된 계정'):'연결 필요')}</dd></div><div><dt>카페</dt><dd>${cafeLink?`<a href="${escapeHTML(cafeLink)}" target="_blank" rel="noopener noreferrer">${escapeHTML(p.target.cafeName||'네이버 카페')} ↗</a>`:escapeHTML(p.target?.cafeName||'미설정')}</dd></div><div><dt>게시판</dt><dd>${escapeHTML(boardName)}${p.target?.menuId?` <small>(번호 ${escapeHTML(p.target.menuId)})</small>`:''}</dd></div><div><dt>게시 제목</dt><dd>${escapeHTML(p.title)}</dd></div></dl>${publicationView(p.publication)}${p.reasons?.length?`<ul class="cafe-publish-reasons">${p.reasons.map(reason=>`<li>${escapeHTML(reason)}</li>`).join('')}</ul>`:''}${p.readyToPublish?`<p class="cafe-publish-help">아래 식단 사진·탄단지 블록·식단 메모가 카페에 게시됩니다. 게시글은 카페 회원에게 공개되며 해당 게시판의 권한을 따릅니다.</p><label class="check-field cafe-publish-confirm"><input type="checkbox" id="confirm-cafe-publish"> 이 제목과 아래 사진·블록을 ‘${escapeHTML(boardName)}’ 게시판에 올리는 것을 확인했습니다.</label><button type="button" class="button" id="publish-cafe" disabled>네이버 카페에 올리기 ↗</button>`:'<p class="cafe-publish-help">카페 연동 신청 후 관리자가 내 게시판을 연결하면 올릴 수 있습니다. <a href="#connect">카페 연동 신청하기 ↗</a></p>'}`;
    const checkbox=target.querySelector('#confirm-cafe-publish'), publishButton=target.querySelector('#publish-cafe');
    if(checkbox)checkbox.onchange=()=>{publishButton.disabled=!checkbox.checked||publishing||prepared!==p;};
    if(publishButton)publishButton.onclick=()=>publishPrepared(p);
  }
  titleInput.addEventListener('input',()=>{
    if(publishing)return;
    prepared=null;target.innerHTML='';publishStatus.textContent='제목이 변경됐어요. 게시 대상을 다시 확인해주세요.';
  });
  dialog.addEventListener('cancel',event=>{if(publishing)event.preventDefault();});
  prepareButton.onclick=async()=>{
    if(preparing||publishing)return;
    const title=titleInput.value.trim();
    if(!title){publishStatus.textContent='글 제목을 입력해주세요.';titleInput.focus();return;}
    prepared=null;preparing=true;prepareButton.disabled=true;titleInput.disabled=true;target.innerHTML='';publishStatus.textContent='최신 식단과 네이버 게시 대상을 확인하고 있어요…';
    try {
      const result=await api('/api/naver/preview',{method:'POST',body:JSON.stringify({date:draft.date,title})});
      if(!dialog.isConnected||mealPage!==current)return;
      prepared=result;draft=result.draft;
      // This HTML is generated by the server's escaping MealSummary renderer, not by a Cafe response.
      dialog.querySelector('#cafe-draft-body').innerHTML=result.bodyHtml;
      dialog.querySelector('#cafe-draft-text').value=MealSummary.bodyText(draft);
      dialog.querySelector('#cafe-date-note').textContent=`프로그램 시작일: ${draft.startDate||'미설정'} · ${draft.dayNumber===null?'시작일이 없어 일차를 계산하지 못했어요.':draft.dayNumber<1?'프로그램 시작 전 기록입니다.':'시작일을 1일차로 계산합니다.'}`;
      paintPrepared();publishStatus.textContent=result.readyToPublish?'본문과 게시 대상을 확인한 뒤 체크하고 게시해주세요.':'게시 준비 상태를 확인했어요. 아래 안내를 확인해주세요.';
    }catch(error){if(dialog.isConnected)publishStatus.textContent=error.message;}
    finally{preparing=false;if(dialog.isConnected){prepareButton.disabled=false;titleInput.disabled=false;prepareButton.textContent='게시 대상 다시 확인';}}
  };
  async function publishPrepared(snapshot) {
    if(publishing||prepared!==snapshot||!snapshot.readyToPublish||!target.querySelector('#confirm-cafe-publish')?.checked)return;
    if(titleInput.value.trim()!==snapshot.title){prepared=null;target.innerHTML='';publishStatus.textContent='제목이 변경됐어요. 게시 대상을 다시 확인해주세요.';return;}
    publishing=true;current.busy=true;prepareButton.disabled=true;titleInput.disabled=true;target.inert=true;dialog.querySelector('[data-close-dialog]').disabled=true;publishStatus.textContent='사진을 준비하고 카페에 게시하고 있어요. 완료될 때까지 기다려주세요…';
    try {
      const result=await api('/api/naver/publish',{method:'POST',body:JSON.stringify({date:draft.date,title:snapshot.title,previewVersion:snapshot.previewVersion,confirmed:true})});
      if(!dialog.isConnected||mealPage!==current)return;
      prepared=null;target.innerHTML=publicationView(result.publication);publishStatus.textContent=result.publication?.status==='published'?'카페 게시가 완료됐어요. 위 링크에서 확인할 수 있습니다.':'게시 결과를 확인해주세요. 같은 식단을 다시 보내지 않습니다.';
    }catch(error){
      if(!dialog.isConnected)return;
      prepared=null;target.innerHTML='';publishStatus.textContent=`${error.message} 게시 대상 다시 확인으로 서버에 기록된 결과를 확인해주세요. 결과 확인이 필요한 글은 다시 게시하지 않습니다.`;
    }finally{
      publishing=false;current.busy=false;
      if(dialog.isConnected){prepareButton.disabled=false;titleInput.disabled=false;target.inert=false;dialog.querySelector('[data-close-dialog]').disabled=false;prepareButton.textContent='게시 결과 · 대상 다시 확인';}
    }
  }
  async function copy(input, message) {
    try { await navigator.clipboard.writeText(input.value); if(dialog.isConnected)status.textContent=message; }
    catch { if(dialog.isConnected){input.focus(); input.select(); status.textContent='내용을 선택했어요. 기기의 복사 기능을 사용해주세요.';} }
  }
  dialog.querySelector('#copy-cafe-title').onclick=()=>copy(titleInput,'제목을 복사했어요.');
  dialog.querySelector('#copy-cafe-text').onclick=()=>copy(dialog.querySelector('#cafe-draft-text'),'본문 텍스트를 복사했어요. 사진은 별도로 첨부해주세요.');
  const abort = new AbortController(); dialog.addEventListener('close',()=>abort.abort(),{once:true});
  dialog.querySelector('#download-cafe-html').onclick=async event=>{
    const button=event.currentTarget;
    if(!titleInput.value.trim()){status.textContent='글 제목을 입력해주세요.';titleInput.focus();return;}
    const snapshot={...draft,title:titleInput.value.trim()};button.disabled=true;
    try {
      const urls=[...new Set(snapshot.meals.flatMap(m=>m.photos.map(p=>p.url)))], sources={};
      for(const [index,url] of urls.entries()) {
        status.textContent=`사진 준비 중… ${index+1} / ${urls.length}장`;
        const response=await fetch(url,{credentials:'same-origin',signal:abort.signal});
        if(!response.ok)throw new Error('사진을 불러오지 못했어요. 다시 로그인하거나 잠시 후 시도해주세요.');
        const blob=await response.blob();
        if(!['image/jpeg','image/png','image/webp'].includes(blob.type))throw new Error('사진 형식을 확인하지 못했어요.');
        sources[url]=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('사진을 준비하지 못했어요.'));reader.readAsDataURL(blob);});
      }
      if(!dialog.isConnected)return;
      const file=new Blob([MealSummary.standaloneHTML(snapshot,sources)],{type:'text/html;charset=utf-8'});
      const url=URL.createObjectURL(file), link=document.createElement('a');link.href=url;link.download=`존다-${draft.date}-식단.html`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status.textContent='사진 포함 HTML 파일을 기기에 저장했어요.';
    } catch(error) { if(dialog.isConnected&&error.name!=='AbortError')status.textContent=error.message; }
    finally { if(dialog.isConnected)button.disabled=false; }
  };
}
