// End-to-end data integrity sweep. Every check prints a verdict and a number.
// End-to-end data integrity sweep, kept in the repo so it can be re-run.
//
//   node tools/systems_check.mjs
//
// It is deliberately separate from the unit tests: these are whole-dataset
// invariants, and one of them caught the schema change when the territory
// field was added, by asserting the row width the generator writes.

import { UK_WIND_FARMS, UK_RADAR_SITES, LIVE_STATUSES, farmRecord, radarRecord,
  liveFarmIndices, farmAttributeCoverage, POSITION_UNCERTAINTY_M,
  territoryCounts, offshoreFlagConflicts } from '../js/uksites.js';
import { STATUS_GROUPS, ASSUMPTIONS, SENSITIVITY } from '../js/national.js';
import { TARGET_PRESETS, TURBINE_PRESETS, RADAR_PRESETS, RADAR_MOUNTS, TARGET_GROUPS,
  BLADE_CHORD_PROVENANCE } from '../js/model.js';

let fails = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) fails += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

console.log('--- wind farm table ---');
ok(UK_WIND_FARMS.length === 2694, 'record count', `${UK_WIND_FARMS.length}`);
let badLat = 0, badLon = 0, badMw = 0, badRef = 0, badRow = 0;
for (const f of UK_WIND_FARMS) {
  if (f.length !== 12) badRow += 1;
  if (!Number.isFinite(f[1]) || f[1] < 49 || f[1] > 62) badLat += 1;   // UK + Ireland
  if (!Number.isFinite(f[2]) || f[2] < -11 || f[2] > 3) badLon += 1;
  if (!Number.isFinite(f[3]) || f[3] < 0 || f[3] > 5000) badMw += 1;
  if (!/^\d+$/.test(String(f[6]))) badRef += 1;
}
ok(badRow === 0, 'every row has 12 fields', `${badRow} bad`);
ok(badLat === 0, 'latitudes inside UK and Ireland', `${badLat} outside`);
ok(badLon === 0, 'longitudes inside UK and Ireland', `${badLon} outside`);
ok(badMw === 0, 'capacities 0..5000 MW', `${badMw} outside`);
ok(badRef === 0, 'REPD references numeric', `${badRef} bad`);

const refs = UK_WIND_FARMS.map((f) => String(f[6]));
ok(new Set(refs).size === refs.length, 'REPD references unique',
  `${refs.length - new Set(refs).size} duplicates`);

const statuses = [...new Set(UK_WIND_FARMS.map((f) => f[4]))];
const claimed = new Set(Object.values(STATUS_GROUPS).flatMap((g) => g.match));
const unclaimed = statuses.filter((s) => !claimed.has(s));
ok(unclaimed.length === 0, 'every status belongs to a group', unclaimed.join(', ') || '');

console.log('\n--- turbine attributes (WINDEL merge) ---');
const cov = farmAttributeCoverage();
ok(cov.live === 1447, 'live farms', `${cov.live}`);
ok(cov.turbines === 15846, 'turbines counted', `${cov.turbines}`);
ok(cov.withCount / cov.live > 0.85, 'turbine count coverage',
  `${(100 * cov.withCount / cov.live).toFixed(0)}%`);
ok(cov.withHeight / cov.live > 0.25, 'tip height coverage',
  `${(100 * cov.withHeight / cov.live).toFixed(0)}%`);
// The builder and the raw table must agree, or a field is being dropped.
let bCount = 0, bHeight = 0, bTurb = 0;
for (const i of liveFarmIndices()) {
  const r = farmRecord(i);
  if (r.turbines) { bCount += 1; bTurb += r.turbines; }
  if (r.tipHeightM) bHeight += 1;
}
ok(bCount === cov.withCount && bHeight === cov.withHeight && bTurb === cov.turbines,
  'farmRecord agrees with the raw table', `${bCount}/${bHeight}/${bTurb}`);
let zeroLeak = 0, badTip = 0;
for (const i of liveFarmIndices()) {
  const r = farmRecord(i);
  if (r.turbines === 0 || r.tipHeightM === 0 || r.turbineMw === 0) zeroLeak += 1;
  if (r.tipHeightM !== null && (r.tipHeightM < 20 || r.tipHeightM > 400)) badTip += 1;
}
ok(zeroLeak === 0, 'no zero leaks through as a real figure', `${zeroLeak}`);
ok(badTip === 0, 'tip heights 20..400 m', `${badTip} outside`);

console.log('\n--- radar sites ---');
ok(UK_RADAR_SITES.length === 55, 'radar count', `${UK_RADAR_SITES.length}`);
let rBad = 0;
for (let i = 0; i < UK_RADAR_SITES.length; i += 1) {
  const r = radarRecord(i);
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) rBad += 1;
  if (r.lat < 49 || r.lat > 62 || r.lon < -11 || r.lon > 3) rBad += 1;
}
ok(rBad === 0, 'radar positions inside the region', `${rBad} bad`);
const roles = [...new Set(UK_RADAR_SITES.map((r) => r[1]))].sort();
ok(roles.join(',') === 'aerodrome,en-route,unclassified', 'roles as expected', roles.join(','));

console.log('\n--- presets ---');
ok(Object.keys(TARGET_PRESETS).length === 42, 'target presets', `${Object.keys(TARGET_PRESETS).length}`);
const ungrouped = Object.values(TARGET_PRESETS).filter((t) => !TARGET_GROUPS.includes(t.group));
ok(ungrouped.length === 0, 'every target preset is in a listed group', `${ungrouped.length}`);
let tBad = 0;
for (const [k, t] of Object.entries(TARGET_PRESETS)) {
  if (!(t.spanM > 0 && t.lengthM > 0 && Number.isFinite(t.rcsDbsm))) { tBad += 1; console.log('    bad:', k); }
}
ok(tBad === 0, 'target dimensions and RCS present', `${tBad} bad`);
let uBad = 0;
for (const [k, t] of Object.entries(TURBINE_PRESETS)) {
  if (!(t.hubHeightM > 0 && t.rotorDiameterM > 0 && t.bladeChordM > 0 && t.rpm > 0)) { uBad += 1; console.log('    bad:', k); }
}
ok(uBad === 0, 'turbine presets complete', `${Object.keys(TURBINE_PRESETS).length} machines`);
let radBad = 0;
for (const [k, r] of Object.entries(RADAR_PRESETS)) {
  if (!(r.freqHz > 0 && r.azBeamwidthDeg > 0 && r.elBeamwidthDeg > 0 && r.peakPowerW > 0)) { radBad += 1; console.log('    bad:', k); }
}
ok(radBad === 0, 'radar presets complete', `${Object.keys(RADAR_PRESETS).length} radars`);
ok(Object.keys(RADAR_MOUNTS).length >= 7, 'radar mounts', `${Object.keys(RADAR_MOUNTS).length}`);

console.log('\n--- territories ---');
const tc = territoryCounts();
ok(Object.values(tc).reduce((a, b) => a + b, 0) === UK_WIND_FARMS.length,
  'every farm lands in exactly one territory bucket');
ok(tc.Scotland > 1000 && tc.England > 700, 'territory counts look right',
  `Scotland ${tc.Scotland}, England ${tc.England}`);
const oc = offshoreFlagConflicts();
const nConf = oc.onshoreInSea.length + oc.offshoreOnLand.length;
ok(nConf > 0 && nConf < UK_WIND_FARMS.length * 0.01,
  'offshore flag vs geography disagreements stay rare', `${nConf}`);
let radTagged = 0;
for (let i = 0; i < UK_RADAR_SITES.length; i += 1) if (radarRecord(i).territory) radTagged += 1;
ok(radTagged >= UK_RADAR_SITES.length - 2, 'radars are tagged', `${radTagged}/${UK_RADAR_SITES.length}`);

console.log('\n--- stated provenance ---');
ok(POSITION_UNCERTAINTY_M === 1100, 'measured position uncertainty carried', `${POSITION_UNCERTAINTY_M} m`);
ok(BLADE_CHORD_PROVENANCE.status === 'unverified' && BLADE_CHORD_PROVENANCE.affectsResults === true,
  'blade chord still flagged as unverified and result-affecting');
ok(ASSUMPTIONS.tipHeightNote.includes('19') && ASSUMPTIONS.tipHeightNote.includes('33'),
  'tip height note quotes the re-measured figures');
ok(SENSITIVITY.baselinePairings === 910, 'sensitivity baseline', `${SENSITIVITY.baselinePairings}`);

console.log(fails === 0 ? `\nALL CHECKS PASSED` : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
