const test = require('node:test');
const assert = require('node:assert/strict');
const { readPublicAsset } = require('./support/public-assets');
const vm = require('node:vm');

const source = readPublicAsset('app.js');
const decode = value => String(value || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attributes = html => Object.fromEntries([...html.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
const shell = readPublicAsset('index.html');
const boxReturnAttributes = [...shell.matchAll(/<a\s+([^>]*)>/g)]
  .map(match => attributes(match[1])).find(link => link.class?.split(/\s+/).includes('box-return'));
class Element {
  constructor(attrs = {}) {
    this.attrs = attrs; this.value = attrs.value || ''; this.type = attrs.type || ''; this.name = attrs.name || ''; this.dataset = {page:attrs['data-page']}; this.listeners = {}; this.style = {}; this.disabled = false;
    const classes = new Set();
    this.classList = {add:(...items)=>items.forEach(item=>classes.add(item)),remove:(...items)=>items.forEach(item=>classes.delete(item)),contains:item=>classes.has(item),toggle:(item,force)=>{const on=force??!classes.has(item);on?classes.add(item):classes.delete(item);return on;}};
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  querySelector() { return this.button; }
  insertAdjacentHTML() {}
  checkValidity() { return true; }
}
class FormValues {
  constructor(form) { this.rows=form.controls.filter(e=>e.name && (e.type!=='checkbox'||e.checked)).map(e=>[e.name,e.value]); }
  get(name) { return this.rows.find(([key])=>key===name)?.[1] ?? null; }
  [Symbol.iterator]() { return this.rows[Symbol.iterator](); }
}
function deferred() { let resolve; const promise=new Promise(done=>{resolve=done;});return {promise,resolve}; }
function fixture(hash = '#record/2026-11-10', {isAdmin = false, zondaParticipant = true, pendingApproval = false} = {}) {
  const listeners={}, nodes=new Map(), links=[], localLinks=[], prompts=[], messages=[], calls=[];
  const flags={meal:false,naver:false,admin:false,boxMember:false,wod:false,answer:false};
  const location={hash,pathname:'/',search:''};
  const user = {id: isAdmin ? 'admin' : 'u01', username: pendingApproval ? '' : isAdmin ? 'admin' : 'member01', name: '김민준', isAdmin, pendingApproval};
  const personal = {settings:{name:'김민준',startWeight:'',goalWeight:''},records:{}};
  const account = {user,zondaParticipant,personal,personalRevision:0,program:{name:'존다'},photoMealCounts:{}};
  let form=null, initial=true, response=async()=>account;
  const body=new Element(), app=new Element(), nav=new Element(), profile=new Element(), settings=new Element({'data-page':'settings'});
  nodes.set('#app',app);nodes.set('.sidebar',new Element());nodes.set('.sidebar nav',nav);nodes.set('.settings-link',settings);nodes.set('.profile',profile);nodes.set('.program-label',new Element());nodes.set('#login-root',new Element());nodes.set('#page-label',new Element());nodes.set('#toast',new Element());
  nodes.set('.topbar > span:first-child',{firstChild:{textContent:''}});
  const boxReturn = new Element({...boxReturnAttributes});
  nodes.set('.box-return', boxReturn);
  const subnav = new Element();
  nodes.set('.zonda-subnav', subnav);
  for (const [menu, anchors] of [[nav, links], [subnav, localLinks]]) {
    Object.defineProperty(menu, 'innerHTML', {set(html) {
      anchors.length = 0;
      for (const [,attrs] of html.matchAll(/<a\s+([^>]*)>/g)) anchors.push(new Element(attributes(attrs)));
    }});
  }
  Object.defineProperty(app,'innerHTML',{set(html){
    app.markup = html;
    for (const id of ['logout-button', 'profile-membership']) {
      const key = '#' + id;
      if (nodes.has(key)) nodes.get(key).isConnected = false;
      nodes.delete(key);
      if (html.includes('id="' + id + '"')) {
        const element = new Element();
        element.isConnected = true;
        nodes.set(key, element);
      }
    }
    for(const key of [...nodes.keys()])if(key.startsWith('#form-')||['#record-form','#settings-form','#record-date'].includes(key))nodes.delete(key);
    form=null;
    const match=html.match(/<form\s+([^>]*)>([\s\S]*?)<\/form>/);
    if(!match)return;
    form=new Element(attributes(match[1]));form.controls=[];form.button=new Element();
    for(const entry of match[2].matchAll(/<input\b([^>]*)>|<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
      const attrs=entry[1]??entry[2],field=new Element(attributes(attrs));field.checked=/\bchecked\b/.test(attrs);
      if(field.type==='checkbox'&&!field.value)field.value='on';
      if(entry[2]!==undefined)field.value=decode(entry[3]);
      form.controls.push(field);nodes.set('#form-'+field.name,field);
      if(field.attrs.id==='record-date')nodes.set('#record-date',field);
    }
    nodes.set('#'+form.attrs.id,form);
  }});
  const navState={cancelled:0,synced:[]};
  const ctx=vm.createContext({
    Date,JSON,FormData:FormValues,location,
    history:{state:null,replaceState(state,_title,url){this.state=state;location.hash=url.includes('#')?url.slice(url.indexOf('#')):'';}},
    document:{body,querySelector:selector=>selector==='#record-form, #settings-form'?form:nodes.get(selector)||null,querySelectorAll:selector=>selector==='[data-page]'?[...links,...localLinks,settings]:[]},
    window:{addEventListener:(name,fn)=>{listeners[name]=fn;},scrollTo(){}},
    MobileNavigation:{create(options){navState.options=options;return{cancel(){navState.cancelled++;},sync(){navState.synced.push(links.find(e=>e.classList.contains('active'))?.dataset.page||'settings');}};}},
    fetch:async(url,options)=>{if(initial){initial=false;return new Promise(()=>{});}calls.push({url,options});const result=await response(url,options);return {ok:true,json:async()=>result};},
    setTimeout:()=>0,clearTimeout(){},confirm:message=>{prompts.push(message);return flags.answer;},
    cleanupMeals(){flags.meal=false;},cleanupNaverUI(){flags.naver=false;},cleanupReservations(){},cleanupBoxMembers(){flags.boxMember=false;},
    mealsHasUnsaved:()=>flags.meal,naverIsDirty:()=>flags.naver,adminIsDirty:()=>flags.admin,
    boxMembersIsDirty:()=>flags.boxMember, reservationsView:()=>'<div>수업 예약</div>', boxMembersView:()=>'<div>박스 회원 관리</div>',
    showAccountRecovery(){return false;}, mountWodPreview(){},
    wodView:()=>'<div>오늘의 와드</div>', wodIsDirty:()=>flags.wod,
    guideView:()=>'<div>크로스핏 가이드</div>', mountGuide(){navState.guideMounted=true;}, cleanupGuide(){},
    mountWod(date){navState.wodDate=date;navState.wodMounts=(navState.wodMounts||0)+1;},
    restoreWodDate(){navState.restoredWodDate=navState.wodDate;}, cleanupWod(){flags.wod=false;},
    cleanupBookingNotifications(){}, mountBookingNotifications(){}, disableBookingPushOnLogout(){},
    bookingMembershipCard:pass=>'회원권 ' + pass.kind, bookingKoreaDate:{format:()=>'2026-11-27'},
    mountBoxMembers(){}, mountReservations(date){navState.bookingDate=date;},
    confirmMealDiscard:()=>flags.mealPrompt?flags.mealPrompt.promise:Promise.resolve(flags.answer),
    resetAdminDraft(){flags.admin=false;},memberTeamBanner:()=>'',mealLoadingView:()=>'<div>식단</div>',
    adminView:()=>'',accountsView:()=>'',naverAdminView:()=>'',naverOnboardingView:()=>'',naverMemberView:()=>'',
    bindAdmin(){},mountMeals(){},mountNaverAdmin(){},mountNaverOnboarding(){},mountNaverMember(){},
    mealPage:{date:'2026-11-10'}
  });
  vm.runInContext(source,ctx);
  ctx.messages=messages;ctx.testAccount=account;
  vm.runInContext("toast=message=>messages.push(message); authReady=true; bootstrap=testAccount; session=bootstrap.user; state=bootstrap.personal; render();",ctx);
  return {ctx,location,flags,prompts,messages,calls,navState,nodes,body,account,boxReturn,links,localLinks,subnav,
    get pages(){return links.map(link=>link.dataset.page);},
    get markup(){return app.markup;},
    get form(){return form;},get active(){return links.find(e=>e.classList.contains('active'))?.dataset.page||'settings';},
    setResponse(fn){response=fn;},eval:code=>vm.runInContext(code,ctx),
    field:name=>form.controls.find(e=>e.name===name),
    async navigate(next){location.hash=next;await listeners.hashchange();},
    async submit(){await form.listeners.submit({preventDefault(){},currentTarget:form});},
    unload(){const event={preventDefault(){this.prevented=true;}};listeners.beforeunload(event);return event;}
  };
}

test('returning to the guide after discarding WOD edits preserves the destination history entry', async () => {
  const f = fixture('#wod/2026-11-10');
  const destinationState = { guide: { query: 'Fran' } };
  f.ctx.history.state = destinationState;
  f.flags.wod = true;
  f.flags.answer = true;
  await f.navigate('#guide');
  assert.equal(f.location.hash, '#guide');
  assert.equal(f.ctx.history.state, destinationState);
  assert.equal(f.navState.guideMounted, true);
});

test('declining dirty personal navigation restores URL, active menu and edited form',async()=>{
  const f=fixture();f.field('weight').value='71.5';const form=f.form;
  await f.navigate('#team');
  assert.equal(f.location.hash,'#record/2026-11-10');assert.equal(f.active,'record');assert.equal(f.form,form);assert.equal(f.field('weight').value,'71.5');
  assert.equal(f.prompts.length,1);assert.equal(f.navState.synced.at(-1),'record');assert.equal(f.eval('navigationPending'),false);
  assert.equal(f.unload().prevented,true);
});
test('date-only selection navigates freely; declining a dirty date change restores the original date',async()=>{
  const f=fixture();f.field('date').value='2026-11-09';await f.navigate('#record/2026-11-09');
  assert.equal(f.prompts.length,0);assert.equal(f.field('date').value,'2026-11-09');
  f.field('breakfast').value='아침 기록';f.field('date').value='2026-11-08';await f.navigate('#record/2026-11-08');
  assert.equal(f.location.hash,'#record/2026-11-09');assert.equal(f.field('date').value,'2026-11-09');assert.equal(f.field('breakfast').value,'아침 기록');
});
test('an asynchronous meal discard confirmation rejects overlapping navigation and keeps the original destination',async()=>{
  for(const accepted of [false,true]) {
    const f=fixture('#team');f.flags.meal=true;f.flags.mealPrompt=deferred();
    const pending=f.navigate('#board');assert.equal(f.eval('navigationPending'),true);assert.equal(f.location.hash,'#team');
    await f.navigate('#settings');assert.equal(f.location.hash,'#team');assert.equal(f.active,'team');
    f.flags.mealPrompt.resolve(accepted);await pending;
    assert.equal(f.location.hash,accepted?'#board':'#team');assert.equal(f.active,accepted?'board':'team');assert.equal(f.eval('navigationPending'),false);
  }
});
test('saving personal records blocks navigation; edits during the save remain unsaved afterwards',async()=>{
  const f=fixture(), save=deferred();f.field('weight').value='71.5';f.setResponse(()=>save.promise);
  const pending=f.submit();assert.equal(f.eval('personalSaving'),true);assert.equal(f.form.button.disabled,true);
  await f.navigate('#team');assert.equal(f.location.hash,'#record/2026-11-10');assert.equal(f.active,'record');assert.equal(f.prompts.length,0);assert.match(f.messages.at(-1),/저장하고/);
  const sent=JSON.parse(f.calls[0].options.body);assert.equal(sent.records['2026-11-10'].weight,'71.5');
  f.field('weight').value='72';save.resolve({personal:sent,personalRevision:1});await pending;
  assert.equal(f.eval('personalSaving'),false);assert.equal(f.eval('personalIsDirty()'),true);assert.equal(f.field('weight').value,'72');
  await f.navigate('#team');assert.equal(f.location.hash,'#record/2026-11-10');assert.equal(f.prompts.length,1);
});
test('successful unchanged settings save clears dirty state and failed save preserves the draft',async()=>{
  const f=fixture('#settings');f.field('name').value='민준';
  f.setResponse(async(_url,options)=>({personal:JSON.parse(options.body),personalRevision:1}));await f.submit();
  assert.equal(f.eval('personalIsDirty()'),false);assert.equal(f.form.button.disabled,false);assert.equal(f.unload().prevented,undefined);
  f.field('goalWeight').value='65';f.setResponse(async()=>{throw new Error('network failed');});await f.submit();
  assert.equal(f.eval('personalSaving'),false);assert.equal(f.form.button.disabled,false);assert.equal(f.eval('personalIsDirty()'),true);
  await f.navigate('#today');assert.equal(f.location.hash,'#settings');assert.equal(f.field('goalWeight').value,'65');
});
test('accepted personal discard switches page once and clears old-form dirty state',async()=>{
  const f=fixture();f.field('workoutNote').value='미저장 운동';f.flags.answer=true;await f.navigate('#team');
  assert.equal(f.location.hash,'#team');assert.equal(f.active,'team');assert.equal(f.form,null);assert.equal(f.eval('personalIsDirty()'),false);assert.equal(f.prompts.length,1);
  await f.navigate('#team');assert.equal(f.prompts.length,1);assert.equal(f.eval('navigationPending'),false);
});

test('the header opens the signed-in member profile with the correct settings and return destination', async () => {
  for (const zondaParticipant of [true, false]) {
    const f = fixture('#reservations/2027-01-04', {zondaParticipant});
    f.account.user.name = '회원<이름>';
    f.setResponse(async () => ({kind:'visits'}));
    const header = f.nodes.get('.profile');
    assert.match(header.innerHTML, /href="#profile"/);
    await f.navigate('#profile');
    assert.match(header.innerHTML, /aria-current="page"/);
    assert.match(f.markup, /회원&lt;이름&gt;/);
    assert.match(f.markup, /<dd>member01<\/dd>/);
    assert.match(f.markup, /id="booking-notifications"/);
    assert.equal(f.markup.includes('href="#settings"'), zondaParticipant);
    assert.ok(f.nodes.get('#logout-button').listeners.click);
    assert.equal(f.body.classList.contains('in-zonda'), false);
    assert.equal(f.boxReturn.getAttribute('href'), '#reservations/2027-01-04');
    assert.deepEqual(f.calls.map(call=>call.url), ['/api/membership']);
    await new Promise(setImmediate);
    assert.equal(f.nodes.get('#profile-membership').innerHTML, '회원권 visits');
  }
});

test('administrator and pending profiles offer their own settings without requesting member data', () => {
  for (const pendingApproval of [false, true]) {
    const f = fixture('#profile', {isAdmin:!pendingApproval, pendingApproval, zondaParticipant:false});
    assert.match(f.markup, /<h1>내 정보<\/h1>/);
    assert.match(f.markup, pendingApproval ? /<dd>승인 대기<\/dd>/ : /<dd>관리자<\/dd>/);
    assert.match(f.markup, pendingApproval ? /href="#connect"/ : /href="#naver"/);
    assert.match(f.markup, pendingApproval ? /<dd>네이버<\/dd>/ : /<dd>admin<\/dd>/);
    assert.doesNotMatch(f.markup, /id="booking-notifications"|id="profile-membership"|href="#settings"/);
    assert.equal(f.calls.length, 0);
  }
});

test('opening the profile respects unsaved edits', async () => {
  const f = fixture('#settings');
  f.field('name').value = '새 이름';
  await f.navigate('#profile');
  assert.equal(f.location.hash, '#settings');
  assert.equal(f.field('name').value, '새 이름');
  assert.equal(f.prompts.length, 1);
});

test('booking is the default for box members and Zonda keeps previous participant bookmarks', async () => {
  const f = fixture('');
  assert.equal(f.active, 'reservations');
  assert.equal(f.boxReturn.hidden, true);
  assert.deepEqual(f.pages, ['reservations', 'wod', 'guide', 'zonda']);
  await f.navigate('#reservations/2027-01-04');
  assert.equal(f.navState.bookingDate, '2027-01-04');
  await f.navigate('#zonda');
  assert.equal(f.calls.at(-1).url, '/api/bootstrap');
  assert.equal(f.active, 'today');
  assert.equal(f.body.classList.contains('in-zonda'), true);
  assert.equal(f.boxReturn.hidden, false);
  await f.navigate('#record/2026-11-10');
  assert.equal(f.active, 'record');
  assert.equal(f.field('date').value, '2026-11-10');
  assert.equal(f.boxReturn.getAttribute('href'), '#reservations/2027-01-04');
  await f.navigate(f.boxReturn.getAttribute('href'));
  assert.equal(f.active, 'reservations');
  assert.equal(f.navState.bookingDate, '2027-01-04');
  assert.equal(f.boxReturn.hidden, true);
  assert.equal(f.body.classList.contains('in-zonda'), false);
});

test('box-only members can open Zonda information and gain access after enrollment', async () => {
  const f = fixture('#members', {zondaParticipant: false});
  assert.equal(f.active, 'reservations');
  assert.ok(!f.pages.includes('members'));
  await f.navigate('#guide');
  assert.equal(f.active, 'guide');
  assert.equal(f.navState.guideMounted, true);
  assert.equal(f.body.classList.contains('in-box'), true);
  await f.navigate('#zonda');
  assert.equal(f.active, 'zonda');
  assert.equal(f.subnav.hidden, true);
  assert.equal(f.localLinks.length, 0);
  assert.equal(f.boxReturn.hidden, false);
  assert.equal(f.boxReturn.getAttribute('href'), '#guide');
  await f.navigate(f.boxReturn.getAttribute('href'));
  assert.equal(f.active, 'guide');
  assert.equal(f.boxReturn.hidden, true);
  assert.equal(f.body.classList.contains('in-box'), true);
  await f.navigate('#record/2026-11-10');
  assert.equal(f.active, 'reservations');
  assert.equal(f.form, null);
  f.setResponse(async () => ({...f.account, zondaParticipant: true}));
  await f.navigate('#zonda');
  assert.equal(f.active, 'today');
});

test('administrators manage the box and Zonda separately; unapproved applicants only see onboarding', async () => {
  const f = fixture('', {isAdmin: true, zondaParticipant: false});
  assert.equal(f.active, 'reservations');
  assert.deepEqual(f.pages, ['reservations', 'wod', 'guide', 'members', 'zonda']);
  await f.navigate('#members');
  assert.equal(f.active, 'members');
  assert.match(f.markup, /박스 회원 관리/);
  f.flags.boxMember = true;
  await f.navigate('#reservations');
  assert.equal(f.active, 'members');
  assert.equal(f.unload().prevented, true);
  f.flags.answer = true;
  await f.navigate('#zonda');
  assert.equal(f.active, 'admin');
  assert.equal(f.body.classList.contains('in-zonda'), true);
  assert.ok(f.pages.includes('accounts'));
  await f.navigate('#accounts');
  assert.equal(f.boxReturn.hidden, false);
  await f.navigate(f.boxReturn.getAttribute('href'));
  assert.equal(f.active, 'members');
  const pending = fixture('#reservations', {zondaParticipant: false, pendingApproval: true});
  assert.deepEqual(pending.pages, ['connect']);
  assert.equal(pending.subnav.hidden, true);
  assert.equal(pending.localLinks.length, 0);
  assert.equal(pending.active, 'connect');
  assert.equal(pending.boxReturn.hidden, true);
  await pending.navigate('#guide');
  assert.equal(pending.active, 'connect');
  assert.equal(pending.navState.guideMounted, undefined);
});

test('mobile Zonda retains the box destinations and highlights both the section and its role-specific page', async () => {
  for (const isAdmin of [false, true]) {
    const f = fixture('#reservations/2027-01-04', {isAdmin});
    const boxPages = f.pages;
    await f.navigate('#zonda');
    const mobileLinks = f.links.filter(link => link.getAttribute('class') === 'mobile-box-link');
    assert.deepEqual(mobileLinks.map(link => link.dataset.page), boxPages);
    assert.equal(mobileLinks[0].getAttribute('href'), '#reservations/2027-01-04');
    assert.equal(mobileLinks.find(link => link.dataset.page === 'zonda').getAttribute('aria-current'), 'location');
    const programPages = isAdmin ? ['admin','accounts','naver','board'] : ['today','team','board','record','progress','settings'];
    assert.equal(f.subnav.hidden, false);
    assert.deepEqual(f.localLinks.map(link => link.dataset.page), programPages);
    for (const page of programPages) {
      await f.navigate('#' + page);
      assert.equal(f.localLinks.find(link => link.dataset.page === page).getAttribute('aria-current'), 'page');
      assert.equal(f.links.find(link => link.dataset.page === 'zonda').getAttribute('aria-current'), 'location');
    }
    if (!isAdmin) {
      await f.navigate('#connect');
      assert.equal(f.localLinks.find(link => link.dataset.page === 'settings').getAttribute('aria-current'), 'location');
    }
    await f.navigate(f.boxReturn.getAttribute('href'));
    assert.equal(f.location.hash, '#reservations/2027-01-04');
    assert.equal(f.subnav.hidden, true);
    assert.equal(f.localLinks.length, 0);
  }
});

test('a direct Zonda link returns to the box landing and respects unsaved program records', async () => {
  const f = fixture('#record/2026-11-10');
  assert.equal(f.boxReturn.hidden, false);
  assert.equal(f.boxReturn.getAttribute('href'), '#reservations');
  f.field('weight').value = '71.5';
  await f.navigate(f.boxReturn.getAttribute('href'));
  assert.equal(f.active, 'record');
  assert.equal(f.field('weight').value, '71.5');
  f.flags.answer = true;
  await f.navigate(f.boxReturn.getAttribute('href'));
  assert.equal(f.active, 'reservations');
  assert.equal(f.boxReturn.hidden, true);
});

test('members outside Zonda can open a WOD and preserve an unsaved result when declining a date change', async () => {
  const f = fixture('#wod/2026-11-10', {zondaParticipant:false});
  assert.equal(f.active, 'wod');
  assert.equal(f.navState.wodDate, '2026-11-10');
  const mounts = f.navState.wodMounts;
  f.flags.wod = true;
  assert.equal(f.unload().prevented, true);
  await f.navigate('#wod/2026-11-09');
  assert.equal(f.location.hash, '#wod/2026-11-10');
  assert.equal(f.navState.restoredWodDate, '2026-11-10');
  assert.equal(f.navState.wodMounts, mounts);
  assert.equal(f.prompts.length, 1);
  f.flags.answer = true;
  await f.navigate('#wod/2026-11-09');
  assert.equal(f.navState.wodDate, '2026-11-09');
  assert.equal(f.navState.wodMounts, mounts + 1);
});
