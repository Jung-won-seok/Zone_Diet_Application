const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const {createServer,seedStore} = require('../server');

test('a delayed authenticated body cannot use a Naver session after its connection is removed', {timeout:10000}, async t => {
  const listener=http.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>listener.close(resolve)));
  const host=`127.0.0.1:${listener.address().port}`, origin=`https://${host}`, base=`http://${host}`;
  const identity={connectionId:'first-connection',providerIdHash:'first-provider',appHash:crypto.createHash('sha256').update('race-client').digest('hex')};
  const seed=seedStore();
  seed.naverConnections={u01:{...identity,displayName:'회원',encryptedTokens:'revocation-does-not-need-a-decryptable-fixture'}};
  seed.authState={sessions:{'naver-session':{userId:'u01',csrfToken:'session-csrf',expires:Date.now()+60000,naverIdentity:identity}},failures:{}};
  let bodyWaiting;
  const waiting=new Promise(resolve=>{bodyWaiting=resolve;});
  let providerCalls=0;
  const app=createServer({initialStore:seed,persistStore:async()=>{},cloud:true,allowedHosts:[host],naverConfig:{clientId:'race-client',clientSecret:'race-secret',callbackUrl:origin+'/api/naver/callback',encryptionKey:Buffer.alloc(32,21).toString('base64')},naverFetch:async()=>{providerCalls++;throw Error('No provider request expected');}});
  listener.on('request',(req,res)=>{
    if(req.url==='/api/naver/preview') {
      const observe=name=>{if(name==='data'){req.removeListener('newListener',observe);bodyWaiting();}};
      req.on('newListener',observe);
    }
    return app.listeners('request')[0](req,res);
  });
  const headers={Origin:origin,Cookie:'zonda_session=naver-session','X-CSRF-Token':'session-csrf','Content-Type':'application/json'};
  const body=JSON.stringify({date:'2026-01-01'});
  let delayed;
  const result=new Promise((resolve,reject)=>{
    delayed=http.request(base+'/api/naver/preview',{method:'POST',headers:{...headers,'Content-Length':Buffer.byteLength(body)}},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',chunk=>{raw+=chunk;});res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw)}));
    });
    delayed.on('error',reject);delayed.write(body.slice(0,1));
  });
  t.after(()=>delayed.destroy());
  await waiting;
  const disconnected=await fetch(base+'/api/naver/disconnect',{method:'POST',headers,body:'{}'});
  assert.equal(disconnected.status,200);await disconnected.arrayBuffer();
  const expired=await fetch(base+'/api/bootstrap',{headers});
  assert.equal(expired.status,401);await expired.arrayBuffer();
  delayed.end(body.slice(1));
  const response=await result;
  assert.equal(response.status,401);assert.match(response.data.error,/로그인 상태가 변경/);assert.equal(response.data.draft,undefined);
  assert.equal(providerCalls,0);
});
