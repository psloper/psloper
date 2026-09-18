// Correlate real UK wind farm locations against real UK civil radar site
// locations, using this tool's own propagation and radar maths.
//
// Run: node calibration/uk_sites.mjs
//
// Data provenance is recorded in calibration/UK-SITES.md. Nothing here is
// retrieved live; both inputs are snapshots vendored under data/.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EARTH_RADIUS_M, effectiveEarthRadius, horizonDistance } from '../js/geo.js';
import { receivedPowerW, noisePowerW, matchedBandwidth, linToDb, wavelength, dbToLin } from '../js/rf.js';
import { RADAR_PRESETS } from '../js/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, '..', 'data', f), 'utf8'));
const radars = load('uk-radar-sites.json');
const farms = load('uk-wind-farms.json');

// Great-circle distance. The tool's own scene maths is local-tangent-plane, so
// this is the one piece the tool does not already own.
function greatCircleM(aLat, aLon, bLat, bLon) {
  const p1 = aLat * Math.PI / 180, p2 = bLat * Math.PI / 180;
  const dp = p2 - p1, dl = (bLon - aLon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

const KM = 1000, NM = 1852;
const TIP_M = 150;           // representative modern onshore tip height
const TURBINE_RCS_DBSM = 40; // whole-machine screening value used by the tool

const ae = effectiveEarthRadius(4 / 3);

function pct(n, d) { return (100 * n / d).toFixed(1) + '%'; }
function quantile(sorted, q) { return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; }

// ---------------------------------------------------------------------------
// 1. How far is every UK wind farm from the nearest civil radar?
// ---------------------------------------------------------------------------
const pairs = farms.map((f) => {
  let best = null, bestEnroute = null;
  for (const r of radars) {
    const d = greatCircleM(f.lat, f.lon, r.lat, r.lon);
    if (!best || d < best.d) best = { d, r };
    if (r.role === 'en-route' && (!bestEnroute || d < bestEnroute.d)) bestEnroute = { d, r };
  }
  return { f, nearest: best, nearestEnroute: bestEnroute };
});

const dists = pairs.map((p) => p.nearest.d).sort((a, b) => a - b);
console.log('=== UK wind farms vs nearest civil radar site ===');
console.log(`farms: ${farms.length}   radar sites: ${radars.length}`);
console.log(`nearest-radar distance: min ${(dists[0] / KM).toFixed(1)} km, ` +
  `p10 ${(quantile(dists, 0.1) / KM).toFixed(0)}, median ${(quantile(dists, 0.5) / KM).toFixed(0)}, ` +
  `p90 ${(quantile(dists, 0.9) / KM).toFixed(0)}, max ${(dists[dists.length - 1] / KM).toFixed(0)} km`);

// Thresholds that appear in UK safeguarding practice. These are the numbers the
// tool cites as unverified; here they are only used to bin the distances.
for (const [label, limit] of [['10 km', 10 * KM], ['15 NM (SSR)', 15 * NM], ['30 km (MOD technical site)', 30 * KM]]) {
  const n = pairs.filter((p) => p.nearest.d <= limit).length;
  const mw = pairs.filter((p) => p.nearest.d <= limit).reduce((s, p) => s + p.f.mw, 0);
  console.log(`  within ${label}: ${n} farms (${pct(n, farms.length)}), ${mw.toFixed(0)} MW`);
}

// ---------------------------------------------------------------------------
// 2. Smooth-earth radar line of sight. This is an UPPER BOUND on how many farms
//    a radar can see: no terrain is applied, so nothing is ever shielded.
// ---------------------------------------------------------------------------
console.log('\n=== smooth-earth line of sight to a 150 m tip (k = 4/3, NO terrain) ===');
const losRows = pairs.map((p) => {
  const preset = RADAR_PRESETS[p.nearest.r.role === 'en-route' ? 'psr-enroute' : 'psr-terminal'];
  const losM = horizonDistance(preset.heightAgl, ae) + horizonDistance(TIP_M, ae);
  return { ...p, preset, losM, inLos: p.nearest.d <= losM };
});
const inLos = losRows.filter((r) => r.inLos);
console.log(`radio horizon: en-route antenna 20 m -> ${(horizonDistance(20, ae) / KM).toFixed(1)} km, ` +
  `terminal 12 m -> ${(horizonDistance(12, ae) / KM).toFixed(1)} km, 150 m tip -> ${(horizonDistance(TIP_M, ae) / KM).toFixed(1)} km`);
console.log(`farms inside nearest-radar line of sight: ${inLos.length} of ${farms.length} (${pct(inLos.length, farms.length)})`);
console.log(`  capacity inside: ${inLos.reduce((s, r) => s + r.f.mw, 0).toFixed(0)} MW of ${farms.reduce((s, f) => s + f.mw, 0).toFixed(0)} MW`);

// ---------------------------------------------------------------------------
// 3. Clutter-to-noise at the real range, using the tool's own range equation.
// ---------------------------------------------------------------------------
console.log('\n=== single-turbine clutter-to-noise at the real range (40 dBsm, main beam) ===');
const cnrs = [];
for (const row of inLos) {
  const p = row.preset;
  const lambdaM = wavelength(p.freqHz);
  const g = dbToLin(p.gainDbi);
  const pr = receivedPowerW({
    ptW: p.peakPowerW, gTx: g, gRx: g, lambdaM,
    sigmaM2: Math.pow(10, TURBINE_RCS_DBSM / 10),
    rangeM: row.nearest.d, lossLin: dbToLin(p.systemLossDb),
  });
  const pn = noisePowerW(matchedBandwidth(p.pulseWidthS, p.compressedBandwidthHz), p.noiseFigureDb);
  cnrs.push({ name: row.f.name, site: row.nearest.r.name, d: row.nearest.d, cnr: linToDb(pr / pn) });
}
cnrs.sort((a, b) => b.cnr - a.cnr);
const vals = cnrs.map((c) => c.cnr).sort((a, b) => a - b);
console.log(`clutter-to-noise across ${cnrs.length} in-sight farms: ` +
  `min ${vals[0].toFixed(0)} dB, median ${quantile(vals, 0.5).toFixed(0)} dB, max ${vals[vals.length - 1].toFixed(0)} dB`);
const over = cnrs.filter((c) => c.cnr > 60).length;
console.log(`  above 60 dB (well past any MTI rejection the presets model): ${over} (${pct(over, cnrs.length)})`);
console.log('\n  worst ten pairings:');
for (const c of cnrs.slice(0, 10)) {
  console.log(`   ${c.name.slice(0, 34).padEnd(34)} ${c.site.slice(0, 16).padEnd(16)} ${(c.d / KM).toFixed(1).padStart(6)} km  ${c.cnr.toFixed(0).padStart(3)} dB`);
}

// ---------------------------------------------------------------------------
// 4. Where the two radar sources disagree. Both name the same sites; they do
//    not agree on where they are.
// ---------------------------------------------------------------------------
console.log('\n=== positional disagreement between the two radar sources ===');
const both = radars.filter((r) => r.source_disagreement_m != null)
  .sort((a, b) => b.source_disagreement_m - a.source_disagreement_m);
console.log(`sites carried by both sources: ${both.length} of ${radars.length}`);
const sep = both.map((r) => r.source_disagreement_m).sort((a, b) => a - b);
console.log(`separation: min ${sep[0]} m, median ${quantile(sep, 0.5)} m, max ${sep[sep.length - 1]} m`);
for (const r of both.slice(0, 5)) {
  console.log(`   ${r.name.padEnd(18)} ${String(r.source_disagreement_m).padStart(5)} m  (also listed as ${r.alt_name})`);
}

// How much does a 1.5 km site error move the answer? Re-run the threshold count
// with every dual-sourced site shifted to its alternative position.
const shifted = farms.map((f) => {
  let best = Infinity;
  for (const r of radars) {
    const lat = r.alt_lat ?? r.lat, lon = r.alt_lon ?? r.lon;
    best = Math.min(best, greatCircleM(f.lat, f.lon, lat, lon));
  }
  return best;
});
const base30 = pairs.filter((p) => p.nearest.d <= 30 * KM).length;
const alt30 = shifted.filter((d) => d <= 30 * KM).length;
console.log(`\nfarms within 30 km: ${base30} using source A positions, ${alt30} using source B positions ` +
  `(${alt30 - base30 >= 0 ? '+' : ''}${alt30 - base30})`);
// Same per-site preset heights as the baseline, so the two counts compare.
const altLos = shifted.filter((d, i) => d <= losRows[i].losM).length;
console.log(`farms in line of sight: ${inLos.length} vs ${altLos} under the alternative positions`);
