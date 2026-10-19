// api/agenda-brief.js
// Small greeting/brief endpoint kept for compatibility with older links.
// Primary provider is DeepSeek; Gemini is the fallback. Keys stay server-side.

const PROMPT = "Write a short, warm 'good morning' message for a restaurant chef/owner named Keith, 2-3 sentences, mentioning it's a fresh start to the day. No agenda items needed, just a friendly greeting.";

export default async function handler(req, res) {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!deepseekKey && !geminiKey) {
    return res.status(200).json({ summary: 'Good morning, Keith.', generatedAt: new Date().toISOString(), provider: 'none' });
  }

  if (deepseekKey) {
    try {
      const upstream = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deepseekKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: PROMPT }],
          temperature: 0.7,
          max_tokens: 160,
        }),
      });
      if (!upstream.ok) throw new Error(`DeepSeek HTTP ${upstream.status}`);
      const data = await upstream.json();
      const summary = data?.choices?.[0]?.message?.content?.trim() || 'Good morning, Keith.';
      return res.status(200).json({ summary, generatedAt: new Date().toISOString(), provider: 'deepseek' });
    } catch (err) {
      console.error('agenda-brief deepseek failed:', err.message);
    }
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }] }] }),
      }
    );
    if (!upstream.ok) throw new Error(`Gemini HTTP ${upstream.status}`);
    const data = await upstream.json();
    const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Good morning, Keith.';
    return res.status(200).json({ summary, generatedAt: new Date().toISOString(), provider: 'gemini' });
  } catch (err) {
    console.error('agenda-brief gemini failed:', err.message);
    return res.status(200).json({ summary: 'Good morning, Keith. (Brief temporarily unavailable.)', generatedAt: new Date().toISOString() });
  }
}
