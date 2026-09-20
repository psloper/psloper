// The drawing is only honest if the model actually carries the dimensions it
// draws from. The rendered geometry itself is verified in a browser by
// tools/verify-geometry.mjs, which varies one model parameter at a time and
// measures the bounding boxes; these tests guard the inputs that harness needs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultScenario, buildTurbines, TURBINE_PRESETS, applyTurbinePreset, TARGET_PRESETS, applyTargetPreset } from '../js/model.js';
import { createTerrain } from '../js/geo.js';

const build = (patch = {}) => {
  const sc = defaultScenario();
  sc.farm.count = 1;
  Object.assign(sc.farm, patch);
  return buildTurbines(sc, createTerrain(sc.environment.terrain))[0];
};

// Every dimension the scene draws from has to exist, be finite and be positive.
const DRAWN = ['hubHeightM', 'rotorRadiusM', 'bladeCount', 'bladeChordM',
  'towerBaseDiameterM', 'towerTopDiameterM',
  'nacelleLengthM', 'nacelleWidthM', 'nacelleHeightM', 'hubDiameterM'];

test('every drawn dimension is present and sane on a built turbine', () => {
  const t = build();
  for (const k of DRAWN) {
    assert.ok(Number.isFinite(t[k]) && t[k] > 0, `${k} is ${t[k]}`);
  }
  assert.ok(t.towerTopDiameterM < t.towerBaseDiameterM, 'a tower tapers upwards');
  assert.ok(t.nacelleLengthM > t.nacelleWidthM, 'a nacelle is longer than it is wide');
});

test('every turbine preset supplies its own nacelle and hub dimensions', () => {
  for (const key of Object.keys(TURBINE_PRESETS)) {
    const sc = applyTurbinePreset(defaultScenario(), key);
    sc.farm.count = 1;
    const t = buildTurbines(sc, createTerrain(sc.environment.terrain))[0];
    for (const k of DRAWN) {
      assert.ok(Number.isFinite(t[k]) && t[k] > 0, `${key}: ${k} is ${t[k]}`);
    }
    // Sizes must track the machine: a 15 MW offshore nacelle cannot be the
    // same as an 0.85 MW one.
    assert.ok(t.nacelleLengthM > t.rotorRadiusM * 0.10 && t.nacelleLengthM < t.rotorRadiusM * 0.40,
      `${key}: nacelle length ${t.nacelleLengthM} m is out of proportion to a ${t.rotorRadiusM} m blade`);
  }
  const small = TURBINE_PRESETS['small-850'].nacelleLengthM;
  const big = TURBINE_PRESETS['offshore-15000'].nacelleLengthM;
  assert.ok(big > small * 2, 'nacelle size must differ across the range of machines');
});

test('the scene applies ONE girth factor, and never to a span', () => {
  // A source check, because the failure this guards against is a second factor
  // creeping back in. The rendered proof is in tools/verify-geometry.mjs.
  const src = readFileSync(new URL('../js/scene.js', import.meta.url), 'utf8');
  const build = src.slice(src.indexOf('\n  _buildTurbines()'), src.indexOf('\n  _buildShadows()'));
  assert.ok(build.length > 1000, 'failed to locate the turbine builder');
  // girth is the stated factor; tGirth is that same factor with the group
  // scale divided out, so the net width on screen equals what girth says.
  const factors = [...build.matchAll(/const (girth\w*|tGirth|chordExag|\w*Exag) =/g)].map((m) => m[1]);
  assert.deepEqual(factors, ['girth', 'tGirth'],
    `expected girth and tGirth in _buildTurbines, found: ${factors.join(', ')}`);
  assert.ok(/const tGirth = girth \/ this\.vExag;/.test(build),
    'tGirth must be girth with the group scale divided out, or the stated factor lies');

  // Spans must not be multiplied by any girth factor.
  for (const span of ['bladeLen = t.rotorRadiusM', 'nacL = t.nacelleLengthM']) {
    const line = build.split('\n').find((l) => l.includes(span));
    assert.ok(line, `could not find "${span}"`);
    assert.ok(!/girth/i.test(line), `a span is being scaled by girth: ${line.trim()}`);
  }
  // Widths must be.
  for (const girth of ['baseR =', 'topR =', 'nacW =', 'nacH =', 'spinR =', 'const chord =']) {
    const line = build.split('\n').find((l) => l.includes(girth));
    assert.ok(line && /tGirth/.test(line), `a width is NOT being scaled: ${line?.trim() ?? girth}`);
  }
});

test('the turbine is built true and scaled ONCE, uniformly', () => {
  // This is the invariant two earlier versions broke. Scaling only the height
  // made the rotor an ellipse and three identical blades look like three
  // different ones. Leaving the rotor true while the tower stayed exaggerated
  // made the blades look far too short. A uniform scale on the finished group
  // is the only arrangement that keeps the silhouette right.
  const src = readFileSync(new URL('../js/scene.js', import.meta.url), 'utf8');
  const build = src.slice(src.indexOf('\n  _buildTurbines()'), src.indexOf('\n  _buildShadows()'));

  // Built at true dimensions: no vExag inside the builder at all.
  const inside = build.split('\n').filter((l) => /this\.vExag/.test(l) && !/^\s*\/\//.test(l));
  assert.deepEqual(inside.map((l) => l.trim()), [
    'const tGirth = girth / this.vExag;',
    'g.scale.setScalar(this.vExag);',
  ], `vExag used somewhere unexpected inside the turbine builder:\n${inside.join('\n')}`);

  // And nowhere may a single axis be scaled on its own: that is the ellipse.
  const perAxis = build.split('\n')
    .filter((l) => !/^\s*\/\//.test(l))          // the comment explaining why not
    .filter((l) => /\.scale\.[xyz]\s*=/.test(l));
  assert.deepEqual(perAxis, [],
    `a single axis is being scaled, which distorts the rotor:\n${perAxis.join('\n')}`);

  assert.ok(/g\.scale\.setScalar\(this\.vExag\);/.test(build),
    'the finished turbine group must carry one uniform scale');
  assert.ok(/const hubY = t\.hubHeightM;/.test(build),
    'hub height must be the true figure; the group scale does the exaggerating');
});


// ----------------------------------------------------------------- aircraft

test('every target class carries the dimensions the drawing needs', () => {
  for (const [key, p] of Object.entries(TARGET_PRESETS)) {
    assert.ok(Number.isFinite(p.spanM) && p.spanM > 0, `${key}: no span`);
    assert.ok(Number.isFinite(p.lengthM) && p.lengthM > 0, `${key}: no length`);
    assert.ok(['wing', 'rotor'].includes(p.planform), `${key}: planform is ${p.planform}`);
  }
});

test('the dimensions order the way the real aircraft do', () => {
  const span = (k) => TARGET_PRESETS[k].spanM;
  // If these ever stop holding, the drawing is telling the user something false.
  assert.ok(span('widebody') > span('airliner'), 'a widebody should out-span a narrowbody');
  assert.ok(span('airliner') > span('regional-jet'));
  assert.ok(span('regional-jet') > span('light-twin'));
  assert.ok(span('light-twin') > span('uas-fixed'));
  assert.ok(span('uas-fixed') > span('uas-micro'));
  // A widebody is about five times the span of a light single, which is the
  // ratio the picture has to show.
  const ratio = span('widebody') / span('light-ga');
  assert.ok(ratio > 4 && ratio < 7, `widebody to light single span ratio is ${ratio.toFixed(1)}`);
});

test('helicopters are rotor planform and their span is the rotor diameter', () => {
  for (const k of ['helicopter', 'helicopter-med', 'sar-helicopter', 'mil-rotary', 'uas-micro']) {
    assert.equal(TARGET_PRESETS[k].planform, 'rotor', `${k} should be a rotor type`);
  }
  // A rotor is wider than the machine is long for a light helicopter, and the
  // medium and SAR types are longer than they are wide once the boom counts.
  assert.ok(TARGET_PRESETS['sar-helicopter'].lengthM > TARGET_PRESETS['sar-helicopter'].spanM);
});

test('the dimensions reach the scenario, because the drawing reads them there', () => {
  const s = applyTargetPreset(defaultScenario(), 'widebody');
  assert.equal(s.target.spanM, TARGET_PRESETS['widebody'].spanM);
  assert.equal(s.target.planform, 'wing');
  const h = applyTargetPreset(defaultScenario(), 'sar-helicopter');
  assert.equal(h.target.planform, 'rotor');
});
