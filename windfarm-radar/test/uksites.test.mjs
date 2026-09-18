// The UK site data is real data with real limits. These tests hold it to both:
// that the numbers are sane, and that the limits are stated where a user sees
// them rather than buried.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UK_WIND_FARMS, UK_RADAR_SITES, UK_MILITARY_RADAR_NOTE,
  greatCircleM, initialBearingDeg, nearestRadar, pairingGeometry, farmRecord, radarRecord,
} from '../js/uksites.js';

test('every record sits inside the UK and Ireland bounding box', () => {
  for (const [name, lat, lon] of UK_WIND_FARMS) {
    assert.ok(lat > 49 && lat < 61.5, `${name} latitude ${lat}`);
    assert.ok(lon > -11 && lon < 2.5, `${name} longitude ${lon}`);
  }
  for (const [name, , lat, lon] of UK_RADAR_SITES) {
    assert.ok(lat > 49 && lat < 61.5, `${name} latitude ${lat}`);
    assert.ok(lon > -11 && lon < 2.5, `${name} longitude ${lon}`);
  }
});

test('capacities and roles are plausible', () => {
  for (const [name, , , mw] of UK_WIND_FARMS) {
    assert.ok(mw > 0 && mw <= 2000, `${name} capacity ${mw} MW`);
  }
  const roles = new Set(UK_RADAR_SITES.map((r) => r[1]));
  assert.deepEqual([...roles].sort(), ['aerodrome', 'en-route', 'unclassified']);
  assert.ok(UK_RADAR_SITES.filter((r) => r[1] === 'en-route').length >= 15);
});

test('great-circle distance and bearing agree with known separations', () => {
  // Claxby to Great Dun Fell, two NATS en-route sites far enough apart to check.
  const claxby = UK_RADAR_SITES.find((r) => r[0] === 'Claxby');
  const gdf = UK_RADAR_SITES.find((r) => r[0] === 'Great Dun Fell');
  const d = greatCircleM(claxby[2], claxby[3], gdf[2], gdf[3]);
  assert.ok(d > 180000 && d < 200000, `Claxby to Great Dun Fell ${(d / 1000).toFixed(1)} km`);
  // A due-north step must bear 000, a due-east step 090 at this latitude.
  assert.ok(Math.abs(initialBearingDeg(53, -1, 54, -1)) < 1e-6);
  assert.ok(Math.abs(initialBearingDeg(53, -1, 53, 0) - 90) < 0.5);
  // The function is a distance, so it is symmetric and zero on itself.
  assert.equal(greatCircleM(53, -1, 53, -1), 0);
  assert.ok(Math.abs(greatCircleM(53, -1, 55, 1) - greatCircleM(55, 1, 53, -1)) < 1e-6);
});

test('nearestRadar returns the closest site and honours the role filter', () => {
  const f = farmRecord(0);
  const any = nearestRadar(f.lat, f.lon);
  const enroute = nearestRadar(f.lat, f.lon, 'en-route');
  assert.equal(enroute.role, 'en-route');
  assert.ok(any.distanceM <= enroute.distanceM);
  // Brute force the same answer.
  let best = Infinity;
  for (const r of UK_RADAR_SITES) best = Math.min(best, greatCircleM(f.lat, f.lon, r[2], r[3]));
  assert.ok(Math.abs(any.distanceM - best) < 1e-6);
});

test('pairingGeometry places the farm on the true bearing at the true range', () => {
  const g = pairingGeometry(0);
  assert.ok(g.rangeM > 0);
  assert.ok(Math.abs(Math.hypot(g.east, g.north) - g.rangeM) < 1e-6);
  const back = (Math.atan2(g.east, g.north) * 180 / Math.PI + 360) % 360;
  assert.ok(Math.abs(back - g.bearingDeg) < 1e-6);
  // An explicit radar index must be honoured rather than silently replaced.
  const forced = pairingGeometry(0, 3);
  assert.equal(forced.radar.index, 3);
  assert.ok(forced.rangeM > 0 && Number.isFinite(forced.bearingDeg));
});

test('the tangent-plane warning fires exactly when it should', () => {
  let long = 0, short = 0;
  for (let i = 0; i < UK_WIND_FARMS.length; i += 1) {
    const g = pairingGeometry(i);
    assert.equal(g.tangentPlaneWarning, g.rangeM > 100000, `farm ${i}`);
    if (g.tangentPlaneWarning) long += 1; else short += 1;
  }
  assert.ok(short > 0 && long >= 0);
});

test('sites carried by both sources record how far apart the sources put them', () => {
  const dual = UK_RADAR_SITES.filter((r) => r[4].split(',').length === 2);
  assert.ok(dual.length >= 10, 'expected a meaningful cross-check sample');
  for (const r of dual) {
    assert.ok(r[5] > 0, `${r[0]} claims two sources but no disagreement figure`);
    assert.ok(r[5] < 6000, `${r[0]} disagreement ${r[5]} m exceeds the merge radius`);
  }
  // Single-source sites must not claim a cross-check they do not have.
  for (const r of UK_RADAR_SITES.filter((x) => x[4].split(',').length === 1)) {
    assert.equal(r[5], 0, `${r[0]} claims a disagreement figure with only one source`);
  }
});

test('no military radar position is asserted anywhere in the data', () => {
  assert.equal(UK_MILITARY_RADAR_NOTE.retrieved, false);
  assert.ok(UK_MILITARY_RADAR_NOTE.sites.length > 0);
  for (const s of UK_MILITARY_RADAR_NOTE.sites) {
    assert.equal(s.lat, undefined, `${s.name} must not carry a latitude`);
    assert.equal(s.lon, undefined, `${s.name} must not carry a longitude`);
  }
  assert.match(UK_MILITARY_RADAR_NOTE.caution, /unverified/i);
  // And none of the civil sites is a Remote Radar Head smuggled in by name.
  for (const r of UK_RADAR_SITES) assert.ok(!/^RRH/i.test(r[0]), `${r[0]} looks military`);
});

test('the module states its limits at the top of the file, not only in the docs', () => {
  const src = readFileSync(new URL('../js/uksites.js', import.meta.url), 'utf8');
  const head = src.slice(0, src.indexOf('export const UK_WIND_FARMS'));
  for (const phrase of ['centroid', 'not turbine positions', 'disagree', 'No military radar']) {
    assert.ok(head.toLowerCase().includes(phrase.toLowerCase()),
      `the header must say "${phrase}"`);
  }
});
