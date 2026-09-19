// Validation tests for the physics core.
//
// These check the implemented formulas against values that are independently
// known, so a regression in the maths fails loudly rather than quietly
// producing a plausible-looking but wrong assessment.
//
//   node --test windfarm-radar/test/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  effectiveEarthRadius, horizonDistance, curvatureDrop, bearingOf, angleDelta,
  createTerrain, profileObstruction, viewGeometry,
} from '../js/geo.js';

import {
  C, BOLTZMANN, wavelength, receivedPowerW, noisePowerW, linToDb,
  albersheimSnrDb, knifeEdgeLossDb, fresnelParameter, fresnelRadius,
  azimuthGainDb, elevationGainDb, tipSpeed, dopplerHz, blindSpeed,
  foldVelocity, mtiResponseDb, rotorSolidity, rotorBlockageLossDb,
  pulsesPerScan, rangeResolution, unambiguousRange, farFieldDistance,
} from '../js/rf.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} +/- ${tol}`);

// ---------------------------------------------------------------- curvature

test('radar horizon matches the standard d_km = 4.12*sqrt(h_m) rule at k=4/3', () => {
  const ae = effectiveEarthRadius(4 / 3);
  // The familiar 4.12 is sqrt(2*a_e)/1000 rounded to three figures.
  close(Math.sqrt(2 * ae) / 1000, 4.12, 0.005, 'rule-of-thumb coefficient');
  for (const h of [10, 20, 50, 150, 300]) {
    const km = horizonDistance(h, ae) / 1000;
    close(km, 4.12 * Math.sqrt(h), 0.001 * km + 0.01, `horizon at ${h} m`);
  }
});

test('curvature drop is quadratic in range', () => {
  const ae = effectiveEarthRadius(4 / 3);
  close(curvatureDrop(30000, ae), 53.0, 0.5, 'drop at 30 km');
  close(curvatureDrop(60000, ae) / curvatureDrop(30000, ae), 4, 1e-9, 'quadratic');
});

test('true-earth horizon is shorter than the 4/3-earth horizon', () => {
  assert.ok(horizonDistance(30, effectiveEarthRadius(1)) <
            horizonDistance(30, effectiveEarthRadius(4 / 3)));
});

test('bearings are measured clockwise from north', () => {
  close(bearingOf(0, 1), 0, 1e-9, 'north');
  close(bearingOf(1, 0), 90, 1e-9, 'east');
  close(bearingOf(0, -1), 180, 1e-9, 'south');
  close(bearingOf(-1, 0), 270, 1e-9, 'west');
  close(angleDelta(10, 350), 20, 1e-9, 'wrap across north');
});

// ------------------------------------------------------------- knife edge
//
// Two independent anchors on the ITU-R P.526 approximation:
//   - grazing incidence (v = 0) is the textbook 6.02 dB
//   - the stated validity cut-off v = -0.78 is exactly where the loss reaches 0

test('knife-edge loss is 6.02 dB at grazing incidence', () => {
  close(knifeEdgeLossDb(0), 6.02, 0.02, 'J(0)');
});

test('knife-edge loss reaches exactly 0 dB at the v = -0.78 cut-off', () => {
  close(knifeEdgeLossDb(-0.78), 0, 0.02, 'J(-0.78)');
  assert.equal(knifeEdgeLossDb(-2), 0, 'well clear of the obstruction');
});

test('knife-edge loss increases monotonically with obstruction', () => {
  let prev = -Infinity;
  for (let v = -0.7; v <= 6; v += 0.1) {
    const j = knifeEdgeLossDb(v);
    assert.ok(j >= prev, `J not monotonic at v=${v.toFixed(1)}`);
    prev = j;
  }
  assert.ok(knifeEdgeLossDb(3) > 20, 'deep shadow should exceed 20 dB');
});

test('Fresnel parameter and first-zone radius are consistent', () => {
  const lambda = 0.1, d1 = 5000, d2 = 5000;
  const r1 = fresnelRadius(d1, d2, lambda);
  // An obstruction exactly on the first Fresnel zone edge gives v = sqrt(2).
  close(fresnelParameter(r1, d1, d2, lambda), Math.SQRT2, 1e-6, 'v at F1 edge');
});

// ----------------------------------------------------------- radar equation

test('received power follows the 1/R^4 law', () => {
  const base = { ptW: 1e6, gTx: 1e4, gRx: 1e4, lambdaM: 0.1, sigmaM2: 1, lossLin: 1 };
  const a = receivedPowerW({ ...base, rangeM: 10000 });
  const b = receivedPowerW({ ...base, rangeM: 20000 });
  close(a / b, 16, 1e-6, 'doubling range costs 12 dB');
});

test('radar equation reproduces a hand-worked example', () => {
  // Pt = 1.5 MW, G = 45 dB, 3 GHz, sigma = 1 m^2, R = 50 km, no losses.
  const g = Math.pow(10, 4.5);
  const pr = receivedPowerW({
    ptW: 1.5e6, gTx: g, gRx: g, lambdaM: wavelength(3e9),
    sigmaM2: 1, rangeM: 50000, lossLin: 1,
  });
  close(linToDb(pr), -89.2, 0.3, 'received power dBW');
  const pn = noisePowerW(1e6, 3);
  close(linToDb(pn), -140.9, 0.3, 'noise power dBW');
  close(linToDb(pr) - linToDb(pn), 51.7, 0.5, 'SNR dB');
});

test('noise power uses kT0BF', () => {
  close(noisePowerW(1e6, 0), BOLTZMANN * 290 * 1e6, 1e-24, 'kT0B');
  close(linToDb(noisePowerW(1e6, 3)) - linToDb(noisePowerW(1e6, 0)), 3, 1e-9,
    'noise figure adds directly');
});

// --------------------------------------------------------------- Albersheim

test('Albersheim reproduces the standard 13.1 dB case', () => {
  // Pd = 0.9, Pfa = 1e-6, single pulse, non-fluctuating target.
  close(albersheimSnrDb(0.9, 1e-6, 1), 13.1, 0.1, 'required single-pulse SNR');
});

test('Albersheim: integration lowers the per-pulse SNR requirement', () => {
  const one = albersheimSnrDb(0.8, 1e-6, 1);
  const twenty = albersheimSnrDb(0.8, 1e-6, 20);
  assert.ok(twenty < one - 8, 'integrating 20 pulses should save well over 8 dB');
});

test('Albersheim: higher Pd and lower Pfa both cost SNR', () => {
  assert.ok(albersheimSnrDb(0.9, 1e-6, 10) > albersheimSnrDb(0.5, 1e-6, 10));
  assert.ok(albersheimSnrDb(0.8, 1e-8, 10) > albersheimSnrDb(0.8, 1e-4, 10));
});

// ----------------------------------------------------------------- antenna

test('Gaussian beam is -3 dB at half the 3 dB beamwidth', () => {
  close(azimuthGainDb(0.7, 1.4, -60), -3, 0.01, 'az half-beamwidth');
  close(azimuthGainDb(0, 1.4, -60), 0, 1e-9, 'boresight');
});

test('azimuth pattern floors at the sidelobe level', () => {
  close(azimuthGainDb(45, 1.4, -30), -30, 1e-9, 'far out');
});

test('cosecant-squared region holds constant power for constant altitude', () => {
  const cfg = { elBeamwidthDeg: 4.8, elPeakDeg: 4, cscMaxDeg: 30, elSidelobeFloorDb: -50 };
  close(elevationGainDb(4, cfg), 0, 1e-9, 'gain peaks at the beam peak');
  // Constant-altitude target: range ~ h/sin(el), so two-way R^-4 costs
  // 40*log10(sin el2 / sin el1) while csc^2 gives back exactly that in gain.
  const el1 = 6, el2 = 12;
  const gainDelta = elevationGainDb(el2, cfg) - elevationGainDb(el1, cfg);
  const rangeGain = 40 * Math.log10(
    Math.sin(el2 * Math.PI / 180) / Math.sin(el1 * Math.PI / 180));
  close(2 * gainDelta + rangeGain, 0, 1e-6, 'csc^2 compensates R^-4 exactly');
});

// ----------------------------------------------------------------- Doppler

test('tip speed and Doppler shift', () => {
  // 60 m rotor radius at 12 rpm.
  close(tipSpeed(60, 12), 75.4, 0.1, 'tip speed m/s');
  // 80 m/s closing at 3 GHz -> 2*80*3e9/c = 1601.1 Hz.
  close(dopplerHz(80, 3e9), 2 * 80 * 3e9 / C, 1e-6, 'S-band Doppler');
  close(dopplerHz(80, 3e9), 1601, 1.5, 'S-band Doppler, round figures');
  // Doppler scales linearly with carrier frequency.
  close(dopplerHz(80, 1.3e9) / dopplerHz(80, 3e9), 1.3 / 3, 1e-9, 'scales with frequency');
});

test('blind speeds follow n*PRF*lambda/2', () => {
  close(blindSpeed(1000, 0.1, 1), 50, 1e-9, 'first blind speed');
  close(blindSpeed(1000, 0.1, 3), 150, 1e-9, 'third blind speed');
});

test('velocity folding wraps into the unambiguous interval', () => {
  // PRF 1000 Hz, lambda 0.1 -> span 50 m/s, so +/- 25 m/s unambiguous.
  close(foldVelocity(10, 1000, 0.1), 10, 1e-9, 'inside the interval');
  close(foldVelocity(60, 1000, 0.1), 10, 1e-9, 'one fold');
  close(foldVelocity(-60, 1000, 0.1), -10, 1e-9, 'negative fold');
});

test('MTI notch rejects near-zero Doppler and passes fast returns', () => {
  const cfg = { prfHz: 1000, lambdaM: 0.1, notchHalfWidthMs: 4, rejectionDb: 45 };
  close(mtiResponseDb(0, cfg), -45, 1e-9, 'stationary clutter fully rejected');
  close(mtiResponseDb(4, cfg), 0, 1e-9, 'at the notch edge');
  close(mtiResponseDb(20, cfg), 0, 1e-9, 'well inside the pass band');
  // A blind speed folds back into the notch and is rejected again.
  close(mtiResponseDb(50, cfg), -45, 1e-9, 'first blind speed is rejected');
});

test('a realistic blade tip passes straight through a conventional MTI notch', () => {
  const lambdaM = wavelength(2.8e9);
  const cfg = { prfHz: 1000, lambdaM, notchHalfWidthMs: 4, rejectionDb: 45 };
  const vTip = tipSpeed(60, 12); // ~75 m/s
  assert.ok(Math.abs(mtiResponseDb(vTip, cfg)) < 1,
    'blade tip Doppler is not rejected by a zero-velocity notch');
});

// -------------------------------------------------------------- rotor model

test('rotor solidity is a few per cent for a modern three-blade machine', () => {
  const s = rotorSolidity({ bladeCount: 3, bladeChordM: 2.6, bladeLengthM: 60, rotorRadiusM: 62 });
  assert.ok(s > 0.02 && s < 0.12, `solidity out of expected range: ${s}`);
  assert.ok(rotorBlockageLossDb(s) < 1.5, 'rotor alone should not be a hard screen');
  assert.ok(rotorBlockageLossDb(s) > 0, 'but it is not free either');
});

// ----------------------------------------------------------- radar plumbing

test('waveform relationships', () => {
  close(unambiguousRange(1000) / 1000, 149.9, 0.2, 'Ru km at 1 kHz PRF');
  close(rangeResolution(1e-6, 0), 150, 0.5, 'uncompressed 1 us -> 150 m');
  close(rangeResolution(100e-6, 1e6), 150, 0.5, 'compressed to 1 MHz -> 150 m');
  close(pulsesPerScan(1000, 1.4, 15), 1000 * (1.4 / 360) / 0.25, 1e-6, 'hits per scan');
});

test('far-field distance grows with aperture squared', () => {
  close(farFieldDistance(10, 0.1), 2000, 1e-6, '2D^2/lambda');
});

// ---------------------------------------------------------------- terrain

test('flat terrain returns the base height everywhere', () => {
  const t = createTerrain({ relief: 0, featureSize: 4000, seed: 7, baseHeight: 25 });
  close(t.heightAt(0, 0), 25, 1e-9, 'origin');
  close(t.heightAt(12345, -6789), 25, 1e-9, 'far away');
});

test('terrain is deterministic for a given seed', () => {
  const a = createTerrain({ relief: 200, featureSize: 3000, seed: 42, baseHeight: 0 });
  const b = createTerrain({ relief: 200, featureSize: 3000, seed: 42, baseHeight: 0 });
  close(a.heightAt(1234, 5678), b.heightAt(1234, 5678), 1e-12, 'same seed');
});

test('a screening ridge blocks line of sight, and lowering it restores sight', () => {
  const ae = effectiveEarthRadius(4 / 3);
  const site = { east: 0, north: 0, height: 20 };
  const target = { east: 0, north: 12000, height: 150 };
  const ridgeCfg = (height) => createTerrain({
    relief: 0, featureSize: 4000, seed: 1, baseHeight: 0,
    ridge: { enabled: true, east: 0, north: 6000, bearingDeg: 90, height, halfWidth: 800, length: 20000 },
  });

  const tall = profileObstruction(site, target, ridgeCfg(400), ae);
  assert.ok(tall.blocked, 'a 400 m ridge at mid-path should block a 150 m target');
  assert.ok(knifeEdgeLossDb(fresnelParameter(tall.clearance, tall.d1, tall.d2, 0.1)) > 20,
    'and should produce a deep diffraction loss');

  const low = profileObstruction(site, target, ridgeCfg(10), ae);
  assert.ok(!low.blocked, 'a 10 m ridge should not block it');
});

test('curvature alone blocks a distant low target over flat ground', () => {
  const ae = effectiveEarthRadius(4 / 3);
  const flat = createTerrain({ relief: 0, featureSize: 4000, seed: 1, baseHeight: 0 });
  const site = { east: 0, north: 0, height: 20 };
  // Horizon for 20 m + 30 m is about 18.4 + 22.6 = 41 km.
  const inside = profileObstruction(site, { east: 0, north: 35000, height: 30 }, flat, ae);
  const outside = profileObstruction(site, { east: 0, north: 60000, height: 30 }, flat, ae);
  assert.ok(!inside.blocked, 'inside the radio horizon');
  assert.ok(outside.blocked, 'beyond the radio horizon');
});

test('view geometry reports range, bearing and elevation', () => {
  const ae = effectiveEarthRadius(4 / 3);
  const g = viewGeometry({ east: 0, north: 0, height: 20 }, { east: 3000, north: 0, height: 1020 }, ae);
  close(g.bearing, 90, 1e-9, 'due east');
  close(g.ground, 3000, 1e-9, 'ground range');
  // 1000 m up over 3000 m out, less ~0.5 m of curvature drop.
  close(g.elevationDeg, Math.atan2(1000 - curvatureDrop(3000, ae), 3000) * 180 / Math.PI, 1e-6, 'elevation');
});
