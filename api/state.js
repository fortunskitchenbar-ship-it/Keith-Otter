// api/state.js
// Optional cross-device sync backed by Supabase (PostgREST).
//
// Enabled only when all three env vars are present:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY), DASHBOARD_SYNC_TOKEN
//
// The browser sends `x-sync-token`; this route compares it server-side and then
// reads/writes a single JSON row using the service role key — which never leaves
// the server. Without those env vars the route answers 501 and the dashboard
// stays local-first.

import { timingSafeEqual, createHash } from 'node:crypto';

const ROW_ID = 'keith';
const MAX_BYTES = 1.5 * 1024 * 1024;

function safeEqual(a = '', b = '') {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  const token = process.env.DASHBOARD_SYNC_TOKEN;
  if (!url || !key || !token) return null;
  return { url: url.replace(/\/$/, ''), key, token };
}

async function rest(cfg, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      signal: controller.signal,
      ...options,
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${String(text).slice(0, 200)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  const cfg = supabaseConfig();
  if (!cfg) {
    return res.status(501).json({
      error: 'sync_not_configured',
      hint: 'Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DASHBOARD_SYNC_TOKEN in Vercel, then run automation/supabase/schema.sql.',
    });
  }

  const provided = req.headers['x-sync-token'];
  if (!provided || !safeEqual(provided, cfg.token)) {
    return res.status(401).json({ error: 'bad_sync_token' });
  }

  try {
    if (req.method === 'GET') {
      const rows = await rest(cfg, `dashboard_state?id=eq.${ROW_ID}&select=id,data,updated_at`);
      const row = Array.isArray(rows) ? rows[0] : null;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        ok: true,
        found: !!row,
        updatedAt: row?.updated_at || null,
        data: row?.data || null,
      });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = null; }
      }
      if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
        return res.status(400).json({ error: 'body must be { data: object }' });
      }
      const payload = JSON.stringify(body.data);
      if (Buffer.byteLength(payload, 'utf8') > MAX_BYTES) {
        return res.status(413).json({ error: 'state too large (1.5 MB max)' });
      }

      await rest(cfg, 'dashboard_state?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          id: ROW_ID,
          data: body.data,
          updated_at: new Date().toISOString(),
        }),
      });

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('state sync failed:', err.message);
    return res.status(502).json({ error: 'sync_failed', detail: err.message });
  }
}
