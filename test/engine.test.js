'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../lib/engine');
const options = { identity: 'player-1', hostKey: 'secret' };
async function joined() {
 const e = engine({}, options);
 await e.dispatch('hello', { role: 'player' });
 await e.dispatch('join', { name: 'Alice', avatar: '🦁' });
 return e;
}
function restore(e, opt = options) { return engine(JSON.parse(JSON.stringify(e.snapshot())), opt); }
test('restores bets, validates balance and refunds exactly once', async () => {
 let e = await joined(); await e.dispatch('bet', { type: 'red', amount: 500 });
 e = restore(e); await e.dispatch('hello', { role: 'player' });
 await e.dispatch('bet', { type: 'black', amount: 500 });
 await e.dispatch('bet', { type: 'red', amount: 10 });
 assert.equal(e.view().me.balance, 0);
 await e.dispatch('undo'); assert.equal(e.view().me.balance, 500);
 await e.dispatch('clearBets'); await e.dispatch('clearBets'); assert.equal(e.view().me.balance, 1000);
});
test('dealer authorization is required; roulette settles once after instance replacement', async () => {
 let e = await joined(); await e.dispatch('bet', { type: 'n', value: 0, amount: 10 });
 await e.dispatch('spin'); assert.equal(e.view().state.phase, 'betting');
 e = restore(e); await e.dispatch('hello', { role: 'host', key: 'secret' }); await e.dispatch('spin');
 assert.equal(e.view().state.phase, 'spinning');
 let s=e.snapshot(); s.game.result=0; s.game.spinEnd=1;
 e=engine(s,options); e.tick(); assert.equal(e.view().me.balance,1350);
 e=restore(e); e.tick(); assert.equal(e.view().me.balance,1350); assert.equal(e.view().state.history.length,1);
});
test('blackjack deck stays private and survives requests', async () => {
 let e=await joined(); await e.dispatch('bjDeal',{amount:100});
 const s=e.snapshot(); s.players[0].bj.status='playing'; s.players[0].bj.natural=false;
 e=engine(s,options); assert.equal(e.view().me.bj.deck,undefined); assert.deepEqual(e.view().me.bj.dealer[1],{hidden:true});
 await e.dispatch('hello',{role:'player'}); await e.dispatch('bjStand');
 const balance=e.view().me.balance;
 e=restore(e); await e.dispatch('hello',{role:'player'}); await e.dispatch('bjStand'); assert.equal(e.view().me.balance,balance);
});
test('slots settle once after reload and busy state clears', async () => {
 let e=await joined(); await e.dispatch('slots',{amount:100});
 const s=e.snapshot(); s.players[0].slotPending.due=1; const win=s.players[0].slotPending.win;
 e=engine(s,options); e.tick(); assert.equal(e.view().me.balance,900+win); assert.equal(e.view().me.busy,false);
 e=restore(e);e.tick();assert.equal(e.view().me.balance,900+win);
});
test('auto deadlines persist and advance without process timers', async () => {
 let e=await joined(); e=restore(e);await e.dispatch('hello',{role:'host',key:'secret'});await e.dispatch('auto',{on:true});
 let s=e.snapshot();s.game.deadline=1;e=engine(s,options);e.tick();assert.equal(e.view().state.phase,'spinning');
 s=e.snapshot();s.game.spinEnd=1;e=engine(s,options);e.tick();assert.equal(e.view().state.phase,'result');
 s=e.snapshot();s.game.deadline=1;e=engine(s,options);e.tick();assert.equal(e.view().state.round,2);assert.equal(e.view().state.phase,'betting');
});
test('player cannot impersonate another identity through hello', async()=>{
 const e=await joined();await e.dispatch('hello',{id:'victim',role:'player'});assert.equal(e.snapshot().players[0].id,'player-1');
});
