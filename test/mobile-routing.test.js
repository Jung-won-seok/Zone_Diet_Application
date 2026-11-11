const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const decode = value => String(value || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attributes = html => Object.fromEntries([...html.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
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
function fixture(hash = '#record/2026-11-10') {
  const listeners={}, nodes=new Map(), links=[], prompts=[], messages=[], calls=[];
  const flags={meal:false,naver:false,admin:false,answer:false};
  const location={hash,pathname:'/',search:''};
  let form=null, initial=true, response=async()=>({personal:{settings:{name:'김민준',startWeight:'',goalWeight:''},records:{}},personalRevision:1});
  const body=new Element(), app=new Element(), nav=new Element(), profile=new Element(), settings=new Element({'data-page':'settings'});
  nodes.set('#app',app);nodes.set('.sidebar',new Element());nodes.set('.sidebar nav',nav);nodes.set('.settings-link',settings);nodes.set('.profile',profile);nodes.set('.program-label',new Element());nodes.set('#login-root',new Element());nodes.set('#page-label',new Element());nodes.set('#toast',new Element());
  nodes.set('.topbar > span:first-child',{firstChild:{textContent:''}});
  Object.defineProperty(nav,'innerHTML',{set(html){links.length=0;for(const [,attrs]of html.matchAll(/<a\s+([^>]*)>/g))links.push(new Element(attributes(attrs)));}});
  Object.defineProperty(profile,'innerHTML',{set(){nodes.set('#logout-button',new Element());}});
  Object.defineProperty(app,'innerHTML',{set(html){
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
    history:{replaceState(_state,_title,url){location.hash=url.includes('#')?url.slice(url.indexOf('#')):'';}},
    document:{body,querySelector:selector=>selector==='#record-form, #settings-form'?form:nodes.get(selector)||null,querySelectorAll:selector=>selector==='[data-page]'?[...links,settings]:[]},
    window:{addEventListener:(name,fn)=>{listeners[name]=fn;},scrollTo(){}},
    MobileNavigation:{create(options){navState.options=options;return{cancel(){navState.cancelled++;},sync(){navState.synced.push(links.find(e=>e.classList.contains('active'))?.dataset.page||'settings');}};}},
    fetch:async(url,options)=>{if(initial){initial=false;return new Promise(()=>{});}calls.push({url,options});const result=await response(url,options);return {ok:true,json:async()=>result};},
    setTimeout:()=>0,clearTimeout(){},confirm:message=>{prompts.push(message);return flags.answer;},
    cleanupMeals(){flags.meal=false;},cleanupNaverUI(){flags.naver=false;},
    mealsHasUnsaved:()=>flags.meal,naverIsDirty:()=>flags.naver,adminIsDirty:()=>flags.admin,
    confirmMealDiscard:()=>flags.mealPrompt?flags.mealPrompt.promise:Promise.resolve(flags.answer),
    resetAdminDraft(){flags.admin=false;},memberTeamBanner:()=>'',mealLoadingView:()=>'<div>식단</div>',
    adminView:()=>'',accountsView:()=>'',naverAdminView:()=>'',naverOnboardingView:()=>'',naverMemberView:()=>'',
    bindAdmin(){},mountMeals(){},mountNaverAdmin(){},mountNaverOnboarding(){},mountNaverMember(){},
    mealPage:{date:'2026-11-10'}
  });
  vm.runInContext(source,ctx);
  ctx.messages=messages;
  vm.runInContext("toast=message=>messages.push(message); authReady=true; session={id:'u01',name:'김민준',isAdmin:false}; state={settings:{name:'김민준',startWeight:'',goalWeight:''},records:{}}; bootstrap={personal:state,personalRevision:0,program:{name:'존다'},photoMealCounts:{}}; render();",ctx);
  return {ctx,location,flags,prompts,messages,calls,navState,nodes,
    get form(){return form;},get active(){return links.find(e=>e.classList.contains('active'))?.dataset.page||'settings';},
    setResponse(fn){response=fn;},eval:code=>vm.runInContext(code,ctx),
    field:name=>form.controls.find(e=>e.name===name),
    async navigate(next){location.hash=next;await listeners.hashchange();},
    async submit(){await form.listeners.submit({preventDefault(){},currentTarget:form});},
    unload(){const event={preventDefault(){this.prevented=true;}};listeners.beforeunload(event);return event;}
  };
}

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
