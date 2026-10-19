// api/news.js
// Live headline aggregation from public RSS/Atom feeds, shaped for the dashboard.
// Edge-cached for 15 minutes. Falls back to the repo's committed JSON in the browser.

const FEEDS = [
  { name: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/latest.xml' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
];

const CATEGORIES = [
  { id: 'markets', words: ['market', 'stocks', 'dow', 'nasdaq', 's&p', 'inflation', 'federal reserve', 'fed ', 'interest rate', 'economy', 'economic', 'tariff', 'oil price', 'bitcoin', 'crypto', 'earnings', 'jobless', 'jobs report', 'wall street', 'mortgage'] },
  { id: 'tech', words: ['ai ', ' ai', 'artificial intelligence', 'openai', 'chatgpt', 'deepseek', 'google', 'apple', 'microsoft', 'nvidia', 'chip', 'semiconductor', 'robot', 'tech', 'software', 'cyber', 'data breach', 'smartphone', 'meta '] },
  { id: 'local', words: ['california', 'la quinta', 'palm springs', 'riverside', 'coachella', 'indio', 'desert', 'los angeles', 'sacramento', 'san diego', 'orange county', 'inland empire'] },
];

function decode(text = '') {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function categorize(title, summary = '') {
  const hay = `${title} ${summary}`.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.words.some(w => hay.includes(w))) return cat.id;
  }
  return 'world';
}

function parseFeed(xml, source) {
  const items = [];

  // RSS 2.0
  const rssBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of rssBlocks) {
    const title = decode((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    let link = decode((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
    if (!link) link = decode((block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || '');
    const pub = decode((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
    const summary = decode((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 240);
    if (title && link) items.push({ title, link, summary, published: pub ? new Date(pub).toISOString() : null, source });
  }

  // Atom
  const atomBlocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of atomBlocks) {
    const title = decode((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
    const link = linkMatch ? linkMatch[1] : '';
    const pub = decode((block.match(/<(?:published|updated)>([\s\S]*?)<\/(?:published|updated)>/i) || [])[1] || '');
    const summary = decode((block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || block.match(/<content[^>]*>([\s\S]*?)<\/content>/i) || [])[1] || '').slice(0, 240);
    if (title && link) items.push({ title, link, summary, published: pub ? new Date(pub).toISOString() : null, source });
  }

  return items.filter(item => /^https?:\/\//i.test(item.link));
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'KeithCommandCenter/2.0 (+https://keith-otter.vercel.app)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!res.ok) throw new Error(`${feed.name} HTTP ${res.status}`);
    const xml = await res.text();
    return parseFeed(xml, feed.name);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const items = [];

  for (const result of results) {
    if (result.status === 'fulfilled') items.push(...result.value);
    else console.error('feed failed:', result.reason?.message);
  }

  if (!items.length) {
    return res.status(502).json({ error: 'All news feeds are unreachable right now.' });
  }

  const seen = new Set();
  const unique = items
    .filter(item => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(item => ({ ...item, category: categorize(item.title, item.summary) }))
    .sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0))
    .slice(0, 30);

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
  return res.status(200).json({
    source: 'rss',
    updated: new Date().toISOString(),
    feeds: FEEDS.map(f => f.name),
    count: unique.length,
    items: unique,
  });
}
