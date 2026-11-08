function openCafeDraft() {
  if (!mealPage || mealPage.board || session?.isAdmin) return;
  if (mealsHasUnsaved()) { toast('작성 중인 식단을 먼저 저장해주세요. 저장된 기록으로 초안을 만들어요.'); return; }
  const draft = MealSummary.buildDraft({date:mealPage.date,startDate:bootstrap.program.startDate,memberId:session.id,name:session.name,posts:mealPage.data.posts});
  const dialog = createMealDialog(`<div class="dialog-heading"><div><span class="eyebrow">MY CAFE JOURNAL</span><h2>카페에 올릴 하루 식단</h2></div><button type="button" class="dialog-close" data-close-dialog aria-label="카페 초안 닫기">×</button></div><div class="report-preview-body"><p class="report-scope">저장된 내 식단으로 만든 초안입니다. 네이버 카페에 아직 게시되지 않았어요.</p><div class="field"><label for="cafe-draft-title">글 제목 <small>수정 가능</small></label><input id="cafe-draft-title" maxlength="200" value="${escapeHTML(draft.title)}"></div><p class="cafe-date-note">프로그램 시작일: ${escapeHTML(draft.startDate||'미설정')} · ${draft.dayNumber===null?'시작일이 없어 일차를 계산하지 못했어요.':draft.dayNumber<1?'프로그램 시작 전 기록입니다.':'시작일을 1일차로 계산합니다.'}</p><article id="cafe-draft-body" class="cafe-draft-body">${MealSummary.bodyHTML(draft)}</article><label for="cafe-draft-text" class="cafe-text-label">복사할 본문 텍스트</label><textarea id="cafe-draft-text" class="cafe-draft-text" readonly>${escapeHTML(MealSummary.bodyText(draft))}</textarea><p class="cafe-export-note">본문 복사는 텍스트만 복사합니다. 사진 포함 HTML은 사진이 내장된 미리보기 파일이며, 카페 자동 게시는 네이버 연동 후 제공됩니다.</p><p id="cafe-draft-status" role="status" aria-live="polite"></p></div><div class="dialog-footer cafe-draft-actions"><button type="button" class="button secondary" id="copy-cafe-title">제목 복사</button><button type="button" class="button secondary" id="copy-cafe-text">본문 텍스트 복사</button><button type="button" class="button" id="download-cafe-html">사진 포함 HTML 저장 ↓</button></div>`,'cafe-draft-dialog');
  const titleInput = dialog.querySelector('#cafe-draft-title');
  const status = dialog.querySelector('#cafe-draft-status');
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
      status.textContent='사진 포함 HTML 파일을 저장했어요. 카페에는 아직 게시되지 않았습니다.';
    } catch(error) { if(dialog.isConnected&&error.name!=='AbortError')status.textContent=error.message; }
    finally { if(dialog.isConnected)button.disabled=false; }
  };
}
