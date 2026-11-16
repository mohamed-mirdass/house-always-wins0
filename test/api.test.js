const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
test('HTTP session, concurrent wagers, idempotent retry and static routes', async () => {
 const db = new PGlite();
 await db.exec('create role anon; create role authenticated; create publication supabase_realtime;');
 await db.exec(fs.readFileSync(require.resolve('../sql/setup.sql'),'utf8'));
 // PGlite has one connection. Queue checkouts as a one-connection pg Pool would.
 let tail=Promise.resolve();
 require('pg').Pool = class {
  async connect() {
   const previous=tail;let release;tail=new Promise(r=>release=r);await previous;
   return { query: (sql, params) => db.query(sql,params), release };
  }
 };
 process.env.DATABASE_URL='test';process.env.SESSION_SECRET='a'.repeat(32);process.env.HOST_KEY='dealer';
 const app=require('../server');const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 const url=`http://localhost:${server.address().port}`;let cookie='';
 const action=async(event,data={},extra={})=>{
  const r=await fetch(url+'/api/game',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({event,data,requestId:randomUUID(),...extra})});
  if(r.headers.get('set-cookie')) cookie=r.headers.get('set-cookie').split(';')[0];
  assert.equal(r.status,200);return r.json();
 };
 try {
  await action('hello');await action('join',{name:'Alice'});
  await Promise.all(Array.from({length:10},()=>action('bet',{type:'red',amount:100})));
  let state=await action('poll');assert.equal(state.me.balance,0);assert.equal(state.me.total,1000);
  await action('clearBets');
  const requestId=randomUUID();
  await Promise.all([action('bet',{type:'black',amount:100},{requestId}),action('bet',{type:'black',amount:100},{requestId})]);
  state=await action('poll');assert.equal(state.me.balance,900);
  state=await action('spin',{}, {role:'host',key:'wrong'});assert.equal(state.state.phase,'betting');
  state=await action('spin',{}, {role:'host',key:'dealer'});assert.equal(state.state.phase,'spinning');
  for(const path of ['/','/host','/tv','/js/transport.js','/vendor/supabase.js','/healthz']) assert.equal((await fetch(url+path)).status,200,path);
  assert.equal((await fetch(url+'/api/tick',{method:'POST'})).status,401);
  const tampered=cookie.replace(/.$/,'x');cookie=tampered;
  state=await action('poll');assert.equal(state.me,null);
 } finally {await new Promise(r=>server.close(r));await db.close();}
});
