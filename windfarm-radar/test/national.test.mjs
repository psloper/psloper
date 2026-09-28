// The national screen and the coastline it is drawn on.
//
// Two of these tests exist because of bugs that produced a plausible-looking
// map. The compact site arrays were read as objects, so every coordinate was
// undefined; the distance came out NaN; and `NaN > reach` is false, so every
// one of the 136,895 pairings fell through the range test and was reported
// visible. Nothing threw. The map just quietly said every radar could see
// every farm in the country.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { nationalScreen, distanceM, STATUS_GROUPS, ACTIVE_STATUSES, ASSUMPTIONS,
  SENSITIVITY } from '../js/national.js';
import { decodeBlock } from '../js/terrain.js';
import { METHOD_HTML } from '../js/report.js';
import { COASTLINE, COASTLINE_SOURCE } from '../js/coastline.js';
import { HEAT_RADIUS_KM } from '../js/ukmap.js';
import { UK_WIND_FARMS, UK_RADAR_SITES , farmRecord } from '../js/uksites.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The same mapping main.js uses, restated here so a change to the row layout
// breaks a test rather than the map.
// The SAME builder the application uses. A local copy of this mapping is how
// the test came to screen every farm at the fallback tip height while the
// measurement tool used the real ones, and the two disagreed by 108 pairings
// with nothing to say which was right.
const farmObj = (r, i) => farmRecord(i);
const radarObj = (r, i) => ({ index: i, name: r[0], role: r[1], lat: r[2], lon: r[3] });

test('the compact site rows map to the fields the screen reads', () => {
  const f = farmObj(UK_WIND_FARMS[0], 0);
  const r = radarObj(UK_RADAR_SITES[0], 0);
  // Positions must be real numbers in the right hemisphere, or every distance
  // downstream is NaN and the screen silently reports everything visible.
  for (const [what, o] of [['farm', f], ['radar', r]]) {
    assert.ok(Number.isFinite(o.lat), `${what} latitude is not a number`);
    assert.ok(Number.isFinite(o.lon), `${what} longitude is not a number`);
    assert.ok(o.lat > 49 && o.lat < 61, `${what} latitude ${o.lat} is outside these islands`);
    assert.ok(o.lon > -11 && o.lon < 3, `${what} longitude ${o.lon} is outside these islands`);
  }
  assert.equal(typeof f.status, 'string');
  assert.equal(typeof r.role, 'string');
  // A known site, checked by name so a reordered column is caught.
  const allanshill = UK_RADAR_SITES.map(radarObj).find((x) => x.name === 'Allanshill');
  assert.ok(allanshill, 'Allanshill is not in the radar list');
  assert.equal(allanshill.role, 'en-route');
  assert.ok(Math.abs(allanshill.lat - 57.64306) < 1e-4);
  assert.ok(Math.abs(allanshill.lon - -2.16528) < 1e-4);
});

test('every built-in site has a usable position', () => {
  const bad = [];
  UK_WIND_FARMS.map(farmObj).forEach((f) => {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) bad.push(`farm ${f.index}`);
  });
  UK_RADAR_SITES.map(radarObj).forEach((r) => {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) bad.push(`radar ${r.name}`);
  });
  assert.deepEqual(bad, [], 'sites with an unusable position');
});

test('an unusable coordinate is skipped, not counted as visible', () => {
  const radars = [{ name: 'good', lat: 55, lon: -3 }];
  const farms = [
    { name: 'near', lat: 55.05, lon: -3, status: 'Operational' },
    { name: 'no position', lat: undefined, lon: undefined, status: 'Operational' },
    { name: 'NaN', lat: NaN, lon: NaN, status: 'Operational' },
  ];
  const s = nationalScreen({ radars, farms, coarse: null });
  assert.equal(s.skipped, 2, 'the two unusable rows were not skipped');
  assert.equal(s.summary.visiblePairings, 1, 'a row with no position was counted visible');
});

test('a radar with no position poisons nothing', () => {
  const radars = [{ name: 'broken', lat: NaN, lon: NaN }, { name: 'good', lat: 55, lon: -3 }];
  const farms = [{ name: 'near', lat: 55.05, lon: -3, status: 'Operational' }];
  const s = nationalScreen({ radars, farms, coarse: null });
  assert.equal(s.byRadar[0].visible, 0);
  assert.equal(s.byRadar[1].visible, 1);
  assert.equal(s.skipped, 1);
});

test('range is bounded by the two horizons, and nothing beyond is tested', () => {
  const radars = [{ name: 'r', lat: 55, lon: -3 }];
  // One farm just inside the reach, one well outside it.
  const farms = [
    { name: 'inside', lat: 55 + 0.4, lon: -3, status: 'Operational' },
    { name: 'outside', lat: 55 + 3.0, lon: -3, status: 'Operational' },
  ];
  const s = nationalScreen({ radars, farms, coarse: null });
  assert.ok(s.reachM > 60000 && s.reachM < 80000, `reach ${s.reachM} is not the two horizons`);
  assert.equal(s.byRadar[0].beyond, 1, 'the distant farm was tested anyway');
  assert.equal(s.profiles, 1, 'a profile was run for a pairing out of reach');
});

test('distance agrees with a known separation', () => {
  // Fitful Head to Sumburgh is about 6 km; check the function against a pair
  // of coordinates a degree apart instead, which is arithmetic anyone can redo.
  const d = distanceM(55, -3, 56, -3);
  assert.ok(Math.abs(d - 111132.92) < 60, `one degree of latitude came out ${d.toFixed(0)} m`);
  const e = distanceM(55, -3, 55, -2);
  // One degree of longitude at 55 degrees north is about 63.9 km.
  assert.ok(Math.abs(e - 63900) < 400, `one degree of longitude came out ${e.toFixed(0)} m`);
});

test('terrain reduces what a radar can see, and the screen says which it used', () => {
  // Without a terrain block the screen must SAY it is flat rather than imply
  // real ground. This is the sentence the map prints.
  const s = nationalScreen({ radars: [{ name: 'r', lat: 55, lon: -3 }],
    farms: [{ name: 'f', lat: 55.2, lon: -3, status: 'Operational' }], coarse: null });
  assert.match(s.terrainUsed, /NONE/);
  assert.match(s.terrainUsed, /flat sea level/);
});

test('the status groups cover every status in the data, with no overlap', () => {
  const seen = new Set(UK_WIND_FARMS.map((r) => r[4]));
  const grouped = new Set();
  for (const g of Object.values(STATUS_GROUPS)) {
    for (const st of g.match) {
      assert.ok(!grouped.has(st), `${st} is in two groups`);
      grouped.add(st);
    }
  }
  const missing = [...seen].filter((st) => !grouped.has(st));
  assert.deepEqual(missing, [], 'statuses in the data that no group claims');
  assert.deepEqual(ACTIVE_STATUSES, STATUS_GROUPS.active.match);
});

test('every assumption the screen makes carries a note saying why it matters', () => {
  for (const key of ['tipHeightM', 'antennaHeightM', 'kFactor', 'maxRangeM', 'samples']) {
    assert.ok(Number.isFinite(ASSUMPTIONS[key]), `${key} is not a number`);
    const note = ASSUMPTIONS[key.replace(/M$|Factor$/, (m) => m) + 'Note']
      || ASSUMPTIONS[`${key.replace(/M$/, '')}Note`] || ASSUMPTIONS[`${key}Note`];
    assert.ok(note && note.length > 40, `${key} has no note explaining it`);
  }
});

// --------------------------------------------------------------- coastline

test('the coastline carries its source and licence', () => {
  assert.match(COASTLINE_SOURCE.source, /Natural Earth/);
  assert.match(COASTLINE_SOURCE.licence, /Public domain|CC0/);
  assert.match(COASTLINE_SOURCE.note, /not for measurement|not be used/i);
});

test('the outlying islands survived simplification', () => {
  // Simplifying a coastline is exactly how Shetland disappears. Each of these
  // is a separate ring far from the mainland, so if the area threshold or the
  // tolerance is ever raised, this is what fails.
  const boxes = {
    Shetland: [59.8, 60.9, -1.8, -0.7],
    Orkney: [58.7, 59.4, -3.5, -2.3],
    'Outer Hebrides': [57.4, 58.6, -7.8, -6.8],
    'Isle of Man': [54.0, 54.5, -4.9, -4.2],
    'Isles of Scilly': [49.8, 50.1, -6.5, -6.2],
    'Channel Islands': [49.1, 49.8, -2.8, -1.9],
    Ireland: [51.4, 55.4, -10.6, -8.0],
  };
  for (const [name, [la0, la1, lo0, lo1]] of Object.entries(boxes)) {
    const hit = COASTLINE.some((r) => r.some((p) => p[1] >= la0 && p[1] <= la1
      && p[0] >= lo0 && p[0] <= lo1));
    assert.ok(hit, `${name} is missing from the coastline`);
  }
});

test('the coastline is well formed and small enough to ship', () => {
  assert.ok(COASTLINE.length > 40, 'too few rings: islands have been dropped');
  for (const r of COASTLINE) {
    assert.ok(r.length >= 4, 'a ring with fewer than four points cannot be drawn');
    for (const p of r) {
      assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), 'a non-numeric coordinate');
      assert.ok(p[1] > 48 && p[1] < 62, `latitude ${p[1]} is outside these islands`);
      assert.ok(p[0] > -12 && p[0] < 3, `longitude ${p[0]} is outside these islands`);
    }
  }
  const bytes = readFileSync(resolve(root, 'js/coastline.js')).length;
  assert.ok(bytes < 300 * 1024, `coastline.js is ${(bytes / 1024).toFixed(0)} KB`);
});

// --------------------------------------------------- measured sensitivity

// The map states percentages for how far each assumption moves the answer.
// They were measured once by tools/measure_sensitivity.mjs, and a number
// measured once is a number that goes stale. This recomputes them against the
// shipped terrain and fails if any has drifted.
const manifest = JSON.parse(readFileSync(resolve(root, 'data/terrain/manifest.json'), 'utf8'));
const buf = readFileSync(resolve(root, 'data/terrain', manifest.coarse.file));
const coarse = await decodeBlock(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const activeFarms = UK_WIND_FARMS.map(farmObj).filter((f) => ACTIVE_STATUSES.includes(f.status));
const allRadars = UK_RADAR_SITES.map(radarObj);

test('the stated sensitivity figures still match the data', () => {
  const base = nationalScreen({ radars: allRadars, farms: activeFarms, coarse });
  const B = base.summary.visiblePairings;
  assert.equal(B, SENSITIVITY.baselinePairings, 'the baseline itself has moved');
  assert.equal(activeFarms.length, SENSITIVITY.baselineFarms);
  const pct = (over, terrain = coarse) => {
    const n = nationalScreen({ radars: allRadars, farms: activeFarms, coarse: terrain,
      assumptions: over }).summary.visiblePairings;
    return Math.round(((n - B) / B) * 100);
  };
  const checks = [
    ['noTerrainPct', pct({}, null)],
    ['tipLowPct', pct({ tipHeightM: 100 })],
    ['tipHighPct', pct({ tipHeightM: 250 })],
    ['antennaLowPct', pct({ antennaHeightM: 10 })],
    ['antennaHighPct', pct({ antennaHeightM: 50 })],
    ['kLowPct', pct({ kFactor: 1.0 })],
    ['kHighPct', pct({ kFactor: 2.0 })],
    ['samplesCoarsePct', pct({ samples: 16 })],
    ['samplesFinePct', pct({ samples: 128 })],
  ];
  const drift = checks.filter(([k, v]) => Math.abs(v - SENSITIVITY[k]) > SENSITIVITY.tolerance)
    .map(([k, v]) => `${k}: stated ${SENSITIVITY[k]}%, measured ${v}%`);
  assert.deepEqual(drift, [], 'stated sensitivity has drifted from the data');
});

test('the ranking the panel claims is the ranking the numbers give', () => {
  // The panel says terrain matters most, then tip height, then antenna, then
  // refraction, then sampling. If that order ever changes the text is wrong.
  const spread = (lo, hi) => Math.abs(SENSITIVITY[hi]) + Math.abs(SENSITIVITY[lo]);
  const tip = spread('tipLowPct', 'tipHighPct');
  const ant = spread('antennaLowPct', 'antennaHighPct');
  const k = spread('kLowPct', 'kHighPct');
  const samp = spread('samplesFinePct', 'samplesCoarsePct');
  assert.ok(SENSITIVITY.noTerrainPct > tip, 'terrain is no longer the biggest effect');
  assert.ok(tip > ant, 'tip height is no longer the biggest assumption');
  assert.ok(ant > k, 'antenna height no longer beats refraction');
  assert.ok(k > samp, 'refraction no longer beats sampling');
  assert.match(SENSITIVITY.order, /terrain at all/);
});

test('the assumption notes quote the measured figures, not adjectives', () => {
  // Each note must contain the number its own sensitivity entry carries, so a
  // measured value cannot be updated while the prose keeps the old claim.
  assert.match(ASSUMPTIONS.tipHeightNote, new RegExp(String(Math.abs(SENSITIVITY.tipHighPct))));
  assert.match(ASSUMPTIONS.antennaHeightNote, new RegExp(String(Math.abs(SENSITIVITY.antennaHighPct))));
  assert.match(ASSUMPTIONS.kFactorNote, new RegExp(String(Math.abs(SENSITIVITY.kHighPct))));
  assert.match(ASSUMPTIONS.samplesNote, new RegExp(String(Math.abs(SENSITIVITY.samplesCoarsePct))));
  assert.match(ASSUMPTIONS.positionNote, new RegExp(String(SENSITIVITY.positionFlipCount)));
  for (const note of [ASSUMPTIONS.tipHeightNote, ASSUMPTIONS.antennaHeightNote]) {
    assert.match(note, /MEASURED/, 'a note no longer says its figure was measured');
  }
});

test('the military radar statement is scoped to the built-in list', () => {
  // Importing air defence positions is supported, so the report must not go on
  // claiming there is no military radar "in this tool".
  assert.ok(!/No military radar is included in either set or in this tool/.test(METHOD_HTML),
    'the report still says no military radar is in this tool, which import makes false');
  assert.match(METHOD_HTML, /BUILT-IN list/);
  assert.match(METHOD_HTML, /air defence/i);
});

// ------------------------------------------------------------ the map layer

test('the heat kernel is a ground distance, not a number of pixels', () => {
  // It used to be 27 screen pixels, which meant a 42 km neighbourhood at the
  // national view and 1.1 km zoomed in: the same colour meant different things
  // at different zooms. Fixing it in kilometres is the whole point, so the
  // constant has to stay a distance and stay sane.
  assert.ok(Number.isFinite(HEAT_RADIUS_KM));
  assert.ok(HEAT_RADIUS_KM >= 5 && HEAT_RADIUS_KM <= 40,
    `a ${HEAT_RADIUS_KM} km kernel is not a sensible neighbourhood for this map`);
  const src = readFileSync(resolve(root, 'js/ukmap.js'), 'utf8');
  // The kernel must be derived from the projection scale, or it is back to
  // being a pixel count by another name.
  assert.match(src, /HEAT_RADIUS_KM \* 1000 \* this\.proj\.pxPerMetre\(\)/);
  // And it must stop drawing rather than fill the screen when zoomed past it.
  assert.match(src, /heatTooClose/);
});

test('the map dialog only becomes a flex container when it is open', () => {
  // A bare `display: flex` on a dialog beats the user-agent
  // `dialog:not([open]) { display: none }`. The closed dialog then stayed in
  // the layout and its header swallowed every click on the page behind it,
  // which made the whole tool unusable, not just the map.
  const css = readFileSync(resolve(root, 'css/style.css'), 'utf8');
  const rules = css.match(/^\.dlg-full[^{]*\{[^}]*\}/gm) || [];
  assert.ok(rules.length, 'the map dialog has no rules at all');
  for (const rule of rules) {
    if (/display:\s*flex/.test(rule)) {
      assert.match(rule, /\[open\]/,
        `display:flex on a dialog must be scoped to [open]: ${rule.split('\n')[0]}`);
    }
  }
});

test('the active count is separate from the all-records count', () => {
  // The panel said "Active farms in line of sight" while the screen ran over
  // every planning record, refused and withdrawn included. Lowther Hill was
  // reported as seeing 288 "active" farms when the real figure is 89.
  const radars = [{ name: 'r', lat: 55, lon: -3 }];
  const farms = [
    { name: 'a', lat: 55.05, lon: -3, status: 'Operational' },
    { name: 'b', lat: 55.06, lon: -3, status: 'Under Construction' },
    { name: 'c', lat: 55.07, lon: -3, status: 'Application Refused' },
    { name: 'd', lat: 55.08, lon: -3, status: 'Application Withdrawn' },
  ];
  const s2 = nationalScreen({ radars, farms, coarse: null });
  assert.equal(s2.byRadar[0].visible, 4, 'every record should be screened');
  assert.equal(s2.byRadar[0].visibleActive, 2, 'only two of those are active');
  assert.equal(s2.summary.farms, 4);
  assert.equal(s2.summary.activeFarms, 2);
});
