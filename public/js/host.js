/* host.js - panneau du croupier */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const socket = io();
  let S = null, key = '';
  try { key = sessionStorage.getItem('rs_hostkey') || ''; } catch (e) { /* ignore */ }

  const hello = () => socket.emit('hello', { id: RS.pid() + '-host', role: 'host', key });
  socket.on('connect', hello);
  socket.on('hostOk', () => { $('auth').classList.add('hide'); $('panel').classList.remove('hide'); });
  socket.on('hostDenied', d => {
    $('panel').classList.add('hide');
    if (d.keyRequired) { $('auth').classList.remove('hide'); if (key) $('keyerr').textContent = 'Clé incorrecte.'; }
    else { $('auth').classList.remove('hide'); $('keyerr').textContent = 'Ouvrez cette page depuis l\'ordinateur qui lance le serveur (localhost) ou définissez HOST_KEY.'; }
  });
  $('keybtn').onclick = () => {
    key = $('key').value;
    try { sessionStorage.setItem('rs_hostkey', key); } catch (e) { /* ignore */ }
    // le serveur n'accepte qu'un seul "hello" par connexion: on se reconnecte
    socket.disconnect(); socket.connect();
  };
  $('key').addEventListener('keydown', e => { if (e.key === 'Enter') $('keybtn').click(); });

  socket.on('info', i => {
    $('qr').src = i.qr; $('qr').classList.remove('hide');
    const sel = $('urlsel'); sel.textContent = '';
    i.urls.forEach(u => { const o = document.createElement('option'); o.value = u; o.textContent = u; if (u === i.url) o.selected = true; sel.appendChild(o); });
  });
  $('urlsel').onchange = e => socket.emit('setUrl', { url: e.target.value });

  socket.on('state', s => { S = s; render(); });

  const PH = { betting: 'paris', spinning: 'roue', result: 'résultat' };
  function render() {
    $('hRound').textContent = S.round; $('hPhase').textContent = PH[S.phase]; $('hOnline').textContent = S.online;
    $('spin').disabled = S.phase !== 'betting';
    $('next').disabled = S.phase !== 'result';
    $('auto').checked = S.auto;
    $('betms').value = String(S.betMs / 1000);

    const total = S.counts.reduce((a, b) => a + b, 0), max = Math.max(1, ...S.counts);
    $('sSpins').textContent = total;
    $('sBet').textContent = RS.fmt(S.players.reduce((a, p) => a + p.wagered, 0));
    $('sPlayers').textContent = S.players.length;
    const bars = $('bars'); bars.textContent = '';
    S.counts.forEach((c, n) => {
      const d = document.createElement('div'); d.className = RS.color(n);
      d.style.height = Math.max(2, (c / max) * 100) + '%'; d.title = n + ' : ' + c + ' fois';
      bars.appendChild(d);
    });

    const body = $('plist'); body.textContent = '';
    [...S.players].sort((a, b) => b.balance - a.balance).forEach(p => {
      const tr = body.insertRow();
      tr.insertCell().textContent = (p.online ? '● ' : '○ ') + p.avatar + ' ' + p.name;
      tr.insertCell().textContent = p.betting ? 'a misé' : '-';
      tr.insertCell().textContent = RS.fmt(p.balance);
    });
    if (!S.players.length) { const tr = body.insertRow(); const c = tr.insertCell(); c.colSpan = 3; c.className = 'mut'; c.textContent = 'Aucun joueur. Faites scanner le QR code.'; }
  }

  $('spin').onclick = () => socket.emit('spin');
  $('next').onclick = () => socket.emit('next');
  $('auto').onchange = e => socket.emit('auto', { on: e.target.checked });
  $('betms').onchange = e => socket.emit('betMs', { seconds: +e.target.value });
  $('resetScores').onclick = () => { if (confirm('Remettre tous les scores à 1 000 ?')) socket.emit('resetScores'); };
  $('reset').onclick = () => { if (confirm('Effacer tous les joueurs et les statistiques ?')) socket.emit('reset'); };
})();
