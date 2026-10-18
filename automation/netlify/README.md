# Netlify (optional alternative host)

The project currently runs on **Vercel**, which auto-detects the root `index.html` and the `api/` folder. Netlify can host the same dashboard, but its function layout is different, so it is a migration — not a drop-in.

## What works unchanged

- `index.html`, `assets/`, `manifest.webmanifest`, `sw.js`, `output/`, `agenda/`, `scripts/rss_headlines.json` — all static.
- The browser code only calls relative `/api/...` URLs, so a redirect is enough to move the routes.

## What needs adapting

Netlify Functions live in `netlify/functions/` and export `handler(event, context)`, not Vercel's `(req, res)`.

Minimal adapter (one file per route, or a single router):

```js
// netlify/functions/api.mjs
import aiCorner from '../../api/ai-corner.js';
// …import the other handlers

const routes = {
  'ai-corner': aiCorner,
  weather: (await import('../../api/weather.js')).default,
  news: (await import('../../api/news.js')).default,
  status: (await import('../../api/status.js')).default,
  state: (await import('../../api/state.js')).default,
  'smartermail-email': (await import('../../api/smartermail-email.js')).default,
};

export async function handler(event) {
  const name = event.path.replace('/api/', '');
  const fn = routes[name];
  if (!fn) return { statusCode: 404, body: 'Not found' };

  const req = {
    method: event.httpMethod,
    headers: event.headers,
    query: Object.fromEntries(new URLSearchParams(event.rawQuery || '')),
    body: event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : undefined,
  };
  let statusCode = 200;
  const headers = {};
  let body = '';
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status(code) { statusCode = code; return this; },
    json(payload) { headers['content-type'] = 'application/json'; body = JSON.stringify(payload); return this; },
    send(payload) { body = payload; return this; },
    write(chunk) { body += chunk; },
    end(chunk) { if (chunk) body += chunk; },
    flushHeaders() {},
  };
  await fn(req, res);
  return { statusCode, headers, body };
}
```

Streaming (`/api/ai-corner` SSE) will not stream through the adapter above — Netlify supports streaming responses on newer runtimes; if that matters, keep the AI route on Vercel or use Netlify Edge Functions.

## netlify.toml

```toml
[build]
  publish = "."
  functions = "netlify/functions"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200
```

## Env vars

Same names as Vercel (`DEEPSEEK_API_KEY`, `SMARTERMAIL_*`, `SUPABASE_*`, `DASHBOARD_SYNC_TOKEN`). Set them in **Site configuration → Environment variables**.

## Recommendation

Stay on Vercel unless there is a concrete reason to move. The automations, docs and tests in this repo all assume Vercel's function convention.
