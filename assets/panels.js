/* ==========================================================================
   panels.js — every card/section on the dashboard
   ========================================================================== */

import {
  $, $$, esc, uid, isoDay, timeAgo, relativeDay, fmtTime, fmtDate,
  store, apiJSON, toast, openModal, closeModal, markdown,
  wxInfo, wxFromText, windDir, download, debounce, session, clamp,
} from './core.js';

/* ------------------------------- local state ------------------------------ */

const view = {
  taskFilter: 'open',
  emailFilter: '',
  email: [],
  emailLoaded: false,
  news: [],
  newsLoaded: false,
  agenda: { items: [], sections: {}, updated: null, raw: '' },
  weather: null,
  weatherSource: '',
  status: null,
  checks: [],
  healthUnlocked: false,
  activeNote: null,
  noteTab: 'edit',
  streamingTimer: null,
};

const HEALTH_SESSION = 'kc.health.unlocked';

/* ------------------------------- helpers -------------------------------- */

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label || 'Working…'}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

function taskCounts() {
  const open = store.state.tasks.filter(t => !t.done).length;
  const done = store.state.tasks.filter(t => t.done).length;
  return { open, done, total: open + done };
}

function priorities(a, b) {
  const rank = { high: 0, normal: 1, low: 2 };
  const r = (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
  if (r !== 0) return r;
  return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
}

function sortTasks(list) {
  return list.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return priorities(a, b);
  });
}

function dueLabel(task) {
  if (!task.due) return null;
  const today = isoDay();
  const overdue = task.due < today && !task.done;
  const label = relativeDay(task.due);
  return { label, overdue, due: task.due };
}

/* -------------------------------- tasks --------------------------------- */

export function renderTasks() {
  const list = $('#taskList');
  if (!list) return;
  const { open, done } = taskCounts();
  const showAll = view.taskFilter === 'all';
  const source = showAll ? store.state.tasks : store.state.tasks.filter(t => !t.done);
  const tasks = sortTasks(source);

  list.innerHTML = tasks.map(task => {
    const due = dueLabel(task);
    return `
      <li class="task-item ${task.done ? 'done' : ''}" data-id="${task.id}">
        <button class="task-check" data-act="toggle" aria-label="${task.done ? 'Mark not done' : 'Mark done'}" aria-pressed="${task.done}">
          <svg><use href="#i-check"/></svg>
        </button>
        <span class="task-text" data-act="toggle" tabindex="0">${esc(task.text)}</span>
        <span class="task-meta">
          ${task.priority && task.priority !== 'normal' ? `<span class="pill ${task.priority}">${task.priority}</span>` : ''}
          ${due ? `<span class="pill due ${due.overdue ? 'overdue' : ''}">${esc(due.label)}</span>` : ''}
          <button class="task-del" data-act="del" aria-label="Delete task"><svg><use href="#i-trash"/></svg></button>
        </span>
      </li>`;
  }).join('');

  $('#taskEmpty').hidden = tasks.length > 0;
  const filterBtn = $('#tasksFilter');
  if (filterBtn) filterBtn.textContent = showAll ? 'Show open' : 'Show all';
  $('#kpiTasks').textContent = open;
  $('#kpiTag').textContent = done ? `${done} done` : 'today';
}

function addTask(text, priority, due) {
  const clean = String(text || '').trim();
  if (!clean) return false;
  store.state.tasks.push({
    id: uid(), text: clean, done: false,
    priority: priority || 'normal', due: due || '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  store.save('tasks');
  renderTasks();
  return true;
}

/* -------------------------------- email --------------------------------- */

function renderEmail() {
  const filter = view.emailFilter.toLowerCase();
  const matches = (m) => !filter || `${m.subject} ${m.from}`.toLowerCase().includes(filter);
  const emptyText = view.emailLoaded
    ? (view.emailError || (filter ? 'No priority mail matches that filter.' : 'No priority mail right now.'))
    : 'Loading inbox…';

  const mini = $('#emailMini');
  if (mini) {
    const items = view.email.filter(matches).slice(0, 3);
    mini.innerHTML = items.length
      ? items.map(m => `<li data-uid="${esc(m.uid)}"><span class="mail-subject">${esc(m.subject)}</span><span class="mail-meta">${esc(m.from)} · ${esc(timeAgo(m.date))}</span></li>`).join('')
      : `<li class="empty">${esc(emptyText)}</li>`;
  }

  const list = $('#emailList');
  if (list) {
    const items = view.email.filter(matches);
    list.innerHTML = items.length
      ? items.map(m => `
        <li data-uid="${esc(m.uid)}">
          <span class="mail-subject">${esc(m.subject)}</span>
          <span class="mail-meta"><span>${esc(m.from)}</span><span>${esc(new Date(m.date).toLocaleString())}</span></span>
        </li>`).join('')
      : `<li class="empty">${esc(emptyText)}</li>`;
  }

  $('#kpiMail').textContent = view.email.length;
}

export async function refreshEmail(force = false) {
  if (view.emailLoaded && !force) { renderEmail(); return; }
  const res = await apiJSON('/api/smartermail-email?t=' + Date.now(), {}, 18000);
  if (res.ok && Array.isArray(res.data)) {
    view.email = res.data.filter(m => m && m.uid);
    const system = res.data.find(m => m && m.error);
    view.emailError = system ? system.subject : null;
  } else {
    view.email = [];
    view.emailError = res.error || 'Could not reach the inbox.';
  }
  view.emailLoaded = true;
  renderEmail();
  updateStatusSummary();
}

async function openEmail(uidValue) {
  const cached = view.email.find(m => String(m.uid) === String(uidValue));
  openModal(cached ? cached.subject : 'Email', '<p class="muted">Loading…</p>');
  const res = await apiJSON('/api/smartermail-email?uid=' + encodeURIComponent(uidValue), {}, 20000);
  const body = $('#modalBody');
  if (!body) return;
  if (!res.ok || !res.data || res.data.error) {
    body.innerHTML = `<p class="error">${esc((res.data && res.data.error) || 'Could not load this email.')}</p>`;
    return;
  }
  const d = res.data;
  $('#modalTitle').textContent = d.subject || cached?.subject || 'Email';
  body.innerHTML = `<p class="muted" style="margin-bottom:12px">${esc(d.from || '')}${d.date ? ' · ' + esc(new Date(d.date).toLocaleString()) : ''}</p><div>${esc(d.text || '(No readable text in this email.)')}</div>`;
}

/* --------------------------------- news --------------------------------- */

const NEWS_SOURCE_RE = /^https?:\/\/([^/]+)/i;

function sourceName(item) {
  if (item.source) return item.source.replace(/^www\./, '');
  const m = NEWS_SOURCE_RE.exec(item.link || '');
  return m ? m[1].replace(/^www\./, '') : 'news';
}

export function renderNews() {
  const filter = ($('#newsFilter')?.value || 'all');
  const q = ($('#newsSearch')?.value || '').trim().toLowerCase();

  const filtered = view.news.filter(n => {
    if (filter !== 'all' && n.category !== filter) return false;
    if (q && !`${n.title} ${n.summary || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const mini = $('#newsMini');
  if (mini) {
    mini.innerHTML = view.news.length
      ? view.news.slice(0, 4).map(n => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`).join('')
      : '<li class="empty">No headlines yet.</li>';
  }

  const grid = $('#newsGrid');
  if (grid) {
    grid.innerHTML = filtered.length
      ? filtered.map(n => `
        <article class="news-card">
          <span class="n-cat">${esc(n.category || 'news')}</span>
          <a class="n-title" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
          <span class="n-src">${esc(sourceName(n))}${n.published ? ' · ' + esc(timeAgo(n.published)) : ''}</span>
        </article>`).join('')
      : '<p class="empty">No headlines match that filter.</p>';
  }
}

export async function refreshNews() {
  const res = await apiJSON('/api/news', {}, 18000);
  if (res.ok && res.data && Array.isArray(res.data.items) && res.data.items.length) {
    view.news = res.data.items;
  } else {
    const fallback = await apiJSON('/scripts/rss_headlines.json?t=' + Date.now(), {}, 12000);
    if (fallback.ok && Array.isArray(fallback.data)) {
      view.news = fallback.data.map(n => ({
        title: n.title, link: n.link, summary: n.summary || '',
        source: 'foxnews.com', category: 'world', published: null,
      }));
    }
  }
  view.newsLoaded = true;
  view.newsUpdated = new Date().toISOString();
  renderNews();
}

/* ------------------------------- weather -------------------------------- */

function normalizeWeather(raw) {
  if (!raw) return null;
  if (raw.current) {
    return {
      temp: Math.round(raw.current.temp),
      feels: Math.round(raw.current.feels ?? raw.current.temp),
      high: Math.round(raw.high),
      low: Math.round(raw.low),
      humidity: raw.current.humidity,
      wind: raw.current.wind,
      windDir: raw.current.windDir,
      code: raw.current.code,
      isDay: raw.current.isDay !== 0,
      conditions: raw.current.label,
      updated: raw.updated,
      hourly: raw.hourly || [],
      daily: raw.daily || [],
      air: raw.air || null,
      sunrise: raw.sunrise || raw.daily?.[0]?.sunrise || '',
      sunset: raw.sunset || raw.daily?.[0]?.sunset || '',
      units: raw.units || 'imperial',
    };
  }
  return {
    temp: Math.round(raw.temp),
    feels: Math.round(raw.temp),
    high: Math.round(raw.high),
    low: Math.round(raw.low),
    humidity: null, wind: null, windDir: null, code: null, isDay: true,
    conditions: raw.conditions || 'Clear',
    updated: raw.updated,
    hourly: (raw.hourly || []).map(h => ({ time: h.time, temp: h.temp, code: null, label: h.conditions })),
    daily: (raw.daily || []).map(d => ({ day: d.day, high: d.high, low: d.low, code: null, label: d.conditions })),
    air: null, sunrise: '', sunset: '', units: 'imperial',
  };
}

export async function refreshWeather() {
  const res = await apiJSON('/api/weather', {}, 15000);
  let data = null;
  let source = '';
  if (res.ok && res.data && !res.data.error) {
    data = normalizeWeather(res.data);
    source = 'live · Open-Meteo';
  } else {
    const fallback = await apiJSON('/output/weather.json?t=' + Date.now(), {}, 12000);
    if (fallback.ok && fallback.data) {
      data = normalizeWeather(fallback.data);
      source = 'cached · GitHub Actions';
    }
  }
  if (!data) { renderWeatherError(); return; }
  view.weather = data;
  view.weatherSource = source;
  renderWeather();
}

function renderWeatherError() {
  $('#wxCond').textContent = 'Weather unavailable';
  $('#wxMeta').textContent = 'Check /api/weather or output/weather.json';
}

function renderWeather() {
  const w = view.weather;
  if (!w) return;
  const info = w.code != null ? wxInfo(w.code, w.isDay ? 1 : 0) : { label: w.conditions || 'Clear', icon: wxFromText(w.conditions) };

  $('#wxTemp').textContent = w.temp;
  $('#wxCond').textContent = info.label;
  $('#wxMeta').textContent = [w.air?.aqi ? `AQI ${w.air.aqi}` : null, w.humidity != null ? `${w.humidity}% humidity` : null].filter(Boolean).join(' · ') || 'Live conditions';
  $('#wxIcon').textContent = info.icon;
  $('#wxHiLo').textContent = `${w.high}° / ${w.low}°`;
  $('#wxFeels').textContent = `${w.feels}°`;
  $('#wxWind').textContent = w.wind != null ? `${Math.round(w.wind)} mph ${windDir(w.windDir)}`.trim() : '—';
  $('#wxHumid').textContent = w.humidity != null ? `${w.humidity}%` : '—';
  $('#wxSunrise').textContent = w.sunrise || '—';
  $('#wxSunset').textContent = w.sunset || '—';
  $('#wxUpdated').textContent = w.updated ? `as of ${fmtTime(w.updated)}` : '';
  $('#wxSource').textContent = view.weatherSource.replace('live · ', '').replace('cached · ', '');
  $('#weatherChipText').textContent = `${info.icon} ${w.temp}°`;
  $('#footUpdated').textContent = `data ${w.updated ? timeAgo(w.updated) : '—'}`;
  const miniWx = $('#miniWeather');
  if (miniWx) miniWx.textContent = view.weatherSource.replace(' · Open-Meteo', '').replace(' · GitHub Actions', '');

  const hourly = (w.hourly || []).slice(0, 12);
  $('#wxHourly').innerHTML = hourly.map(h => {
    const hi = h.code != null ? wxInfo(h.code, 1).icon : wxFromText(h.label);
    return `<div class="hour-chip">
      <div class="h-time">${esc(h.time)}</div>
      <div class="h-temp">${Math.round(h.temp)}°</div>
      <div class="h-ico">${hi}</div>
      ${h.pop ? `<div class="h-pop">${h.pop}%</div>` : ''}
    </div>`;
  }).join('');

  const daily = (w.daily || []).slice(0, 7);
  $('#wxDaily').innerHTML = daily.map(d => {
    const di = d.code != null ? wxInfo(d.code, 1).icon : wxFromText(d.label);
    return `<div class="day-chip">
      <div class="d-name">${esc(d.day)}</div>
      <div class="d-ico">${di}</div>
      <div class="d-hi">${Math.round(d.high)}°</div>
      <div class="d-lo">${Math.round(d.low)}°</div>
    </div>`;
  }).join('');

  store.state.settings.lastWeather = { temp: w.temp, label: info.label, high: w.high, low: w.low, updated: w.updated };
  renderBriefContext();
}

/* -------------------------------- agenda -------------------------------- */

function parseAgenda(text) {
  const lines = String(text || '').split(/\r?\n/);
  const sections = {};
  const items = [];
  let current = 'overview';
  let sectionLines = [];
  const flush = () => {
    if (current) sections[current] = sectionLines.filter(Boolean);
    sectionLines = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[=\-]{6,}$/.test(trimmed)) continue;
    if (/^[📅📰🔔✅⚠️🗓️]/.test(trimmed)) {
      flush();
      const name = trimmed.replace(/^[^\wA-Za-z]+/, '').trim().toLowerCase();
      current = name.includes('agenda') ? 'agenda' : name.includes('headline') || name.includes('news') ? 'news' : 'other';
      continue;
    }
    sectionLines.push(trimmed);
    if (current === 'agenda' && !/no events/i.test(trimmed) && !/^[-–—]$/.test(trimmed)) {
      items.push(trimmed.replace(/^\d+[.)]\s*/, ''));
    }
  }
  flush();
  return { items, sections };
}

export async function refreshAgenda() {
  const res = await apiJSON('/agenda/daily_agenda.txt?t=' + Date.now(), { headers: { Accept: 'text/plain' } }, 12000);
  let text = '';
  if (res.ok && typeof res.data === 'string') text = res.data;
  else if (res.status === 404) text = '';
  view.agenda.raw = text;
  const parsed = parseAgenda(text);
  view.agenda.items = parsed.items;
  view.agenda.sections = parsed.sections;
  const stamp = text.match(/Generated at ([^\n]+)/i);
  view.agenda.updatedFull = stamp ? stamp[1].trim() : null;
  const clock = view.agenda.updatedFull?.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
  view.agenda.updated = clock ? clock[1] : (view.agenda.updatedFull || null);
  renderAgenda();
}

function renderAgenda() {
  const list = $('#agendaList');
  if (!list) return;
  const items = view.agenda.items;
  if (!items.length) {
    const noEvents = /no events scheduled/i.test(view.agenda.raw);
    list.innerHTML = `<li class="empty">${noEvents ? 'No events scheduled today. Headlines are in Comms.' : 'No agenda file yet — the workflow writes it four times a day.'}</li>`;
  } else {
    list.innerHTML = items.slice(0, 8).map(i => `<li>${esc(i)}</li>`).join('');
  }
  $('#agendaStamp').textContent = view.agenda.updated ? `updated ${view.agenda.updated}` : 'workflow';
  $('#kpiAgenda').textContent = items.length;
  renderBriefContext();
}

/* -------------------------------- status -------------------------------- */

export async function refreshStatus() {
  const res = await apiJSON('/api/status', {}, 15000);
  view.status = res.ok ? res.data : null;
  renderFreshness();
  renderAutomations();
  updateStatusSummary();
  return view.status;
}

function renderFreshness() {
  const list = $('#freshness');
  if (!list) return;
  const s = view.status || {};
  const rows = [
    { name: 'Weather (output/weather.json)', age: view.weather?.updated || s.files?.weather?.updated },
    { name: 'Headlines (scripts/rss_headlines.json)', age: view.newsUpdated || s.files?.rss?.updated },
    { name: 'Agenda (agenda/daily_agenda.txt)', age: s.files?.agenda?.updated || view.agenda.updatedFull },
    { name: 'Deployment', age: s.deployment?.deployedAt || null },
  ];
  list.innerHTML = rows.map(r => {
    const mins = r.age ? Math.round((Date.now() - new Date(r.age).getTime()) / 60000) : null;
    const stale = mins != null && mins > 720;
    return `<li><span class="f-name">${esc(r.name)}</span><span class="f-age ${stale ? 'stale' : ''}">${r.age ? timeAgo(r.age) : '—'}</span></li>`;
  }).join('');

  const deploy = s.deployment;
  $('#deployTag').textContent = deploy?.env ? deploy.env : '—';

  const runs = $('#workflowRuns');
  if (runs) {
    const list2 = s.github?.runs;
    if (!list2 || !list2.length) {
      runs.innerHTML = `<li class="empty">${s.github ? 'No workflow runs found.' : 'GitHub unavailable (rate limit or offline).'}</li>`;
    } else {
      runs.innerHTML = list2.slice(0, 4).map(r => {
        const good = r.conclusion === 'success';
        const bad = r.conclusion === 'failure' || r.conclusion === 'cancelled';
        const dot = good ? 'ok' : bad ? 'bad' : 'warn';
        return `<li><span class="r-dot ${dot}"></span>
          <a class="r-name" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
          <span class="r-time">${r.conclusion || r.status} · ${timeAgo(r.updatedAt)}</span></li>`;
      }).join('');
    }
  }
}

function renderAutomations() {
  const s = view.status || {};
  const ints = s.integrations || {};
  const set = (id, ok, onText = 'configured', offText = 'not set') => {
    const el = $(id);
    if (!el) return;
    el.textContent = ok ? onText : offText;
    el.style.color = ok ? 'var(--green)' : '';
  };
  set('#autoDeepSeek', !!ints.deepseek, 'key set', 'key missing');
  set('#autoSupabase', !!ints.supabase, 'configured', 'optional');
  set('#autoN8n', !!ints.n8n, 'configured', 'optional');
  set('#autoGitHub', !!s.github, 'live', '—');
  set('#autoVercel', !!s.deployment, 'live', '—');
  set('#autoZapier', false, 'configured', 'optional');
}

/* ------------------------------ service checks --------------------------- */

export async function runChecks() {
  const grid = $('#healthGrid');
  if (!grid) return;
  const checks = [
    { name: 'Dashboard shell', url: '/', detail: 'static HTML' },
    { name: 'Weather API', url: '/api/weather' },
    { name: 'News API', url: '/api/news' },
    { name: 'AI (DeepSeek)', url: '/api/ai-corner', expect: [405, 200] },
    { name: 'Inbox (SmarterMail)', url: '/api/smartermail-email' },
    { name: 'Status', url: '/api/status' },
    { name: 'Sync (Supabase)', url: '/api/state', allow: [200, 501, 503] },
  ];

  view.checks = [];
  grid.innerHTML = checks.map(c => `
    <li class="health-row ${c.pending ? '' : ''}" data-check="${esc(c.name)}">
      <span class="h-dot"></span><span class="h-name">${esc(c.name)}</span>
      <span class="h-detail">checking…</span><span class="h-ms">—</span>
    </li>`).join('');

  await Promise.all(checks.map(async (c) => {
    const res = await apiJSON(c.url, {}, 15000);
    const good = c.expect ? c.expect.includes(res.status) : (c.allow ? c.allow.includes(res.status) : res.status === 200);
    const detail = res.status === 501 ? 'not configured' : res.status === 0 ? (res.error || 'unreachable') : `HTTP ${res.status}`;
    const row = $(`[data-check="${CSS.escape(c.name)}"]`);
    if (row) {
      row.classList.remove('ok', 'bad', 'warn');
      row.classList.add(good ? (res.status === 501 ? 'warn' : 'ok') : 'bad');
      row.querySelector('.h-detail').textContent = detail;
      row.querySelector('.h-ms').textContent = res.ms ? `${res.ms} ms` : '—';
    }
    view.checks.push({ name: c.name, ok: good, status: res.status, ms: res.ms, detail });
  }));

  const good = view.checks.filter(c => c.ok).length;
  updateStatusSummary();
  return view.checks;
}

function updateStatusSummary() {
  const pill = $('#apiDot');
  if (!pill) return;
  const configured = view.checks.filter(c => c.status !== 501);
  const bad = configured.filter(c => !c.ok).length;
  const mailOk = view.emailLoaded && view.email.length > 0;
  let state = 'ok';
  let text = 'online';
  if (bad > 0) { state = 'warn'; text = `${bad} degraded`; }
  if (view.checks.length === 0) { state = 'idle'; text = 'checking'; }
  pill.dataset.state = state;
  pill.querySelector('span').textContent = text;
  pill.title = `${view.checks.filter(c => c.ok).length}/${view.checks.length} services healthy${mailOk ? ' · mail ok' : ''}`;

  const ints = view.status?.integrations || {};
  const ai = $('#miniAi');
  if (ai) ai.textContent = ints.deepseek ? 'DeepSeek V3' : ints.gemini ? 'Gemini fallback' : 'no key';
  const inbox = $('#miniInbox');
  if (inbox) inbox.textContent = view.emailLoaded ? (view.email.length ? `${view.email.length} priority` : 'empty') : '—';
  const brief = $('#miniBrief');
  if (brief) {
    const cached = store.state.settings.brief;
    brief.textContent = cached && cached.date === isoDay() ? 'ready today' : 'not generated';
  }
}

/* ------------------------------- daily brief ----------------------------- */

function briefContext() {
  const w = view.weather;
  const tasks = sortTasks(store.state.tasks.filter(t => !t.done)).slice(0, 8).map(t => `- ${t.text}${t.due ? ` (due ${t.due})` : ''}${t.priority === 'high' ? ' [high]' : ''}`);
  const mail = view.email.slice(0, 4).map(m => `- ${m.subject} — ${m.from}`);
  const agenda = view.agenda.items.slice(0, 6).map(i => `- ${i}`);
  const weather = w ? `${w.temp}°F now, high ${w.high}°, low ${w.low}°, ${w.conditions || ''}` : 'weather unavailable';
  return [
    `Weather: ${weather}`,
    tasks.length ? `Open tasks:\n${tasks.join('\n')}` : 'Open tasks: none',
    agenda.length ? `Agenda:\n${agenda.join('\n')}` : 'Agenda: nothing scheduled',
    mail.length ? `Priority mail:\n${mail.join('\n')}` : 'Priority mail: nothing new',
  ].join('\n\n');
}

function renderBriefContext() {
  const cached = store.state.settings.brief;
  if (!cached || cached.date !== isoDay()) return;
  $('#briefText').textContent = cached.text;
  $('#briefStamp').textContent = `today · ${timeAgo(cached.at)}`;
  const mini = $('#miniBrief');
  if (mini) mini.textContent = 'ready today';
  updateStatusSummary();
}

export async function generateBrief(force = false) {
  const cached = store.state.settings.brief;
  if (!force && cached && cached.date === isoDay()) {
    $('#briefText').textContent = cached.text;
    $('#briefStamp').textContent = `today · ${timeAgo(cached.at)}`;
    return;
  }
  const btn = $('#briefBtn');
  setBusy(btn, true, 'Thinking…');
  $('#briefText').classList.add('loading');
  $('#briefText').textContent = 'Writing your brief from weather, tasks, agenda and mail…';
  try {
    const message = `Write Keith's daily brief in under 120 words. Plain English, warm but efficient. Use short paragraphs or dashes. Cover: weather to expect, the two or three things worth doing first, anything time-sensitive in mail or agenda. Do not invent facts.\n\n${briefContext()}`;
    const res = await apiJSON('/api/ai-corner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, preset: 'brief', model: 'deepseek-chat' }),
    }, 60000);
    const reply = res.ok && res.data?.reply ? res.data.reply : '';
    const usable = !!reply && res.data?.provider !== 'none';
    $('#briefText').classList.remove('loading');
    $('#briefText').textContent = usable ? reply : (reply || 'Could not reach the AI service. Add DEEPSEEK_API_KEY in Vercel, then redeploy.');
    if (usable) {
      store.state.settings.brief = { date: isoDay(), text: reply, at: new Date().toISOString() };
      store.save('settings');
      $('#briefStamp').textContent = 'just now';
      updateStatusSummary();
    } else {
      $('#briefStamp').textContent = 'not generated';
    }
  } catch (err) {
    $('#briefText').classList.remove('loading');
    $('#briefText').textContent = 'Brief failed: ' + err.message;
  } finally {
    setBusy(btn, false);
  }
}

/* ---------------------------------- AI ---------------------------------- */

function activeChat() {
  let chat = store.state.chats.find(c => c.id === store.state.settings.activeChat);
  if (!chat) {
    chat = store.state.chats[0];
    if (chat) store.state.settings.activeChat = chat.id;
  }
  return chat;
}

function ensureChat() {
  let chat = activeChat();
  if (!chat) {
    chat = {
      id: uid(), title: 'New chat', model: 'deepseek-chat',
      messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    store.state.chats.unshift(chat);
    store.state.settings.activeChat = chat.id;
    store.save('chats'); store.save('settings');
  }
  return chat;
}

export function renderChats() {
  const list = $('#chatThreads');
  if (!list) return;
  const chats = store.state.chats.slice().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  list.innerHTML = chats.map(c => `
    <li><button class="thread ${c.id === store.state.settings.activeChat ? 'is-active' : ''}" data-chat="${c.id}">
      <span class="t-title">${esc(c.title || 'Untitled')}</span>
      <span class="t-meta">${c.messages?.length || 0} messages · ${c.model === 'deepseek-reasoner' ? 'R1' : 'V3'}</span>
    </button></li>`).join('') || '<li class="empty">No threads yet.</li>';
  renderChat();
}

function renderChat() {
  const chat = activeChat();
  const box = $('#chatMessages');
  if (!box) return;
  $('#chatTitle').innerHTML = `<svg class="h-ico"><use href="#i-spark"/></svg>${esc(chat?.title || 'New chat')}`;
  $('#chatStats').textContent = chat?.messages?.length ? `${chat.messages.length} msgs` : 'ready';

  if (!chat || !chat.messages.length) {
    box.innerHTML = `<div class="chat-empty" id="chatEmpty">
      <svg><use href="#i-spark"/></svg>
      <h4>Ask anything</h4>
      <p>DeepSeek is wired through a serverless function — your key never reaches the browser.</p>
      <div class="suggestions">
        <button data-suggest="Summarize what I should focus on today given my tasks and the weather.">Today’s focus</button>
        <button data-suggest="Draft a short, polite email to my landlord about the water heater.">Draft an email</button>
        <button data-suggest="Give me three high-protein dinner ideas I can make in 30 minutes.">Dinner ideas</button>
        <button data-suggest="Explain what changed in AI this week in five bullets.">AI recap</button>
      </div>
    </div>`;
    return;
  }

  box.innerHTML = chat.messages.map(m => `
    <div class="msg ${m.role === 'user' ? 'user' : 'ai'}" data-msg="${m.id || ''}">
      <span class="avatar">${m.role === 'user' ? 'YOU' : 'DS'}</span>
      <div class="bubble">
        <span class="role">${m.role === 'user' ? 'You' : 'DeepSeek'}</span>
        <div class="content">${m.role === 'user' ? esc(m.text) : markdown(m.text || '')}</div>
      </div>
    </div>`).join('');
  box.scrollTop = box.scrollHeight;
}

async function streamReply(chat, placeholder, payload) {
  const res = await fetch('/api/ai-corner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ ...payload, stream: true }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI ${res.status}${text ? ' · ' + text.slice(0, 120) : ''}`);
  }

  // No API key configured, or a provider that answers as plain JSON: use it directly.
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/event-stream')) {
    const data = await res.json().catch(() => null);
    if (data?.reply) { placeholder.text = data.reply; return; }
    if (data?.error) throw new Error(data.error);
    throw new Error('The AI service returned an unexpected response.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let raf = null;
  const paint = () => {
    raf = null;
    const bubble = document.querySelector(`[data-msg="${placeholder.id}"] .content`);
    if (bubble) bubble.textContent = placeholder.text;
    const box = $('#chatMessages');
    if (box) box.scrollTop = box.scrollHeight;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }
        if (evt.error) throw new Error(evt.error);
        if (evt.delta) {
          placeholder.text += evt.delta;
          if (!raf) raf = requestAnimationFrame(paint);
        }
        if (evt.done && evt.usage) chat.usage = evt.usage;
      }
    }
  }
  if (raf) cancelAnimationFrame(raf);
  paint();
}

export async function sendChat(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  const chat = ensureChat();
  const input = $('#chatInput');
  if (input) input.value = '';

  const userMsg = { id: uid(), role: 'user', text: clean, ts: new Date().toISOString() };
  chat.messages.push(userMsg);
  if (chat.messages.length === 1) chat.title = clean.length > 42 ? clean.slice(0, 42) + '…' : clean;
  chat.updatedAt = new Date().toISOString();

  const placeholder = { id: uid(), role: 'assistant', text: '', pending: true, ts: new Date().toISOString() };
  chat.messages.push(placeholder);
  store.save('chats');
  renderChats();

  const box = $('#chatMessages');
  if (box) box.scrollTop = box.scrollHeight;
  const bubble = document.querySelector(`[data-msg="${placeholder.id}"] .content`);
  if (bubble) bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

  const settings = store.state.settings;
  const payload = {
    message: clean,
    model: chat.model || settings.model,
    preset: settings.preset,
    history: chat.messages.filter(m => !m.pending && m.id !== placeholder.id).slice(-10).map(m => ({ role: m.role, text: m.text })),
  };

  const started = performance.now();
  try {
    if (settings.stream) {
      await streamReply(chat, placeholder, payload);
    } else {
      const res = await apiJSON('/api/ai-corner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 90000);
      if (!res.ok || !res.data) throw new Error(`AI ${res.status}`);
      placeholder.text = res.data.reply || 'No reply.';
      if (res.data.usage) chat.usage = res.data.usage;
    }
    if (!placeholder.text.trim()) placeholder.text = 'No reply received.';
  } catch (err) {
    placeholder.text = '⚠ ' + err.message;
    toast('AI request failed: ' + err.message, 'err');
  } finally {
    placeholder.pending = false;
    chat.updatedAt = new Date().toISOString();
    store.save('chats');
    renderChats();
    const ms = Math.round(performance.now() - started);
    $('#chatStats').textContent = `${(ms / 1000).toFixed(1)}s · ${chat.usage?.total_tokens ? chat.usage.total_tokens + ' tok' : 'ok'}`;
    if (input) input.focus();
  }
}

/* --------------------------------- health -------------------------------- */

async function derivePin(pin, saltB64) {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function showHealth(unlocked) {
  view.healthUnlocked = unlocked;
  $('#healthLock').hidden = unlocked;
  $('#healthContent').hidden = !unlocked;
  if (unlocked) {
    renderMeds();
    renderVitals();
    const notes = $('#healthNotes');
    if (notes) notes.value = store.state.healthNotes || '';
  } else {
    const hasPin = !!(store.state.health.pinHash || store.state.health.legacyPin);
    $('#healthLockMsg').textContent = hasPin
      ? 'Enter your PIN to view medications, vitals and notes.'
      : 'Set a PIN (4+ digits) to protect your medications, vitals and notes.';
  }
}

async function tryUnlock(pin) {
  const h = store.state.health;
  if (!h.pinHash && !h.legacyPin) {
    if (pin.length < 4) throw new Error('Use at least 4 digits.');
    h.pinSalt = randomSalt();
    h.pinHash = await derivePin(pin, h.pinSalt);
    delete h.legacyPin;
    store.save('health');
    session.set(HEALTH_SESSION, '1');
    return true;
  }
  if (h.pinHash) {
    const hash = await derivePin(pin, h.pinSalt);
    if (hash !== h.pinHash) throw new Error('Wrong PIN.');
  } else if (h.legacyPin && pin !== h.legacyPin) {
    throw new Error('Wrong PIN.');
  }
  if (h.legacyPin) {
    h.pinSalt = randomSalt();
    h.pinHash = await derivePin(pin, h.pinSalt);
    delete h.legacyPin;
    store.save('health');
  }
  session.set(HEALTH_SESSION, '1');
  return true;
}

function renderMeds() {
  const list = $('#medList');
  if (!list) return;
  const meds = store.state.meds.slice().sort((a, b) => (a.refill || '9999') < (b.refill || '9999') ? -1 : 1);
  list.innerHTML = meds.map(m => {
    const days = m.refill ? Math.ceil((new Date(m.refill + 'T12:00:00') - Date.now()) / 86400000) : null;
    const soon = days != null && days <= 7;
    return `<li data-med="${m.id}">
      <span class="med-main"><span class="med-name">${esc(m.name)}</span><span class="med-sub">${esc(m.dose || '')}</span></span>
      ${m.refill ? `<span class="med-refill ${soon ? 'soon' : 'ok'}">${soon ? `refill in ${days}d` : `refill ${fmtDate(m.refill)}`}</span>` : ''}
      <button class="task-del" data-act="del-med" data-id="${m.id}" aria-label="Remove medication"><svg><use href="#i-trash"/></svg></button>
    </li>`;
  }).join('') || '<li class="empty">No medications yet.</li>';
}

function renderVitals() {
  const list = $('#vitalsList');
  if (!list) return;
  const vitals = store.state.vitals.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  list.innerHTML = vitals.slice(0, 10).map(v => `
    <li data-vital="${v.id}">
      <span>${v.sys}/${v.dia}${v.pulse ? ' · ' + v.pulse + ' bpm' : ''}</span>
      <span class="v-date">${esc(fmtDate(v.at))}</span>
      <button class="task-del" data-act="del-vital" data-id="${v.id}" aria-label="Remove reading"><svg><use href="#i-trash"/></svg></button>
    </li>`).join('') || '<li class="empty">No readings logged.</li>';

  const spark = $('#vitalsSpark');
  if (!spark) return;
  const series = vitals.slice(0, 12).reverse();
  if (series.length < 2) {
    spark.innerHTML = '<p class="hint">Log two readings to see the trend.</p>';
    return;
  }
  const w = 420, h = 74, pad = 6;
  const sys = series.map(v => v.sys), dia = series.map(v => v.dia);
  const min = Math.min(...dia) - 8, max = Math.max(...sys) + 8;
  const x = (i) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  spark.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Blood pressure trend">
    <path class="area" d="${path(sys)} L${x(series.length - 1)},${h - pad} L${x(0)},${h - pad} Z"/>
    <path class="line" d="${path(sys)}"/>
    <path class="line" style="stroke:var(--blue);opacity:.65" d="${path(dia)}"/>
    ${series.map((v, i) => `<circle class="pt" cx="${x(i)}" cy="${y(v.sys)}" r="2.4"/>`).join('')}
    <line class="axis" x1="0" y1="${h - pad}" x2="${w}" y2="${h - pad}"/>
  </svg>`;
}

/* --------------------------------- sleep --------------------------------- */

function sleepSummary(events) {
  if (!events.length) return 'No events logged yet tonight — looking good so far.';
  const counts = {};
  events.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
  const total = events.length;
  const quality = total <= 2 ? 'A pretty solid night.' : total <= 5 ? 'A few rough patches.' : 'A rough night — worth mentioning at your next appointment.';
  const breakdown = Object.entries(counts).map(([type, n]) => `${n} ${type}`).join(', ');
  return `${quality} ${total} event${total === 1 ? '' : 's'} logged (${breakdown}).`;
}

export function renderSleep() {
  const events = store.state.sleepEvents;
  $('#sleepCount').textContent = events.length;
  $('#sleepSummary').textContent = sleepSummary(events);
  $('#kpiSleep').textContent = events.length;

  const history = $('#sleepHistory');
  if (history) {
    history.innerHTML = events.length
      ? events.slice().reverse().map(e => `<li><span class="s-type">${esc(e.type)}</span><span class="s-time">${esc(new Date(e.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }))}</span></li>`).join('')
      : '<li class="empty">No sleep events logged yet.</li>';
  }
  if (events.length) {
    const last = events[events.length - 1];
    $('#sleepLast').textContent = `last ${fmtTime(last.time)}`;
  } else {
    $('#sleepLast').textContent = '—';
  }

  renderSleepChart();
}

function renderSleepChart() {
  const chart = $('#sleepChart');
  if (!chart) return;
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = isoDay(d);
    const count = store.state.sleepEvents.filter(e => isoDay(e.time) === key).length;
    days.push({ key, label: d.toLocaleDateString('en-US', { weekday: 'narrow' }), count });
  }
  const max = Math.max(4, ...days.map(d => d.count));
  chart.innerHTML = days.map(d => `
    <div class="bar-col" title="${d.key}: ${d.count} events">
      <div class="bar ${d.count ? '' : 'zero'}" style="height:${Math.max(3, (d.count / max) * 100)}%"></div>
      <span class="b-label">${d.label}</span>
    </div>`).join('');
}

export function logSleepEvent(type) {
  store.state.sleepEvents.push({ id: uid(), type, time: new Date().toISOString() });
  store.save('sleep');
  renderSleep();
  toast(`${type} logged`);
}

/* --------------------------------- notes --------------------------------- */

export function renderNotes() {
  const list = $('#notesList');
  if (!list) return;
  const q = ($('#noteSearch')?.value || '').toLowerCase();
  const notes = store.state.notes
    .filter(n => !q || `${n.title} ${n.body}`.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  list.innerHTML = notes.map(n => `
    <li><button class="note-item ${n.id === view.activeNote ? 'is-active' : ''}" data-note="${n.id}">
      <span class="n-name">${n.pinned ? '<svg class="inline" style="color:var(--accent)"><use href="#i-pin"/></svg>' : ''}${esc(n.title || 'Untitled')}</span>
      <span class="n-snip">${esc((n.body || '').replace(/\n/g, ' ').slice(0, 60) || 'Empty note')}</span>
    </button></li>`).join('') || `<li class="empty">${q ? 'No notes match.' : 'No notes yet — create one.'}</li>`;

  if (!view.activeNote && notes[0]) selectNote(notes[0].id);
}

function selectNote(id) {
  if (view.activeNote && view.activeNote !== id) {
    const previous = store.state.notes.find(n => n.id === view.activeNote);
    if (previous) {
      const title = $('#noteTitle').value;
      const body = $('#noteBody').value;
      if (previous.title !== title || previous.body !== body) {
        previous.title = title;
        previous.body = body;
        previous.updatedAt = new Date().toISOString();
        store.save('notes');
      }
    }
  }
  view.activeNote = id;
  const note = store.state.notes.find(n => n.id === id);
  if (!note) return;
  store.state.settings.activeNote = id;
  $('#noteTitle').value = note.title || '';
  $('#noteBody').value = note.body || '';
  $('#noteMeta').textContent = `updated ${timeAgo(note.updatedAt)}${note.pinned ? ' · pinned' : ''}`;
  $('#notePin').textContent = note.pinned ? 'Unpin' : 'Pin';
  renderNotes();
  renderNotePreview();
}

function renderNotePreview() {
  const preview = $('#notePreview');
  if (!preview || preview.hidden) return;
  const note = store.state.notes.find(n => n.id === view.activeNote);
  preview.innerHTML = markdown(note?.body || '');
}

const saveNoteSoon = debounce(() => {
  const note = store.state.notes.find(n => n.id === view.activeNote);
  if (!note) return;
  note.title = $('#noteTitle').value;
  note.body = $('#noteBody').value;
  note.updatedAt = new Date().toISOString();
  store.save('notes');
  $('#noteMeta').textContent = `updated just now${note.pinned ? ' · pinned' : ''}`;
  renderNotes();
  renderNotePreview();
}, 500);

/* ---------------------------------- ops --------------------------------- */

function renderStorage() {
  const list = $('#storageUsage');
  if (!list) return;
  const bytes = store.usage();
  const counts = {
    tasks: store.state.tasks.length,
    notes: store.state.notes.length,
    meds: store.state.meds.length,
    vitals: store.state.vitals.length,
    sleep: store.state.sleepEvents.length,
    chats: store.state.chats.length,
  };
  list.innerHTML = `
    <dt>Device storage</dt><dd>${(bytes / 1024).toFixed(1)} KB</dd>
    <dt>Tasks</dt><dd>${counts.tasks}</dd>
    <dt>Notes</dt><dd>${counts.notes}</dd>
    <dt>Medications</dt><dd>${counts.meds}</dd>
    <dt>Vitals</dt><dd>${counts.vitals}</dd>
    <dt>Sleep events</dt><dd>${counts.sleep}</dd>
    <dt>Chats</dt><dd>${counts.chats}</dd>`;
  const s = store.state.settings;
  const badge = $('#syncText');
  if (badge) {
    badge.textContent = s.lastSyncAt ? `Synced ${timeAgo(s.lastSyncAt)}` : 'Local-first · this device';
  }
  const dot = $('#syncDot');
  if (dot) dot.className = 'dot ' + (s.lastSyncAt ? 'ok' : 'off');
  if ($('#syncToken') && !$('#syncToken').value) $('#syncToken').value = s.syncToken || '';
  if ($('#backupStamp')) $('#backupStamp').textContent = s.lastSyncAt ? `synced ${timeAgo(s.lastSyncAt)}` : 'local only';
}

export async function syncNow(push = true) {
  const token = store.state.settings.syncToken || $('#syncToken')?.value || '';
  if (!token) { toast('Add a sync token first (Ops → Storage & sync).', 'err'); return; }
  const res = await apiJSON('/api/state', { headers: { 'x-sync-token': token } }, 20000);
  if (res.status === 501 || res.status === 503) {
    toast('Sync is not configured on the server yet (Supabase env vars).', 'err');
    return;
  }
  if (!res.ok) { toast('Sync pull failed: HTTP ' + res.status, 'err'); return; }
  if (res.data?.data) store.merge(res.data.data);
  if (push) {
    const put = await apiJSON('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify({ data: store.snapshot() }),
    }, 20000);
    if (!put.ok) toast('Sync push failed: HTTP ' + put.status, 'err');
    else toast('Synced both ways');
  }
  store.state.settings.lastSyncAt = new Date().toISOString();
  store.save('settings');
  renderStorage();
}

export function exportBackup() {
  const stamp = new Date().toISOString().slice(0, 10);
  download(`keith-command-center-backup-${stamp}.json`, JSON.stringify(store.snapshot(), null, 2), 'application/json');
  toast('Backup downloaded');
}

export async function importBackup(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    store.merge(data);
    renderTasks(); renderNotes(); renderSleep(); renderStorage();
    if (view.healthUnlocked) { renderMeds(); renderVitals(); }
    toast('Backup merged');
  } catch (err) {
    toast('Import failed: ' + err.message, 'err');
  }
}

/* --------------------------------- init --------------------------------- */

function bindTaskEvents() {
  $('#taskForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#taskInput');
    if (addTask(input.value, $('#taskPriority').value, $('#taskDue').value)) {
      input.value = '';
      $('#taskDue').value = '';
      input.focus();
    }
  });

  $('#taskList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const task = store.state.tasks.find(t => t.id === row.dataset.id);
    if (!task) return;
    const act = btn?.dataset.act;
    if (act === 'toggle') {
      task.done = !task.done;
      task.updatedAt = new Date().toISOString();
      store.save('tasks'); renderTasks();
    } else if (act === 'del') {
      store.state.tasks = store.state.tasks.filter(t => t.id !== task.id);
      store.save('tasks'); renderTasks();
    }
  });

  $('#taskList')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      e.preventDefault();
      row.querySelector('[data-act="toggle"]')?.click();
    }
  });

  $('#tasksFilter')?.addEventListener('click', () => {
    view.taskFilter = view.taskFilter === 'open' ? 'all' : 'open';
    renderTasks();
  });
}

function bindEmailEvents() {
  $('#emailSearch')?.addEventListener('input', debounce((e) => {
    view.emailFilter = e.target.value.trim();
    renderEmail();
  }, 150));
  $('#emailRefresh')?.addEventListener('click', () => refreshEmail(true));
  ['#emailList', '#emailMini'].forEach(sel => {
    $(sel)?.addEventListener('click', (e) => {
      const li = e.target.closest('[data-uid]');
      if (li) openEmail(li.dataset.uid);
    });
  });
}

function bindNewsEvents() {
  $('#newsFilter')?.addEventListener('change', renderNews);
  $('#newsSearch')?.addEventListener('input', debounce(renderNews, 150));
}

function bindChatEvents() {
  $('#chatForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat($('#chatInput').value);
  });
  $('#chatInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(e.target.value); }
  });
  $('#chatInput')?.addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(180, e.target.scrollHeight) + 'px';
  });
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-suggest]');
    if (s) { sendChat(s.dataset.suggest); return; }
  });
  $('#newChat')?.addEventListener('click', () => {
    const chat = { id: uid(), title: 'New chat', model: store.state.settings.model, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    store.state.chats.unshift(chat);
    store.state.settings.activeChat = chat.id;
    store.save('chats'); store.save('settings');
    renderChats();
    $('#chatInput')?.focus();
  });
  $('#deleteChat')?.addEventListener('click', () => {
    const chat = activeChat();
    if (!chat) return;
    if (!confirm('Delete this chat?')) return;
    store.state.chats = store.state.chats.filter(c => c.id !== chat.id);
    store.state.settings.activeChat = store.state.chats[0]?.id || null;
    store.save('chats'); store.save('settings');
    renderChats();
  });
  $('#chatThreads')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chat]');
    if (!btn) return;
    store.state.settings.activeChat = btn.dataset.chat;
    store.save('settings');
    renderChats();
  });
  $('#modelSelect')?.addEventListener('change', (e) => {
    store.state.settings.model = e.target.value;
    const chat = activeChat();
    if (chat) { chat.model = e.target.value; chat.updatedAt = new Date().toISOString(); store.save('chats'); }
    store.save('settings');
  });
  $('#presetSelect')?.addEventListener('change', (e) => {
    store.state.settings.preset = e.target.value;
    store.save('settings');
  });
  $('#streamToggle')?.addEventListener('change', (e) => {
    store.state.settings.stream = e.target.checked;
    store.save('settings');
  });
}

function bindHealthEvents() {
  $('#healthPinForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#healthPin');
    const errEl = $('#healthPinError');
    errEl.textContent = '';
    try {
      await tryUnlock(input.value.trim());
      input.value = '';
      showHealth(true);
      toast('Health Hub unlocked');
    } catch (err) {
      errEl.textContent = err.message;
      input.value = '';
    }
  });

  $('#lockHealth')?.addEventListener('click', () => {
    session.remove(HEALTH_SESSION);
    showHealth(false);
    $('#healthPin').value = '';
    $('#healthPinError').textContent = '';
  });

  $('#changePin')?.addEventListener('click', async () => {
    const current = prompt('Enter your current PIN:');
    if (current === null) return;
    try {
      const h = store.state.health;
      if (h.pinHash) {
        const hash = await derivePin(current, h.pinSalt);
        if (hash !== h.pinHash) throw new Error('Wrong PIN.');
      } else if (h.legacyPin && current !== h.legacyPin) {
        throw new Error('Wrong PIN.');
      }
      const next = prompt('Enter a new PIN (4+ digits):');
      if (!next) return;
      if (next.trim().length < 4) throw new Error('Use at least 4 digits.');
      h.pinSalt = randomSalt();
      h.pinHash = await derivePin(next.trim(), h.pinSalt);
      delete h.legacyPin;
      store.save('health');
      toast('PIN updated');
    } catch (err) { toast(err.message, 'err'); }
  });

  $('#medForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#medName').value.trim();
    if (!name) return;
    store.state.meds.push({
      id: uid(), name, dose: $('#medDose').value.trim(), refill: $('#medRefill').value,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    store.save('meds');
    renderMeds();
    $('#medName').value = ''; $('#medDose').value = ''; $('#medRefill').value = '';
  });

  $('#medList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="del-med"]');
    if (!btn) return;
    store.state.meds = store.state.meds.filter(m => m.id !== btn.dataset.id);
    store.save('meds'); renderMeds();
  });

  $('#vitalsForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const sys = parseInt($('#vitalSys').value, 10);
    const dia = parseInt($('#vitalDia').value, 10);
    if (!sys || !dia || sys <= dia) { toast('Enter a valid systolic/diastolic pair (SYS > DIA).', 'err'); return; }
    store.state.vitals.push({
      id: uid(), sys, dia, pulse: parseInt($('#vitalPulse').value, 10) || null,
      at: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    store.save('vitals');
    renderVitals();
    $('#vitalSys').value = ''; $('#vitalDia').value = ''; $('#vitalPulse').value = '';
  });

  $('#vitalsList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="del-vital"]');
    if (!btn) return;
    store.state.vitals = store.state.vitals.filter(v => v.id !== btn.dataset.id);
    store.save('vitals'); renderVitals();
  });

  const healthNotes = $('#healthNotes');
  healthNotes?.addEventListener('input', debounce(() => {
    store.state.healthNotes = healthNotes.value;
    store.save('healthNotes');
  }, 500));
}

function bindSleepEvents() {
  $('#sleepButtons')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-type]');
    if (btn) logSleepEvent(btn.dataset.type);
  });
  const notes = $('#sleepNotes');
  if (notes) {
    notes.value = store.state.sleepNotes[isoDay()] || '';
    notes.addEventListener('input', debounce(() => {
      store.state.sleepNotes[isoDay()] = notes.value;
      store.save('sleep');
    }, 500));
  }
  $('#sleepClear')?.addEventListener('click', () => {
    if (!confirm("Clear tonight's sleep event log?")) return;
    const today = isoDay();
    store.state.sleepEvents = store.state.sleepEvents.filter(e => isoDay(e.time) !== today);
    store.save('sleep'); renderSleep();
  });
  $('#sleepExport')?.addEventListener('click', () => {
    const rows = [['date', 'time', 'type']].concat(
      store.state.sleepEvents.slice().sort((a, b) => new Date(a.time) - new Date(b.time)).map(e => [isoDay(e.time), new Date(e.time).toLocaleString(), e.type])
    );
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    download('keith-sleep-log.csv', csv, 'text/csv');
    toast('Sleep log exported');
  });
}

function bindNoteEvents() {
  $('#newNote')?.addEventListener('click', () => {
    const note = { id: uid(), title: 'Untitled note', body: '', pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    store.state.notes.unshift(note);
    store.save('notes');
    view.activeNote = note.id;
    renderNotes();
    selectNote(note.id);
    $('#noteTitle').focus();
    $('#noteTitle').select();
  });
  $('#notesList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-note]');
    if (btn) selectNote(btn.dataset.note);
  });
  $('#noteSearch')?.addEventListener('input', debounce(renderNotes, 150));
  $('#noteTitle')?.addEventListener('input', saveNoteSoon);
  $('#noteBody')?.addEventListener('input', saveNoteSoon);
  $('#notePin')?.addEventListener('click', () => {
    const note = store.state.notes.find(n => n.id === view.activeNote);
    if (!note) return;
    note.pinned = !note.pinned;
    note.updatedAt = new Date().toISOString();
    store.save('notes'); selectNote(note.id);
  });
  $('#noteDelete')?.addEventListener('click', () => {
    const note = store.state.notes.find(n => n.id === view.activeNote);
    if (!note || !confirm('Delete this note?')) return;
    store.state.notes = store.state.notes.filter(n => n.id !== note.id);
    view.activeNote = store.state.notes[0]?.id || null;
    store.save('notes');
    if (view.activeNote) selectNote(view.activeNote);
    else { $('#noteTitle').value = ''; $('#noteBody').value = ''; renderNotes(); }
  });
  $$('[data-note-tab]').forEach(tab => tab.addEventListener('click', () => {
    view.noteTab = tab.dataset.noteTab;
    $$('[data-note-tab]').forEach(t => t.classList.toggle('is-active', t === tab));
    const editing = view.noteTab === 'edit';
    $('#noteBody').hidden = !editing;
    $('#notePreview').hidden = editing;
    renderNotePreview();
  }));
}

function bindOpsEvents() {
  $('#opsRefresh')?.addEventListener('click', () => runChecks());
  $('#syncForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const token = $('#syncToken').value.trim();
    store.state.settings.syncToken = token;
    store.save('settings');
    toast(token ? 'Sync token saved' : 'Sync token cleared');
    if (token) syncNow(true);
    renderStorage();
  });
  $('#syncNow')?.addEventListener('click', () => syncNow(true));
  $('#backupExport')?.addEventListener('click', exportBackup);
  $('#backupImport')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importBackup(file);
    e.target.value = '';
  });
}

/* ------------------------------- public init ----------------------------- */

export function initPanels() {
  bindTaskEvents();
  bindEmailEvents();
  bindNewsEvents();
  bindChatEvents();
  bindHealthEvents();
  bindSleepEvents();
  bindNoteEvents();
  bindOpsEvents();

  $('#refreshAll')?.addEventListener('click', () => refreshAll(true));
  $('#briefBtn')?.addEventListener('click', () => generateBrief(false));
  $('#briefRegen')?.addEventListener('click', () => generateBrief(true));
  $('#briefCopy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#briefText').textContent); toast('Brief copied'); }
    catch { toast('Clipboard blocked by browser', 'err'); }
  });

  // Restore chat controls
  $('#modelSelect').value = store.state.settings.model || 'deepseek-chat';
  $('#presetSelect').value = store.state.settings.preset || 'research';
  $('#streamToggle').checked = store.state.settings.stream !== false;

  // Initial render from local data
  renderTasks();
  renderChats();
  renderSleep();
  renderStorage();
  renderNotes();
  const today = $('.hero-title #heroDate');
  if (today) today.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const greeting = $('#greeting');
  if (greeting) {
    const h = new Date().getHours();
    greeting.textContent = h < 5 ? 'Late night, Keith' : h < 12 ? 'Good morning, Keith' : h < 17 ? 'Good afternoon, Keith' : 'Good evening, Keith';
  }

  // Health session
  showHealth(session.get(HEALTH_SESSION) === '1');

  // Kick off network work in parallel
  refreshWeather();
  refreshNews();
  refreshEmail();
  refreshAgenda();
  refreshStatus().then(renderFreshness);
  runChecks();
  renderBriefContext();

  if (store.state.settings.syncToken) syncNow(false).catch(() => {});

  setInterval(() => { refreshWeather(); }, 10 * 60 * 1000);
  setInterval(() => { refreshEmail(true); }, 12 * 60 * 1000);
  setInterval(() => { refreshStatus(); }, 5 * 60 * 1000);
}

export async function refreshAll(verbose = false) {
  const btn = $('#refreshAll');
  setBusy(btn, true, 'Refreshing…');
  try {
    await Promise.all([refreshWeather(), refreshNews(), refreshEmail(true), refreshAgenda(), refreshStatus()]);
    if (verbose) toast('Dashboard refreshed');
  } finally {
    setBusy(btn, false);
  }
}

export { view };
