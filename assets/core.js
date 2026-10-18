/* ==========================================================================
   core.js — utilities, persistence, API client, UI primitives
   No dependencies. Imported by panels.js and app.js.
   ========================================================================== */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const fmtDateLong = (d) => new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const isoDay = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export function timeAgo(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export function relativeDay(dateStr) {
  if (!dateStr) return '';
  const today = isoDay();
  const tomorrow = isoDay(new Date(Date.now() + 86400000));
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function debounce(fn, wait = 220) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/* ---------------------------------- store --------------------------------- */

const LS = {
  tasks: 'kc.v2.tasks',
  notes: 'kc.v2.notes',
  meds: 'kc.v2.meds',
  vitals: 'kc.v2.vitals',
  sleep: 'kc.v2.sleep',
  chats: 'kc.v2.chats',
  settings: 'kc.v2.settings',
  health: 'kc.v2.health',
  healthNotes: 'kc.v2.healthNotes',
  sleepNotes: 'kc.v2.sleepNotes',
  meta: 'kc.v2.meta',
};

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (err) { console.warn('storage write failed', key, err); return false; }
};

function migrateLegacy() {
  if (localStorage.getItem(LS.meta)) return;

  const tasks = read('keith_tasks', null);
  if (Array.isArray(tasks) && tasks.length) {
    store.state.tasks = tasks.map(t => ({
      id: uid(), text: String(t.text || ''), done: !!t.done,
      priority: 'normal', due: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })).filter(t => t.text);
  }

  const notes = localStorage.getItem('keith_notes');
  if (notes && notes.trim()) {
    store.state.notes.push({
      id: uid(), title: 'Keith’s Notes', body: notes, pinned: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }

  const meds = read('keith_meds', null);
  if (Array.isArray(meds) && meds.length) {
    store.state.meds = meds.map(m => ({
      id: uid(), name: String(m.text || m.name || ''), dose: m.dose || '',
      refill: m.refill || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })).filter(m => m.name);
  }

  const healthNotes = localStorage.getItem('keith_health_notes');
  if (healthNotes) store.state.healthNotes = healthNotes;

  const sleep = read('keith_sleep_events', null);
  if (Array.isArray(sleep) && sleep.length) {
    store.state.sleepEvents = sleep.map(e => ({
      id: uid(), type: String(e.type || 'Event'),
      time: e.time || new Date().toISOString(),
    }));
  }
  const sleepNotes = localStorage.getItem('keith_sleep_notes');
  if (sleepNotes) store.state.sleepNotes[isoDay()] = sleepNotes;

  const chats = read('keith_ai_chats', null);
  if (Array.isArray(chats) && chats.length) {
    store.state.chats = chats.map(c => ({
      id: String(c.id || uid()),
      title: String(c.title || 'Imported chat'),
      model: 'deepseek-chat',
      messages: (c.messages || []).map(m => ({
        role: m.role === 'ai' ? 'assistant' : (m.role || 'user'),
        text: String(m.text || ''),
        ts: Date.now(),
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  const pin = localStorage.getItem('keith_health_pin');
  if (pin) store.state.health.legacyPin = pin;

  store.save('meta');
  store.emit('migrated');
}

export const store = {
  state: {
    tasks: [],
    notes: [],
    meds: [],
    vitals: [],
    sleepEvents: [],
    sleepNotes: {},
    chats: [],
    settings: {
      theme: 'dark',
      model: 'deepseek-chat',
      preset: 'research',
      stream: true,
      activeChat: null,
      activeNote: null,
      brief: null,
      lastSyncAt: null,
      syncToken: '',
    },
    healthNotes: '',
    health: { pinHash: '', pinSalt: '', legacyPin: '' },
    meta: { tasks: null, notes: null, meds: null, vitals: null, sleep: null, chats: null, settings: null },
  },
  _listeners: new Map(),

  load() {
    this.state.tasks         = read(LS.tasks, []);
    this.state.notes         = read(LS.notes, []);
    this.state.meds          = read(LS.meds, []);
    this.state.vitals        = read(LS.vitals, []);
    this.state.sleepEvents   = read(LS.sleep, []);
    this.state.chats         = read(LS.chats, []);
    this.state.settings      = { ...this.state.settings, ...read(LS.settings, {}) };
    this.state.health        = { ...this.state.health, ...read(LS.health, {}) };
    this.state.meta          = { ...this.state.meta, ...read(LS.meta, {}) };
    this.state.sleepNotes    = read(LS.sleepNotes, {});
    this.state.healthNotes   = localStorage.getItem(LS.healthNotes) || '';
    migrateLegacy();
    if (this.state.health.legacyPin && !this.state.health.pinHash) {
      this.state.health.legacyPin = this.state.health.legacyPin; // hashed on next unlock
    }
  },

  save(key) {
    const now = new Date().toISOString();
    if (key in this.state.meta) this.state.meta[key] = now;
    if (key === 'meta') this.state.meta.settings = now;
    write(LS.meta, this.state.meta);

    switch (key) {
      case 'tasks': write(LS.tasks, this.state.tasks); break;
      case 'notes': write(LS.notes, this.state.notes); break;
      case 'meds': write(LS.meds, this.state.meds); break;
      case 'vitals': write(LS.vitals, this.state.vitals); break;
      case 'sleep':
        write(LS.sleep, this.state.sleepEvents);
        write(LS.sleepNotes, this.state.sleepNotes);
        break;
      case 'chats': write(LS.chats, this.state.chats); break;
      case 'settings': write(LS.settings, this.state.settings); break;
      case 'health': write(LS.health, this.state.health); break;
      case 'healthNotes':
        try { localStorage.setItem(LS.healthNotes, String(this.state.healthNotes || '')); } catch { /* ignore */ }
        break;
      default: break;
    }
    this.emit('change', key);
    return true;
  },

  saveAll() {
    ['tasks', 'notes', 'meds', 'vitals', 'sleep', 'chats', 'settings', 'health', 'healthNotes'].forEach(k => this.save(k));
    this.save('meta');
  },

  on(evt, fn) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(fn);
    return () => this._listeners.get(evt)?.delete(fn);
  },

  emit(evt, payload) {
    this._listeners.get(evt)?.forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
  },

  snapshot() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      tasks: this.state.tasks,
      notes: this.state.notes,
      meds: this.state.meds,
      vitals: this.state.vitals,
      sleepEvents: this.state.sleepEvents,
      sleepNotes: this.state.sleepNotes,
      chats: this.state.chats,
      settings: this.state.settings,
      healthNotes: this.state.healthNotes,
      meta: this.state.meta,
    };
  },

  merge(remote) {
    if (!remote || typeof remote !== 'object') return false;
    const mergeById = (local, incoming) => {
      const map = new Map(local.map(item => [item.id, item]));
      (incoming || []).forEach(item => {
        if (!item || !item.id) return;
        const existing = map.get(item.id);
        if (!existing) { map.set(item.id, item); return; }
        const a = new Date(existing.updatedAt || 0).getTime();
        const b = new Date(item.updatedAt || 0).getTime();
        if (b >= a) map.set(item.id, { ...existing, ...item });
      });
      return Array.from(map.values());
    };

    if (Array.isArray(remote.tasks)) this.state.tasks = mergeById(this.state.tasks, remote.tasks);
    if (Array.isArray(remote.notes)) this.state.notes = mergeById(this.state.notes, remote.notes);
    if (Array.isArray(remote.meds)) this.state.meds = mergeById(this.state.meds, remote.meds);
    if (Array.isArray(remote.vitals)) this.state.vitals = mergeById(this.state.vitals, remote.vitals);
    if (Array.isArray(remote.sleepEvents)) this.state.sleepEvents = mergeById(this.state.sleepEvents, remote.sleepEvents);
    if (Array.isArray(remote.chats)) this.state.chats = mergeById(this.state.chats, remote.chats);
    if (remote.sleepNotes && typeof remote.sleepNotes === 'object') this.state.sleepNotes = { ...remote.sleepNotes, ...this.state.sleepNotes };
    if (typeof remote.healthNotes === 'string' && remote.healthNotes.length > this.state.healthNotes.length) this.state.healthNotes = remote.healthNotes;
    if (remote.settings && remote.meta && remote.meta.settings) {
      const keeper = ['theme', 'model', 'preset', 'stream'];
      keeper.forEach(k => { if (remote.settings[k] !== undefined) this.state.settings[k] = remote.settings[k]; });
    }
    this.saveAll();
    return true;
  },

  usage() {
    let bytes = 0;
    Object.values(LS).forEach(k => {
      try { bytes += (localStorage.getItem(k) || '').length * 2; } catch { /* ignore */ }
    });
    return bytes;
  },
};

/* ---------------------------------- API ---------------------------------- */

export async function apiJSON(url, opts = {}, timeout = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const started = performance.now();
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...(opts.headers || {}) },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { ok: false, status: 0, error: err.name === 'AbortError' ? 'timed out' : err.message, ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------- UI ----------------------------------- */

export function toast(message, kind = 'ok', ttl = 4200) {
  const stack = $('#toasts');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.innerHTML = `<span class="t-ico">${kind === 'err' ? '⚠' : '✓'}</span><span class="t-body">${esc(message)}</span><button class="t-close" aria-label="Dismiss">×</button>`;
  stack.appendChild(node);
  const remove = () => node.remove();
  node.querySelector('.t-close').addEventListener('click', remove);
  setTimeout(remove, ttl);
}

export function openModal(title, bodyHtml) {
  const dlg = $('#modal');
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

export function closeModal() {
  const dlg = $('#modal');
  if (typeof dlg.close === 'function' && dlg.open) dlg.close();
  else dlg.removeAttribute('open');
}

/* ------------------------------- weather -------------------------------- */

const WX = {
  0:  { label: 'Clear sky',            day: '☀️', night: '🌙' },
  1:  { label: 'Mainly clear',         day: '🌤️', night: '🌙' },
  2:  { label: 'Partly cloudy',        day: '⛅', night: '☁️' },
  3:  { label: 'Overcast',             day: '☁️', night: '☁️' },
  45: { label: 'Fog',                  day: '🌫️', night: '🌫️' },
  48: { label: 'Freezing fog',         day: '🌫️', night: '🌫️' },
  51: { label: 'Light drizzle',        day: '🌦️', night: '🌧️' },
  53: { label: 'Drizzle',              day: '🌦️', night: '🌧️' },
  55: { label: 'Heavy drizzle',        day: '🌧️', night: '🌧️' },
  56: { label: 'Freezing drizzle',     day: '🌧️', night: '🌧️' },
  57: { label: 'Freezing drizzle',     day: '🌧️', night: '🌧️' },
  61: { label: 'Light rain',           day: '🌦️', night: '🌧️' },
  63: { label: 'Rain',                 day: '🌧️', night: '🌧️' },
  65: { label: 'Heavy rain',           day: '🌧️', night: '🌧️' },
  66: { label: 'Freezing rain',        day: '🌧️', night: '🌧️' },
  67: { label: 'Freezing rain',        day: '🌧️', night: '🌧️' },
  71: { label: 'Light snow',           day: '🌨️', night: '🌨️' },
  73: { label: 'Snow',                 day: '🌨️', night: '🌨️' },
  75: { label: 'Heavy snow',           day: '❄️', night: '❄️' },
  77: { label: 'Snow grains',          day: '🌨️', night: '🌨️' },
  80: { label: 'Light showers',        day: '🌦️', night: '🌧️' },
  81: { label: 'Showers',              day: '🌧️', night: '🌧️' },
  82: { label: 'Violent showers',      day: '⛈️', night: '⛈️' },
  85: { label: 'Snow showers',         day: '🌨️', night: '🌨️' },
  86: { label: 'Heavy snow showers',   day: '❄️', night: '❄️' },
  95: { label: 'Thunderstorm',         day: '⛈️', night: '⛈️' },
  96: { label: 'Thunderstorm, hail',   day: '⛈️', night: '⛈️' },
  99: { label: 'Severe thunderstorm',  day: '⛈️', night: '⛈️' },
};

export function wxInfo(code, isDay = 1) {
  const hit = WX[code] || { label: 'Mixed conditions', day: '🌤️', night: '🌙' };
  return { label: hit.label, icon: isDay ? hit.day : hit.night };
}

export function wxFromText(text = '') {
  const t = text.toLowerCase();
  if (t.includes('thunder')) return '⛈️';
  if (t.includes('rain') || t.includes('shower')) return '🌧️';
  if (t.includes('snow')) return '🌨️';
  if (t.includes('fog')) return '🌫️';
  if (t.includes('cloud') && t.includes('part')) return '⛅';
  if (t.includes('cloud') || t.includes('overcast')) return '☁️';
  return '☀️';
}

export function windDir(deg) {
  if (deg == null || Number.isNaN(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
}

/* -------------------------------- markdown ------------------------------- */

export function markdown(src = '') {
  let text = esc(src);

  const blocks = [];
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/^\w+\n/, '')}</code></pre>`);
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });

  text = text
    .replace(/^###### (.*)$/gm, '<h6>$1</h6>')
    .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  text = text.replace(/(?:^|\n)((?:[-*] .*(?:\n|$))+)/g, (m, list) => {
    const items = list.trim().split('\n').map(line => `<li>${line.replace(/^[-*] /, '')}</li>`).join('');
    return `\n<ul>${items}</ul>`;
  });
  text = text.replace(/(?:^|\n)((?:\d+\. .*(?:\n|$))+)/g, (m, list) => {
    const items = list.trim().split('\n').map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`).join('');
    return `\n<ol>${items}</ol>`;
  });

  text = text
    .split(/\n{2,}/)
    .map(chunk => (/^<(h\d|ul|ol|blockquote|pre)/.test(chunk.trim()) ? chunk : `<p>${chunk.replace(/\n/g, '<br>')}</p>`))
    .join('');

  blocks.forEach((html, i) => { text = text.replace(`\u0000BLOCK${i}\u0000`, html); });
  return text;
}

/* -------------------------------- session -------------------------------- */

export const session = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, val) { try { sessionStorage.setItem(key, val); } catch { /* ignore */ } },
  remove(key) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
};
