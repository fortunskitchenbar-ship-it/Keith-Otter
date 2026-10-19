// api/markets.js
// Live market snapshot for the Markets card.
// Equities/commodities: Yahoo Finance chart endpoint (keyless, no crumb needed).
// Crypto: CoinGecko simple price (keyless).
// Edge-cached for 2 minutes; the browser falls back to an "unavailable" state.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

const EQUITIES = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'Nasdaq' },
  { symbol: '^DJI', label: 'Dow Jones' },
  { symbol: 'CL=F', label: 'Crude oil' },
];

const CRYPTO = [
  { id: 'bitcoin', symbol: 'BTC', label: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', label: 'Ethereum' },
];

async function getJSON(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function quote(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  let data;
  try {
    data = await getJSON(`https://query1.finance.yahoo.com${path}`);
  } catch {
    data = await getJSON(`https://query2.finance.yahoo.com${path}`);
  }

  const result = data?.chart?.result?.[0];
  if (!result?.meta) throw new Error(`no quote for ${symbol}`);

  const meta = result.meta;
  const price = Number(meta.regularMarketPrice);
  const previous = Number(meta.previousClose ?? meta.chartPreviousClose);
  if (!Number.isFinite(price)) throw new Error(`no price for ${symbol}`);

  const closes = (result.indicators?.quote?.[0]?.close || [])
    .filter(v => typeof v === 'number' && Number.isFinite(v));
  const change = Number.isFinite(previous) ? price - previous : 0;
  const changePct = Number.isFinite(previous) && previous !== 0 ? (change / previous) * 100 : 0;

  return {
    symbol: symbol.replace('^', '').replace('=F', ''),
    label: null,
    price,
    change,
    changePct,
    currency: meta.currency || 'USD',
    spark: closes.slice(-12).map(v => Number(v.toFixed(2))),
  };
}

async function crypto() {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';
  const data = await getJSON(url);
  return CRYPTO.map(c => {
    const row = data?.[c.id];
    if (!row || typeof row.usd !== 'number') return null;
    const pct = Number(row.usd_24h_change) || 0;
    return {
      symbol: c.symbol,
      label: c.label,
      price: row.usd,
      change: (row.usd * pct) / 100,
      changePct: pct,
      currency: 'USD',
      spark: [],
    };
  }).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const [equityResults, cryptoResult] = await Promise.all([
    Promise.allSettled(EQUITIES.map(e => quote(e.symbol))),
    crypto().catch(err => {
      console.error('markets: crypto failed', err.message);
      return [];
    }),
  ]);

  const items = [];
  equityResults.forEach((result, i) => {
    if (result.status === 'fulfilled') items.push({ ...result.value, label: EQUITIES[i].label });
    else console.error('markets: quote failed', EQUITIES[i].symbol, result.reason?.message);
  });
  items.push(...cryptoResult);

  if (!items.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Market data unavailable' });
  }

  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  return res.status(200).json({
    source: 'yahoo+coingecko',
    updated: new Date().toISOString(),
    items,
  });
}
