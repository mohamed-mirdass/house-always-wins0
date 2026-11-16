/* shared.js - outils communs: roue (canvas), sons (WebAudio), confettis, formats */
(function () {
  'use strict';
  const RS = (window.RS = {});
  const TAU = Math.PI * 2;

  RS.ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  RS.REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  RS.color = n => (n === 0 ? 'green' : RS.REDS.has(n) ? 'red' : 'black');
  RS.COLOR_FR = { red: 'Rouge', black: 'Noir', green: 'Vert' };
  RS.fmt = n => Math.round(n).toLocaleString('fr-FR');

  RS.winKeys = function (n) {
    const k = ['n:' + n];
    if (n === 0) return k;
    k.push(RS.color(n) === 'red' ? 'red:null' : 'black:null');
    k.push(n % 2 === 0 ? 'even:null' : 'odd:null');
    k.push(n <= 18 ? 'low:null' : 'high:null');
    k.push(n <= 12 ? 'd1:null' : n <= 24 ? 'd2:null' : 'd3:null');
    k.push('c' + (n % 3 === 1 ? 1 : n % 3 === 2 ? 2 : 3) + ':null');
    return k;
  };

  RS.level = p => {
    const lv = 1 + Math.floor(Math.sqrt((p.wagered || 0) / 200));
    const t = lv >= 10 ? ['💎', 'Diamant'] : lv >= 6 ? ['⚜️', 'Or'] : lv >= 3 ? ['🔷', 'Argent'] : ['🪙', 'Bronze'];
    return { lv, icon: t[0], name: t[1] };
  };
  RS.badges = p => {
    const b = [];
    if (p.straights >= 1) b.push(['🎯', 'Numéro plein']);
    if (p.streak >= 3) b.push(['🔥', 'Série de ' + p.streak]);
    if (p.best >= 1000) b.push(['💰', 'Gros gain']);
    if ((p.wagered || 0) >= 5000) b.push(['🎰', 'High roller']);
    if (p.balance >= 5000) b.push(['👑', 'Magnat']);
    return b;
  };

  RS.pid = function () {
    let id = null;
    try { id = localStorage.getItem('rs_id'); } catch (e) { /* ignore */ }
    if (!id) {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem('rs_id', id); } catch (e) { /* ignore */ }
    }
    return id;
  };

  RS.clock = {
    off: 0,
    set(serverTime) { this.off = serverTime - Date.now(); },
    now() { return Date.now() + this.off; }
  };

  RS.animateNumber = function (el, to, ms) {
    ms = ms || 700;
    const from = el._v === undefined ? to : el._v;
    el._v = to;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (from === to) { el.textContent = RS.fmt(to); return; }
    const t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = RS.fmt(from + (to - from) * e);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  };

  RS.historyHTML = function (el, list, max) {
    el.textContent = '';
    (list || []).slice(0, max || 14).forEach(n => {
      const s = document.createElement('span');
      s.className = 'hn ' + RS.color(n);
      s.textContent = n;
      el.appendChild(s);
    });
  };

  /* ---------------------------------------------------------------- audio */
  const A = (RS.audio = {
    ctx: null, muted: false, _noise: null, _lastTick: 0,
    init() {
      try {
        if (!this.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return; this.ctx = new C(); }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { /* ignore */ }
    },
    tone(freq, dur, type, vol, delay, slideTo) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime + (delay || 0);
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.03);
    },
    noise(dur, vol, delay) {
      if (this.muted || !this.ctx) return;
      if (!this._noise) {
        const len = this.ctx.sampleRate * 0.3, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this._noise = buf;
      }
      const t = this.ctx.currentTime + (delay || 0);
      const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = this._noise; f.type = 'highpass'; f.frequency.value = 1800;
      g.gain.setValueAtTime(vol || 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.ctx.destination);
      s.start(t); s.stop(t + dur + 0.02);
    },
    chip() { this.tone(1500, 0.05, 'square', 0.05); this.tone(950, 0.08, 'triangle', 0.09, 0.02); this.noise(0.05, 0.06); },
    tick() { const n = performance.now(); if (n - this._lastTick < 38) return; this._lastTick = n; this.tone(2300, 0.025, 'triangle', 0.05); },
    card() { this.noise(0.09, 0.12); },
    spinStart() { this.tone(180, 0.9, 'sawtooth', 0.04, 0, 700); },
    win(big) {
      const notes = big ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
      notes.forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.13, i * 0.09));
      for (let i = 0; i < (big ? 8 : 4); i++) this.tone(2400 + Math.random() * 800, 0.05, 'square', 0.04, 0.3 + i * 0.07);
    },
    lose() { this.tone(300, 0.25, 'sine', 0.12); this.tone(210, 0.45, 'sine', 0.12, 0.2); },
    toggle() {
      this.muted = !this.muted;
      try { localStorage.setItem('rs_mute', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
      return this.muted;
    }
  });
  try { A.muted = localStorage.getItem('rs_mute') === '1'; } catch (e) { /* ignore */ }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => A.init(), { passive: true }));

  /* ------------------------------------------------------------- confettis */
  RS.confetti = function (kind) {
    const c = document.createElement('canvas');
    c.className = 'confetti';
    document.body.appendChild(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext && c.getContext('2d');
    if (!g) { c.remove(); return; }
    g.scale(dpr, dpr);
    const cols = ['#f5d77a', '#c9a24a', '#fff6dc', '#c8202c', '#2ee6a6', '#4aa8ff'];
    const N = kind === 'big' ? 170 : 90, parts = [];
    for (let i = 0; i < N; i++) {
      parts.push({
        x: Math.random() * w, y: -Math.random() * h * 0.4, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4,
        r: 4 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        c: cols[(Math.random() * cols.length) | 0], coin: Math.random() < 0.4
      });
    }
    const t0 = performance.now();
    (function frame(t) {
      g.clearRect(0, 0, w, h);
      let alive = false;
      parts.forEach(p => {
        p.vy += 0.08; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y < h + 30) alive = true;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        if (p.coin) {
          g.scale(Math.abs(Math.cos(p.rot * 2)) + 0.15, 1);
          g.fillStyle = '#e8c35a'; g.strokeStyle = '#8a6414'; g.lineWidth = 1.5;
          g.beginPath(); g.arc(0, 0, p.r + 2, 0, TAU); g.fill(); g.stroke();
        } else { g.fillStyle = p.c; g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); }
        g.restore();
      });
      if (alive && t - t0 < 5500) requestAnimationFrame(frame); else c.remove();
    })(t0);
  };

  /* ------------------------------------------------------------------ roue */
  function drawBase(g, s) {
    const cx = s / 2, R = (s / 2) * 0.97, step = TAU / 37;
    let gr = g.createRadialGradient(cx, cx, R * 0.9, cx, cx, R);
    gr.addColorStop(0, '#6b4a12'); gr.addColorStop(0.5, '#f1d37c'); gr.addColorStop(1, '#8a6414');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, R, 0, TAU); g.fill();

    gr = g.createRadialGradient(cx, cx, R * 0.78, cx, cx, R * 0.94);
    gr.addColorStop(0, '#120806'); gr.addColorStop(1, '#3a2010');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, R * 0.94, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(241,211,124,.45)'; g.lineWidth = Math.max(1, s * 0.004);
    g.beginPath(); g.arc(cx, cx, R * 0.885, 0, TAU); g.stroke();

    for (let i = 0; i < 37; i++) {
      const n = RS.ORDER[i], a0 = i * step - step / 2 - Math.PI / 2;
      g.beginPath(); g.moveTo(cx, cx); g.arc(cx, cx, R * 0.8, a0, a0 + step); g.closePath();
      g.fillStyle = n === 0 ? '#0e8a45' : RS.REDS.has(n) ? '#c0141f' : '#15151b';
      g.fill();
    }
    g.strokeStyle = 'rgba(241,211,124,.9)'; g.lineWidth = Math.max(1, s * 0.003);
    for (let i = 0; i < 37; i++) {
      const a = i * step - step / 2 - Math.PI / 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.52, cx + Math.sin(a) * R * 0.52);
      g.lineTo(cx + Math.cos(a) * R * 0.8, cx + Math.sin(a) * R * 0.8); g.stroke();
    }
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${s * 0.043}px Helvetica, Arial, sans-serif`;
    for (let i = 0; i < 37; i++) {
      const ac = i * step - Math.PI / 2;
      g.save(); g.translate(cx + Math.cos(ac) * R * 0.69, cx + Math.sin(ac) * R * 0.69);
      g.rotate(ac); g.fillText(RS.ORDER[i], 0, 0); g.restore();   // chiffres posés dans le sens du rayon
    }
    g.strokeStyle = 'rgba(241,211,124,.95)'; g.lineWidth = Math.max(2, s * 0.006);
    g.beginPath(); g.arc(cx, cx, R * 0.8, 0, TAU); g.stroke();

    gr = g.createRadialGradient(cx * 0.9, cx * 0.9, R * 0.04, cx, cx, R * 0.52);
    gr.addColorStop(0, '#fff3c4'); gr.addColorStop(0.55, '#c9a24a'); gr.addColorStop(1, '#6b4a12');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, R * 0.52, 0, TAU); g.fill();
    g.fillStyle = '#16060a'; g.beginPath(); g.arc(cx, cx, R * 0.38, 0, TAU); g.fill();
    gr = g.createRadialGradient(cx, cx, R * 0.04, cx, cx, R * 0.37);
    gr.addColorStop(0, '#3a1a20'); gr.addColorStop(1, '#16060a');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, R * 0.37, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(241,211,124,.8)'; g.lineWidth = Math.max(2, s * 0.007);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      g.beginPath(); g.moveTo(cx, cx); g.lineTo(cx + Math.cos(a) * R * 0.36, cx + Math.sin(a) * R * 0.36); g.stroke();
    }
    gr = g.createRadialGradient(cx - R * 0.02, cx - R * 0.02, 1, cx, cx, R * 0.14);
    gr.addColorStop(0, '#fff3c4'); gr.addColorStop(1, '#a37a1f');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, R * 0.13, 0, TAU); g.fill();
  }

  RS.Wheel = class {
    constructor(canvas, opt) {
      opt = opt || {};
      this.c = canvas; this.g = canvas.getContext ? canvas.getContext('2d') : null;
      this.theta = 0; this.idx = -1; this.anim = null; this.size = 0; this.base = null;
      this.onTick = opt.onTick || null; this.onEnd = opt.onEnd || null;
      this.t0 = performance.now();
      if (!this.g) return;
      this._loop = this._loop.bind(this);
      this.resize();
      requestAnimationFrame(this._loop);
    }
    resize() {
      const w = Math.round(this.c.clientWidth || 0);
      if (!w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.size = w; this.c.width = this.c.height = Math.round(w * dpr);
      this.base = document.createElement('canvas');
      this.base.width = this.base.height = this.c.width;
      drawBase(this.base.getContext('2d'), this.c.width);
    }
    setResult(n) { this.idx = RS.ORDER.indexOf(n); this.anim = null; }
    spin(n, total, remaining) {
      if (!this.g) return;
      const idx = RS.ORDER.indexOf(n), step = TAU / 37, a = idx * step;
      const th0 = this.theta % TAU;
      if (remaining <= 0) { this.theta = -a; this.idx = idx; this.anim = null; return; }
      const need = (((-a - th0) % TAU) + TAU) % TAU;
      this.anim = { n, idx, a, th0, delta: TAU * 4 + need, start: performance.now() - (total - remaining), total, lastK: undefined };
    }
    _loop(now) {
      requestAnimationFrame(this._loop);
      const dt = Math.min(0.1, (now - this.t0) / 1000); this.t0 = now;
      if (this.c.clientWidth && this.c.clientWidth !== this.size) this.resize();
      if (!this.base) return;
      const g = this.g, s = this.c.width, cx = s / 2, R = (s / 2) * 0.97, step = TAU / 37;
      let ballRel = null, ballR = 0;
      const A_ = this.anim;
      if (A_) {
        const t = Math.min(1, (now - A_.start) / A_.total);
        if (t >= 1) {
          this.theta = A_.th0 + A_.delta; this.idx = A_.idx; this.anim = null;
          ballRel = A_.a; ballR = 0.665;
          if (this.onEnd) this.onEnd(A_.n);
        } else {
          this.theta = A_.th0 + A_.delta * (1 - Math.pow(1 - t, 3));
          const e2 = 1 - Math.pow(1 - t, 4);
          ballRel = A_.a + (1 - e2) * 6 * TAU;
          const u = Math.max(0, Math.min(1, (t - 0.72) / 0.28)), sm = u * u * (3 - 2 * u);
          ballR = 0.845 + (0.665 - 0.845) * sm + (1 - u) * Math.abs(Math.sin(u * Math.PI * 4)) * 0.045 * (u > 0 ? 1 : 0);
          const k = Math.floor(ballRel / step);
          if (A_.lastK !== undefined && k !== A_.lastK && this.onTick) this.onTick();
          A_.lastK = k;
        }
      } else {
        this.theta += dt * 0.25;
        if (this.idx >= 0) { ballRel = this.idx * step; ballR = 0.665; }
      }
      g.clearRect(0, 0, s, s);
      g.save(); g.translate(cx, cx); g.rotate(this.theta); g.drawImage(this.base, -cx, -cx); g.restore();
      if (ballRel !== null) {
        const ang = this.theta + ballRel - Math.PI / 2, bx = cx + Math.cos(ang) * R * ballR, by = cx + Math.sin(ang) * R * ballR, br = Math.max(3, R * 0.034);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(bx + br * 0.35, by + br * 0.45, br, 0, TAU); g.fill();
        const bg = g.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.1, bx, by, br);
        bg.addColorStop(0, '#fff'); bg.addColorStop(1, '#b9b4a6');
        g.fillStyle = bg; g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill();
      }
      g.fillStyle = '#f1d37c'; g.strokeStyle = '#6b4a12'; g.lineWidth = Math.max(1, s * 0.004);
      const mw = s * 0.03;
      g.beginPath(); g.moveTo(cx - mw, cx - R * 1.0); g.lineTo(cx + mw, cx - R * 1.0); g.lineTo(cx, cx - R * 0.905); g.closePath(); g.fill(); g.stroke();
    }
  };
})();
