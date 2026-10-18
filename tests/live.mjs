// tests/live.mjs
// Post-deploy verification against the production URL.
//   node tests/live.mjs                      → https://keith-otter.vercel.app
//   node tests/live.mjs https://example.com  → any deployment
//   node tests/live.mjs --ai                 → also sends one tiny DeepSeek prompt

const base = (process.argv.find(a => a.startsWith('http')) || 'https://keith-otter.vercel.app').replace(/\/$/, '');
const withAi = process.argv.includes('--ai');

const results = [];
const pass = (name, detail = '') => results.push({ name, ok: true, detail });
const fail = (name, detail = '') => results.push({ name, ok: false, detail });
const warn = (name, detail = '') => results.push({ name, ok: true, warn: true, detail });

async function get(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(base + path, { ...opts, signal: ctrl.signal, redirect: 'follow' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* text */ }
    return { res, text, json };
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, fn) {
  try { pass(name, await fn()); } catch (err) { fail(name, err.message); }
}

const isV2 = async () => {
  const { res, text } = await get('/');
  return res.ok && text.includes('Command Center') && text.includes('/assets/app.js');
};

await check('production serves the v2 shell', async () => {
  const { res, text } = await get('/');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!text.includes('Keith · Command Center')) {
    throw new Error('still the v1 page — the v2 commit is not deployed yet');
  }
  if (!text.includes('/assets/app.js')) throw new Error('v2 asset bundle missing');
  return `${(text.length / 1024).toFixed(1)} KB`;
});

await check('v2 assets load', async () => {
  const { res, text } = await get('/assets/styles.css');
  if (!res.ok) throw new Error(`styles HTTP ${res.status}`);
  if (!text.includes('--accent')) throw new Error('design tokens missing');
  const app = await get('/assets/app.js');
  if (!app.res.ok) throw new Error(`app.js HTTP ${app.res.status}`);
  const panels = await get('/assets/panels.js');
  if (!panels.res.ok) throw new Error(`panels.js HTTP ${panels.res.status}`);
  if (!panels.text.includes('refreshWeather')) throw new Error('panels bundle looks stale');
  return 'styles + app + panels';
});

await check('security headers', async () => {
  const { res } = await get('/');
  const nosniff = res.headers.get('x-content-type-options');
  if (nosniff !== 'nosniff') throw new Error('x-content-type-options missing (vercel.json not applied?)');
  return 'nosniff + referrer policy';
});

await check('live weather API', async () => {
  const { res, json } = await get('/api/weather');
  if (res.status === 404) throw new Error('/api/weather not deployed');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!json?.current || typeof json.current.temp !== 'number') throw new Error('bad shape');
  const age = (Date.now() - new Date(json.updated).getTime()) / 60000;
  if (age > 90) throw new Error(`payload ${Math.round(age)}m old`);
  return `${json.current.temp}°F, high ${json.high}°, ${json.current.label}`;
});

await check('live news API', async () => {
  const { res, json } = await get('/api/news');
  if (res.status === 404) throw new Error('/api/news not deployed');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!Array.isArray(json.items) || json.items.length < 5) throw new Error('too few items');
  return `${json.items.length} items / ${json.feeds?.length || 0} feeds`;
});

await check('status API (production)', async () => {
  const { res, json } = await get('/api/status');
  if (res.status === 404) throw new Error('/api/status not deployed');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (json.deployment?.env !== 'production') throw new Error(`env=${json.deployment?.env}`);
  if (typeof json.integrations?.deepseek !== 'boolean') throw new Error('integration flags missing');
  return `deepseek=${json.integrations.deepseek} gemini=${json.integrations.gemini} email=${json.integrations.email}`;
});

await check('AI route is configured', async () => {
  const { res, json } = await get('/api/ai-corner');
  if (res.status === 404) throw new Error('/api/ai-corner not deployed');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (json.provider === 'none') throw new Error('no AI key configured in Vercel (DEEPSEEK_API_KEY)');
  return `provider=${json.provider}`;
});

await check('state route degrades or is configured', async () => {
  const { res, json } = await get('/api/state');
  if (![200, 401, 501].includes(res.status)) throw new Error(`HTTP ${res.status}`);
  return res.status === 501 ? 'sync not configured (expected)' : `HTTP ${res.status}`;
});

await check('email route responds', async () => {
  const { res, json } = await get('/api/smartermail-email');
  if (res.status === 404) throw new Error('route not deployed');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!Array.isArray(json)) throw new Error('not an array');
  return `${json.filter(m => m.uid).length} priority message(s)`;
});

if (withAi) {
  await check('DeepSeek answers on production', async () => {
    const { res, json } = await get('/api/ai-corner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Reply with exactly: production-ok', model: 'deepseek-chat' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (json.provider === 'none') throw new Error('no key');
    return `${json.provider}: ${String(json.reply || '').slice(0, 40)}`;
  });
}

for (const r of results) {
  const mark = r.ok ? (r.warn ? 'WARN' : 'PASS') : 'FAIL';
  console.log(`${mark}  ${r.name.padEnd(40, '.')} ${r.detail || ''}`);
}

const failures = results.filter(r => !r.ok);
console.log(`\n${base} — ${results.length - failures.length}/${results.length} passed`);
process.exitCode = failures.length ? 1 : 0;
