// Does the terrain choice change what the tool CONCLUDES, or only what it draws?
//
// Two comparisons across real UK radar-to-farm pairings:
//   1. the shipped max-pooled data against a nearest-neighbour control set
//   2. real terrain against the synthetic surface
//
// Both are run through the full analysis and compared on the outputs a user
// acts on: how many turbines the radar can see, how many plots reach the
// display, and the worst detection margin.
//
// The nearest-neighbour control set is not committed. Rebuild it by running
// tools/build_terrain.py against a resample that takes the nearest source post
// instead of the highest, and point NN at the output.
//
// Run from the windfarm-radar directory:
//   node tools/terrain_verdict_impact.mjs
import { readFile } from 'node:fs/promises';
import { defaultScenario, mergeDeep } from '../js/model.js';
import { analyse } from '../js/analysis.js';
import { loadTerrain, createRealTerrain } from '../js/terrain.js';
import { UK_WIND_FARMS, pairingGeometry, liveFarmIndices } from '../js/uksites.js';

const SHIP = new URL('../data/terrain/', import.meta.url).pathname;
// Point this at a nearest-neighbour control set to reproduce the comparison.
const NN = process.env.NN_TERRAIN || '';
const reader = (dir) => async (p) => {
  const b = await readFile(dir + p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const live = liveFarmIndices();
// A deterministic spread across the live UK fleet.
const picks = [];
for (let k = 0; k < 900; k++) picks.push(live[Math.floor(k * live.length / 900)]);

const rows = [];
for (const idx of picks) {
  const geom = pairingGeometry(idx);
  if (!geom || !Number.isFinite(geom.radar.lat) || geom.rangeM > 22000 || geom.rangeM < 2000) continue;
  const base = mergeDeep(defaultScenario(), {
    site: { originLat: geom.farm.lat, originLon: geom.farm.lon,
            radarLat: geom.radar.lat, radarLon: geom.radar.lon },
    farm: { centreBearingDeg: Math.round(geom.bearingDeg),
            centreRangeM: Math.round(geom.rangeM / 250) * 250 },
  });
  const out = {};
  for (const [tag, dir] of (NN ? [['ship', SHIP], ['nn', NN]] : [['ship', SHIP]])) {
    try {
      const L = await loadTerrain({ lat: geom.radar.lat, lon: geom.radar.lon,
        halfExtentM: 45000, fetchFn: reader(dir) });
      const t = createRealTerrain({ anchorLat: geom.radar.lat, anchorLon: geom.radar.lon,
        coarse: L.coarse, blocks: L.blocks });
      const sc = mergeDeep(base, { environment: { terrain: { source: 'real' } } });
      const r = analyse(sc, { skipCoverage: true, realTerrain: t });
      out[tag] = {
        los: r.summary.visibleCount,
        n: r.turbineResults.length,
        margin: r.summary.worstPoint.marginDb,
        plots: r.summary.displayedPlotCount,
      };
    } catch (e) { if (!globalThis.__shown) { console.error("load error:", e.message); globalThis.__shown = 1; } out[tag] = null; }
  }
  const syn = analyse(base, { skipCoverage: true });
  out.syn = { los: syn.summary.visibleCount, n: syn.turbineResults.length,
    margin: syn.summary.worstPoint.marginDb, plots: syn.summary.displayedPlotCount };
  if (out.ship && (!NN || out.nn)) rows.push({ name: geom.farm.name, km: geom.rangeM / 1000, ...out });
}

const losDiff = rows.filter((r) => r.ship.los !== r.nn.los);
const plotDiff = rows.filter((r) => r.ship.plots !== r.nn.plots);
const vsSyn = rows.filter((r) => r.ship.los !== r.syn.los);
const marg = rows.map((r) => r.ship.margin - r.nn.margin).filter(Number.isFinite);
const absMarg = marg.map(Math.abs).sort((a, b) => a - b);

console.log(`${rows.length} real UK pairings, radar to farm, each run three ways\n`);
console.log('MAX-POOLED (shipped) vs NEAREST-NEIGHBOUR, same data, same resolution:');
console.log(`  turbines in line of sight differ   ${losDiff.length}  (${(100*losDiff.length/rows.length).toFixed(0)}%)`);
console.log(`  turbine plots per scan differ      ${plotDiff.length}  (${(100*plotDiff.length/rows.length).toFixed(0)}%)`);
console.log(`  worst detection margin, median shift ${absMarg.length ? absMarg[absMarg.length>>1].toFixed(2) : 'n/a'} dB, max ${absMarg.length ? absMarg[absMarg.length-1].toFixed(2) : 'n/a'} dB`);
const nnSees = rows.filter((r) => r.nn.los > r.ship.los).length;
console.log(`  nearest-neighbour saw MORE turbines (beam looked clear) in ${nnSees} cases`);
console.log(`\nREAL (shipped) vs SYNTHETIC terrain:`);
console.log(`  turbines in line of sight differ   ${vsSyn.length}  (${(100*vsSyn.length/rows.length).toFixed(0)}%)`);

const tally = (k) => { const m = {}; for (const r of rows) { const key = r[k].los + '/' + r[k].n; m[key]=(m[key]||0)+1; } return m; };
console.log('\nline-of-sight distribution (how many of the fleet the radar can see):');
for (const k of ['syn','ship','nn']) console.log('  ' + k.padEnd(6), JSON.stringify(tally(k)));
const mdiff = rows.map(r=>({n:r.name, d:r.ship.margin-r.syn.margin})).filter(x=>Math.abs(x.d)>0.5);
console.log('\nworst detection margin, real vs synthetic: ' + mdiff.length + ' of ' + rows.length + ' pairings shift by more than 0.5 dB');
for (const x of mdiff.sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,5)) console.log('  ' + x.n.slice(0,44).padEnd(46) + (x.d>0?'+':'') + x.d.toFixed(1) + ' dB');
console.log('\nworst disagreements between the two resamples:');
for (const r of losDiff.sort((a,b)=>Math.abs(b.ship.los-b.nn.los)-Math.abs(a.ship.los-a.nn.los)).slice(0,5)) {
  console.log(`  ${r.name.slice(0,40).padEnd(42)} ${r.km.toFixed(1).padStart(5)} km  max-pool ${r.ship.los}/${r.ship.n} vs nearest ${r.nn.los}/${r.nn.n}`);
}
