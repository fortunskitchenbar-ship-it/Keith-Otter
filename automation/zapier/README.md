# Zapier (optional)

The dashboard does not need Zapier. If you want the old automation back, this is the shortest path.

## What Zapier is good for here

- Mirror new tasks or market moves into Slack / SMS / email.
- Create a task in the dashboard from another app (via a small webhook endpoint).
- Log a daily digest into a Google Sheet.

## Option A — Zapier watches GitHub

1. In Zapier: **Trigger → GitHub → "New commit"** (repo `mathew1960/Keith-Otter`, branch `main`).
2. **Filter**: commit message contains `auto-update JSON`.
3. **Action**: Slack / SMS / Gmail with the commit URL.
4. Done. Every scheduled refresh now pings you.

## Option B — Zapier → dashboard

The dashboard has no write webhook by default (deliberately: the shell is static). Two clean ways to add one:

1. **Supabase (recommended).** Zapier's Supabase integration writes a row; `/api/state` is the read path the dashboard already uses. Configure the sync token and the row `id = 'keith'`.
2. **n8n webhook.** Import `automation/n8n/keith-command-center.json`; its `Manual webhook` node is a URL Zapier can POST to.

Do **not** add a public write endpoint to `/api/state` that skips the token — that would expose all local data.

## Environment

No Zapier env vars are read by the app. The Automations panel simply links to Zapier and reports `optional`.
