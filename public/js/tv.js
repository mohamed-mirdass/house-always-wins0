/* tv.js - écran géant (projecteur) */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const A = RS.audio;
  const socket = io();
  let S = null, lastPhase = null, lastRound = null;

  const wheel = new RS.Wheel($('wheel'), { onTick: () => A.tick() });

  addEventListener('pointerdown', () => { A.init(); $('soundhint').classList.add('hide'); });
  addEventListener('keydown', () => { A.init(); $('soundhint').classList.add('hide'); });

  socket.on('connect', () => socket.emit('hello', { id: RS.pid() + '-tv', role: 'tv' }));
  socket.on('info', i => {
    $('qr').src = i.qr; $('qr').classList.remove('hide');
    $('url').textContent = i.url.replace(/^https?:\/\//, '');
  });

  socket.on('state', s => {
    const first = !S;
    S = s; RS.clock.set(s.serverTime);
    if (first && s.history.length) wheel.setResult(s.history[0]);
    if (s.phase !== lastPhase || s.round !== lastRound) onPhase(s);
    lastPhase = s.phase; lastRound = s.round;
    $('tvRound').textContent = 'Tour ' + s.round;
    $('tvOnline').textContent = s.online + (s.online > 1 ? ' joueurs en ligne' : ' joueur en ligne');
    renderLB(); renderStats(); tick();
  });

  function onPhase(s) {
    const ov = $('overlay');
    if (s.phase === 'betting') ov.classList.add('hide');
    else if (s.phase === 'spinning') { ov.classList.add('hide'); wheel.spin(s.result, s.spinMs, s.spinEnd - RS.clock.now()); A.spinStart(); }
    else if (s.phase === 'result') showResult(s, lastPhase === 'spinning');
  }

  function showResult(s, live) {
    const col = RS.color(s.result), big = $('bignum');
    big.className = 'bignum ' + col; big.textContent = s.result;
    $('ovlTitle').textContent = RS.COLOR_FR[col] + ' · ' + (s.result === 0 ? 'zéro' : s.result % 2 ? 'impair' : 'pair');
    const w = s.players.filter(p => p.net > 0).sort((a, b) => b.net - a.net).slice(0, 5);
    const box = $('winners'); box.textContent = '';
    if (!w.length) box.textContent = s.players.some(p => p.betting) ? 'Personne ne gagne ce tour' : '';
    w.forEach(p => {
      const d = document.createElement('div');
      d.appendChild(document.createTextNode(p.avatar + ' ' + p.name + '  '));
      const b = document.createElement('b'); b.textContent = '+' + RS.fmt(p.net); d.appendChild(b);
      box.appendChild(d);
    });
    $('overlay').classList.remove('hide');
    if (live && w.length) { A.win(w[0].net >= 1000); RS.confetti(w[0].net >= 1000 ? 'big' : 'small'); }
  }

  function tick() {
    if (!S) return;
    const el = $('bigstatus');
    if (S.phase === 'betting') {
      if (S.deadline) { const r = Math.max(0, Math.ceil((S.deadline - RS.clock.now()) / 1000)); el.innerHTML = 'Faites vos jeux<span class="cd">' + r + '</span>'; }
      else el.textContent = 'Faites vos jeux';
    } else if (S.phase === 'spinning') el.textContent = 'Rien ne va plus';
    else el.textContent = '';
  }
  setInterval(tick, 250);

  function renderLB() {
    const list = [...S.players].sort((a, b) => b.balance - a.balance).slice(0, 8), box = $('lb');
    box.textContent = '';
    list.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'lbrow' + (p.online ? '' : ' off');
      const l = RS.level(p), bd = RS.badges(p).map(x => x[0]).join('');
      row.innerHTML = '<span class="rk"></span><span class="av"></span><span class="nm"><b></b></span><span class="sc"></span>';
      row.children[0].textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1;
      row.children[1].textContent = p.avatar;
      row.querySelector('b').textContent = p.name + ' ' + l.icon + bd;
      row.children[3].textContent = RS.fmt(p.balance) + ' pts';
      box.appendChild(row);
    });
    if (!list.length) box.textContent = 'En attente des premiers joueurs…';
  }

  function renderStats() {
    RS.historyHTML($('hist'), S.history, 14);
    const total = S.counts.reduce((a, b) => a + b, 0);
    const hot = $('hot'), cold = $('cold'); hot.textContent = ''; cold.textContent = '';
    if (total < 5) return;
    const idx = S.counts.map((c, n) => [c, n]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const mk = (box, n) => { const s = document.createElement('span'); s.className = 'hn ' + RS.color(n); s.textContent = n; box.appendChild(s); };
    idx.slice(0, 3).forEach(x => mk(hot, x[1]));
    idx.slice(-3).reverse().forEach(x => mk(cold, x[1]));
  }

})();
