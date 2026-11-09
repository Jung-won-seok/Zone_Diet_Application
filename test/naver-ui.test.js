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
  html=c.naverMemberRow(member);assert.doesNotMatch(html,/data-naver-approve checked/);assert.match(html,/data-naver-approve\s+disabled/);assert.match(html,/&lt;script&gt;/);assert.match(html,/새 승인은 위의 카페 연결 요청/);
  member.board.approvedConnectionId='current';assert.match(c.naverMemberRow(member),/data-naver-approve checked/);
  member.connection.needsReconnect=true;assert.match(c.naverMemberRow(member),/data-naver-approve\s+disabled/);
});
test('login redirect accepts only the official Naver authorization endpoint',()=>{
  const c=context();
  assert.equal(c.naverAuthorizeUrl('https://nid.naver.com/oauth2.0/authorize?state=test'),'https://nid.naver.com/oauth2.0/authorize?state=test');
  for(const value of ['http://nid.naver.com/oauth2.0/authorize','https://nid.naver.com.evil.test/oauth2.0/authorize','https://nid.naver.com/login','https://user@nid.naver.com/oauth2.0/authorize','javascript:alert(1)'])assert.throws(()=>c.naverAuthorizeUrl(value));
});
const onboardingData=()=>({cafe:{name:'존다 카페',url:'https://cafe.naver.com/mycaffelatte',clubId:'31811778'},configuration:{ready:true},connection:{connected:true,displayName:'김민준',connectionId:'c1'},request:null,approved:false,needsRequest:true});
test('initial onboarding requires explicit consent and offers deferral before a request',()=>{
  const c=context(), data=onboardingData(), html=c.naverOnboardingContent(data);
  assert.match(html,/name="name" required maxlength="30"/);assert.match(html,/name="cafeNickname" required/);
  assert.match(html,/name="consent" type="checkbox" required/);assert.doesNotMatch(html,/name="consent"[^>]*checked/);
  assert.match(html,/관리자에게 연결 요청/);assert.match(html,/id="skip-naver-onboarding">나중에/);
  const deferred=c.naverOnboardingContent(data,true);
  assert.match(deferred,/아직 관리자에게 요청을 보내지 않았습니다/);assert.doesNotMatch(deferred,/<form/);
  data.configuration.ready=false;
  assert.match(c.naverOnboardingContent(data),/id="onboarding-connect-naver"[^>]+disabled/);assert.doesNotMatch(c.naverOnboardingContent(data),/id="naver-link-request"/);
});
test('onboarding shows waiting, rejected, stale and approved states without faking approval',()=>{
  const c=context(), data=onboardingData();
  data.request={status:'pending',name:'김<민준>',cafeNickname:'민준',requestedBoardName:'2기',stale:false};
  let html=c.naverOnboardingContent(data);assert.match(html,/관리자 확인 대기/);assert.match(html,/연결 상태 새로고침/);assert.doesNotMatch(html,/id="naver-link-request"/);assert.match(html,/김&lt;민준&gt;/);
  data.request.status='rejected';data.request.reason='<img src=x>';
  html=c.naverOnboardingContent(data);assert.match(html,/id="naver-link-request"/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img src=x>/);
  data.request.status='pending';data.request.stale=true;html=c.naverOnboardingContent(data);assert.match(html,/새로 신청해주세요/);assert.match(html,/id="naver-link-request"/);
  data.approved=true;data.board={menuId:'7',label:'김민준 게시판'};html=c.naverOnboardingContent(data);assert.match(html,/내 카페 게시판이 연결됐어요/);assert.match(html,/김민준 게시판/);assert.match(html,/네이버 카페에 올리기/);assert.doesNotMatch(html,/id="naver-link-request"/);
});
test('administrator manually selects an app member and board; occupied members cannot be reassigned',()=>{
  const c=context(), data={configuration:{ready:true},members:[{id:'u01',username:'member01',name:'김민준',hasConnection:false},{id:'u02',username:'member02',name:'박민준',hasConnection:true}],requests:[{id:'r1',name:'김민준',naverName:'인증<이름>',cafeNickname:'카페 닉네임',requestedBoardName:'김민준',status:'pending',version:1,memberId:null}]};
  let html=c.naverRequestsView(data);
  assert.match(html,/value="" selected disabled/);assert.doesNotMatch(html,/value="u01"[^>]*selected/);assert.match(html,/value="u02"\s+disabled/);
  assert.match(html,/member01 · 김민준/);assert.match(html,/name="memberName" required maxlength="30" value="김민준"/);
  assert.match(html,/name="menuId" required[^>]+placeholder=/);assert.doesNotMatch(html,/name="menuId"[^>]*value="/);
  assert.match(html,/name="confirmed" type="checkbox" required/);assert.match(html,/기존 앱 회원 계정과 그 기록을 이 네이버 회원에게 연결/);assert.match(html,/인증&lt;이름&gt;/);
  data.requests[0].memberId='u01';html=c.naverRequestsView(data);assert.match(html,/value="u01" selected/);assert.match(html,/value="u02"\s+disabled/);assert.match(html,/다른 회원으로 바꿀 수 없습니다/);
  data.requests[0].stale=true;assert.match(c.naverRequestsView(data),/value="approve" disabled/);
});
test('preserved review drafts do not restore consent for a changed request or unavailable member',()=>{
  const fields={memberId:{value:'',selectedOptions:[{disabled:false}]},memberName:{value:'새 신청 이름'},confirmed:{type:'checkbox',value:'on',checked:false}};
  const form={dataset:{requestId:'r1'},elements:{...fields,namedItem:name=>fields[name]}};
  const c=context({document:{querySelectorAll:()=>[form]}});
  vm.runInContext("naverAdminPage={requestsData:{requests:[{id:'r1',version:2}]}}",c);
  const draft={id:'r1',version:1,fields:[{name:'memberName',value:'이전 이름'},{name:'memberId',value:'u01'},{name:'confirmed',value:'on',checked:true}]};
  c.restoreNaverReviewDrafts([draft]);assert.equal(fields.memberName.value,'새 신청 이름');assert.equal(fields.confirmed.checked,false);
  draft.version=2;c.restoreNaverReviewDrafts([draft]);assert.equal(fields.memberName.value,'이전 이름');assert.equal(fields.confirmed.checked,true);
  fields.memberId.selectedOptions[0].disabled=true;c.restoreNaverReviewDrafts([draft]);assert.equal(fields.memberId.value,'');assert.equal(fields.confirmed.checked,false);
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
test('Naver login remains disabled without configuration and redirects only after a click',async()=>{
  const root=new Element();root.innerHTML='<button id="naver-login-button"></button><p id="naver-login-status"></p><p id="naver-login-error"></p>';
  const calls=[], redirects=[], configuration={ready:false};
  const c=context({document:root,location:{hash:'',assign:value=>redirects.push(value)},api:async(url,options)=>{calls.push({url,options});return url.endsWith('/login-config')?{configuration}:{authorizeUrl:'https://nid.naver.com/oauth2.0/authorize?state=test'};}});
  await c.mountNaverLogin();assert.equal(root.querySelector('#naver-login-button').disabled,true);assert.match(root.querySelector('#naver-login-status').textContent,/설정을 준비/);assert.equal(calls.length,1);
  configuration.ready=true;await c.mountNaverLogin();assert.equal(root.querySelector('#naver-login-button').disabled,false);assert.equal(redirects.length,0);
  await root.querySelector('#naver-login-button').onclick();assert.equal(calls[2].url,'/api/naver/login');assert.equal(calls[2].options.method,'POST');assert.deepEqual(redirects,['https://nid.naver.com/oauth2.0/authorize?state=test']);
});
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
