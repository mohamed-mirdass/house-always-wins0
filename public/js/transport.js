/* Compatibility interface for the existing UI; HTTP actions + Supabase invalidation. */
window.io = function () {
  const listeners = new Map();
  let role = 'player', key = '', active = true, connected = false, queue = Promise.resolve(), timer, channel;
  const fire = (name, value) => (listeners.get(name) || []).forEach(fn => fn(value));
  async function request(event, data = {}) {
    const body = { event, data, role, key, requestId: crypto.randomUUID() };
    let response;
    // Retry the same request ID: a lost response must not duplicate a bet.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error('Serveur indisponible');
        response = await r.json(); break;
      } catch (e) { if (attempt === 1) throw e; }
    }
    if (!active) return;
    if (!connected) { connected = true; if (event !== 'hello') fire('connect'); }
    for (const { event: name, data: value } of response.events) fire(name, value);
    fire('state', response.state); fire('me', response.me);
  }
  function enqueue(event, data) {
    queue = queue.then(() => active && request(event, data)).catch(() => {
      connected = false; fire('disconnect'); fire('err', 'Connexion perdue, reconnexion…');
    });
    return queue;
  }
  let polling = false;
  function poll() {
    if (!active || polling) return;
    polling = true;
    enqueue('poll').finally(() => { polling = false; });
  }
  async function realtime() {
    try {
      const config = await (await fetch('/api/config')).json();
      if (!config.url || !config.key || !window.supabase) return;
      channel = window.supabase.createClient(config.url, config.key).channel('game-revision')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'royal_spin_revision' }, poll).subscribe();
    } catch (_) { /* Heartbeat also catches missed notifications. */ }
  }
  const api = {
    on(name, fn) { listeners.set(name, [...(listeners.get(name) || []), fn]); return api; },
    emit(event, data = {}) {
      if (event === 'hello') { role = data.role || 'player'; key = data.key || ''; }
      enqueue(event, data); return api;
    },
    disconnect() { active = false; connected = false; clearInterval(timer); if (channel) channel.unsubscribe(); fire('disconnect'); return api; },
    connect() { active = true; connected = true; fire('connect'); timer = setInterval(poll, 2000); realtime(); return api; }
  };
  setTimeout(() => api.connect(), 0);
  return api;
};
