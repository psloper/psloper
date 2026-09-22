// Measure how much each assumption moves the national screen, and print the
// block to paste into js/national.js.
//
// The map used to describe its assumptions with adjectives: one was "the
// single biggest lever", another reached "noticeably further". Those were
// asserted. This measures them, one assumption moved at a time with everything
// else held, so the panel can state a percentage instead of an adjective.
//
//   node tools/measure_sensitivity.mjs
import { readFileSync } from 'node:fs';
import { decodeBlock } from '../js/terrain.js';
import { nationalScreen, STATUS_GROUPS } from '../js/national.js';

const root = new URL('..', import.meta.url).pathname;
const allFarms = JSON.parse(readFileSync(root + 'data/uk-wind-farms.json', 'utf8'));
const radars = JSON.parse(readFileSync(root + 'data/uk-radar-sites.json', 'utf8'));
const manifest = JSON.parse(readFileSync(root + 'data/terrain/manifest.json', 'utf8'));
const buf = readFileSync(root + 'data/terrain/' + manifest.coarse.file);
const coarse = await decodeBlock(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const farms = allFarms.filter((f) => STATUS_GROUPS.active.match.includes(f.status));

const base = nationalScreen({ radars, farms, coarse });
const B = base.summary.visiblePairings;
const pct = (n) => Math.round(((n - B) / B) * 100);
const run = (over, terrain = coarse) =>
  nationalScreen({ radars, farms, coarse: terrain, assumptions: over }).summary.visiblePairings;

const out = {
  measuredOn: new Date().toISOString().slice(0, 10),
  baselinePairings: B,
  baselineFarms: farms.length,
  noTerrainPct: pct(run({}, null)),
  tipLowPct: pct(run({ tipHeightM: 100 })),
  tipHighPct: pct(run({ tipHeightM: 250 })),
  antennaLowPct: pct(run({ antennaHeightM: 10 })),
  antennaHighPct: pct(run({ antennaHeightM: 50 })),
  kLowPct: pct(run({ kFactor: 1.0 })),
  kHighPct: pct(run({ kFactor: 2.0 })),
  samplesCoarsePct: pct(run({ samples: 16 })),
  samplesFinePct: pct(run({ samples: 128 })),
};

// Position uncertainty is not an assumption but an error bar: shift every farm
// by the measured 1,100 m and count how many verdicts flip.
const M_LAT = 111132.92;
const dLon = 1100 / (111412.84 * Math.cos(55 * Math.PI / 180));
let worst = 0;
for (const [dLat, dLo] of [[1100 / M_LAT, 0], [-1100 / M_LAT, 0], [0, dLon], [0, -dLon]]) {
  const moved = farms.map((f) => ({ ...f, lat: f.lat + dLat, lon: f.lon + dLo }));
  const s = nationalScreen({ radars, farms: moved, coarse });
  let changed = 0;
  for (let i = 0; i < farms.length; i++) {
    if ((base.byFarm[i].seenBy > 0) !== (s.byFarm[i].seenBy > 0)) changed += 1;
  }
  worst = Math.max(worst, changed);
}
out.positionFlipPct = Number(((worst / farms.length) * 100).toFixed(1));
out.positionFlipCount = worst;

console.log(JSON.stringify(out, null, 2));
