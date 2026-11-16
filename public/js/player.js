/* player.js - page joueur */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const A = RS.audio;
  const socket = io();
  const pid = RS.pid();
  const AV = ['🦁', '🐯', '🦊', '🐼', '🐲', '🦄', '🦅', '🐺', '🤖', '👑', '😎', '🎩'];

  let S = null, ME = null, joined = false, chip = 10;
  let lastPhase = null, lastRound = null, liveResult = false, shownRound = null;
  let avatar = AV[0], tab = 'roulette';
  let prevBJ = 0;

  /* ------------------------------------------------------------- utilitaires */
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2300);
  }
  function chipCls(a) { return a >= 1000 ? 'm1000' : 'm' + a; }
  function short(a) { return a >= 1000 ? (a / 1000).toFixed(a % 1000 ? 1 : 0) + 'k' : String(a); }

  /* ------------------------------------------------------------ inscription */
  try { avatar = localStorage.getItem('rs_av') || AV[0]; $('nick').value = localStorage.getItem('rs_name') || ''; } catch (e) { /* ignore */ }
  AV.forEach(a => {
    const b = document.createElement('button');
    b.textContent = a; b.type = 'button';
    b.onclick = () => { avatar = a; markAv(); };
    $('avatars').appendChild(b);
  });
  function markAv() { [...$('avatars').children].forEach(b => b.classList.toggle('sel', b.textContent === avatar)); }
  markAv();
  $('joinbtn').onclick = () => {
    const name = $('nick').value.trim(); if (!name) { $('nick').focus(); return; }
    try { localStorage.setItem('rs_av', avatar); localStorage.setItem('rs_name', name); } catch (e) { /* ignore */ }
    socket.emit('join', { name, avatar });
  };
  $('nick').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinbtn').click(); });

  /* ---------------------------------------------------------------- jetons */
  document.querySelectorAll('[data-chips]').forEach(box => {
    [10, 50, 100, 500].forEach(v => {
      const b = document.createElement('button');
      b.className = 'chip c' + v; b.textContent = v; b.dataset.v = v; b.type = 'button';
      b.onclick = () => { chip = v; A.chip(); markChips(); };
      box.appendChild(b);
    });
  });
  function markChips() { document.querySelectorAll('.chips .chip').forEach(b => b.classList.toggle('sel', +b.dataset.v === chip)); }
  markChips();

  /* ----------------------------------------------------------- roue + table */
  const wheel = new RS.Wheel($('wheel'), { onTick: () => A.tick() });

  const tbl = $('rtable');
  function cell(cls, html, type, value, area) {
    const d = document.createElement('button');
    d.type = 'button'; d.className = 'cell ' + cls; d.dataset.key = type + ':' + value;
    d.innerHTML = '<span class="lbl">' + html + '</span><span class="stack"></span>';
    d.style.gridArea = area;
    d.onclick = () => placeBet(type, value);
    tbl.appendChild(d);
  }
  cell('green', '0', 'n', 0, '1 / 2 / 2 / 5');
  for (let r = 0; r < 12; r++) for (let c = 0; c < 3; c++) {
    const n = 3 * r + c + 1;
    cell(RS.color(n), n, 'n', n, `${r + 2} / ${c + 2} / ${r + 3} / ${c + 3}`);
  }
  [['d1', '1-12', 2], ['d2', '13-24', 6], ['d3', '25-36', 10]].forEach(([k, l, r]) => cell('v', l, k, null, `${r} / 1 / ${r + 4} / 2`));
  cell('sm', 'MANQUE<br>1-18', 'low', null, '2 / 5 / 4 / 6');
  cell('sm', 'PAIR', 'even', null, '4 / 5 / 6 / 6');
  cell('red', '<i class="diamond r"></i>', 'red', null, '6 / 5 / 8 / 6');
  cell('black', '<i class="diamond b"></i>', 'black', null, '8 / 5 / 10 / 6');
  cell('sm', 'IMPAIR', 'odd', null, '10 / 5 / 12 / 6');
  cell('sm', 'PASSE<br>19-36', 'high', null, '12 / 5 / 14 / 6');
  [['c1', 2], ['c2', 3], ['c3', 4]].forEach(([k, col]) => cell('sm', '2:1', k, null, `14 / ${col} / 15 / ${col + 1}`));

  function placeBet(type, value) {
    if (!S || S.phase !== 'betting') return toast('Les paris sont fermés');
    if (!ME || ME.balance < chip) return toast('Solde insuffisant');
    A.chip();
    socket.emit('bet', { type, value, amount: chip });
  }
  $('undo').onclick = () => socket.emit('undo');
  $('clear').onclick = () => socket.emit('clearBets');
  $('rebet').onclick = () => { A.chip(); socket.emit('rebet'); };
  $('refill').onclick = () => socket.emit('refill');

  /* ---------------------------------------------------------------- socket */
  socket.on('connect', () => {
    $('conn').textContent = 'Connecté'; $('joinbtn').disabled = false;
    socket.emit('hello', { id: pid, role: 'player' });
  });
  socket.on('disconnect', () => { $('conn').textContent = 'Connexion perdue, reconnexion…'; $('joinbtn').disabled = true; });
  socket.on('err', m => { toast(m); if (m === 'Solde insuffisant') slotStop(true); });

  socket.on('state', s => {
    const first = !S;
    S = s; RS.clock.set(s.serverTime);
    joined = s.players.some(p => p.id === pid);
    $('join').classList.toggle('hide', joined);
    $('app').classList.toggle('hide', !joined);
    if (first && s.history.length) wheel.setResult(s.history[0]);
    if (s.phase !== lastPhase || s.round !== lastRound) onPhase(s);
    lastPhase = s.phase; lastRound = s.round;
    renderHeader(); renderLB(); RS.historyHTML($('rHist'), s.history, 14);
    tickTimer(); showResult();
  });

  function onPhase(s) {
    if (s.phase === 'betting') {
      liveResult = false; $('rBanner').classList.add('hide');
      document.querySelectorAll('.cell.hit').forEach(c => c.classList.remove('hit'));
    } else if (s.phase === 'spinning') {
      wheel.spin(s.result, s.spinMs, s.spinEnd - RS.clock.now());
      A.spinStart();
    } else if (s.phase === 'result') {
      liveResult = lastPhase === 'spinning';
      RS.winKeys(s.result).forEach(k => { const c = tbl.querySelector(`[data-key="${k}"]`); if (c) c.classList.add('hit'); });
    }
  }

  socket.on('me', m => {
    const prevBal = ME ? ME.balance : null;
    ME = m;
    if (!m) return;
    RS.animateNumber($('bal'), m.balance, prevBal === null ? 1 : 700);
    renderBets(); renderBJ(); showResult();
    $('slotSpin').disabled = m.busy;
  });

  function renderHeader() {
    const me = S.players.find(p => p.id === pid); if (!me) return;
    $('myav').textContent = me.avatar; $('myname').textContent = me.name;
    const l = RS.level(me); $('mylvl').textContent = l.icon + ' ' + l.name + ' · niveau ' + l.lv;
  }

  function tickTimer() {
    if (!S) return;
    const bar = $('rBar'), wrap = $('rBarWrap'), st = $('rStatus');
    if (S.phase === 'betting') {
      if (S.deadline) {
        const rem = Math.max(0, S.deadline - RS.clock.now());
        st.textContent = 'Faites vos jeux · ' + Math.ceil(rem / 1000) + ' s';
        bar.style.width = (rem / S.betMs * 100) + '%'; wrap.classList.toggle('low', rem < 5000);
      } else { st.textContent = 'Faites vos jeux'; bar.style.width = '100%'; wrap.classList.remove('low'); }
    } else if (S.phase === 'spinning') { st.textContent = 'Rien ne va plus…'; bar.style.width = '0%'; }
    else { st.textContent = 'Numéro ' + S.result + ' · ' + RS.COLOR_FR[RS.color(S.result)]; bar.style.width = '0%'; }
  }
  setInterval(tickTimer, 250);

  function renderBets() {
    if (!ME) return;
    const map = {}; ME.bets.forEach(b => { map[b.type + ':' + b.value] = b.amount; });
    tbl.querySelectorAll('.cell').forEach(c => {
      const a = map[c.dataset.key], st = c.lastChild;
      const cur = st.firstChild ? st.firstChild.dataset.a : '';
      if (String(a || '') === (cur || '')) return;
      st.textContent = '';
      if (a) { const m = document.createElement('i'); m.className = 'mini ' + chipCls(a); m.dataset.a = a; m.textContent = short(a); st.appendChild(m); }
    });
    $('rTotal').textContent = RS.fmt(ME.total);
    const open = S && S.phase === 'betting';
    $('undo').disabled = !open || !ME.bets.length;
    $('clear').disabled = !open || !ME.bets.length;
    $('rebet').disabled = !open || !ME.hasLast;
    const broke = ME.balance < 10 && !ME.bets.length && !(ME.bj && ME.bj.status === 'playing') && !ME.busy;
    $('refillBox').classList.toggle('hide', !broke);
  }

  function showResult() {
    if (!S || !ME || S.phase !== 'result' || shownRound === S.round) return;
    if (!ME.res || ME.res.round !== S.round) return;
    shownRound = S.round;
    const { stake, win } = ME.res, net = win - stake, b = $('rBanner');
    if (stake <= 0) return;
    b.classList.remove('hide', 'win', 'lose');
    if (net > 0) { b.classList.add('win'); b.textContent = 'Vous gagnez +' + RS.fmt(net) + ' points !'; }
    else if (net === 0) { b.classList.add('lose'); b.textContent = 'Mise remboursée'; }
    else { b.classList.add('lose'); b.textContent = 'Perdu : ' + RS.fmt(net) + ' points'; }
    if (liveResult) {
      if (net > 0) { A.win(net >= 1000); RS.confetti(net >= 1000 ? 'big' : 'small'); }
      else if (net < 0) A.lose();
    }
  }

  /* -------------------------------------------------------------- blackjack */
  function cardEl(c) {
    const d = document.createElement('div');
    if (c.hidden) { d.className = 'card back'; return d; }
    d.className = 'card' + (c.s === '♥' || c.s === '♦' ? ' red' : '');
    d.innerHTML = '<span>' + c.r + '</span><i>' + c.s + '</i>';
    return d;
  }
  function renderBJ() {
    const b = ME && ME.bj;
    const playing = !!b && b.status === 'playing';
    $('bjDealBox').classList.toggle('hide', playing);
    $('bjPlayBox').classList.toggle('hide', !playing);
    const dl = $('bjDealer'), pl = $('bjPlayer');
    const count = b ? b.player.length + b.dealer.length : 0;
    if (count !== prevBJ) {
      dl.textContent = ''; pl.textContent = '';
      if (b) { b.dealer.forEach(c => dl.appendChild(cardEl(c))); b.player.forEach(c => pl.appendChild(cardEl(c))); }
      if (count > prevBJ) A.card();
      prevBJ = count;
    } else if (b && b.status === 'done') {
      dl.textContent = ''; b.dealer.forEach(c => dl.appendChild(cardEl(c)));
    }
    $('bjPv').textContent = b ? b.pv : ''; $('bjDv').textContent = b ? b.dv : '';
    $('bjBet').textContent = b ? '· mise ' + RS.fmt(b.bet) : '';
    $('bjDeal').textContent = b && b.status === 'done' ? 'Nouvelle main' : 'Distribuer';
    $('bjDeal').disabled = !ME || ME.balance < chip;
    $('bjDouble').disabled = !b || !b.canDouble || ME.balance < b.bet;
    const m = $('bjMsg'); m.className = 'felt-msg';
    if (!b) m.textContent = 'Placez votre mise';
    else if (playing) m.textContent = 'À vous de jouer';
    else {
      const net = b.payout - b.bet;
      const txt = { blackjack: 'BLACKJACK ! +' + RS.fmt(net), win: 'Gagné ! +' + RS.fmt(net), push: 'Égalité, mise rendue', lose: 'Le croupier gagne', bust: 'Dépassé ! −' + RS.fmt(b.bet) }[b.outcome];
      m.textContent = txt; m.classList.add(net > 0 ? 'win' : net < 0 ? 'lose' : '');
      if (!renderBJ.done || renderBJ.done !== b.player.length + ':' + b.dealer.length + b.outcome + b.bet) {
        renderBJ.done = b.player.length + ':' + b.dealer.length + b.outcome + b.bet;
        if (net > 0) { A.win(b.outcome === 'blackjack'); if (b.outcome === 'blackjack') RS.confetti('small'); } else if (net < 0) A.lose();
      }
    }
  }
  $('bjDeal').onclick = () => { if (!ME || ME.balance < chip) return toast('Solde insuffisant'); socket.emit('bjDeal', { amount: chip }); };
  $('bjHit').onclick = () => socket.emit('bjHit');
  $('bjStand').onclick = () => socket.emit('bjStand');
  $('bjDouble').onclick = () => socket.emit('bjDouble');

  /* ---------------------------------------------------------- machine à sous */
  const SYMS = ['🍒', '🍋', '🔔', '⭐', '7️⃣', '💎'];
  let slotTimers = [], slotRunning = false;
  function slotStop(reset) {
    if (!reset) return;
    slotTimers.forEach(clearInterval); slotTimers = []; slotRunning = false;
    [0, 1, 2].forEach(i => $('r' + i).classList.remove('spinning'));
  }
  $('slotSpin').onclick = () => {
    if (slotRunning || !ME) return;
    if (ME.balance < chip) return toast('Solde insuffisant');
    slotRunning = true; $('slotMsg').textContent = 'Les rouleaux tournent…'; $('slotMsg').className = 'felt-msg';
    A.spinStart();
    [0, 1, 2].forEach(i => {
      const r = $('r' + i); r.classList.add('spinning'); r.classList.remove('stop');
      slotTimers[i] = setInterval(() => { r.firstChild.textContent = SYMS[(Math.random() * SYMS.length) | 0]; }, 90);
    });
    socket.emit('slots', { amount: chip });
  };
  socket.on('slotsResult', r => {
    [0, 1, 2].forEach(i => setTimeout(() => {
      clearInterval(slotTimers[i]);
      const el = $('r' + i); el.classList.remove('spinning'); el.classList.add('stop'); el.firstChild.textContent = r.reels[i];
      A.chip();
      if (i === 2) {
        slotRunning = false; const m = $('slotMsg');
        if (r.win > r.amount) { m.textContent = 'GAGNÉ +' + RS.fmt(r.win - r.amount) + ' !'; m.className = 'felt-msg win'; A.win(r.mult >= 50); RS.confetti(r.mult >= 50 ? 'big' : 'small'); }
        else if (r.win === r.amount) { m.textContent = 'Mise remboursée'; m.className = 'felt-msg'; }
        else { m.textContent = 'Perdu, retentez votre chance'; m.className = 'felt-msg lose'; A.lose(); }
      }
    }, 700 + i * 500));
  });

  /* ------------------------------------------------------------- classement */
  function renderLB() {
    const list = [...S.players].sort((a, b) => b.balance - a.balance), box = $('lb');
    box.textContent = '';
    list.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'lbrow' + (p.id === pid ? ' me' : '') + (p.online ? '' : ' off');
      const l = RS.level(p), bd = RS.badges(p).map(x => x[0]).join(' ');
      const rk = i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1;
      row.innerHTML = '<span class="rk"></span><span class="av"></span><span class="nm"><b></b><span class="lvl"></span></span><span class="sc"></span>';
      row.children[0].textContent = rk; row.children[1].textContent = p.avatar;
      row.querySelector('b').textContent = p.name + (p.id === pid ? ' (vous)' : '');
      row.querySelector('.lvl').textContent = l.icon + ' niv. ' + l.lv + (bd ? ' · ' + bd : '');
      row.children[3].textContent = RS.fmt(p.balance) + ' pts';
      box.appendChild(row);
    });
    if (!list.length) box.textContent = 'Aucun joueur pour le moment.';
  }

  /* -------------------------------------------------------------- navigation */
  $('nav').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll('.bottomnav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hide', t.id !== 'tab-' + tab));
    window.scrollTo(0, 0);
  });

  function paintMute() { $('mute').textContent = A.muted ? '🔇' : '🔊'; }
  $('mute').onclick = () => { A.init(); A.toggle(); paintMute(); };
  paintMute();
})();
