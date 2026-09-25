// How much did reading CAP 670 actually change?
//
// Until the document arrived, js/cap670.js ran on figures transcribed from a
// third-party summary, with the angle, Table 1 and most of Table 3 inferred.
// Reading the document corrected four things. This measures the difference
// rather than asserting it: run a population of realistic geometries through
// the superseded logic and through the current logic and count how many
// verdicts move, and which way.
//
// The superseded logic is reimplemented here, not imported, because it has
// been removed from the module. It is kept in one clearly labelled function so
// nothing else can reach it.
//
// Run from the windfarm-radar directory:
//   node tools/cap670_correction_impact.mjs

import * as C from '../js/cap670.js';

// ---------------------------------------------------------------------------
// THE SUPERSEDED LOGIC. Do not use this for anything. It is here to be
// measured against, and it is wrong in the four ways CORRECTIONS records.
// ---------------------------------------------------------------------------

const OLD_GREEN_KM = { small: 1.8, medium: 3.5, large: 5.8, reference: 10.5, 'large-industrial': 17.2 };
const OLD_ROTOR_BANDS = [['large-industrial', 120], ['reference', 92], ['large', 61], ['medium', 43]];
const RANK = { red: 0, amber: 1, green: 2 };

function oldClassify(rotorM) {
  for (const [k, lower] of OLD_ROTOR_BANDS) if (rotorM >= lower) return k;
  return 'small';
}

function oldSubtenseDeg(widthM, rangeM) {
  if (!(rangeM > 0)) return 180;
  return 2 * Math.atan(widthM / (2 * rangeM)) * 180 / Math.PI;
}

function oldZone({ classKey, distanceM, rotorDiameterM }) {
  const z = C.ZONES[classKey];
  const km = distanceM / 1000;
  const angle = oldSubtenseDeg(rotorDiameterM, distanceM);
  const byDistance = km <= z.redKm ? 'red' : km >= OLD_GREEN_KM[classKey] ? 'green' : 'amber';
  const byAngle = angle >= z.redDeg ? 'red' : angle <= z.greenDeg ? 'green' : 'amber';
  if (byDistance === byAngle) return byDistance;
  if (byDistance === 'red' && byAngle === 'green') return 'green';   // the one known cell
  return RANK[byDistance] < RANK[byAngle] ? byDistance : byAngle;    // "take the worse"
}

// ---------------------------------------------------------------------------
// Population. Real machines, real separations, real site heights.
// ---------------------------------------------------------------------------

const cases = [];
for (const rotor of [15, 22, 30, 43, 52, 61, 71, 80, 92, 101, 110, 126, 150]) {
  const hub = Math.round(rotor * 0.85);
  const tip = hub + rotor / 2;
  for (const km of [0.15, 0.3, 0.5, 0.7, 0.9, 1.2, 1.5, 2.0, 2.6, 3.4, 4.5, 6, 8, 10.5, 13, 16, 18, 22, 30]) {
    for (const n of [1, 4, 8, 10, 11, 30]) {
      // Ground below, level with, and above the radio site.
      for (const drop of [-80, -20, 0, 20, 80]) {
        cases.push({ rotor, hub, tip, d: km * 1000, n, turbineGroundM: 60 + drop, siteBaseM: 60 });
      }
    }
  }
}

const newVerdict = (c) => {
  const cls = C.classifyTurbine({ hubHeightM: c.hub, rotorDiameterM: c.rotor, tipHeightM: c.tip }).key;
  const z = C.zonalCheck({
    classKey: cls,
    distanceM: c.d,
    angleDeg: C.hubElevationDeg(c.turbineGroundM + c.hub, c.siteBaseM, c.d),
  });
  const r = C.routeToCI({ zone: z.zone, tipHeightM: c.tip, turbineCount: c.n });
  return { cls, zone: z.zone, outcome: r.outcome };
};

const oldVerdict = (c) => {
  const cls = oldClassify(c.rotor);
  const zone = oldZone({ classKey: cls, distanceM: c.d, rotorDiameterM: c.rotor });
  const r = C.routeToCI({ zone, tipHeightM: c.tip, turbineCount: c.n });
  return { cls, zone, outcome: r.outcome };
};

let zoneMoved = 0, outcomeMoved = 0, classMoved = 0;
let oldHarsher = 0, oldPermissive = 0;
const moves = new Map();

for (const c of cases) {
  const a = oldVerdict(c);
  const b = newVerdict(c);
  if (a.cls !== b.cls) classMoved += 1;
  if (a.outcome !== b.outcome) outcomeMoved += 1;
  if (a.zone !== b.zone) {
    zoneMoved += 1;
    if (RANK[a.zone] < RANK[b.zone]) oldHarsher += 1; else oldPermissive += 1;
    const k = `${a.zone} -> ${b.zone}`;
    moves.set(k, (moves.get(k) || 0) + 1);
  }
}

const pct = (x) => `${(100 * x / cases.length).toFixed(1)}%`;
console.log(`${cases.length} geometries: rotor 15 to 150 m, 0.15 to 30 km, 1 to 30 turbines,`);
console.log('turbine ground 80 m below to 80 m above the radio site base level.\n');
console.log(`Turbine class changed           ${String(classMoved).padStart(6)}  ${pct(classMoved)}`);
console.log(`Zonal verdict changed           ${String(zoneMoved).padStart(6)}  ${pct(zoneMoved)}`);
console.log(`Routing outcome changed         ${String(outcomeMoved).padStart(6)}  ${pct(outcomeMoved)}`);
console.log(`\n  of the zonal changes:`);
console.log(`    the old logic was HARSHER    ${String(oldHarsher).padStart(6)}  ${pct(oldHarsher)}`);
console.log(`    the old logic was PERMISSIVE ${String(oldPermissive).padStart(6)}  ${pct(oldPermissive)}`);
console.log('\nWhere the verdicts went:');
for (const [k, v] of [...moves].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} ${String(v).padStart(6)}  ${pct(v)}`);
}

// A permissive change is the expensive direction to have been wrong in, so say
// plainly which way the correction went overall.
console.log(oldPermissive > oldHarsher
  ? '\nThe tool was previously more PERMISSIVE than CAP 670 on balance. That is the '
    + 'expensive direction: it would have said no objection where the document objects.'
  : '\nThe tool was previously HARSHER than CAP 670 on balance. It would have raised '
    + 'objections the document does not require.');
