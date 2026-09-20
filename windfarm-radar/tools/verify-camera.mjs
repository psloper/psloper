// Measure the orbit camera instead of looking at it.
//
// Two defects showed up while recording a demo: the scroll wheel always drove
// at the scene origin, so you could never get close to a turbine, and at close
// range the camera sank into the ground and the view went black. Both are
// invisible to the unit tests, because scene.js needs a browser. This harness
// loads the real module and measures the camera against the real terrain.
//
// Run with the app served from the repository root:
//   python3 -m http.server 8080 --directory ..
//   node tools/verify-camera.mjs http://127.0.0.1:8080/windfarm-radar/

import { loadChromium, EXECUTABLE, LAUNCH_ARGS } from './playwright.mjs';

const chromium = await loadChromium();

const base = process.argv[2] || 'http://127.0.0.1:8080/windfarm-radar/';

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: LAUNCH_ARGS,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base, { waitUntil: 'load' });

const results = await page.evaluate(async (origin) => {
  const { Orbit } = await import(new URL('js/scene.js', origin).href);
  const THREE = await import('three');

  const out = [];
  const check = (name, pass, detail) => out.push({ name, pass, detail });

  const dom = document.createElement('div');
  Object.assign(dom.style, { position: 'fixed', left: '0', top: '0', width: '800px', height: '600px' });
  document.body.append(dom);
  const cam = new THREE.PerspectiveCamera(42, 800 / 600, 5, 400000);
  const orbit = new Orbit(cam, dom);

  // 1. With no ground function the camera sits exactly where the maths says.
  orbit.groundY = null;
  orbit.set(0, Math.PI * 0.25, 10000, new THREE.Vector3(0, 0, 0));
  const plain = Math.cos(Math.PI * 0.25) * 10000;
  check('no ground function leaves the camera height untouched',
    Math.abs(cam.position.y - plain) < 1e-6, `${cam.position.y.toFixed(3)} vs ${plain.toFixed(3)}`);

  // 2. A hill under the camera pushes the eye above it.
  const HILL = 900;
  orbit.groundY = () => HILL;
  orbit.set(0, Math.PI * 0.49, 1000);   // almost horizontal, so y would be tiny
  const wouldBe = Math.cos(Math.PI * 0.49) * 1000;
  check('the eye is lifted clear of the ground',
    cam.position.y > HILL && wouldBe < HILL,
    `camera ${cam.position.y.toFixed(1)} m, ground ${HILL} m, unclamped would be ${wouldBe.toFixed(1)} m`);

  // 3. The clamp does not fire when the camera is already well above ground.
  orbit.set(0, Math.PI * 0.25, 10000);
  check('a high camera is not disturbed by the clamp',
    Math.abs(cam.position.y - plain) < 1e-6, `${cam.position.y.toFixed(3)} vs ${plain.toFixed(3)}`);

  // 4. Zooming in with the pointer off-centre moves the target towards it.
  orbit.groundY = null;
  orbit.set(0, Math.PI * 0.30, 20000, new THREE.Vector3(0, 0, 0));
  const rect = dom.getBoundingClientRect();
  const before = orbit.target.clone();
  dom.dispatchEvent(new WheelEvent('wheel', {
    deltaY: -600, bubbles: true, cancelable: true,
    clientX: rect.left + rect.width * 0.2, clientY: rect.top + rect.height * 0.8,
  }));
  const moved = orbit.target.distanceTo(before);
  check('zooming in steers the target towards the pointer',
    moved > 1, `target moved ${moved.toFixed(0)} m`);

  // 5. Zooming out does not drag the target around.
  const beforeOut = orbit.target.clone();
  dom.dispatchEvent(new WheelEvent('wheel', {
    deltaY: 600, bubbles: true, cancelable: true,
    clientX: rect.left + rect.width * 0.2, clientY: rect.top + rect.height * 0.8,
  }));
  check('zooming out leaves the target alone',
    orbit.target.distanceTo(beforeOut) < 1e-6, `moved ${orbit.target.distanceTo(beforeOut).toFixed(6)} m`);

  dom.remove();
  return out;
}, base);

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
}
if (errors.length) { console.log('\npage errors:'); for (const e of errors) console.log('  ' + e); }
await browser.close();
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
