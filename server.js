'use strict';
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const QRCode = require('qrcode');
const { transaction } = require('./lib/store');
const engine = require('./lib/engine');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const allowed = new Set(['hello', 'join', 'bet', 'undo', 'clearBets', 'rebet', 'refill', 'slots', 'bjDeal', 'bjHit', 'bjStand', 'bjDouble', 'spin', 'next', 'auto', 'betMs', 'resetScores', 'reset']);
function identity(req, res) {
  const key = process.env.SESSION_SECRET;
  if (!key || key.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const sign = id => crypto.createHmac('sha256', key).update(id).digest('hex');
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('rs_session='));
  const [id, signature] = (cookie ? cookie.slice(11) : '').split('.');
  if (id && /^[a-f0-9]{64}$/.test(signature || '') && /^[a-f0-9-]{36}$/.test(id) && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)))) return id;
  const fresh = crypto.randomUUID();
  res.cookie('rs_session', fresh + '.' + sign(fresh), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 31536000000, path: '/' });
  return fresh;
}
app.get('/api/config', (req, res) => res.json({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY }));
app.get('/healthz', async (req, res) => {
  try { await transaction(() => null); res.send('ok'); }
  catch (e) { console.error(e); res.status(503).send('Database not configured or unavailable'); }
});
app.post('/api/tick', async (req, res) => {
  if (!process.env.CRON_SECRET || req.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return res.sendStatus(401);
  try {
    await transaction(row => { const game = engine(row.state); game.tick(); row.state = game.snapshot(); });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.sendStatus(503); }
});
app.post('/api/game', async (req, res) => {
  try {
    if (!process.env.HOST_KEY) throw new Error('HOST_KEY is required.');
    // Same-origin requests only. No credentials or dealer key in query strings.
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.sendStatus(403);
    const id = identity(req, res);
    const { event = 'poll', data = {}, role = 'player', key = '', requestId } = req.body;
    if (event !== 'poll' && !allowed.has(event)) return res.sendStatus(400);
    if (!['player', 'tv', 'host'].includes(role) || typeof data !== 'object' || !data || Array.isArray(data) || typeof key !== 'string') return res.sendStatus(400);
    if (event !== 'poll' && (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId))) return res.sendStatus(400);
    const url = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const info = event === 'hello' ? { url, urls: [url], qr: await QRCode.toDataURL(url, { width: 360, margin: 1 }), hostKeyRequired: true } : {};
    const result = await transaction(async row => {
      const duplicate = event !== 'poll' && await row.findRequest(id, requestId);
      if (event !== 'poll' && duplicate) return duplicate;
      const game = engine(row.state, { identity: id, hostKey: process.env.HOST_KEY, info });
      game.tick();
      await game.dispatch('hello', { role, key });
      if (event !== 'hello') game.events.length = 0;
      if (event !== 'poll' && event !== 'hello') await game.dispatch(event, data);
      row.state = game.snapshot();
      const out = { ...game.view(), events: game.events };
      if (event !== 'poll') await row.saveRequest(id, requestId, out);
      return out;
    });
    res.json(result);
  } catch (e) { console.error(e); res.status(503).json({ error: 'Le serveur est indisponible. Réessayez dans un instant.' }); }
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/vendor/supabase.js', (req, res) => res.sendFile(require.resolve('@supabase/supabase-js').replace(/dist\/.*$/, 'dist/umd/supabase.js')));
if (require.main === module) app.listen(process.env.PORT || 3000, '0.0.0.0');
module.exports = app;
