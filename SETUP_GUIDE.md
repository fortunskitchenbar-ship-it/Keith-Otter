# Keith · Command Center — Setup Guide

How to stand this dashboard up from scratch, recreate it in a new repo, or add the optional integrations. The dashboard itself needs **no build step** and **no database**.

---

## 1. What you are building

- A static `index.html` + `assets/` shell hosted on Vercel.
- Seven serverless routes in `api/` (weather, news, markets, AI, status, sync, agenda greeting).
- Two scheduled GitHub Actions that refresh JSON in the repo (and therefore redeploy Vercel).
- Optional: Supabase for cross-device sync, n8n or Zapier for automation.

---

## 2. Repo layout

```
your-repo/
├── index.html
├── assets/            styles.css, core.js, panels.js, app.js, icons/
├── api/               weather.js, news.js, markets.js, ai-corner.js, status.js, state.js, agenda-brief.js
├── scripts/           Python fetchers used by the scheduled workflows
├── output/            weather.json, research_data.json
├── agenda/            daily_agenda.txt
├── automation/        supabase/schema.sql, n8n/workflow.json, zapier/, netlify/
├── tests/             dev server + smoke + Chrome UI checks
├── .github/workflows/ auto-commit-json.yml, daily_agenda.yml, ci.yml
├── .env.example
└── package.json       type: module, no runtime dependencies
```

---

## 3. Deploy to Vercel

1. Push the repo to GitHub.
2. Vercel → **Add New → Project** → import the repo.
3. Framework preset: **Other**. Build command: empty. Output directory: `.` (root).
4. Deploy. Note the domain (`something.vercel.app`).
5. Avoid importing the same repo twice under different project names — you will end up with two "production" sites, one of which is missing env vars.

---

## 4. Environment variables

Vercel → **Settings → Environment Variables** (Production **and** Preview). These are separate from GitHub Actions secrets.

| Variable | Required | Notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | yes, for AI | https://platform.deepseek.com/api_keys |
| `GEMINI_API_KEY` | optional | fallback only |
| `SUPABASE_URL` | optional sync | https://supabase.com |
| `SUPABASE_SERVICE_ROLE_KEY` | optional sync | server-side only |
| `DASHBOARD_SYNC_TOKEN` | optional sync | long random string |
| `GITHUB_TOKEN` | optional | raises GitHub API limits in Ops |
| `N8N_WEBHOOK_URL` | optional | shown in Automations |

After adding or changing variables, **redeploy** so the functions pick them up.

---

## 5. Optional: cross-device sync (Supabase)

1. Create a Supabase project (free tier is fine).
2. SQL Editor → paste and run `automation/supabase/schema.sql`.
3. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_SYNC_TOKEN` to Vercel → redeploy.
4. On each device: **Ops → Storage & sync** → paste the same token → **Save**. It will pull, merge and push.
5. Verify: `select id, updated_at from public.dashboard_state;` should show one row (`keith`).

Without these three variables the dashboard is fully functional and local-first; `/api/state` returns 501 with a clear hint.

---

## 6. Optional: n8n

1. n8n Cloud or self-hosted.
2. Set n8n environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
3. **Import** `automation/n8n/keith-command-center.json`.
4. Open the workflow, check the schedule (6:30 / 11:30 / 16:30 / 21:30 Pacific expressed as UTC cron), activate.
5. The webhook trigger (`keith-command-center-refresh`) gives you a manual refresh URL.

---

## 7. Optional: Zapier

See `automation/zapier/README.md`. Short version: watch GitHub commits, or write to Supabase and let the dashboard read it. Do not expose a write endpoint without the sync token.

---

## 8. GitHub Actions secrets

| Secret | Used by | Notes |
|---|---|---|
| `GCAL_ICAL_URL` | `scripts/fetch_calendar.py` | optional; script fails soft |

`GITHUB_TOKEN` is provided automatically to the JSON workflows.

---

## 9. Verify

Manual:

1. Open the site — weather should be live (not the 4×/day file).
2. **AI** → ask "Summarize my day" — should stream a reply.
3. **Ops** → all rows green except *Sync (Supabase)* if not set up.
4. **Comms** → market quotes load (S&P, Nasdaq, Dow, oil, BTC, ETH).
5. Toggle the theme, press `Ctrl K`, add a task.

Automated (local):

```bash
node tests/run.mjs           # HTTP + Chrome checks + screenshots
node tests/run.mjs --smoke   # no browser
```

CI runs the smoke suite on every push (`.github/workflows/ci.yml`).

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| AI says "No AI key is configured" | Add `DEEPSEEK_API_KEY` in Vercel and redeploy |
| Weather card says "cached · GitHub Actions" | `/api/weather` upstream failed; the committed JSON is being used. Check `fetch_weather.py` and the Open-Meteo status |
| News empty | All three feeds unreachable; the client falls back to `scripts/rss_headlines.json` |
| Ops shows "Sync (Supabase): not configured" | Expected until the three sync env vars are set |
| Sync returns 401 | The token in the browser does not match `DASHBOARD_SYNC_TOKEN` |
| Markets show “unavailable” | Yahoo Finance or CoinGecko is temporarily unreachable; the card recovers on the next refresh |
| Health Hub asks for a PIN you don't remember | The PIN is local to that browser; clear `kc.v2.health` in DevTools (data stays) |
| Weekly cron drifts by an hour | Crons are UTC; adjust the four cron lines around DST |
| A workflow fails with `IndentationError` | A Python file was pasted with indentation stripped |

---

## 11. Customising

- **Colours / spacing:** `assets/styles.css` design tokens at the top (`--accent`, `--surface`, `--bg`).
- **Sections:** `VIEWS` in `assets/app.js` and the matching `<section class="view">` blocks in `index.html`.
- **AI prompts:** `SYSTEM` in `api/ai-corner.js`.
- **News feeds / categories:** `FEEDS` and `CATEGORIES` in `api/news.js`.
- **Location:** `LAT` / `LON` / `TZ` in `api/weather.js`.
- **Refresh cadence:** service-worker-free intervals at the bottom of `initPanels()`; GitHub Actions cron in `.github/workflows/`.

---

*La Quinta, CA*
