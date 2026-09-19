// The drawing is only honest if the model actually carries the dimensions it
// draws from. The rendered geometry itself is verified in a browser by
// tools/verify-geometry.mjs, which varies one model parameter at a time and
// measures the bounding boxes; these tests guard the inputs that harness needs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultScenario, buildTurbines, TURBINE_PRESETS, applyTurbinePreset } from '../js/model.js';
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
  // Anchor on the method DEFINITIONS, not the call sites, which come first.
  const build = src.slice(src.indexOf('\n  _buildTurbines()'), src.indexOf('\n  _buildShadows()'));
  assert.ok(build.length > 1000, 'failed to locate the turbine builder');
  const factors = [...build.matchAll(/const (girth\w*|chordExag|\w*Exag) =/g)].map((m) => m[1]);
  assert.deepEqual(factors, ['girth'],
    `expected exactly one girth factor in _buildTurbines, found: ${factors.join(', ')}`);
  // Spans must not be multiplied by it.
  for (const span of ['bladeLen = t.rotorRadiusM', 'nacL = t.nacelleLengthM']) {
    const line = build.split('\n').find((l) => l.includes(span));
    assert.ok(line, `could not find "${span}"`);
    assert.ok(!/girth/.test(line), `a span is being scaled by girth: ${line.trim()}`);
  }
  // Girths must be.
  for (const girth of ['baseR =', 'topR =', 'nacW =', 'nacH =', 'spinR =', 'const chord =']) {
    const line = build.split('\n').find((l) => l.includes(girth));
    assert.ok(line && /girth/.test(line), `a girth is NOT being scaled: ${line?.trim() ?? girth}`);
  }
});

test('hub height is exaggerated vertically and never by girth', () => {
  const src = readFileSync(new URL('../js/scene.js', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes('const hubY = t.hubHeightM'));
  assert.ok(/vExag/.test(line) && !/girth/.test(line), line);
});
