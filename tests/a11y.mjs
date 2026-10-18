// tests/a11y.mjs
// Accessibility audit with axe-core across the main views.
// Usage: node tests/a11y.mjs [baseUrl]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AXE = path.join(ROOT, 'tests', 'node_modules', 'axe-core', 'axe.min.js');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export async function runA11y(baseUrl) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.addScriptTag({ path: AXE });

  const views = ['overview', 'comms', 'ai', 'sleep', 'notes', 'ops', 'automations'];
  const all = [];

  for (const view of views) {
    await page.evaluate((id) => {
      document.querySelector(`.nav-btn[data-view="${id}"]`)?.click();
    }, view);
    await new Promise(r => setTimeout(r, 350));

    const result = await page.evaluate(async () => {
      return await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
    });

    for (const v of result.violations) {
      all.push({
        view,
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')),
        count: v.nodes.length,
      });
    }
  }

  await browser.close();

  // Deduplicate by id+target, aggregating views.
  const seen = new Map();
  for (const v of all) {
    const key = v.id + '|' + v.nodes.join(',');
    if (!seen.has(key)) seen.set(key, { ...v, views: [v.view] });
    else seen.get(key).views.push(v.view);
  }
  return Array.from(seen.values());
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { startServer } = await import('./dev-server.mjs');
  const { url, server } = await startServer(0);
  try {
    const issues = await runA11y(process.argv[2] || url);
    if (!issues.length) {
      console.log('No WCAG A/AA violations found.');
    } else {
      for (const i of issues) {
        console.log(`[${i.impact}] ${i.id} — ${i.help}`);
        console.log(`   views: ${[...new Set(i.views)].join(', ')} | nodes: ${i.count}`);
        i.nodes.forEach(t => console.log(`   → ${t}`));
      }
      console.log(`\n${issues.length} unique violation(s).`);
      process.exitCode = 1;
    }
  } finally {
    server.close();
  }
}
