// Measure the drawn aircraft against the dimensions the model carries.
//
// The target used to be a cone sized from the scene extent, so changing the
// aircraft class changed nothing you could see. It is now built from spanM and
// lengthM, and this checks that: the drawn span must equal the model span, the
// drawn length must equal the model length for winged types, and the girth
// exaggeration must move neither. A rotor disc legitimately overhangs the
// fuselage, so for helicopters lengthM is the fuselage length.
//
// Serve the repository root, then run from the windfarm-radar directory:
//   python3 -m http.server 8125 --directory ..
//   node tools/verify-aircraft.mjs http://127.0.0.1:8125/windfarm-radar/

import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:8125/windfarm-radar/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 720 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 220)));

await page.goto(base + 'tools/aircraft-harness.html');
await page.waitForTimeout(3500);

console.log(await page.$eval('#out', (e) => e.textContent));
await page.screenshot({ path: process.env.SHOT || 'aircraft-harness.png' });
const fails = await page.evaluate(() => window.__fails || ['the harness did not run']);
if (errors.length) console.log('\npage errors:\n  ' + errors.join('\n  '));
await browser.close();
process.exit(fails.length || errors.length ? 1 : 0);
