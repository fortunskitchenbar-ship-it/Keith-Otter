/* ==========================================================================
   app.js — shell: navigation, clock, theme, command palette, shortcuts
   ========================================================================== */

import { $, $$, esc, store, toast, closeModal } from './core.js';
import { initPanels, refreshAll, generateBrief, exportBackup, syncNow, runChecks } from './panels.js';

const VIEWS = [
  { id: 'overview',    label: 'Overview',    sub: 'Everything that matters, in one screen.' },
  { id: 'comms',       label: 'Comms',       sub: 'Priority mail and headlines worth knowing.' },
  { id: 'ai',          label: 'AI',          sub: 'DeepSeek research, drafting and thinking.' },
  { id: 'health',      label: 'Health',      sub: 'Medications, vitals and appointment notes.' },
  { id: 'sleep',       label: 'Sleep',       sub: 'Nightly apnea events, trends and notes.' },
  { id: 'notes',       label: 'Notes',       sub: 'Markdown notes, pinned and searchable.' },
  { id: 'ops',         label: 'Ops',         sub: 'Service health, data freshness and backups.' },
  { id: 'automations', label: 'Automations', sub: 'The optional heavy-duty integration layer.' },
];

const THEME_KEY = 'kc.theme';

/* ------------------------------- navigation ------------------------------ */

function setView(id, { scroll = true } = {}) {
  const target = VIEWS.find(v => v.id === id);
  if (!target) return;

  $$('.view').forEach(v => {
    const active = v.dataset.view === id;
    v.classList.toggle('is-active', active);
    v.hidden = !active;
    if (active) {
      // restart the entrance animation
      v.style.animation = 'none';
      void v.offsetWidth;
      v.style.animation = '';
    }
  });
  $$('.nav-btn').forEach(b => {
    const isActive = b.dataset.view === id;
    b.classList.toggle('is-active', isActive);
    if (isActive) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('#viewTitle').textContent = target.label;
  $('#viewSub').textContent = target.sub;
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  document.title = `Keith · ${target.label}`;

  if (id === 'ai') setTimeout(() => $('#chatInput')?.focus(), 60);
  if (id === 'overview') setTimeout(() => document.title = 'Keith · Command Center', 10);
}

function bindNav() {
  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $$('[data-goto]').forEach(el => el.addEventListener('click', () => setView(el.dataset.goto)));
  $('#menuBtn')?.addEventListener('click', () => openPalette());
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (VIEWS.some(v => v.id === id)) setView(id, { scroll: false });
  });
  const initial = location.hash.replace('#', '');
  if (VIEWS.some(v => v.id === initial)) setView(initial, { scroll: false });
}

/* ---------------------------------- clock -------------------------------- */

function tickClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateEl = $('#heroDate');
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const greeting = $('#greeting');
  if (greeting) {
    const h = now.getHours();
    greeting.textContent = h < 5 ? 'Late night, Keith' : h < 12 ? 'Good morning, Keith' : h < 17 ? 'Good afternoon, Keith' : 'Good evening, Keith';
  }
}

/* ---------------------------------- theme -------------------------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const btn = $('#themeBtn');
  if (btn) btn.innerHTML = `<svg><use href="#i-${theme === 'dark' ? 'sun' : 'moon'}"/></svg>`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a101c' : '#eef1f6');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(next === 'dark' ? 'Dark mode' : 'Light mode', 'ok', 1800);
}

/* ------------------------------ command palette --------------------------- */

const staticCommands = () => [
  ...VIEWS.map(v => ({ label: v.label, kind: 'go', hint: `Jump to ${v.label}`, run: () => setView(v.id) })),
  { label: 'New task', kind: 'action', hint: 'Focus the task input', run: () => { setView('overview'); setTimeout(() => $('#taskInput')?.focus(), 120); } },
  { label: 'New note', kind: 'action', hint: 'Create a markdown note', run: () => { setView('notes'); setTimeout(() => $('#newNote')?.click(), 120); } },
  { label: 'Ask DeepSeek', kind: 'action', hint: 'Open the AI thread', run: () => { setView('ai'); } },
  { label: 'Generate daily brief', kind: 'action', hint: 'Summarise the day with AI', run: () => { setView('overview'); generateBrief(true); } },
  { label: 'Refresh everything', kind: 'action', hint: 'Weather, news, mail, agenda', run: () => refreshAll(true) },
  { label: 'Toggle theme', kind: 'action', hint: 'Light / dark', run: toggleTheme },
  { label: 'Export backup', kind: 'action', hint: 'Download all local data', run: () => exportBackup() },
  { label: 'Lock Health Hub', kind: 'action', hint: 'Hide health data now', run: () => { setView('health'); $('#lockHealth')?.click(); } },
  { label: 'Open GitHub Actions', kind: 'link', hint: 'Workflow runs', run: () => window.open('https://github.com/mathew1960/Keith-Otter/actions', '_blank', 'noopener') },
  { label: 'Open Vercel project', kind: 'link', hint: 'Deployments', run: () => window.open('https://vercel.com/mathew1960s-projects/keith-otter', '_blank', 'noopener') },
];

let paletteItems = [];
let paletteIndex = 0;

function buildPalette(query) {
  const q = query.trim().toLowerCase();
  const cmds = staticCommands().filter(c => !q || `${c.label} ${c.hint}`.toLowerCase().includes(q));

  const notes = q ? store.state.notes.filter(n => `${n.title} ${n.body}`.toLowerCase().includes(q)).slice(0, 5).map(n => ({
    label: n.title || 'Untitled note', kind: 'note', hint: 'Open note',
    run: () => { setView('notes'); setTimeout(() => { const btn = document.querySelector(`[data-note="${n.id}"]`); btn?.click(); }, 120); },
  })) : [];

  const tasks = q ? store.state.tasks.filter(t => t.text.toLowerCase().includes(q)).slice(0, 5).map(t => ({
    label: t.text, kind: 'task', hint: t.done ? 'Completed' : 'Open task',
    run: () => { setView('overview'); setTimeout(() => { document.querySelector('#taskInput')?.focus(); }, 120); },
  })) : [];

  paletteItems = [...cmds, ...notes, ...tasks].slice(0, 14);
  paletteIndex = 0;
  renderPalette();
}

function renderPalette() {
  const list = $('#paletteList');
  if (!list) return;
  if (!paletteItems.length) {
    list.innerHTML = '<li class="empty" style="padding:14px">No matches.</li>';
    return;
  }
  list.innerHTML = paletteItems.map((item, i) => `
    <li><button class="palette-item ${i === paletteIndex ? 'is-active' : ''}" data-index="${i}">
      <span>${esc(item.label)}</span><span class="p-kind">${esc(item.kind)}</span>
    </button></li>`).join('');
}

function openPalette() {
  const el = $('#palette');
  if (!el) return;
  el.hidden = false;
  const input = $('#paletteInput');
  input.value = '';
  buildPalette('');
  input.focus();
}

function closePalette() {
  const el = $('#palette');
  if (el) el.hidden = true;
}

function runPaletteItem(index) {
  const item = paletteItems[index];
  if (!item) return;
  closePalette();
  try { item.run(); } catch (err) { toast(err.message, 'err'); }
}

function bindPalette() {
  $('#paletteBtn')?.addEventListener('click', openPalette);
  $('#palette')?.addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });

  const input = $('#paletteInput');
  input?.addEventListener('input', () => buildPalette(input.value));
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1); renderPalette(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); renderPalette(); }
    if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(paletteIndex); }
  });
  $('#paletteList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-index]');
    if (btn) runPaletteItem(Number(btn.dataset.index));
  });
}

/* -------------------------------- shortcuts ------------------------------ */

function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#palette').hidden ? openPalette() : closePalette();
      return;
    }
    if (e.key === 'Escape') {
      if (!$('#palette').hidden) { closePalette(); return; }
      closeModal();
      return;
    }
    if (typing) return;
    if (e.key.toLowerCase() === 't' && !mod) { toggleTheme(); return; }
    if (e.key.toLowerCase() === 'n' && !mod) { e.preventDefault(); setView('overview'); setTimeout(() => $('#taskInput')?.focus(), 100); return; }
    if (/^[1-8]$/.test(e.key) && !mod) { setView(VIEWS[Number(e.key) - 1].id); }
  });
}

/* --------------------------------- settings ------------------------------ */

function openSettings() {
  const s = store.state.settings;
  const dlg = $('#settingsModal');
  $('#setTheme').value = s.theme === 'light' ? 'light' : 'dark';
  $('#setModel').value = s.model === 'deepseek-reasoner' ? 'deepseek-reasoner' : 'deepseek-chat';
  $('#setSync').value = s.syncToken || '';
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

function closeSettings() {
  const dlg = $('#settingsModal');
  if (typeof dlg.close === 'function' && dlg.open) dlg.close();
  else dlg.removeAttribute('open');
}

function bindSettings() {
  $('#settingsBtn')?.addEventListener('click', openSettings);
  $('#settingsClose')?.addEventListener('click', closeSettings);
  $('#setTheme')?.addEventListener('change', (e) => {
    applyTheme(e.target.value);
    store.state.settings.theme = e.target.value;
    store.save('settings');
  });
  $('#setModel')?.addEventListener('change', (e) => {
    store.state.settings.model = e.target.value;
    store.save('settings');
    $('#modelSelect').value = e.target.value;
  });
  $('#setSync')?.addEventListener('change', (e) => {
    store.state.settings.syncToken = e.target.value.trim();
    store.save('settings');
  });
  $('#setSyncNow')?.addEventListener('click', () => syncNow(true));
  $('#setExport')?.addEventListener('click', () => exportBackup());
  $('#setRefresh')?.addEventListener('click', () => { closeSettings(); refreshAll(true); });
  $('#setReset')?.addEventListener('click', () => {
    if (!confirm('Erase tasks, notes, meds, vitals, sleep log and chats on this device? This cannot be undone.')) return;
    Object.keys(localStorage).filter(k => k.startsWith('kc.')).forEach(k => localStorage.removeItem(k));
    location.reload();
  });
}

/* ------------------------------- connectivity ---------------------------- */

function bindConnectivity() {
  const paint = (online) => {
    const pill = $('#apiDot');
    if (!pill) return;
    if (!online) {
      pill.dataset.state = 'bad';
      pill.querySelector('span').textContent = 'offline';
      pill.title = 'No network connection — local data still works';
      toast('Offline — local notes and tasks still work', 'err', 5000);
    }
  };

  window.addEventListener('offline', () => paint(false));
  window.addEventListener('online', () => {
    toast('Back online — refreshing');
    refreshAll(false);
    runChecks();
  });
  if (!navigator.onLine) paint(false);
}

/* ---------------------------------- boot --------------------------------- */

function boot() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');

  store.load();
  initPanels();
  bindNav();
  bindPalette();
  bindShortcuts();
  bindConnectivity();
  tickClock();
  setInterval(tickClock, 1000);

  $('#themeBtn')?.addEventListener('click', toggleTheme);
  bindSettings();
  $('#modalClose')?.addEventListener('click', closeModal);
  $('#modal')?.addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#settingsModal')?.addEventListener('click', (e) => { if (e.target.id === 'settingsModal') closeSettings(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ });
  }

  document.title = 'Keith · Command Center';
}

boot();
