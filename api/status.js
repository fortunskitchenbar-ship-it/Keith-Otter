// api/status.js
// Deployment + integration + data-freshness snapshot for the Ops panel.
// No secrets are returned — only booleans and public metadata.

const REPO = 'mathew1960/Keith-Otter';

async function fetchJSON(url, headers = {}, timeout = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json(), headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function head(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, cache: 'no-store' });
    return { ok: res.ok, lastModified: res.headers.get('last-modified'), length: res.headers.get('content-length') };
  } finally {
    clearTimeout(timer);
  }
}

// Only ever self-fetch our own deployment. On Vercel, VERCEL_URL is authoritative;
// in local dev, allow only localhost. A spoofed Host/x-forwarded-host must not turn
// this route into an SSRF primitive.
function selfOrigin(req) {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const raw = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const host = raw.split(':')[0];
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return `http://${raw}`;
  if (/^[a-z0-9-]+\.vercel\.app$/.test(host)) return `https://${host}`;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const base = selfOrigin(req);

  const [weather, rss, agenda] = base
    ? await Promise.allSettled([
        fetchJSON(`${base}/output/weather.json`),
        head(`${base}/scripts/rss_headlines.json`),
        head(`${base}/agenda/daily_agenda.txt`),
      ])
    : [{ status: 'rejected' }, { status: 'rejected' }, { status: 'rejected' }];

  let githubRuns = null;
  let commitDate = null;
  try {
    const ghHeaders = { 'User-Agent': 'KeithCommandCenter/2.0' };
    if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const runs = await fetchJSON(`https://api.github.com/repos/${REPO}/actions/runs?per_page=5`, ghHeaders);
    githubRuns = (runs.data.workflow_runs || []).map(r => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      event: r.event,
      updatedAt: r.updated_at,
      url: r.html_url,
    }));
    if (process.env.VERCEL_GIT_COMMIT_SHA) {
      const commit = await fetchJSON(`https://api.github.com/repos/${REPO}/commits/${process.env.VERCEL_GIT_COMMIT_SHA}`, ghHeaders);
      commitDate = commit.data?.commit?.committer?.date || null;
    }
  } catch (err) {
    console.warn('status: github lookup failed', err.message);
  }

  const files = {};
  if (weather.status === 'fulfilled') files.weather = { updated: weather.value.data?.updated || null };
  if (rss.status === 'fulfilled') files.rss = { updated: rss.value.lastModified };
  if (agenda.status === 'fulfilled') files.agenda = { updated: agenda.value.lastModified };

  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  return res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    region: process.env.VERCEL_REGION || null,
    deployment: {
      env: process.env.VERCEL_ENV || 'development',
      url: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : base,
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      deployedAt: commitDate,
      region: process.env.VERCEL_REGION || null,
    },
    integrations: {
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      email: !!(process.env.SMARTERMAIL_USER && process.env.SMARTERMAIL_PASS),
      supabase: !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)),
      sync: !!process.env.DASHBOARD_SYNC_TOKEN,
      github: !!process.env.GITHUB_TOKEN,
      n8n: !!process.env.N8N_WEBHOOK_URL,
    },
    github: {
      repo: REPO,
      runs: githubRuns,
    },
    files,
  });
}
