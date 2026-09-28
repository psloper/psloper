// Regenerate dist/example-outputs/ by driving the real application.
//
// These files ship inside the distribution zip as "here is what comes out".
// They were made by hand once and then went stale: the copies in the package
// were three days old and showed the tool before the area map, before figures
// were embedded in the Office exports, and before the terrain carried any
// relief shading. Somebody opening the zip was looking at a different tool.
//
// Generating them from the running app means they cannot drift again: the
// package build calls this, so every zip carries outputs from its own code.
//
// Run: node tools/make_examples.mjs [url]

import { mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, EXECUTABLE, LAUNCH_ARGS } from './playwright.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'example-outputs');
const URL_ = process.argv[2] || process.env.APP_URL || 'http://127.0.0.1:8777/index.html';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: LAUNCH_ARGS });
const ctx = await browser.newContext({
  viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

// A fresh browser profile is a first run, so the application opens whatever it
// shows a new user. That is correct behaviour and it intercepts every click
// after it, which is how this script found the guide the day it was added.
// Close anything open rather than naming one dialog, so a future first-run
// panel does not break the build again.
const dismissed = await page.evaluate(() => {
  const open = [...document.querySelectorAll('dialog[open]')];
  for (const d of open) d.close();
  return open.map((d) => d.id);
});
if (dismissed.length) console.log(`dismissed on first run: ${dismissed.join(', ')}`);
await page.waitForTimeout(500);

// One listener for the whole run, rather than a waitForEvent per click.
//
// The per-click version raced: the workbook now carries four embedded figures
// and took longer than its 30 s window, so it was recorded as a failure and
// then ARRIVED, and the next step's wait caught it. The log claimed the
// Markdown report had produced a .xlsx. A download that is late must not be
// able to attach itself to the wrong step.
const landed = [];
page.on('download', async (dl) => {
  const name = dl.suggestedFilename();
  try {
    await dl.saveAs(join(out, name));
    landed.push(name);
  } catch (e) {
    errors.push(`saving ${name}: ${e.message}`);
  }
});

/** Click something that produces a download, and wait for THAT file to land. */
async function grab(selector, label, timeoutMs = 90000) {
  const before = landed.length;
  try {
    await page.click(selector);
  } catch (e) {
    errors.push(`${label}: ${e.message}`);
    console.log(`  ${label.padEnd(24)} FAILED to click: ${e.message}`);
    return null;
  }
  const deadline = Date.now() + timeoutMs;
  while (landed.length === before && Date.now() < deadline) {
    await page.waitForTimeout(250);
  }
  if (landed.length === before) {
    errors.push(`${label}: no file after ${timeoutMs / 1000}s`);
    console.log(`  ${label.padEnd(24)} FAILED: nothing downloaded in ${timeoutMs / 1000}s`);
    return null;
  }
  const name = landed[landed.length - 1];
  console.log(`  ${label.padEnd(24)} ${name}`);
  return name;
}

console.log('documents and tables');
await page.click('#btn-export');
await page.waitForTimeout(700);
for (const [sel, label] of [
  ['[data-export="word"][data-mode="download"]', 'report .docx'],
  ['[data-export="excel"][data-mode="download"]', 'all tables .xlsx'],
  ['[data-export="report"][data-mode="download"]', 'report .md'],
  ['[data-export="json"][data-mode="download"]', 'full results .json'],
  ['[data-export="turbines"][data-mode="download"]', 'turbines .csv'],
  ['[data-export="scenario"][data-mode="download"]', 'scenario .json'],
]) {
  await grab(sel, label);
  await page.waitForTimeout(400);
}

console.log('figures');
for (const [what, label] of [['scene', '3D view'], ['ppi', 'plan position indicator'],
  ['profile', 'vertical section'], ['windrose', 'wind rose']]) {
  await grab(`[data-image="${what}"]`, label);
  await page.waitForTimeout(400);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

console.log('parameter sweep');
await page.click('#btn-sweep');
await page.waitForTimeout(700);
await page.click('#sweep-run');
await page.waitForTimeout(9000);
await grab('#sweep-png', 'sweep heat map .png');
await page.waitForTimeout(400);
await grab('#sweep-csv', 'sweep grid .csv');
await page.keyboard.press('Escape');

await ctx.close();
await browser.close();

const files = readdirSync(out);
console.log(`downloads that landed: ${landed.length}`);
const bytes = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
writeFileSync(join(out, 'README.md'),
  `# Example outputs\n\n`
  + `Every file here was produced by the application in this package, from its\n`
  + `default scenario, by \`tools/make_examples.mjs\`. They are regenerated on every\n`
  + `package build, so they show this version rather than an older one.\n\n`
  + `Generated: ${new Date().toISOString().slice(0, 10)}\n\n`
  + files.sort().map((f) => `- \`${f}\``).join('\n') + '\n');

console.log(`\n${files.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
if (errors.length) { console.log(`\n${errors.length} PROBLEM(S):\n` + errors.join('\n')); process.exit(1); }
console.log('all example outputs generated');
