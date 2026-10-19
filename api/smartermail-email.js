// api/smartermail-email.js
// Live IMAP inbox for the dashboard.
//   GET /api/smartermail-email            → recent priority messages (max 6)
//   GET /api/smartermail-email?uid=12345  → one message, parsed body
// Credentials live in Vercel env vars (SMARTERMAIL_USER / SMARTERMAIL_PASS).
// Dependencies are imported lazily so an unconfigured deployment still responds.

const HOST = process.env.SMARTERMAIL_HOST || 'mail.fortunfoods.com';
const PORT = Number(process.env.SMARTERMAIL_PORT || 993);

const PRIORITY_FROM = [
  'kgf@comcast.net',
  'notifications@vercel.com',
  'github.com',
  'onedrive.com',
  'noreply@paymentus.com',
  'anthropic.com',
  'ralphs@e.ralphsemail.com',
  'store-news@amazon.com',
  'openai.com',
  'edd.ca.gov',
  'deepseek.com',
];

let deps = null;
async function loadDeps() {
  if (!deps) {
    const [imap, mail] = await Promise.all([import('imapflow'), import('mailparser')]);
    deps = { ImapFlow: imap.ImapFlow, simpleParser: mail.simpleParser };
  }
  return deps;
}

const notConfigured = (uid) => uid
  ? { error: 'SmarterMail is not configured on this deployment.' }
  : [{ uid: null, subject: 'SmarterMail not configured', from: 'system', date: new Date().toISOString(), priority: false, error: true }];

export default async function handler(req, res) {
  const user = process.env.SMARTERMAIL_USER;
  const pass = process.env.SMARTERMAIL_PASS;
  const uid = req.query?.uid;
  const limit = Math.min(Number(req.query?.limit) || 6, 12);

  if (!user || !pass) {
    return res.status(200).json(notConfigured(uid));
  }

  let ImapFlow, simpleParser, client;
  try {
    ({ ImapFlow, simpleParser } = await loadDeps());
    client = new ImapFlow({
      host: HOST,
      port: PORT,
      secure: true,
      auth: { user, pass },
      logger: false,
      socketTimeout: 20000,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      if (uid) {
        const { content } = await client.download(uid, undefined, { uid: true });
        const parsed = await simpleParser(content);
        res.setHeader('Cache-Control', 'private, s-maxage=300');
        return res.status(200).json({
          subject: parsed.subject || '(no subject)',
          from: parsed.from?.text || '',
          to: parsed.to?.text || '',
          date: parsed.date,
          text: (parsed.text || '').slice(0, 60000),
          html: parsed.html || null,
        });
      }

      const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const results = [];

      for await (const message of client.fetch({ since }, { envelope: true, uid: true })) {
        const fromAddr = message.envelope.from?.[0]?.address?.toLowerCase() || '';
        results.push({
          uid: message.uid,
          subject: message.envelope.subject || '(no subject)',
          from: fromAddr,
          date: message.envelope.date,
          priority: PRIORITY_FROM.some(p => fromAddr.includes(p)),
        });
      }

      const priorityOnly = results.filter(m => m.priority);
      const pool = priorityOnly.length ? priorityOnly : results;
      pool.sort((a, b) => new Date(b.date) - new Date(a.date));

      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
      return res.status(200).json(pool.slice(0, limit));
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('SmarterMail fetch failed:', err.message);
    if (uid) return res.status(502).json({ error: 'Could not load this email.' });
    return res.status(200).json([
      { uid: null, subject: 'Could not connect to SmarterMail', from: 'system', date: new Date().toISOString(), error: true },
    ]);
  } finally {
    try { await client?.logout(); } catch { /* already closed */ }
  }
}
