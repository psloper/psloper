// How much does each unverified CAP 670 assumption actually matter?
//
// None of the figures in js/cap670.js was read from the document. Rather than
// repeat that, this measures it: perturb one assumption at a time across a
// population of realistic geometries and count how many verdicts move, and how
// many move in the permissive direction, which is the expensive one.
//
// Run from the windfarm-radar directory: node tools/cap670_sensitivity.mjs

import * as C from '../js/cap670.js';

// Denser population, and tip heights / counts that actually straddle the
// triggers. The first run missed them: no case had a tip between 100 and
// 110 m, so changing the 110 m trigger could not flip anything.
const cases = [];
for (const rotor of [22, 30, 43, 52, 61, 71, 80, 92, 101, 110, 120, 136, 150, 180, 236]) {
  for (const km of [0.15, 0.3, 0.5, 0.7, 0.9, 1.2, 1.5, 2.0, 2.6, 3.4, 4.5, 6, 8, 10.5, 13, 16, 18, 22, 30]) {
    for (const n of [1, 4, 8, 9, 10, 11, 14, 30]) {
      for (const tip of [60, 95, 105, 109, 110, 111, 130, 185]) {
        cases.push({ rotor, d: km * 1000, n, tip });
      }
    }
  }
}

function verdict({ rotor, d, n, tip }, o = {}) {
  const cls = o.forceClass || C.classifyByRotor(rotor).key;
  const z = C.zonalCheck({ classKey: cls, distanceM: d, rotorDiameterM: rotor, angleDeg: o.angleDeg });
  const r = C.routeToCI({ zone: z.zone, tipHeightM: tip, turbineCount: n });
  return `${z.zone}|${r.outcome}`;
}
const base = cases.map((c) => verdict(c));
const rank = { red: 0, amber: 1, green: 2 };
const out = [];
const measure = (label, fn) => {
  let changed = 0, unsafe = 0, zoneChanged = 0;
  cases.forEach((c, i) => {
    const v = fn(c);
    if (v === base[i]) return;
    changed += 1;
    const [wz] = base[i].split('|'); const [nz] = v.split('|');
    if (wz !== nz) zoneChanged += 1;
    if (rank[nz] > rank[wz]) unsafe += 1;
  });
  out.push({ label, changed, pct: 100 * changed / cases.length, zoneChanged, unsafe });
};

// Several readings of the angle column, not just one.
const tipAngle = (c) => Math.atan(c.tip / c.d) * 180 / Math.PI;
measure('ANGLE: elevation to the tip, not a subtense', (c) => verdict(c, { angleDeg: tipAngle(c) }));
measure('ANGLE: subtense of the TIP HEIGHT, not the rotor',
  (c) => verdict(c, { angleDeg: C.subtenseDeg(c.tip, c.d) }));
measure('ANGLE: subtense of the TOWER width (5 m), not the rotor',
  (c) => verdict(c, { angleDeg: C.subtenseDeg(5, c.d) }));
measure('ANGLE: half the subtense (radius, not diameter)',
  (c) => verdict(c, { angleDeg: C.subtenseDeg(c.rotor / 2, c.d) }));

measure('TABLE 1: class one step TOO SMALL', (c) => {
  const i = C.CLASS_ORDER.indexOf(C.classifyByRotor(c.rotor).key);
  return verdict(c, { forceClass: C.CLASS_ORDER[Math.max(0, i - 1)] });
});
measure('TABLE 1: class one step TOO LARGE', (c) => {
  const i = C.CLASS_ORDER.indexOf(C.classifyByRotor(c.rotor).key);
  return verdict(c, { forceClass: C.CLASS_ORDER[Math.min(4, i + 1)] });
});

for (const f of ['redKm', 'greenKm', 'redDeg', 'greenDeg']) {
  measure(`THRESHOLD: ${f} out by 20%`, (c) => {
    const s = {}; for (const k in C.ZONES) { s[k] = C.ZONES[k][f]; C.ZONES[k][f] *= 1.2; }
    const v = verdict(c); for (const k in C.ZONES) C.ZONES[k][f] = s[k]; return v;
  });
}
measure('ROUTING: tip trigger 110 -> "110 or more" (inclusive)', (c) => {
  const s = C.CI_TRIGGERS.tipHeightM; C.CI_TRIGGERS.tipHeightM = 109.999;
  const v = verdict(c); C.CI_TRIGGERS.tipHeightM = s; return v;
});
measure('ROUTING: count trigger 10 -> "10 or more" (inclusive)', (c) => {
  const s = C.CI_TRIGGERS.turbineCount; C.CI_TRIGGERS.turbineCount = 9.999;
  const v = verdict(c); C.CI_TRIGGERS.turbineCount = s; return v;
});
for (const [l, o, k, to] of [
  ['UNUSED: VHF field strength 26 -> 30', C.CI_THRESHOLDS, 'fieldStrengthVhfDbuVm', 30],
  ['UNUSED: single-turbine C/I 20 -> 25 dB', C.CI_THRESHOLDS, 'singleTurbineDb', 25],
  ['UNUSED: GEN 01 radius 20 -> 15 km', C.GEN01, 'consultationRadiusKm', 15]]) {
  measure(l, (c) => { const s = o[k]; o[k] = to; const v = verdict(c); o[k] = s; return v; });
}

out.sort((a, b) => b.changed - a.changed);
console.log(`${cases.length} geometries\n`);
console.log('assumption, if wrong'.padEnd(52) + 'verdicts'.padStart(14) + 'zone flips'.padStart(12) + 'MORE permissive'.padStart(17));
for (const r of out) {
  console.log(r.label.padEnd(52) + `${r.pct.toFixed(1)}%`.padStart(14)
    + String(r.zoneChanged).padStart(12) + String(r.unsafe).padStart(17));
}
