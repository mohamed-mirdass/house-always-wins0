'use strict';
/* ROYAL SPIN - serveur casino (points virtuels uniquement)
   Node.js + Express + Socket.IO. Toute la logique (paris, tirage, gains,
   blackjack, machine à sous) est exécutée côté serveur. */

const express = require('express');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { Redis } = require('@upstash/redis');

const PORT = +process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || '';          // obligatoire en ligne, optionnel en local
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const STATE_KEY = process.env.REDIS_STATE_KEY || 'royal-spin:state';

const START_BALANCE = 1000;
const CHIPS = [10, 50, 100, 500];
const SPIN_MS = +process.env.SPIN_MS || 7000;
const RESULT_MS = +process.env.RESULT_MS || 10000;
let BET_MS = 25000;
const MAX_PLAYERS = 300;
const AVATARS = ['🦁', '🐯', '🦊', '🐼', '🐲', '🦄', '🦅', '🐺', '🤖', '👑', '😎', '🎩'];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/healthz', (req, res) => res.send('ok'));

/* ---------------------------------------------------------------- roulette */
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = n => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
const MULT = { n: 36, red: 2, black: 2, even: 2, odd: 2, low: 2, high: 2, d1: 3, d2: 3, d3: 3, c1: 3, c2: 3, c3: 3 };
const rnd = n => crypto.randomInt(0, n);

function betWins(b, n) {
  switch (b.type) {
    case 'n': return n === b.value;
    case 'red': return colorOf(n) === 'red';
    case 'black': return colorOf(n) === 'black';
    case 'even': return n !== 0 && n % 2 === 0;
    case 'odd': return n % 2 === 1;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19 && n <= 36;
    case 'd1': return n >= 1 && n <= 12;
    case 'd2': return n >= 13 && n <= 24;
    case 'd3': return n >= 25 && n <= 36;
    case 'c1': return n !== 0 && n % 3 === 1;
    case 'c2': return n !== 0 && n % 3 === 2;
    case 'c3': return n !== 0 && n % 3 === 0;
  }
  return false;
}

/* ------------------------------------------------------------------- état */
const players = new Map();
let counts = Array(37).fill(0);
let history = [];
let round = 1;
const game = { phase: 'betting', result: null, deadline: 0, spinEnd: 0, auto: false };
let autoTimer = null, settleTimer = null;

function newPlayer(id, name, avatar) {
  return {
    id, name, avatar, balance: START_BALANCE, wagered: 0, wins: 0, best: 0, straights: 0, streak: 0, refills: 0,
    bets: [], log: [], lastBets: [], res: null, busy: false, bj: null, online: 0
  };
}

async function load() {
  let d;
  try {
    if (redis) {
      const raw = await redis.get(STATE_KEY);
      d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!d) { console.log('Aucun classement sauvegardé dans Redis (premier lancement).'); return; }
    } else d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    if (redis) throw new Error(`Impossible de charger le classement Redis: ${e.message}`);
    return; // premier lancement en local
  }
  (d.players || []).forEach(p => players.set(p.id, Object.assign(newPlayer(p.id, p.name, p.avatar), p)));
  if (Array.isArray(d.counts) && d.counts.length === 37) counts = d.counts;
  history = d.history || [];
  round = d.round || 1;
  console.log(`Données chargées: ${players.size} joueur(s)`);
}

let dirty = false;
const markDirty = () => { dirty = true; };
async function saveNow() {
  try {
    const out = {
      players: [...players.values()].map(p => ({
        id: p.id, name: p.name, avatar: p.avatar,
        // les mises en cours sont rendues au joueur si le serveur s'arrête
        balance: p.balance + p.bets.reduce((s, b) => s + b.amount, 0) + (p.bj && p.bj.status === 'playing' ? p.bj.bet : 0),
        wagered: p.wagered, wins: p.wins, best: p.best, straights: p.straights, streak: p.streak, refills: p.refills
      })),
      counts, history, round
    };
    if (redis) await redis.set(STATE_KEY, JSON.stringify(out));
    else {
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(out));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    }
    return true;
  } catch (e) { console.error('Sauvegarde impossible:', e.message); return false; }
}
let saving = false;
setInterval(async () => {
  if (!dirty || saving) return;
  dirty = false; saving = true;
  if (!await saveNow()) dirty = true;
  saving = false;
}, 2000);
process.on('SIGINT', () => { saveNow().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { saveNow().finally(() => process.exit(0)); });

/* ----------------------------------------------------------- vues publiques */
const betsTotal = p => p.bets.reduce((s, b) => s + b.amount, 0);

function pub() {
  const inResult = game.phase === 'result';
  return {
    round, phase: game.phase, result: game.phase === 'betting' ? null : game.result,
    history: history.slice(0, 24), counts, deadline: game.deadline, spinEnd: game.spinEnd,
    spinMs: SPIN_MS, betMs: BET_MS, auto: game.auto, serverTime: Date.now(), chips: CHIPS,
    online: [...players.values()].filter(p => p.online > 0).length,
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, balance: p.balance, wagered: p.wagered, wins: p.wins,
      best: p.best, straights: p.straights, streak: p.streak, online: p.online > 0,
      betting: p.bets.length > 0, net: inResult && p.res && p.res.round === round ? p.res.win - p.res.stake : 0
    }))
  };
}

const HIDDEN = { hidden: true };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
function handValue(h) {
  let t = 0, aces = 0;
  for (const c of h) {
    if (c.r === 'A') { aces++; t += 11; }
    else if (c.r === '10' || c.r === 'J' || c.r === 'Q' || c.r === 'K') t += 10;
    else t += +c.r;
  }
  while (t > 21 && aces) { t -= 10; aces--; }
  return t;
}
function bjView(b) {
  const done = b.status === 'done';
  return {
    bet: b.bet, player: b.player, dealer: done ? b.dealer : [b.dealer[0], HIDDEN],
    pv: handValue(b.player), dv: done ? handValue(b.dealer) : handValue([b.dealer[0]]),
    status: b.status, outcome: b.outcome, payout: b.payout, canDouble: b.status === 'playing' && b.player.length === 2
  };
}
function meFor(p) {
  if (!p) return null;
  return { balance: p.balance, bets: p.bets, total: betsTotal(p), hasLast: p.lastBets.length > 0, busy: p.busy, res: p.res, bj: p.bj ? bjView(p.bj) : null };
}
function emitMe(socket) { socket.emit('me', meFor(players.get(socket.data.id))); }
function emitAll() {
  io.emit('state', pub());
  for (const s of io.sockets.sockets.values()) if (s.data.id) emitMe(s);
}
let emitT = null;
function scheduleEmit() {
  if (emitT) return;
  emitT = setTimeout(() => { emitT = null; io.emit('state', pub()); }, 150);
}

/* -------------------------------------------------------------- cycle de jeu */
function schedAuto() {
  clearTimeout(autoTimer); autoTimer = null; game.deadline = 0;
  if (!game.auto) return;
  if (game.phase === 'betting') { game.deadline = Date.now() + BET_MS; autoTimer = setTimeout(spin, BET_MS); }
  else if (game.phase === 'result') { game.deadline = Date.now() + RESULT_MS; autoTimer = setTimeout(nextRound, RESULT_MS); }
}
function startBetting() {
  game.phase = 'betting'; game.result = null; game.spinEnd = 0;
  for (const p of players.values()) { p.bets = []; p.log = []; }
  schedAuto(); emitAll();
}
function nextRound() { round++; startBetting(); markDirty(); }
function spin() {
  if (game.phase !== 'betting') return;
  clearTimeout(autoTimer); autoTimer = null;
  game.result = rnd(37); game.phase = 'spinning'; game.deadline = 0; game.spinEnd = Date.now() + SPIN_MS;
  emitAll();
  settleTimer = setTimeout(settle, SPIN_MS);
}
function settle() {
  const n = game.result;
  history.unshift(n); history = history.slice(0, 100); counts[n]++;
  for (const p of players.values()) {
    const stake = betsTotal(p);
    let win = 0, hitStraight = false;
    for (const b of p.bets) if (betWins(b, n)) { win += b.amount * MULT[b.type]; if (b.type === 'n') hitStraight = true; }
    p.res = { round, stake, win };
    if (stake > 0) {
      p.wagered += stake; p.balance += win;
      if (win > stake) { p.wins++; p.streak++; p.best = Math.max(p.best, win - stake); }
      else if (win < stake) p.streak = 0;
      if (hitStraight) p.straights++;
      p.lastBets = p.bets.map(b => ({ ...b }));
    }
  }
  game.phase = 'result';
  schedAuto(); emitAll(); markDirty();
}

/* ------------------------------------------------------------- machine à sous */
const SLOT = [['🍒', 30, 10], ['🍋', 25, 12], ['🔔', 20, 20], ['⭐', 12, 50], ['7️⃣', 8, 100], ['💎', 5, 250]];
function pickSlot() { let r = rnd(100); for (const s of SLOT) { if (r < s[1]) return s; r -= s[1]; } return SLOT[0]; }

/* ------------------------------------------------------------------ blackjack */
function newDeck() {
  const d = [];
  for (const s of ['♠', '♥', '♦', '♣']) for (const r of RANKS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function bjFinish(p) {
  const b = p.bj, pv = handValue(b.player);
  if (pv <= 21) while (handValue(b.dealer) < 17) b.dealer.push(b.deck.pop());
  const dv = handValue(b.dealer);
  let outcome, payout;
  if (pv > 21) { outcome = 'bust'; payout = 0; }
  else if (b.natural) { outcome = dv === 21 && b.dealer.length === 2 ? 'push' : 'blackjack'; payout = outcome === 'push' ? b.bet : b.bet * 2.5; }
  else if (dv > 21 || pv > dv) { outcome = 'win'; payout = b.bet * 2; }
  else if (pv === dv) { outcome = 'push'; payout = b.bet; }
  else { outcome = 'lose'; payout = 0; }
  b.status = 'done'; b.outcome = outcome; b.payout = payout;
  p.balance += payout; p.wagered += b.bet;
  if (payout > b.bet) { p.wins++; p.best = Math.max(p.best, payout - b.bet); }
  markDirty();
}

/* ------------------------------------------------------------------- réseau */
function isLocal(socket) {
  const a = socket.handshake.address || '';
  return a === '::1' || a === '127.0.0.1' || a === '::ffff:127.0.0.1';
}
function authorized(socket, key) { return HOST_KEY ? key === HOST_KEY : isLocal(socket); }

function lanCandidates() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      let score = 0;
      if (/virtual|vbox|vmware|vethernet|wsl|docker|hyper|loopback|tap|tun|bluetooth/i.test(name)) score -= 10;
      if (/wi-?fi|wlan|wireless|en0|^wl/i.test(name)) score += 2;
      if (/ethernet|^eth|^en\d/i.test(name)) score += 1;
      if (n.address.startsWith('192.168.56.') || n.address.startsWith('192.168.99.')) score -= 5;
      if (n.address.startsWith('192.168.')) score += 3;
      else if (n.address.startsWith('10.')) score += 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(n.address)) score += 1;
      if (n.address.startsWith('169.254.')) score -= 20;
      out.push({ ip: n.address, name, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

let chosenUrl = '';
const qrCache = new Map();
async function qrFor(url) {
  if (!qrCache.has(url)) qrCache.set(url, await QRCode.toDataURL(url, { width: 360, margin: 1 }));
  return qrCache.get(url);
}
async function joinInfo(socket) {
  const h = socket.handshake.headers;
  const host = h['x-forwarded-host'] || h.host || `localhost:${PORT}`;
  const hostname = host.split(':')[0];
  let urls;
  if (process.env.PUBLIC_URL) urls = [process.env.PUBLIC_URL.replace(/\/$/, '')];
  else if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    urls = lanCandidates().map(c => `http://${c.ip}:${PORT}`);
    if (!urls.length) urls = [`http://localhost:${PORT}`];
  } else urls = [`${(h['x-forwarded-proto'] || 'http').split(',')[0]}://${host}`];
  const url = urls.includes(chosenUrl) ? chosenUrl : urls[0];
  return { url, urls, qr: await qrFor(url), hostKeyRequired: !!HOST_KEY };
}
async function sendInfo(socket) { try { socket.emit('info', await joinInfo(socket)); } catch (e) { /* ignore */ } }

const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);

io.on('connection', socket => {
  const on = (ev, fn) => socket.on(ev, (d, ack) => { try { fn(d || {}, ack); } catch (e) { console.error(ev, e.message); } });
  const me = () => players.get(socket.data.id);
  const err = msg => socket.emit('err', msg);

  on('hello', d => {
    const { id, role, key } = d;
    if (typeof id !== 'string' || id.length < 4 || id.length > 64 || socket.data.id) return;
    socket.data.id = id; socket.data.role = role;
    const p = players.get(id);
    if (p) { p.online++; socket.data.counted = true; }
    if (role === 'host') {
      if (authorized(socket, key)) { socket.data.isHost = true; socket.emit('hostOk'); sendInfo(socket); }
      else socket.emit('hostDenied', { keyRequired: !!HOST_KEY });
    }
    if (role === 'tv') sendInfo(socket);
    socket.emit('state', pub()); emitMe(socket);
    scheduleEmit();
  });

  on('join', d => {
    const id = socket.data.id;
    if (!id || players.has(id) || players.size >= MAX_PLAYERS) return;
    const name = cleanName(d.name);
    if (!name) return;
    const p = newPlayer(id, name, AVATARS.includes(d.avatar) ? d.avatar : AVATARS[0]);
    p.online = 1; socket.data.counted = true;
    players.set(id, p);
    emitAll(); markDirty();
  });

  /* ---- roulette ---- */
  on('bet', d => {
    const p = me(); if (!p) return;
    if (game.phase !== 'betting') return err('Les paris sont fermés');
    const { type, amount } = d; let value = d.value;
    if (!CHIPS.includes(amount) || !(type in MULT)) return;
    if (type === 'n') { if (!Number.isInteger(value) || value < 0 || value > 36) return; } else value = null;
    if (p.balance < amount) return err('Solde insuffisant');
    p.balance -= amount;
    const ex = p.bets.find(b => b.type === type && b.value === value);
    if (ex) ex.amount += amount; else p.bets.push({ type, value, amount });
    p.log.push({ type, value, amount });
    emitMe(socket); scheduleEmit(); markDirty();
  });
  on('undo', () => {
    const p = me(); if (!p || game.phase !== 'betting') return;
    const l = p.log.pop(); if (!l) return;
    const b = p.bets.find(x => x.type === l.type && x.value === l.value);
    if (b) { b.amount -= l.amount; if (b.amount <= 0) p.bets = p.bets.filter(x => x !== b); }
    p.balance += l.amount;
    emitMe(socket); scheduleEmit(); markDirty();
  });
  on('clearBets', () => {
    const p = me(); if (!p || game.phase !== 'betting') return;
    p.balance += betsTotal(p); p.bets = []; p.log = [];
    emitMe(socket); scheduleEmit(); markDirty();
  });
  on('rebet', () => {
    const p = me(); if (!p || game.phase !== 'betting') return;
    p.balance += betsTotal(p); p.bets = []; p.log = [];
    for (const b of p.lastBets) {
      if (p.balance < b.amount) continue;
      p.balance -= b.amount; p.bets.push({ ...b }); p.log.push({ ...b });
    }
    emitMe(socket); scheduleEmit(); markDirty();
  });
  on('refill', () => {
    const p = me();
    if (!p || p.balance >= 10 || p.bets.length || p.busy || (p.bj && p.bj.status === 'playing')) return;
    p.balance += 500; p.refills++;
    emitMe(socket); scheduleEmit(); markDirty();
  });

  /* ---- machine à sous ---- */
  on('slots', d => {
    const p = me(); if (!p || p.busy) return;
    const amount = d.amount;
    if (!CHIPS.includes(amount)) return;
    if (p.balance < amount) return err('Solde insuffisant');
    p.balance -= amount; p.busy = true;
    const reels = [pickSlot(), pickSlot(), pickSlot()];
    let mult = 0;
    if (reels[0][0] === reels[1][0] && reels[1][0] === reels[2][0]) mult = reels[0][2];
    else if (reels.filter(r => r[0] === '🍒').length === 2) mult = 1;
    const win = amount * mult;
    socket.emit('slotsResult', { reels: reels.map(r => r[0]), win, amount, mult });
    emitMe(socket);
    setTimeout(() => {
      p.balance += win; p.busy = false; p.wagered += amount;
      if (win > amount) { p.wins++; p.best = Math.max(p.best, win - amount); }
      emitMe(socket); scheduleEmit(); markDirty();
    }, 2200);
  });

  /* ---- blackjack ---- */
  on('bjDeal', d => {
    const p = me(); if (!p) return;
    if (p.bj && p.bj.status === 'playing') return;
    const amount = d.amount;
    if (!CHIPS.includes(amount)) return;
    if (p.balance < amount) return err('Solde insuffisant');
    p.balance -= amount;
    const deck = newDeck();
    const b = { bet: amount, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], status: 'playing', outcome: null, payout: 0, natural: false };
    p.bj = b;
    if (handValue(b.player) === 21 || handValue(b.dealer) === 21) { b.natural = handValue(b.player) === 21; bjFinish(p); }
    emitMe(socket); scheduleEmit(); markDirty();
  });
  on('bjHit', () => {
    const p = me(); if (!p || !p.bj || p.bj.status !== 'playing') return;
    p.bj.player.push(p.bj.deck.pop());
    const v = handValue(p.bj.player);
    if (v > 21) bjFinish(p); else if (v === 21) bjFinish(p);
    emitMe(socket); scheduleEmit();
  });
  on('bjStand', () => {
    const p = me(); if (!p || !p.bj || p.bj.status !== 'playing') return;
    bjFinish(p); emitMe(socket); scheduleEmit();
  });
  on('bjDouble', () => {
    const p = me(); if (!p || !p.bj || p.bj.status !== 'playing' || p.bj.player.length !== 2) return;
    if (p.balance < p.bj.bet) return err('Solde insuffisant');
    p.balance -= p.bj.bet; p.bj.bet *= 2;
    p.bj.player.push(p.bj.deck.pop());
    bjFinish(p); emitMe(socket); scheduleEmit();
  });

  /* ---- hôte ---- */
  const host = (ev, fn) => on(ev, d => { if (socket.data.isHost) fn(d); });
  host('spin', () => spin());
  host('next', () => { if (game.phase === 'result') { clearTimeout(autoTimer); nextRound(); } });
  host('auto', d => { game.auto = !!d.on; if (game.phase !== 'spinning') schedAuto(); emitAll(); });
  host('betMs', d => {
    const s = Math.max(8, Math.min(120, +d.seconds || 25)); BET_MS = s * 1000;
    if (game.auto && game.phase === 'betting') schedAuto();
    emitAll();
  });
  host('resetScores', () => {
    for (const p of players.values()) Object.assign(p, { balance: START_BALANCE, wagered: 0, wins: 0, best: 0, straights: 0, streak: 0, refills: 0, bets: [], log: [], lastBets: [], res: null, bj: null });
    emitAll(); markDirty();
  });
  host('reset', () => {
    clearTimeout(autoTimer); clearTimeout(settleTimer);
    players.clear(); counts = Array(37).fill(0); history = []; round = 1;
    startBetting(); markDirty();
  });
  host('setUrl', async d => {
    const info = await joinInfo(socket);
    if (info.urls.includes(d.url)) {
      chosenUrl = d.url;
      for (const s of io.sockets.sockets.values()) if (s.data.role === 'tv' || s.data.isHost) sendInfo(s);
    }
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.data.id);
    if (p && socket.data.counted) { p.online = Math.max(0, p.online - 1); scheduleEmit(); }
  });
});

async function start() {
  if (process.env.VERCEL && !redis) throw new Error('Vercel exige UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN pour conserver le classement.');
  await load();
  server.listen(PORT, '0.0.0.0', () => {
    const c = lanCandidates();
    console.log('\n  ROYAL SPIN est lancé.\n');
    console.log(`  Hôte (ce PC)      : http://localhost:${PORT}/host`);
    console.log(`  Écran géant (TV)  : http://localhost:${PORT}/tv`);
    console.log(`  Joueurs (WiFi)    : ${c.length ? c.map(x => `http://${x.ip}:${PORT}`).join('  ou  ') : `http://localhost:${PORT}`}`);
    if (HOST_KEY) console.log('  Clé hôte définie (HOST_KEY) : demandée sur /host');
    console.log(redis ? '  Classement : sauvegarde Redis activée.' : '  Classement : sauvegarde locale activée.');
    console.log('');
  });
}
start().catch(e => { console.error('Démarrage impossible:', e.message); process.exit(1); });
