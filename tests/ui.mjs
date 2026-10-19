// tests/ui.mjs
// Real-browser checks with Chrome (puppeteer-core), plus screenshots.
// Requires: cd tests && npm install   (installs puppeteer-core)
//
// Usage: node tests/ui.mjs [baseUrl]

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'tests', 'artifacts');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15000, interval = 200, label = 'condition' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await fn()) return true;
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}`);
}

export async function runUi(baseUrl) {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer-core')).default;
  } catch {
    return { skipped: true, reason: 'puppeteer-core not installed (cd tests && npm install)' };
  }

  const { readFile } = await import('node:fs/promises');
  try {
    await readFile(CHROME);
  } catch {
    return { skipped: true, reason: `Chrome not found at ${CHROME}` };
  }

  await mkdir(ARTIFACTS, { recursive: true });
  const results = [];
  const pass = (name, detail = '') => results.push({ name, ok: true, detail });
  const fail = (name, detail = '') => results.push({ name, ok: false, detail });
  const check = async (name, fn) => {
    try { pass(name, await fn()); } catch (err) { fail(name, err.message); }
  };

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--hide-scrollbars'],
  });

  const errors = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // 501 is the documented "sync not configured" answer; network noise is not a bug.
      if (!/favicon|net::ERR_|status of 501|status of 404|Failed to fetch/i.test(text)) errors.push(`console: ${text}`);
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    await check('page title', async () => {
      const title = await page.title();
      if (!/Command Center/.test(title)) throw new Error(`title=${title}`);
      return title;
    });

    await check('overview renders weather', async () => {
      await waitFor(async () => (await page.$eval('#wxTemp', el => el.textContent)) !== '--', { label: 'weather temperature' });
      return await page.$eval('#wxCond', el => el.textContent);
    });

    await check('overview screenshot', async () => {
      await sleep(600);
      await page.screenshot({ path: path.join(ARTIFACTS, '01-overview-dark.png'), fullPage: true });
      return '01-overview-dark.png';
    });

    await check('task add + delete round-trip', async () => {
      const text = `Test task ${Date.now().toString().slice(-5)}`;
      await page.click('#taskInput');
      await page.type('#taskInput', text);
      await page.keyboard.press('Enter');
      await waitFor(async () => page.$$eval('.task-text', (els, label) => els.some(e => e.textContent === label), text), { label: 'new task' });
      await page.evaluate((label) => {
        const row = [...document.querySelectorAll('.task-item')].find(r => r.querySelector('.task-text')?.textContent === label);
        row?.querySelector('[data-act="del"]')?.click();
      }, text);
      await waitFor(async () => page.$$eval('.task-text', (els, label) => !els.some(e => e.textContent === label), text), { label: 'task deleted' });
      return text;
    });

    await check('command palette navigates', async () => {
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyK');
      await page.keyboard.up('Control');
      await waitFor(async () => page.$eval('#palette', el => !el.hidden), { label: 'palette open' });
      await page.type('#paletteInput', 'Sleep');
      await page.keyboard.press('Enter');
      await waitFor(async () => page.$eval('#view-sleep', el => !el.hidden), { label: 'sleep view' });
      return 'palette → sleep';
    });

    await check('AI panel answers or explains configuration', async () => {
      await page.click('.nav-btn[data-view="ai"]');
      await waitFor(async () => page.$eval('#view-ai', el => !el.hidden), { label: 'ai view' });
      await page.type('#chatInput', 'Hello from the test harness');
      await page.click('#chatSend');
      await waitFor(async () => {
        const text = await page.$$eval('.msg.ai .content', els => els.map(e => e.textContent).join(' '));
        return text.trim().length > 4;
      }, { timeout: 60000, label: 'AI reply' });
      const reply = await page.$$eval('.msg.ai .content', els => els[els.length - 1].textContent);
      await page.screenshot({ path: path.join(ARTIFACTS, '02-ai.png'), fullPage: false });
      return reply.slice(0, 80);
    });

    await check('health PIN unlock + add medication', async () => {
      await page.click('.nav-btn[data-view="health"]');
      await waitFor(async () => page.$eval('#view-health', el => !el.hidden), { label: 'health view' });
      await page.type('#healthPin', '4321');
      await page.click('#healthPinForm button[type="submit"]');
      await waitFor(async () => page.$eval('#healthContent', el => !el.hidden), { label: 'health unlock' });
      const med = `Test med ${Date.now().toString().slice(-4)}`;
      await page.type('#medName', med);
      await page.type('#medDose', '10 mg');
      await page.click('#medForm button[type="submit"]');
      await waitFor(async () => page.$$eval('.med-name', (els, label) => els.some(e => e.textContent === label), med), { label: 'medication added' });
      await page.evaluate((label) => {
        const row = [...document.querySelectorAll('#medList li')].find(r => r.querySelector('.med-name')?.textContent === label);
        row?.querySelector('[data-act="del-med"]')?.click();
      }, med);
      await page.screenshot({ path: path.join(ARTIFACTS, '07-health.png'), fullPage: false });
      return 'unlocked + med round-trip';
    });

    await check('health PIN throttles brute force', async () => {
      await page.click('#lockHealth');
      await waitFor(async () => page.$eval('#healthContent', el => el.hidden), { label: 'health locked' });
      for (let i = 0; i < 5; i++) {
        await page.type('#healthPin', '0000');
        await page.click('#healthPinForm button[type="submit"]');
        await sleep(320);
      }
      await waitFor(async () => (await page.$eval('#healthPinError', el => el.textContent)).includes('Locked'), { label: 'lockout message' });
      await page.type('#healthPin', '4321');
      await page.click('#healthPinForm button[type="submit"]');
      await sleep(200);
      const msg = await page.$eval('#healthPinError', el => el.textContent);
      if (!/Too many attempts/i.test(msg)) throw new Error(`correct PIN not blocked during lockout: ${msg}`);
      return 'locked after 5 wrong attempts';
    });

    await check('notes: create, write, preview', async () => {
      await page.click('.nav-btn[data-view="notes"]');
      await page.click('#newNote');
      await page.type('#noteTitle', 'Harness note');
      await page.$eval('#noteBody', (el) => {
        el.value = '## Heading\n\nBody text from the harness.';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.click('[data-note-tab="preview"]');
      await waitFor(async () => page.$eval('#notePreview', el => !el.hidden && el.textContent.includes('Heading')), { label: 'note preview' });
      await page.screenshot({ path: path.join(ARTIFACTS, '03-notes.png'), fullPage: false });
      return 'markdown preview';
    });

    await check('theme toggle', async () => {
      await page.click('.nav-btn[data-view="overview"]');
      const before = await page.evaluate(() => document.documentElement.dataset.theme);
      await page.evaluate(() => document.getElementById('themeBtn').click());
      const after = before === 'dark' ? 'light' : 'dark';
      await waitFor(async () => page.evaluate((want) => document.documentElement.dataset.theme === want, after), { label: `${after} theme` });
      await sleep(500);
      await page.screenshot({ path: path.join(ARTIFACTS, `04-overview-${after}.png`), fullPage: true });
      await page.evaluate(() => document.getElementById('themeBtn').click());
      await waitFor(async () => page.evaluate((want) => document.documentElement.dataset.theme === want, before), { label: `${before} theme restored` });
      return `${before} → ${after} → ${before}`;
    });

    await check('ops panel health checks run', async () => {
      await page.click('.nav-btn[data-view="ops"]');
      await waitFor(async () => (await page.$$eval('#healthGrid .health-row', rows => rows.length)) >= 5, { label: 'checks render' });
      await waitFor(async () => (await page.$$eval('#healthGrid .health-row.ok, #healthGrid .health-row.warn, #healthGrid .health-row.bad', rows => rows.length)) >= 5, { timeout: 30000, label: 'checks settle' });
      await page.screenshot({ path: path.join(ARTIFACTS, '05-ops.png'), fullPage: false });
      const summary = await page.$$eval('#healthGrid .health-row', rows => rows.map(r => `${r.querySelector('.h-name').textContent}: ${r.querySelector('.h-detail').textContent}`));
      return summary.join(' | ').slice(0, 120);
    });

    // Mobile pass
    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    mobile.on('pageerror', err => errors.push(`mobile pageerror: ${err.message}`));
    await mobile.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(900);
    await mobile.screenshot({ path: path.join(ARTIFACTS, '06-mobile.png'), fullPage: true });
    await check('mobile layout renders bottom nav', async () => {
      const box = await mobile.$eval('.rail', el => {
        const r = el.getBoundingClientRect();
        return { top: r.top, height: r.height, vh: window.innerHeight, width: r.width };
      });
      if (box.width < 300) throw new Error('rail not full-width');
      if (box.top < box.vh - 120) throw new Error('rail not pinned to bottom');
      return `rail ${Math.round(box.width)}px wide at y=${Math.round(box.top)}`;
    });

    await check('mobile bottom nav switches views', async () => {
      await mobile.click('.nav-btn[data-view="sleep"]');
      await waitFor(async () => mobile.$eval('#view-sleep', el => !el.hidden), { label: 'mobile sleep view' });
      const title = await mobile.$eval('#viewTitle', el => el.textContent);
      if (title !== 'Sleep') throw new Error(`title=${title}`);
      await mobile.click('.nav-btn[data-view="overview"]');
      await waitFor(async () => mobile.$eval('#view-overview', el => !el.hidden), { label: 'mobile overview' });
      return 'sleep → overview';
    });

    await check('offline shell survives reload', async () => {
      await mobile.evaluate(async () => {
        if (!('serviceWorker' in navigator)) throw new Error('no service worker support');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise(resolve => {
            const t = setTimeout(resolve, 4000);
            navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(); }, { once: true });
          });
        }
      });

      await mobile.setOfflineMode(true);
      try {
        await mobile.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await sleep(900);
        const state = await mobile.evaluate(() => ({
          hasShell: !!document.querySelector('#view-overview'),
          hasTitle: document.body.textContent.includes('Command Center'),
          hasTasks: !!document.querySelector('#taskList'),
        }));
        if (!state.hasShell || !state.hasTitle || !state.hasTasks) {
          throw new Error(`offline render incomplete: ${JSON.stringify(state)}`);
        }
      } finally {
        await mobile.setOfflineMode(false);
      }
      return 'service worker served the shell offline';
    });

    await check('no uncaught page errors', async () => {
      if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
      return 'clean console';
    });
  } finally {
    await browser.close();
  }

  return { skipped: false, results, artifacts: ARTIFACTS };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { startServer } = await import('./dev-server.mjs');
  const { url, server } = await startServer(0);
  try {
    const out = await runUi(process.argv[2] || url);
    console.log(JSON.stringify(out, null, 2));
    if (out.results?.some(r => !r.ok)) process.exitCode = 1;
  } finally {
    server.close();
  }
}
