// Verify that the drawn turbine responds to the model's dimensions.
//
// This is the check the first attempt skipped. Measuring the geometry helpers
// in isolation proves the helpers work; it does NOT prove the scene feeds them
// the model's numbers. This drives the real page, varies one model parameter at
// a time, and measures the RENDERED bounding boxes.
//
// Run: node tools/verify-geometry.mjs   (needs playwright and a served repo)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 8751;
const ROOT = process.env.REPO_ROOT || '/home/user/psloper';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/windfarm-radar/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Build a real SceneView from a real analysis and measure the turbine it draws.
// This goes through the same _buildTurbines the app uses, so it tests the
// wiring between the model and the drawing, not just the geometry helpers.
async function measure(patch) {
  return page.evaluate(async (p) => {
    const [{ defaultScenario }, { analyse }, { SceneView }] = await Promise.all([
      import('./js/model.js'), import('./js/analysis.js'), import('./js/scene.js'),
    ]);
    const sc = defaultScenario();
    sc.farm.count = 1;
    Object.assign(sc.farm, p.farm || {});
    if (p.farm && p.farm.rotorDiameterM) sc.farm.rotorDiameterM = p.farm.rotorDiameterM;

    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 400;
    document.body.append(canvas);
    const view = new SceneView(canvas);
    view.girthExag = p.girth ? 16 : 8;   // fixed so cases are comparable
    view.build(analyse(sc, { skipCoverage: true }));

    // Every drawn mesh tags itself, so nothing here has to guess from shape.
    const found = {};
    view.groups.turbines.children[0].traverse((o) => {
      const part = o.userData?.part;
      if (!o.isMesh || !part || part === 'pick') return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const rec = {
        w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y, d: bb.max.z - bb.min.z,
        rTop: o.geometry.parameters?.radiusTop ?? null,
        rBot: o.geometry.parameters?.radiusBottom ?? null,
      };
      (found[part] = found[part] || []).push(rec);
    });
    const tower = found.tower[0], nac = found.nacelle[0];
    const spin = found.spinner[0], blade = (found.blade || [{}])[0];

    canvas.remove();
    return {
      towerBaseD: tower.rBot * 2, towerTopD: tower.rTop * 2,
      chord: blade.w ?? 0, span: blade.h ?? 0, hubY: tower.h,
      nacL: nac.d, nacW: nac.w, nacH: nac.h, hubD: spin.w,
      blades: (found.blade || []).length,
    };
  }, patch);
}

const cases = [
  { label: 'baseline', patch: {} },
  { label: 'towerBaseDiameterM x2', patch: { farm: { towerBaseDiameterM: 11.0 } } },
  { label: 'towerTopDiameterM x2', patch: { farm: { towerTopDiameterM: 6.4 } } },
  { label: 'bladeChordM x2', patch: { farm: { bladeChordM: 6.0 } } },
  { label: 'rotorDiameterM x2', patch: { farm: { rotorDiameterM: 300 } } },
  { label: 'hubHeightM x2', patch: { farm: { hubHeightM: 220 } } },
  { label: 'nacelleLengthM x2', patch: { farm: { nacelleLengthM: 28.0 } } },
  { label: 'nacelleWidthM x2', patch: { farm: { nacelleWidthM: 8.4 } } },
  { label: 'hubDiameterM x2', patch: { farm: { hubDiameterM: 8.0 } } },
  { label: 'bladeCount 3 -> 2', patch: { farm: { bladeCount: 2 } } },
  { label: 'girth x2', patch: { girth: true } },
];

const rows = [];
for (const c of cases) rows.push([c.label, await measure(c.patch)]);
await browser.close();
srv.kill();

if (errors.length) { console.error('PAGE ERRORS:', errors.slice(0, 4)); process.exit(1); }

const base = rows[0][1];
const f = (v) => (v == null ? '   -  ' : v.toFixed(2).padStart(7));
console.log('Rendered dimensions, scene units. Ratio is against the baseline row.\n');
console.log(`${'case'.padEnd(24)}${'towerBaseD'.padStart(11)}${'towerTopD'.padStart(11)}`
  + `${'chord'.padStart(9)}${'span'.padStart(9)}${'hubY'.padStart(9)}`
  + `${'nacL'.padStart(8)}${'nacW'.padStart(8)}${'hubD'.padStart(8)}${'blades'.padStart(8)}`);
for (const [label, m] of rows) {
  console.log(label.padEnd(24) + f(m.towerBaseD) + f(m.towerTopD) + f(m.chord) + f(m.span)
    + f(m.hubY) + f(m.nacL) + f(m.nacW) + f(m.hubD) + String(m.blades).padStart(8));
}
console.log('\nRatios against baseline:');
for (const [label, m] of rows.slice(1)) {
  const r = Object.keys(base)
    .filter((k) => typeof base[k] === 'number' && base[k] > 0)
    .map((k) => `${k} ${(m[k] / base[k]).toFixed(2)}`)
    .join('  ');
  console.log(`  ${label.padEnd(24)} ${r}`);
}
