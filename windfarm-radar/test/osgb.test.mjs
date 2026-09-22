// British National Grid conversion.
//
// This exists because the importer used to read an easting and a northing as
// an offset from a nominal radar grid position. A UK schedule written in true
// OSGB36 grid references was therefore placed hundreds of kilometres from
// where it belonged, silently, unless the user happened to have set the radar
// grid position to match.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  osgb36ToGrid, gridToOsgb36, gridToWgs84, wgs84ToGrid, looksLikeNationalGrid,
  ambiguousWithIrishGrid, NATIONAL_GRID, HELMERT_OSGB36_TO_WGS84, AIRY_1830,
  VERTICAL_DATUM,
} from '../js/osgb.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const osGuide = readFileSync(resolve(root, 'docs/evidence/os-coordinate-systems-guide.txt'), 'utf8')
  .replace(/\s+/g, ' ');

// The worked example from the Ordnance Survey guide to coordinate systems.
// OSGB36 latitude and longitude, and the National Grid coordinates they
// project to. Obtained through a search result, not the document itself: every
// Ordnance Survey host is blocked from the environment this was built in.
const OS_EXAMPLE = {
  lat: 52 + 39 / 60 + 27.2531 / 3600,
  lon: 1 + 43 / 60 + 4.5177 / 3600,
  easting: 651409.903,
  northing: 313177.270,
};

test('the projection reproduces the Ordnance Survey worked example', () => {
  const g = osgb36ToGrid(OS_EXAMPLE.lat, OS_EXAMPLE.lon);
  // A millimetre. Anything looser would hide a wrong constant.
  assert.ok(Math.abs(g.easting - OS_EXAMPLE.easting) < 0.001,
    `easting ${g.easting.toFixed(4)} vs ${OS_EXAMPLE.easting}`);
  assert.ok(Math.abs(g.northing - OS_EXAMPLE.northing) < 0.001,
    `northing ${g.northing.toFixed(4)} vs ${OS_EXAMPLE.northing}`);
});

test('the inverse projection reproduces it too', () => {
  const o = gridToOsgb36(OS_EXAMPLE.easting, OS_EXAMPLE.northing);
  // A thousandth of an arcsecond is about 3 cm.
  assert.ok(Math.abs(o.lat - OS_EXAMPLE.lat) * 3600 < 0.001, `lat off by ${((o.lat - OS_EXAMPLE.lat) * 3600).toExponential(2)} arcsec`);
  assert.ok(Math.abs(o.lon - OS_EXAMPLE.lon) * 3600 < 0.001, `lon off by ${((o.lon - OS_EXAMPLE.lon) * 3600).toExponential(2)} arcsec`);
});

test('grid to WGS84 and back returns the same grid reference', () => {
  // Corners and middle of the area the tool covers, so a failure that only
  // appears far from the central meridian is caught.
  const points = [[200000, 100000], [400000, 400000], [651409, 313177],
    [100000, 900000], [500000, 1200000], [300000, 700000]];
  for (const [e, n] of points) {
    const w = gridToWgs84(e, n);
    const back = wgs84ToGrid(w.lat, w.lon);
    assert.ok(Math.abs(back.easting - e) < 0.01, `easting round trip off by ${(back.easting - e).toFixed(4)} m at ${e},${n}`);
    assert.ok(Math.abs(back.northing - n) < 0.01, `northing round trip off by ${(back.northing - n).toFixed(4)} m at ${e},${n}`);
  }
});

test('the datum shift moves a British point by the distance it should', () => {
  // OSGB36 and WGS84 differ across Great Britain by roughly 70 to 140 m. If a
  // translation sign were flipped this would be hundreds of metres or zero.
  for (const [e, n] of [[651409, 313177], [300000, 700000], [200000, 900000]]) {
    const o = gridToOsgb36(e, n);
    const w = gridToWgs84(e, n);
    const dN = (w.lat - o.lat) * 111132.92;
    const dE = (w.lon - o.lon) * 111412.84 * Math.cos(o.lat * Math.PI / 180);
    const shift = Math.hypot(dN, dE);
    assert.ok(shift > 50 && shift < 200,
      `datum shift at ${e},${n} is ${shift.toFixed(1)} m, which is not a British datum shift`);
  }
});

test('a known WGS84 position converts to a grid reference in the right place', () => {
  // An independent check that does not use the OS example: a WGS84 position in
  // Lincolnshire must land in the right 100 km square, and converting back
  // must return the position. If the datum shift were dropped entirely the
  // round trip would still pass, so the grid VALUE is what is checked here.
  const g = wgs84ToGrid(53.45008, -0.30825);
  assert.ok(g.easting > 500000 && g.easting < 560000, `easting ${g.easting.toFixed(0)}`);
  assert.ok(g.northing > 380000 && g.northing < 420000, `northing ${g.northing.toFixed(0)}`);
  const back = gridToWgs84(g.easting, g.northing);
  assert.ok(Math.abs(back.lat - 53.45008) < 1e-7);
  assert.ok(Math.abs(back.lon - -0.30825) < 1e-7);
});

test('a grid reference is told apart from a local offset', () => {
  assert.equal(looksLikeNationalGrid(651409, 313177), true);
  assert.equal(looksLikeNationalGrid(400000, 400000), true);
  // Metres from a site origin: small, and often negative.
  assert.equal(looksLikeNationalGrid(-4200, 1800), false);
  assert.equal(looksLikeNationalGrid(150, 300), false);
  // Outside the grid entirely, for example a UTM easting with a false origin.
  assert.equal(looksLikeNationalGrid(5400000, 600000), false);
  assert.equal(looksLikeNationalGrid(NaN, 100000), false);
});

test('the constants and their provenance are stated', () => {
  assert.equal(NATIONAL_GRID.E0, 400000);
  assert.equal(NATIONAL_GRID.N0, -100000);
  assert.equal(NATIONAL_GRID.F0, 0.9996012717);
  assert.equal(AIRY_1830.a, 6377563.396);
  // The accuracy claim must stay attached to the parameters that earn it.
  assert.match(HELMERT_OSGB36_TO_WGS84.accuracy, /few metres/);
  assert.match(HELMERT_OSGB36_TO_WGS84.accuracy, /OSTN15/);
});

// ------------------------------------------- what the OS guide does confirm

test('the three-part structure implemented here is the one the OS guide states', () => {
  // The page names the parts of the National Grid. If the implementation ever
  // drifts from that structure, this is the statement it drifted from.
  assert.ok(osGuide.includes('Airy 1830 ellipsoid'));
  assert.ok(osGuide.includes('a TRF called OSGB36'));
  assert.ok(osGuide.includes('Transverse Mercator map projection'));
  assert.equal(AIRY_1830.a, 6377563.396);
});

test('the guide supports doing this by transformation rather than by survey', () => {
  assert.ok(osGuide.includes('National Grid coordinates are nowadays determined by GNSS plus '
    + 'a transformation rather than theodolite triangulation'));
});

test('the guide does NOT contain the numbers, and the module says so', () => {
  // The honest half. This page gives the framework and none of the constants,
  // so the module must not claim otherwise once the page is in the repository.
  for (const n of ['0.9996012717', '400000', '446.448', '651409']) {
    assert.ok(!osGuide.includes(n), `the OS page does contain ${n} after all`);
  }
  const src = readFileSync(resolve(root, 'js/osgb.js'), 'utf8');
  assert.ok(src.includes('remain unverified against an OS'),
    'the module no longer says the numbers are unverified');
});

test('ETRS89 is kept distinct from WGS84', () => {
  // The OS page says OS Net uses ETRS89. Treating an ETRS89 position as WGS84
  // is an approximation, and the module has to say so rather than conflate
  // them silently.
  assert.ok(osGuide.includes('ETRS89'));
  const src = readFileSync(resolve(root, 'js/osgb.js'), 'utf8');
  assert.match(src, /ETRS89 IS NOT WGS84/);
});

// --------------------------------------------------------- vertical datum

test('the vertical datum mismatch is named, and scoped correctly', () => {
  // The OS page is what surfaced this: British map heights are ODN, and the
  // terrain this tool ships is EGM2008.
  assert.ok(osGuide.includes('Ordnance Datum Newlyn'));
  assert.ok(osGuide.includes('orthometric height only'));
  assert.match(VERTICAL_DATUM.toolUses, /EGM2008/);
  assert.match(VERTICAL_DATUM.britishMapsUse, /Ordnance Datum Newlyn/);
  // The scoping is the useful part: AGL is unaffected, AMSL is not.
  assert.equal(VERTICAL_DATUM.affectsAgl, false);
  assert.equal(VERTICAL_DATUM.affectsAmsl, true);
  assert.equal(VERTICAL_DATUM.corrected, false);
  assert.match(VERTICAL_DATUM.aglNote, /datum cancels/);
  // And it must not invent a figure it cannot support.
  assert.match(VERTICAL_DATUM.amslNote, /NOT quantified/);
  assert.ok(!/\d+(\.\d+)?\s*(m|metres|cm)\b/.test(VERTICAL_DATUM.amslNote.replace(/sub-metre/g, '')),
    'the vertical datum note states a figure it cannot support');
});
