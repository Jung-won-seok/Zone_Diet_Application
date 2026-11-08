const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../meal-summary');
const photo='/api/media/'+'a'.repeat(32);
const entry=(meal,blocks,extra={})=>({memberId:'u01',date:'2026-05-10',meal,blocks,...extra});
const draft=posts=>M.buildDraft({date:'2026-05-10',startDate:'2026-04-21',memberId:'u01',name:'김민준',posts});
test('fractional totals stay exact; unentered differs from explicit zero',()=>{
 const d=draft([entry('breakfast',{carbs:0.1,protein:0,fat:null}),entry('lunch',{carbs:0.2,protein:null,fat:0}),entry('dinner',{carbs:2.25,protein:3.5,fat:1.25})]);
 assert.deepEqual(d.summary.totals,{carbs:2.55,protein:3.5,fat:1.25});assert.deepEqual(d.summary.counts,{carbs:3,protein:2,fat:2});assert.equal(d.summary.completeMeals,1);assert.match(M.bodyText(d),/단백질 0블록/);assert.match(M.bodyText(d),/지방 미입력/);assert.match(M.bodyText(d),/미입력 항목을 제외/);
});
test('title uses selected date and inclusive cohort start across years and leap days',()=>{
 assert.equal(draft([]).title,'5.10일 존다 20일차');
 for(const [date,start,expected] of [['2026-01-01','2025-12-31',2],['2024-03-01','2024-02-28',3],['2026-05-10','2026-05-10',1]])assert.equal(M.buildDraft({date,startDate:start,memberId:'u01',name:'',posts:[]}).dayNumber,expected);
 assert.match(M.buildDraft({date:'2026-05-10',startDate:'2026-05-11',posts:[]}).title,/시작 전/);assert.throws(()=>M.buildDraft({date:'2026-02-30',posts:[]}));
});
test('only selected member and date appear; every meal ordered and all photos included',()=>{
 const b={carbs:3,protein:3,fat:3};const d=draft([entry('dinner',b),entry('breakfast',b,{photos:[{url:photo},{url:'/api/media/'+'b'.repeat(32)}] }),entry('lunch',b,{memberId:'u02',caption:'OTHER MEMBER PRIVATE'}),entry('lunch',b,{date:'2026-05-09',caption:'OTHER DATE'})]);
 assert.deepEqual(d.meals.map(m=>m.meal),['breakfast','lunch','dinner']);assert.equal(d.summary.photoCount,2);assert.equal(d.summary.totals.carbs,6);assert.doesNotMatch(M.bodyText(d),/OTHER/);assert.equal(d.meals[1].blocks.carbs,null);
});
test('legacy posts retain photos without inventing block values',()=>{
 const d=draft([entry('breakfast',undefined,{imageUrl:photo,caption:'사진만 등록한 기록'})]);assert.equal(d.summary.photoCount,1);assert.equal(d.summary.counts.carbs,0);assert.match(M.bodyText(d),/탄수화물 미입력/);
});
test('HTML export embeds every image without private URLs and escapes injected markup',()=>{
 const d=draft([entry('breakfast',{carbs:3,protein:3,fat:3},{photos:[{url:photo},{url:'https://evil.invalid/a.png'}],caption:'<script>alert(1)</script>'})]);d.title='<img src=x onerror=alert(1)>';
 const html=M.standaloneHTML(d,{[photo]:'data:image/png;base64,YQ=='});assert.match(html,/src="data:image\/png;base64,YQ=="/);assert.doesNotMatch(html,/\/api\/media|https:\/\/evil|<script>|<img src=x/);assert.match(html,/&lt;script&gt;/);assert.throws(()=>M.standaloneHTML(d,{}));
});
