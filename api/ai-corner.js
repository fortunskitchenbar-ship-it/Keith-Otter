// api/ai-corner.js
// Vercel serverless function — AI panel + daily brief.
//
// Primary provider: DeepSeek (DEEPSEEK_API_KEY). Fallback: Gemini (GEMINI_API_KEY).
// Keys never reach the browser: the dashboard only ever talks to this route.
//
// POST body:
//   { message: string, history?: [{role,text}], model?: 'deepseek-chat'|'deepseek-reasoner',
//     preset?: 'research'|'brief'|'code'|'kitchen', stream?: boolean }
// Response (non-stream): { reply, provider, model, usage }
// Response (stream):     text/event-stream of `data: {"delta":"..."}` then `data: {"done":true,...}`

const SYSTEM = {
  research:
    'You are Keith Otter\'s private research assistant. He is a restaurant owner in La Quinta, California. ' +
    'Answer directly, in plain English, with specifics rather than filler. Use short paragraphs and bullets. ' +
    'If you are unsure, say so. Never invent prices, dates or personal facts.',
  brief:
    'You write Keith\'s daily brief. Be warm but efficient, under 120 words. Lead with weather, then the two or three ' +
    'things worth doing first, then anything time-sensitive. Plain text, short paragraphs or dashes. No headings, no emoji.',
  code:
    'You are a pragmatic senior engineer. Prefer small, complete, runnable answers. Show the exact code, then a one-line ' +
    'explanation of the non-obvious parts. Never invent APIs.',
  kitchen:
    'You are a chef-consultant for Fortun\'s Kitchen + Bar. Give practical, cost-aware answers: yields, prep time, ' +
    'substitutions and food-safety notes matter. Keep recipes scalable and concise.',
};

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const GEMINI_MODEL = 'gemini-3.6-flash';
const ALLOWED_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner']);

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const entry = hits.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count += 1;
  hits.set(ip, entry);
  if (hits.size > 500) { for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k); }
  return entry.count > 40;
}

function trimHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && typeof m.text === 'string' && m.text.trim())
    .slice(-12)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text.slice(0, 4000) }));
}

function readBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      provider: process.env.DEEPSEEK_API_KEY ? 'deepseek' : process.env.GEMINI_API_KEY ? 'gemini' : 'none',
      models: Array.from(ALLOWED_MODELS),
      hint: 'POST { message, history, model, preset } to chat.',
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ reply: 'This endpoint expects a POST with a message.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ reply: 'Too many AI requests from this network in the last hour. Try again later.' });
  }

  const body = readBody(req);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return res.status(400).json({ reply: 'No message provided.' });
  if (message.length > 8000) return res.status(413).json({ reply: 'That message is too long. Keep it under 8,000 characters.' });

  const model = ALLOWED_MODELS.has(body.model) ? body.model : 'deepseek-chat';
  const preset = SYSTEM[body.preset] ? body.preset : 'research';
  const history = trimHistory(body.history);
  const wantsStream = body.stream === true;

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!deepseekKey && !geminiKey) {
    return res.status(200).json({
      reply: 'No AI key is configured. Add DEEPSEEK_API_KEY in Vercel → Settings → Environment Variables, then redeploy.',
      provider: 'none',
    });
  }

  if (deepseekKey) {
    try {
      return await deepseek(req, res, { key: deepseekKey, message, history, model, preset, wantsStream });
    } catch (err) {
      console.error('DeepSeek failed:', err.message);
      if (!geminiKey) {
        return res.status(200).json({ reply: 'DeepSeek is temporarily unavailable — try again in a bit.', provider: 'deepseek' });
      }
    }
  }

  try {
    return await gemini(res, { key: geminiKey, message, history, preset, wantsStream });
  } catch (err) {
    console.error('Gemini failed:', err.message);
    return res.status(200).json({ reply: 'The AI service is temporarily unavailable — try again in a bit.', provider: 'gemini' });
  }
}

async function deepseek(req, res, { key, message, history, model, preset, wantsStream }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100000);

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM[preset] }, ...history, { role: 'user', content: message }],
        stream: wantsStream,
        temperature: preset === 'brief' ? 0.5 : 0.7,
        max_tokens: 1600,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error('DeepSeek HTTP', upstream.status, detail.slice(0, 400));
      throw new Error(`DeepSeek HTTP ${upstream.status}`);
    }

    if (!wantsStream) {
      const data = await upstream.json();
      const reply = data?.choices?.[0]?.message?.content?.trim() || 'No response received.';
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ reply, provider: 'deepseek', model, usage: data?.usage || null });
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload);
          const delta = evt?.choices?.[0]?.delta?.content;
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          if (evt?.usage) usage = evt.usage;
        } catch { /* ignore malformed keepalives */ }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, provider: 'deepseek', model, usage })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  } catch (err) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: 'The reply was interrupted. Try again.' })}\n\n`);
      return res.end();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function gemini(res, { key, message, history, preset, wantsStream }) {
  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  contents.push({ role: 'user', parts: [{ text: message }] });

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM[preset] }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1600 },
      }),
    }
  );

  if (!upstream.ok) {
    const detail = await upstream.text();
    console.error('Gemini HTTP', upstream.status, detail.slice(0, 400));
    throw new Error(`Gemini HTTP ${upstream.status}`);
  }

  const data = await upstream.json();
  const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim() || 'No response received.';
  const usage = data?.usageMetadata
    ? { prompt_tokens: data.usageMetadata.promptTokenCount, completion_tokens: data.usageMetadata.candidatesTokenCount, total_tokens: data.usageMetadata.totalTokenCount }
    : null;

  if (wantsStream) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.flushHeaders?.();
    // Gemini replies are small; emit in paragraph-sized chunks so the UI still streams.
    const chunks = reply.match(/[\s\S]{1,160}/g) || [reply];
    for (const delta of chunks) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true, provider: 'gemini', model: GEMINI_MODEL, usage })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ reply, provider: 'gemini', model: GEMINI_MODEL, usage });
}
