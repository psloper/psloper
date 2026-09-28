// Tests that hold the model to measured data and to reference implementations.
//
// The values in here are not chosen: they are what the sources say. If a change
// makes one of these fail, the change is wrong, or the source has been re-read
// and the comment above the numbers needs rewriting first.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rotorRpm, DESIGN_TIP_SPEED_RATIO } from '../js/wind.js';
import { knifeEdgeLossDb, fresnelParameter } from '../js/rf.js';

// Median rotor speed by wind speed bin, running and generating machines only,
// from 1.07 million ten-minute SCADA records of a 2.5 MW machine rated at
// 14.6 rpm with a 90 m rotor. See calibration/README.md.
const FL2500_MEASURED = {
  3.0: 8.76, 3.5: 8.83, 4.0: 8.86, 4.5: 8.99, 5.0: 9.15, 5.5: 9.38,
  6.0: 9.80, 6.5: 10.51, 7.0: 11.33, 7.5: 12.17, 8.0: 12.93, 8.5: 13.52,
  9.0: 13.87, 9.5: 13.99, 10.0: 14.01, 11.0: 14.04, 12.0: 14.28,
  13.0: 14.56, 14.0: 14.59,
};
const FL2500_CFG = {
  cutInMs: 3.0, ratedMs: 12, cutOutMs: 25, ratedRpm: 14.6,
  idleFraction: 0.12, rotorRadiusM: 45, designTipSpeedRatio: 7.63,
};

test('the control curve tracks measured rotor speed across the whole band', () => {
  let worst = 0, sum = 0, n = 0;
  for (const [v, measured] of Object.entries(FL2500_MEASURED)) {
    const err = 100 * (rotorRpm(Number(v), FL2500_CFG) - measured) / measured;
    if (Math.abs(err) > Math.abs(worst)) worst = err;
    sum += Math.abs(err); n += 1;
  }
  // Before this was calibrated the worst error was 25 per cent low at 7.5 m/s.
  assert.ok(Math.abs(worst) < 6, `worst error ${worst.toFixed(1)}% exceeds 6%`);
  assert.ok(sum / n < 2, `mean absolute error ${(sum / n).toFixed(2)}% exceeds 2%`);
});

test('rotor speed saturates WELL BELOW the rated-power wind speed', () => {
  // This is the assumption the SCADA overturned. Rotor speed is limited by tip
  // speed, not by rated power, so it tops out around 9 m/s on a machine whose
  // rated POWER wind speed is 12 m/s.
  const rated = FL2500_CFG.ratedRpm;
  assert.ok(rotorRpm(9.5, FL2500_CFG) > 0.93 * rated,
    'rotor speed must be near rated by 9.5 m/s');
  assert.ok(rotorRpm(FL2500_CFG.ratedMs * 0.75, FL2500_CFG) > 0.9 * rated,
    'rotor speed must be near rated at three quarters of the rated-power wind speed');
  // And it must never exceed rated.
  for (let v = 0; v <= 30; v += 0.25) {
    assert.ok(rotorRpm(v, FL2500_CFG) <= rated + 1e-9, `overspeed at ${v} m/s`);
  }
});

test('a running machine never drops below its measured minimum speed', () => {
  // Measured: median 8.76 rpm against 14.6 rated in 3 to 5 m/s wind.
  for (let v = FL2500_CFG.cutInMs; v <= 5; v += 0.1) {
    const r = rotorRpm(v, FL2500_CFG);
    assert.ok(r >= 0.59 * FL2500_CFG.ratedRpm, `${r.toFixed(2)} rpm at ${v.toFixed(1)} m/s`);
  }
});

test('the measured design tip-speed ratio is what the model uses', () => {
  // Across 6.5 to 8.5 m/s the measured tip speed over wind speed is 7.63,
  // constant to within 0.3 per cent. Recompute it from the measured medians.
  const ratios = [6.5, 7.0, 7.5, 8.0].map((v) => {
    const omega = FL2500_MEASURED[v] * Math.PI / 30;
    return omega * FL2500_CFG.rotorRadiusM / v;
  });
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  assert.ok(Math.abs(mean - DESIGN_TIP_SPEED_RATIO) < 0.05,
    `measured tip-speed ratio ${mean.toFixed(3)} vs model ${DESIGN_TIP_SPEED_RATIO}`);
  for (const r of ratios) {
    assert.ok(Math.abs(r - mean) / mean < 0.005, `ratio ${r.toFixed(3)} strays from ${mean.toFixed(3)}`);
  }
});

// ---------------------------------------------------------------------------
// Diffraction, against the ITU's own code.
//
// Recommendation ITU-R P.526 could not be retrieved: itu.int is refused by this
// environment's network policy. The same knife-edge approximation appears as
// equation (13) of Recommendation ITU-R P.452, and the ITU-R Study Group 3
// reference implementation of P.452 is published as source. These two tests
// reproduce that code exactly and check this tool against it.
// Source: eeveetza/Py452, src/Py452/P452.py, function dl_bull, "Eq (13), (21)".
// ---------------------------------------------------------------------------

function ituKnifeEdgeDb(nu) {
  if (nu <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((nu - 0.1) ** 2 + 1) + nu - 0.1);
}

// Source: the same file, equation (20). Distances in km, wavelength in m.
function ituNu(hM, d1Km, d2Km, lambdaM) {
  return hM * Math.sqrt(0.002 * (d1Km + d2Km) / (lambdaM * d1Km * d2Km));
}

test('knife-edge loss matches the ITU reference implementation', () => {
  let worst = 0;
  for (let nu = -3; nu <= 6.0001; nu += 0.01) {
    const d = Math.abs(knifeEdgeLossDb(nu) - ituKnifeEdgeDb(nu));
    if (d > worst) worst = d;
  }
  assert.ok(worst < 1e-12, `max difference ${worst.toExponential(2)} dB`);
  // The cut-off and the grazing value the approximation gives.
  assert.equal(knifeEdgeLossDb(-0.78), 0);
  assert.ok(Math.abs(knifeEdgeLossDb(0) - 6.0329) < 5e-4);
});

test('the Fresnel-Kirchhoff parameter matches the ITU reference implementation', () => {
  const cases = [[10, 5, 5, 0.23], [50, 2, 18, 0.1], [150, 1, 30, 0.23],
    [3, 0.5, 0.5, 0.03], [200, 40, 60, 0.6]];
  for (const [h, d1, d2, lam] of cases) {
    const mine = fresnelParameter(h, d1 * 1000, d2 * 1000, lam);
    const itu = ituNu(h, d1, d2, lam);
    assert.ok(Math.abs(mine - itu) / itu < 1e-12,
      `h=${h} d1=${d1} d2=${d2}: ${mine} vs ${itu}`);
  }
});
