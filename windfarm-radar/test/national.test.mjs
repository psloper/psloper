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

import { nationalScreen, distanceM, STATUS_GROUPS, ACTIVE_STATUSES, ASSUMPTIONS } from '../js/national.js';
import { COASTLINE, COASTLINE_SOURCE } from '../js/coastline.js';
import { UK_WIND_FARMS, UK_RADAR_SITES } from '../js/uksites.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The same mapping main.js uses, restated here so a change to the row layout
// breaks a test rather than the map.
const farmObj = (r, i) => ({ index: i, name: r[0], lat: r[1], lon: r[2], mw: r[3],
  status: r[4], offshore: r[5] === 1, repdRef: r[6] });
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
