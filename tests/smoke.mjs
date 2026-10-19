// tests/smoke.mjs
// HTTP + static-analysis checks for the dashboard, API routes and asset wiring.
// Run through tests/run.mjs (starts a dev server first) or against a live URL.

import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function runSmoke(baseUrl) {
  const results = [];
  const pass = (name, detail = '') => results.push({ name, ok: true, detail });
  const fail = (name, detail = '') => results.push({ name, ok: false, detail });
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      pass(name, detail);
    } catch (err) {
      fail(name, err.message);
    }
  };

  const get = async (p, opts) => {
    const res = await fetch(new URL(p, baseUrl), opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { res, text, json };
  };

  // ---- shell ----
  await check('GET / returns the dashboard shell', async () => {
    const { res, text } = await get('/');
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    for (const needle of ['Keith · Command Center', 'id="view-overview"', '/assets/app.js', 'id="palette"', 'id="view-ai"']) {
      if (!text.includes(needle)) throw new Error(`missing "${needle}"`);
    }
    return `${text.length} bytes`;
  });

  await check('styles load', async () => {
    const { res, text } = await get('/assets/styles.css');
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!text.includes('--accent')) throw new Error('design tokens missing');
    return `${text.length} bytes`;
  });

  await check('app module loads', async () => {
    const { res, text } = await get('/assets/app.js');
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!text.includes('initPanels')) throw new Error('boot code missing');
    return `${text.length} bytes`;
  });

  await check('manifest is valid JSON with icons', async () => {
    const { res, json } = await get('/manifest.webmanifest');
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!json || !Array.isArray(json.icons) || json.icons.length < 2) throw new Error('icons missing');
    return `${json.name} · ${json.icons.length} icons`;
  });

  await check('service worker present', async () => {
    const { res, text } = await get('/sw.js');
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!text.includes('kc-v2')) throw new Error('cache version missing');
    return 'ok';
  });

  await check('no duplicate element ids', async () => {
    const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const seen = new Set();
    const dupes = ids.filter(id => (seen.has(id) ? true : (seen.add(id), false)));
    if (dupes.length) throw new Error('duplicates: ' + [...new Set(dupes)].join(', '));
    return `${ids.length} unique ids`;
  });

  await check('every element the UI binds to exists', async () => {
    const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
    const js = (await readFile(path.join(ROOT, 'assets/panels.js'), 'utf8')) + (await readFile(path.join(ROOT, 'assets/app.js'), 'utf8'));
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const used = new Set([...js.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map(m => m[1]));
    const missing = [...used].filter(id => !ids.has(id));
    if (missing.length) throw new Error('missing ids: ' + missing.join(', '));
    return `${used.size} ids checked`;
  });

  await check('generated data files are valid JSON', async () => {
    const weather = JSON.parse(await readFile(path.join(ROOT, 'output/weather.json'), 'utf8'));
    if (typeof weather.temp !== 'number') throw new Error('weather.temp missing');
    const rss = JSON.parse(await readFile(path.join(ROOT, 'scripts/rss_headlines.json'), 'utf8'));
    if (!Array.isArray(rss)) throw new Error('rss headlines not an array');
    return `weather ${weather.temp}°F · ${rss.length} headlines`;
  });

  await check('vercel config is valid', async () => {
    const config = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
    if (!config.headers?.length) throw new Error('security headers missing');
    if (!config.functions?.['api/ai-corner.js']) throw new Error('ai function duration missing');
    return `${config.headers.length} header rules · ${Object.keys(config.functions).length} function rules`;
  });

  await check('scheduled workflows are race-safe', async () => {
    for (const file of ['daily_agenda.yml', 'auto-commit-json.yml']) {
      const yaml = await readFile(path.join(ROOT, '.github', 'workflows', file), 'utf8');
      if (!yaml.includes('keith-otter-repo-writer')) throw new Error(`${file} missing shared concurrency group`);
      if (!yaml.includes('git pull --rebase')) throw new Error(`${file} missing rebase retry`);
    }
    return 'shared concurrency + rebase retry';
  });

  await check('automation assets are importable', async () => {
    const n8n = JSON.parse(await readFile(path.join(ROOT, 'automation/n8n/keith-command-center.json'), 'utf8'));
    if (!Array.isArray(n8n.nodes) || n8n.nodes.length < 5) throw new Error('n8n workflow has too few nodes');
    if (!n8n.connections?.['Open-Meteo']) throw new Error('n8n connections missing');
    const sql = await readFile(path.join(ROOT, 'automation/supabase/schema.sql'), 'utf8');
    if (!/create table if not exists public\.dashboard_state/i.test(sql)) throw new Error('sync schema missing');
    if (!/enable row level security/i.test(sql)) throw new Error('schema does not enable RLS');
    return `${n8n.nodes.length} n8n nodes · schema + RLS`;
  });

  // ---- api ----
  await check('GET /api/ai-corner reports provider', async () => {
    const { res, json } = await get('/api/ai-corner');
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!json || !json.provider) throw new Error('provider missing');
    if (!Array.isArray(json.models)) throw new Error('models missing');
    return `provider=${json.provider}`;
  });

  await check('POST /api/ai-corner validates empty message', async () => {
    const res = await fetch(new URL('/api/ai-corner', baseUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (res.status !== 400) throw new Error(`status ${res.status}`);
    return 'HTTP 400';
  });

  await check('POST /api/ai-corner degrades without a key', async () => {
    const res = await fetch(new URL('/api/ai-corner', baseUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'ping', preset: 'brief' }),
    });
    const json = await res.json();
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (json.provider === 'none' && !/DEEPSEEK_API_KEY/.test(json.reply || '')) throw new Error('missing setup hint');
    return json.provider;
  });

  await check('GET /api/state is token-gated / reports configuration', async () => {
    const { res, json } = await get('/api/state');
    if (![200, 401, 501].includes(res.status)) throw new Error(`status ${res.status}`);
    if (res.status === 501 && json?.error !== 'sync_not_configured') throw new Error('wrong 501 payload');
    return `HTTP ${res.status}`;
  });

  await check('GET /api/status returns integrations', async () => {
    const { res, json } = await get('/api/status');
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!json?.integrations || typeof json.integrations.deepseek !== 'boolean') throw new Error('integrations missing');
    if (!json.deployment?.env) throw new Error('deployment missing');
    return `env=${json.deployment.env} deepseek=${json.integrations.deepseek}`;
  });

  await check('GET /api/smartermail-email degrades cleanly', async () => {
    const { res, json } = await get('/api/smartermail-email');
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    if (!Array.isArray(json)) throw new Error('not an array');
    return `${json.length} item(s)`;
  });

  // ---- upstream-dependent (allowed to degrade, but shape must be right) ----
  let weatherState = 'degraded';
  await check('GET /api/weather (live or documented fallback)', async () => {
    const { res, json } = await get('/api/weather');
    if (res.status === 200) {
      if (!json?.current || typeof json.current.temp !== 'number') throw new Error('bad weather shape');
      if (!Array.isArray(json.hourly) || !Array.isArray(json.daily)) throw new Error('series missing');
      if (!Array.isArray(json.alerts)) throw new Error('alerts must be an array');
      weatherState = `live ${json.current.temp}°F · ${json.alerts.length} alert(s)`;
      return weatherState;
    }
    if (res.status === 502) return 'upstream 502 (client falls back to output/weather.json)';
    throw new Error(`unexpected status ${res.status}`);
  });

  await check('GET /api/news (live or documented fallback)', async () => {
    const { res, json } = await get('/api/news');
    if (res.status === 200) {
      if (!Array.isArray(json?.items) || !json.items.length) throw new Error('no items');
      if (!json.items[0].title || !json.items[0].link) throw new Error('bad item shape');
      if (!json.items.every(i => /^https?:\/\//i.test(i.link))) throw new Error('non-http link in feed output');
      return `${json.items.length} items from ${json.feeds?.length || 0} feeds`;
    }
    if (res.status === 502) return 'upstream 502 (client falls back to rss_headlines.json)';
    throw new Error(`unexpected status ${res.status}`);
  });

  // ---- syntax ----
  await check('all JavaScript parses', async () => {
    const files = [];
    for (const dir of ['api', 'assets', 'tests']) {
      const entries = await readdir(path.join(ROOT, dir));
      entries.filter(f => /\.(m?js)$/.test(f)).forEach(f => files.push(path.join(ROOT, dir, f)));
    }
    files.push(path.join(ROOT, 'sw.js'));
    for (const file of files) {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    }
    return `${files.length} files`;
  });

  const failed = results.filter(r => !r.ok);
  return { results, failed, weatherState };
}
