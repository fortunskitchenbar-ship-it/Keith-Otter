# v2.0 — Heavy-Duty Revision

What this branch changes, why, how it was verified, and what Keith needs to do to make it live.

---

## 1. Why

The live dashboard was a good v1: a static page, two cron workflows, two API routes. It was still **thin** in the places that matter day to day:

- Weather and news were only as fresh as the last GitHub Action (4×/day).
- AI was Gemini-only, non-streaming, and its key had already been retired once.
- Every note, task and medication was trapped in one browser.
- No visibility into whether the workflow or the deployment was healthy.
- No offline support, no keyboard flow, no light theme, no search.

v2 keeps the same deployment model (static + Vercel functions, free tier) and adds the missing depth.

---

## 2. What is new

### Front-end

- New shell: fixed rail navigation, responsive bottom nav on mobile, sticky top bar with live clock, weather chip and API status.
- **Bento overview** with live weather (current, hourly, 7-day, AQI, sunrise/sunset), at-a-glance counters, tasks, AI daily brief, agenda, priority mail, quick launch and headlines.
- **Command palette** (`Ctrl K`): jump to sections, create a task/note, ask DeepSeek, refresh, export, toggle theme, open GitHub/Vercel, and search across notes and tasks.
- Keyboard shortcuts: `T` theme, `N` new task, `1–8` sections, `Esc` closes dialogs.
- Dark and light themes (dark by default, remembered per device).
- PWA: manifest, icons, offline shell service worker.

### Data

- Local-first store with per-collection timestamps, migration from every legacy v1 key, one-click JSON backup export/import, storage usage meter.
- Tasks gained priority, due date and filtering.
- Notes became multiple documents with markdown preview, pinning, search and autosave.
- Health: PBKDF2-hashed PIN, medications with refill countdowns, blood-pressure trend chart, vitals log, encrypted-at-rest notes (device only).
- Sleep: 14-night chart, event history, CSV export, per-day notes.
- Chats: multiple threads, model per thread, usage/latency display, auto-titled.

### Back-end

- `api/ai-corner.js` rewritten: **DeepSeek primary** (V3 chat / R1 reasoner), Gemini fallback, SSE token streaming, preset system prompts, input limits, per-IP rate limiting, 100s upstream timeout, graceful "no key" message.
- `api/weather.js` **new**: live Open-Meteo forecast + air quality, 10-minute edge cache, server-side shape normalisation, plus active NWS alerts (heat, wind, dust) surfaced on the hero card.
- `api/news.js` **new**: Fox News + NPR + The Verge RSS/Atom merge, entity decoding, de-duplication, keyword categorisation, 15-minute edge cache.
- `api/status.js` **new**: deployment metadata, integration flags (booleans only), latest GitHub Action runs, static-file freshness.
- `api/state.js` **new**: optional Supabase sync, token-gated, service-role key stays server-side, 1.5 MB cap, 501 when not configured.
- `api/smartermail-email.js` hardened: lazy imports, timeouts, 2-day window, up to 12 messages, clean degradation.
- `api/agenda-brief.js` moved off the retired Gemini 2.0 model to DeepSeek/Gemini 3.6, and stopped putting the key in the URL.
- Removed the duplicate `api/smartermail-mail-detail.js` (its behaviour lives in `smartermail-email.js?uid=`).

### Automation & docs

- `automation/supabase/schema.sql` — one-row snapshot table, RLS closed to anon, service-role only, optional history trigger.
- `automation/n8n/keith-command-center.json` — importable n8n workflow (schedule + webhook → weather + headlines → Supabase).
- `automation/zapier/README.md` and `automation/netlify/README.md` — how to layer the old stack back on without touching the shell.
- **Scheduled-workflow race fixed.** Both crons fired in the same minute; whichever pushed second lost with `! [rejected] main -> main (fetch first)` — the failure seen in `Daily Agenda Builder` on 2026-10-18. Both workflows now share `concurrency: keith-otter-repo-writer` and retry `git pull --rebase` + push up to four times.
- `.env.example`, rewritten README and setup guide.
- `tests/` — local Vercel-like dev server, 20 HTTP/static checks, 12 Chrome UI checks, screenshots, JSON report.
- `tests/live.mjs` — post-deploy verification (`npm run test:live`) for the production URL.
- `.github/workflows/ci.yml` — runs the smoke suite on every push/PR.

---

## 3. Verification

Run in this workspace with Node 24 and Chrome 141:

```
PASS  GET / returns the dashboard shell
PASS  styles load
PASS  app module loads
PASS  manifest is valid JSON with icons
PASS  service worker present
PASS  no duplicate element ids (194 unique)
PASS  every element the UI binds to exists (132 ids)
PASS  generated data files are valid JSON
PASS  GET /api/ai-corner reports provider
PASS  POST /api/ai-corner validates empty message
PASS  POST /api/ai-corner degrades without a key
PASS  GET /api/state is token-gated
PASS  GET /api/status returns integrations
PASS  GET /api/smartermail-email degrades cleanly
PASS  GET /api/weather (live)
PASS  GET /api/news (live, 30 items / 3 feeds)
PASS  all JavaScript parses

PASS  page title
PASS  overview renders weather
PASS  overview screenshot
PASS  task add + delete round-trip
PASS  command palette navigates
PASS  AI panel answers or explains configuration
PASS  health PIN unlock + add medication
PASS  notes: create, write, preview
PASS  theme toggle (dark → light → dark)
PASS  ops panel health checks run
PASS  mobile layout renders bottom nav
PASS  no uncaught page errors
```

Plus an axe-core audit: **0 WCAG 2.1 A/AA violations across 7 views** (`npm run test:a11y`).

Screenshots: `tests/artifacts/` (desktop dark/light, AI, notes, ops, health, mobile).

---

## 4. Deploy checklist

| # | Step | Who |
|---|---|---|
| 1 | Merge this branch into `main` | Keith / repo owner |
| 2 | Vercel auto-deploys `keith-otter.vercel.app` | automatic |
| 3 | Add `DEEPSEEK_API_KEY` in Vercel (Production + Preview), redeploy | Keith |
| 4 | Confirm AI answers on the live site | Keith |
| 5 | *(Optional)* Supabase: run `automation/supabase/schema.sql`, add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_SYNC_TOKEN` | Keith |
| 6 | *(Optional)* Paste the sync token into Ops → Storage & sync on each device | Keith |
| 7 | *(Optional)* Import the n8n workflow or rebuild the Zap | Keith |

Until step 3 the AI panel will say "No AI key is configured" — by design, not a crash.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| AI key missing after merge | Panel explains exactly what to add; Gemini fallback if still configured |
| Live weather/news upstream down | Client falls back to the committed `output/weather.json` / `scripts/rss_headlines.json`, and the card shows the fallback source |
| GitHub API rate limit in `/api/status` | Short edge cache, optional `GITHUB_TOKEN`, Ops shows "GitHub unavailable" instead of failing |
| Sync misconfiguration | `/api/state` returns 501/401 with a clear message; dashboard stays local-first |
| Data loss on upgrade | Legacy keys are migrated and left in place; export backup from Ops at any time |
| Service worker serving stale shell | Cache is versioned (`kc-v2.0.0`); API routes are never cached; navigation is network-first |
| Health data exposure on a shared device | PIN lock + auto-lock via "Lock now"; session-only unlock |

---

## 6. Rollback

1. Vercel → Deployments → pick the last v1 production deployment → **Promote to Production**; or
2. `git revert -m 1 <merge-commit>` and push.

Local data is unaffected: v2 writes only `kc.v2.*` keys and never deletes the old `keith_*` keys.

---

## 7. Files at a glance

```
index.html                     ~610 lines, semantic sections + SVG sprite
assets/styles.css              design system, dark/light, responsive
assets/core.js                 storage, migration, API client, markdown, weather codes
assets/panels.js               every panel's render + interaction logic
assets/app.js                  nav, palette, shortcuts, theme, settings
api/ai-corner.js               DeepSeek + Gemini, streaming
api/weather.js                 Open-Meteo
api/news.js                    RSS merge
api/status.js                  deployment + GitHub + freshness
api/state.js                   Supabase sync
api/smartermail-email.js       IMAP
api/agenda-brief.js            greeting endpoint
automation/…                   Supabase SQL, n8n workflow, Zapier/Netlify notes
tests/…                        dev server, smoke, UI, artifacts
docs/UPGRADE-V2.md             this file
```
