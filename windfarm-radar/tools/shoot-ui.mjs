// Screenshot the running app so its appearance can be judged from the image
// rather than from the stylesheet. Not part of the shipped tool.
import { loadChromium, EXECUTABLE, LAUNCH_ARGS } from './playwright.mjs';

const BASE = process.env.APP_URL || 'http://127.0.0.1:8777/index.html';
const OUT = process.env.SHOT_DIR || '/tmp/shots';
const W = Number(process.env.SHOT_W || 1600);
const H = Number(process.env.SHOT_H || 1000);

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/01-default.png` });

// Each rail tab, so the densest panels are visible.
for (const tab of ['radar', 'farm', 'site', 'terrain', 'wind', 'flight', 'mitigation']) {
  const sel = `.rail-tab[data-tab="${tab}"]`;
  if (await page.locator(sel).count()) {
    await page.click(sel);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/rail-${tab}.png`, clip: { x: 0, y: 0, width: 320, height: H } });
  }
}

// Dialogs reached from the top bar.
for (const [id, name] of [['btn-map', 'map'], ['btn-sweep', 'sweep'], ['btn-method', 'method'], ['btn-export', 'export']]) {
  try {
    await page.click(`#${id}`);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${OUT}/dlg-${name}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } catch (e) { errors.push(`${name}: ${e.message}`); }
}

console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
