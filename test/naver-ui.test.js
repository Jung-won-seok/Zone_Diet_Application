const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const MealSummary=require('../meal-summary');
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function context(extra={}) {
  const c=vm.createContext({URL,Date,AbortController,setTimeout,escapeHTML,heading:()=>'',document:{querySelector:()=>null},...extra});
  vm.runInContext(fs.readFileSync(require.resolve('../naver-ui.js'),'utf8'),c);
  return c;
}
test('board links extract only the expected cafe and valid menu',()=>{
  const c=context();
  assert.equal(c.naverBoardId('https://cafe.naver.com/f-e/cafes/31811778/menus/7?viewType=L','31811778'),'7');
  assert.equal(c.naverBoardId(' https://cafe.naver.com/ArticleList.nhn?search.clubid=31811778&search.menuid=8 ','31811778'),'8');
  assert.equal(c.naverBoardId('9','31811778'),'9');
  assert.equal(c.naverBoardId('','31811778'),'');
  for(const value of ['0','-1','https://cafe.naver.com/f-e/cafes/123/menus/7','https://cafe.naver.com.evil.test/f-e/cafes/31811778/menus/7','https://user:secret@cafe.naver.com/f-e/cafes/31811778/menus/7','javascript:alert(1)','https://cafe.naver.com/mycaffelatte'])assert.throws(()=>c.naverBoardId(value,'31811778'));
});
test('external article links never use arbitrary hosts or active URL schemes',()=>{
  const c=context();
  assert.equal(c.naverSafeArticleUrl('https://cafe.naver.com/mycaffelatte/10'),'https://cafe.naver.com/mycaffelatte/10');
  for(const value of ['http://cafe.naver.com/a/1','javascript:alert(1)','https://cafe.naver.com.evil.test/a','https://user@cafe.naver.com/a','https://cafe.naver.com:8080/a'])assert.equal(c.naverSafeArticleUrl(value),'');
});
test('administrator approval requires the authenticated current connection and escapes labels',()=>{
  const c=context(), member={id:'u01',username:'member01',name:'김<민준>',connection:{connected:false},board:{menuId:'7',label:'<img src=x onerror=alert(1)>'}};
  let html=c.naverMemberRow(member);
  assert.match(html,/data-naver-approve\s+disabled/);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/김&lt;민준&gt;/);
  member.connection={connected:true,connectionId:'current',displayName:'<script>bad</script>'};member.board.approvedConnectionId='old';
  html=c.naverMemberRow(member);assert.doesNotMatch(html,/data-naver-approve checked/);assert.match(html,/&lt;script&gt;/);
  member.board.approvedConnectionId='current';assert.match(c.naverMemberRow(member),/data-naver-approve checked/);
  member.connection.needsReconnect=true;assert.match(c.naverMemberRow(member),/data-naver-approve\s+disabled/);
});
test('recent pending publication cannot be reconciled and absent confirmation is explicit',()=>{
  const c=context(), base={memberId:'u01',memberName:'김민준',date:'2026-11-08',status:'pending',createdAt:new Date().toISOString()};
  let html=c.naverPublicationsView([base]);assert.match(html,/name="outcome" disabled/);assert.match(html,/value="not_published" disabled/);assert.match(html,/name="confirmed" required disabled/);
  html=c.naverPublicationsView([{...base,status:'unknown',createdAt:new Date(Date.now()-130000).toISOString()}]);
  assert.doesNotMatch(html,/name="outcome" disabled/);assert.doesNotMatch(html,/value="not_published" disabled/);assert.match(html,/재시도 허용/);assert.match(html,/name="confirmed" required/);
  assert.doesNotMatch(c.naverPublicationsView([{...base,status:'published',articleUrl:'javascript:bad'}]),/href="javascript/);
});
class Element {
  constructor(){this.nodes=new Map();this.listeners={};this.value='';this.checked=false;this.isConnected=true;this.disabled=false;this.textContent='';}
  set innerHTML(html){this.html=html;this.nodes.clear();for(const match of html.matchAll(/id="([^"]+)"/g))this.nodes.set('#'+match[1],new Element());}
  get innerHTML(){return this.html||'';}
  get innerText(){return this.innerHTML.replace(/<[^>]*>/g,' ');}
  querySelector(selector){return this.nodes.get(selector)||null;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  focus(){} select(){}
}
function draftHarness() {
  const dialog=new Element(), close=new Element(), calls=[];
  const response={draft:MealSummary.buildDraft({date:'2026-11-08',startDate:'2026-11-08',memberId:'u01',name:'김민준',posts:[]}),title:'11.8일 존다 1일차',bodyHtml:'<p>서버에서 확인한 식단</p>',summary:{},target:{clubId:'31811778',cafeUrl:'https://cafe.naver.com/mycaffelatte',cafeName:'카페',menuId:'7',boardName:'김민준'},connection:{connected:true,displayName:'김민준'},previewVersion:'exact-preview',readyToPublish:true,reasons:[]};
  const c=context({MealSummary,mealPage:{date:'2026-11-08',data:{posts:[]}},bootstrap:{program:{startDate:'2026-11-08'}},session:{id:'u01',name:'김민준'},mealsHasUnsaved:()=>false,toast:()=>{},navigator:{},api:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return url.endsWith('/preview')?{...response,title:JSON.parse(options.body).title}:{publication:{status:'published',articleUrl:'https://cafe.naver.com/mycaffelatte/10',message:'카페에 게시했어요.'}};},createMealDialog:html=>{dialog.innerHTML=html;dialog.nodes.set('[data-close-dialog]',close);dialog.querySelector('#cafe-draft-title').value=response.title;return dialog;}});
  vm.runInContext(fs.readFileSync(require.resolve('../cafe-draft.js'),'utf8'),c);c.openCafeDraft();
  return {c,dialog,calls,response};
}
test('publication requires an exact fresh preview, explicit check, and final click',async()=>{
  const {c,dialog,calls}=draftHarness(), prepare=dialog.querySelector('#prepare-cafe-publish'), target=dialog.querySelector('#cafe-publish-target'), title=dialog.querySelector('#cafe-draft-title');
  assert.equal(calls.length,0);await prepare.onclick();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/naver/preview');
  const stalePublish=target.querySelector('#publish-cafe');await stalePublish.onclick();assert.equal(calls.length,1);
  target.querySelector('#confirm-cafe-publish').checked=true;
  title.value='새 제목';title.listeners.input();await stalePublish.onclick();assert.equal(calls.length,1);
  await prepare.onclick();target.querySelector('#confirm-cafe-publish').checked=true;await target.querySelector('#publish-cafe').onclick();
  assert.equal(calls.length,3);assert.deepEqual(calls[2],{url:'/api/naver/publish',body:{date:'2026-11-08',title:'새 제목',previewVersion:'exact-preview',confirmed:true}});
  assert.equal(c.mealPage.busy,false);assert.match(target.innerHTML,/카페 게시글 보기/);assert.equal(target.querySelector('#publish-cafe'),null);
});
test('missing settings and unknown result never render a publication action or fake success',async()=>{
  const {dialog,response}=draftHarness();response.readyToPublish=false;response.reasons=['네이버 개발자 앱 설정이 아직 준비되지 않았어요.'];
  await dialog.querySelector('#prepare-cafe-publish').onclick();const target=dialog.querySelector('#cafe-publish-target');assert.equal(target.querySelector('#publish-cafe'),null);assert.match(target.innerHTML,/개발자 앱 설정/);
  response.publication={status:'unknown',message:'게시 결과를 확인해주세요.'};response.reasons=['이전 게시 결과를 확인 중입니다.'];
  await dialog.querySelector('#prepare-cafe-publish').onclick();assert.match(target.innerHTML,/다시 게시하지 말고/);assert.equal(target.querySelector('#publish-cafe'),null);assert.doesNotMatch(target.innerHTML,/게시 완료/);
});
test('copy and HTML download use the current server preview rather than the initial meal snapshot',async()=>{
  const {c,dialog,response}=draftHarness();let exported;
  response.draft.meals[0].caption='다른 창에서 저장한 최신 식단';
  c.MealSummary={...MealSummary,standaloneHTML:snapshot=>{exported=snapshot;return '<html></html>';}};
  c.Blob=Blob;c.setTimeout=fn=>{fn();return 0;};c.document.createElement=()=>({click(){},remove(){}});c.document.body={append(){}};
  await dialog.querySelector('#prepare-cafe-publish').onclick();
  assert.match(dialog.querySelector('#cafe-draft-text').value,/다른 창에서 저장한 최신 식단/);
  const button=dialog.querySelector('#download-cafe-html');await button.onclick({currentTarget:button});
  assert.equal(exported.meals[0].caption,'다른 창에서 저장한 최신 식단');assert.equal(button.disabled,false);
});
