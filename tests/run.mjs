// tests/run.mjs
// One command: starts the local server, runs HTTP/static checks, then browser checks.
//   node tests/run.mjs            (smoke + UI if Chrome/puppeteer are available)
//   node tests/run.mjs --smoke    (smoke only)

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './dev-server.mjs';
import { runSmoke } from './smoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeOnly = process.argv.includes('--smoke');

function line(result) {
  const mark = result.ok ? 'PASS' : 'FAIL';
  const name = result.name.padEnd(52, '.');
  return `${mark}  ${name} ${result.detail || ''}`;
}

const { server, url } = await startServer(0);
let exitCode = 0;

try {
  console.log(`\nKeith · Command Center — verification\nServer: ${url}\n`);

  const smoke = await runSmoke(url);
  smoke.results.forEach(r => console.log(line(r)));
  if (smoke.failed.length) exitCode = 1;

  let ui = { skipped: true, reason: 'skipped (--smoke)' };
  if (!smokeOnly) {
    console.log('\nBrowser checks');
    const mod = await import('./ui.mjs');
    ui = await mod.runUi(url);
    if (ui.skipped) {
      console.log(`SKIP  ${ui.reason}`);
    } else {
      ui.results.forEach(r => console.log(line(r)));
      if (ui.results.some(r => !r.ok)) exitCode = 1;
      if (ui.artifacts) console.log(`\nScreenshots: ${ui.artifacts}`);
    }
  }

  await mkdir(path.join(ROOT, 'tests', 'artifacts'), { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    url,
    smoke: smoke.results,
    ui,
  };
  await writeFile(path.join(ROOT, 'tests', 'artifacts', 'report.json'), JSON.stringify(report, null, 2));

  const failed = [...smoke.failed, ...(ui.results || []).filter(r => !r.ok)];
  console.log(`\n${failed.length ? `${failed.length} check(s) failed` : 'All checks passed'}`);
} finally {
  server.close();
}

process.exitCode = exitCode;
