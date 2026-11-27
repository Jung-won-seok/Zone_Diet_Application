(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MealSummary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const keys = ['carbs', 'protein', 'fat'];
  const labels = {carbs:'탄수화물', protein:'단백질', fat:'지방'};
  const meals = {breakfast:'아침', lunch:'점심', dinner:'저녁'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  const number = n => value(n) === null ? '미입력' : String(Math.round(n * 100) / 100);
  function photosOf(post) {
    const candidates = Array.isArray(post?.photos) ? post.photos : post?.imageUrl ? [{url:post.imageUrl}] : [];
    return candidates.filter(p => /^\/api\/media\/[a-f0-9]{32}$/.test(p.url)).map(p => ({url:p.url}));
  }
  function summarize(posts) {
    const totals = Object.fromEntries(keys.map(k => [k,0]));
    const counts = {...totals}; let completeMeals=0, photoCount=0;
    for (const post of posts) {
      for (const k of keys) if (value(post.blocks?.[k]) !== null) { totals[k] += Math.round(post.blocks[k] * 100); counts[k]++; }
      if (keys.every(k => value(post.blocks?.[k]) !== null)) completeMeals++;
      photoCount += photosOf(post).length;
    }
    for (const k of keys) totals[k] /= 100;
    return {totals, counts, completeMeals, photoCount};
  }
  function calendarDay(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const ms = Date.parse(date+'T00:00:00Z');
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === date ? ms/86400000 : null;
  }
  function buildDraft({date,startDate,memberId,name,posts}) {
    const day = calendarDay(date), start = calendarDay(startDate);
    if (day === null) throw new Error('기록 날짜를 확인해주세요.');
    const dayNumber = start === null ? null : day-start+1;
    const title = `${Number(date.slice(5,7))}.${Number(date.slice(8,10))}일 존다 ${dayNumber === null ? '일차 미설정' : dayNumber < 1 ? '시작 전' : dayNumber+'일차'}`;
    const own = posts.filter(p => p.memberId === memberId && p.date === date);
    const entries = Object.entries(meals).map(([key,label]) => {
      const post = own.find(p => p.meal === key);
      return {meal:key,label,caption:post?.caption || '',blocks:Object.fromEntries(keys.map(k=>[k,value(post?.blocks?.[k])])),photos:photosOf(post)};
    });
    return {date,startDate,dayNumber,title,name,meals:entries,summary:summarize(entries)};
  }
  const blockLine = blocks => keys.map(k=>`${labels[k]} ${number(blocks[k])}${blocks[k] === null ? '' : '블록'}`).join(' · ');
  const totalLine = summary => keys.map(k=>`${labels[k]} ${summary.counts[k] ? number(summary.totals[k])+'블록' : '미입력'} (${summary.counts[k]}/3끼 입력)`).join(' · ');
  function bodyText(draft) {
    return [`${draft.name} · ${draft.date}`, ...draft.meals.map(m=>`[${m.label}]\n${m.photos.length ? '사진 '+m.photos.length+'장 (사진은 별도 첨부)' : '사진 미등록'}\n${m.caption ? m.caption+'\n' : ''}${blockLine(m.blocks)}`), '[하루 합계]\n'+totalLine(draft.summary), draft.summary.completeMeals<3 ? '미입력 항목을 제외한 합계입니다.' : '아침·점심·저녁 블록 입력 완료'].join('\n\n');
  }
  function bodyHTML(draft, imageSources) {
    return `<p>${esc(draft.name)} · ${esc(draft.date)}</p>`+draft.meals.map(m=>`<section class="cafe-meal-section"><h3>${m.label}</h3><p>${esc(blockLine(m.blocks))}</p>${m.caption?`<p class="cafe-meal-caption">${esc(m.caption).replace(/\n/g,'<br>')}</p>`:''}<div class="cafe-draft-photos">${m.photos.length ? m.photos.map((p,i)=>{
      const src = imageSources ? imageSources[p.url] : p.url;
      if (!src || (imageSources && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src))) throw new Error('본문에 포함할 사진을 모두 준비하지 못했어요. 다시 시도해주세요.');
      return `<img src="${esc(src)}" alt="${esc(draft.name)} ${m.label} 사진 ${i+1}">`;
    }).join('') : '<p class="cafe-missing">사진 미등록</p>'}</div></section>`).join('')+`<section class="cafe-total"><h3>하루 합계</h3><p>${esc(totalLine(draft.summary))}</p>${draft.summary.completeMeals<3?'<p>미입력 항목을 제외한 합계입니다.</p>':''}</section>`;
  }
  function standaloneHTML(draft, imageSources) {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${esc(draft.title)}</title><style>body{max-width:760px;margin:40px auto;padding:0 22px;font:16px/1.8 system-ui,sans-serif;color:#203c32}h1{font-size:28px}section{border-top:1px solid #dde5d9;padding:20px 0}img{max-width:100%;height:auto;border-radius:8px}.cafe-draft-photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.cafe-total{background:#f1f5eb;padding:20px}.cafe-missing{color:#71806d}@media(max-width:500px){.cafe-draft-photos{grid-template-columns:1fr}}</style></head><body><h1>${esc(draft.title)}</h1>${bodyHTML(draft,imageSources)}</body></html>`;
  }
  return {summarize,buildDraft,bodyText,bodyHTML,standaloneHTML};
});
