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
  NATIONAL_GRID, HELMERT_OSGB36_TO_WGS84, AIRY_1830,
} from '../js/osgb.js';

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
