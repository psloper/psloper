// Shape checks on the drawn turbine.
//
// tools/verify-geometry.mjs already proves the scene feeds the model's
// dimensions through to the picture. This checks the things a bounding box on
// the whole machine cannot see: a blade root that is a cylinder and not a
// needle, a prebent blade, a tilted shaft, a rotor upwind of its tower.
//
// Serve the repository root, then run from the windfarm-radar directory:
//   python3 -m http.server 8125 --directory ..
//   node tools/verify-turbine.mjs http://127.0.0.1:8125/windfarm-radar/

import { loadChromium, EXECUTABLE, LAUNCH_ARGS } from './playwright.mjs';

const chromium = await loadChromium();
const base = process.argv[2] || 'http://127.0.0.1:8125/windfarm-radar/';
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 220)));

await page.goto(base + 'tools/turbine-harness.html');
await page.waitForFunction(() => Array.isArray(window.__fails), null, { timeout: 30000 });
console.log(await page.$eval('#out', (e) => e.textContent));
const fails = await page.evaluate(() => window.__fails || ['the harness did not run']);
if (errors.length) console.log('\npage errors:\n  ' + errors.join('\n  '));
await browser.close();
process.exit(fails.length || errors.length ? 1 : 0);
