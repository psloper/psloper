// Run the radar mounting harness and fail on any assertion it reports.
//
// The claim under test is narrow and worth stating: adding a steel lattice
// tower changes what is DRAWN and nothing that is computed. The antenna height
// above ground is the whole of what the propagation maths takes from the
// mounting, so a lattice and a tube of the same heights must give the same
// number.
//
// Serve the repository root and run:
//   node tools/verify-tower.mjs http://127.0.0.1:8099/windfarm-radar/tools/tower-harness.html
import { loadChromium, EXECUTABLE, LAUNCH_ARGS } from './playwright.mjs';

const chromium = await loadChromium();

const url = process.argv[2]
  || 'http://127.0.0.1:8099/windfarm-radar/tools/tower-harness.html';
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: LAUNCH_ARGS,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'load' });
// A harness that throws before it measures used to report nothing and be
// mistaken for a pass, so wait for the result and treat its absence as failure.
await page.waitForFunction(() => Array.isArray(window.__fails), null, { timeout: 30000 });
const fails = await page.evaluate(() => window.__fails);
const table = await page.evaluate(() => window.__measured.join('\n'));
await browser.close();
console.log(table);
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
if (fails.length) { console.error('FAIL'); process.exit(1); }
process.exit(0);
