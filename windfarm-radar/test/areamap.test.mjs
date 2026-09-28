// The area map answers "what is in this square", which is the question you
// have when a developer names a search area.

import test from 'node:test';
import assert from 'node:assert/strict';
import { areaBox, sitesInBox, boxProjection, KM_PER_MILE } from '../js/areamap.js';
import { UK_WIND_FARMS, UK_RADAR_SITES, farmRecord, radarRecord, greatCircleM } from '../js/uksites.js';

const farms = UK_WIND_FARMS.map((_, i) => farmRecord(i));
const radars = UK_RADAR_SITES.map((_, i) => radarRecord(i));

test('a 100 mile box is 100 miles WIDE, not 100 miles in radius', () => {
  const widthKm = 100 * KM_PER_MILE;
  const b = areaBox(54, -2, widthKm);
  // Corner to corner across the middle: west edge to east edge at the centre
  // latitude must be the full width, within a rounding of the flat-earth step.
  const acrossM = greatCircleM(54, b.west, 54, b.east);
  assert.ok(Math.abs(acrossM / 1000 - widthKm) < widthKm * 0.01,
    `box is ${(acrossM / 1000).toFixed(1)} km across, expected ${widthKm.toFixed(1)}`);
  const upM = greatCircleM(b.south, -2, b.north, -2);
  assert.ok(Math.abs(upM / 1000 - widthKm) < widthKm * 0.01,
    `box is ${(upM / 1000).toFixed(1)} km tall, expected ${widthKm.toFixed(1)}`);
  assert.ok(Math.abs(b.halfM - (widthKm * 1000) / 2) < 1);
});

test('the box narrows in longitude as it goes north', () => {
  // A degree of longitude is 111 km at the equator and 55 km at 60 N. A box
  // that ignored that would be far too wide in Shetland.
  const w = 100;
  const south = areaBox(50, -2, w);
  const north = areaBox(60, -2, w);
  const spanS = south.east - south.west;
  const spanN = north.east - north.west;
  // The ratio is not a guessed threshold: a degree of longitude shortens as
  // cos(latitude), so a box of fixed ground width must widen in degrees by
  // exactly cos(50)/cos(60) between these two. Asserting the relationship
  // rather than a bound is what makes this a test of the projection and not of
  // whichever number happened to come out first.
  const expected = Math.cos((50 * Math.PI) / 180) / Math.cos((60 * Math.PI) / 180);
  const ratio = spanN / spanS;
  assert.ok(Math.abs(ratio - expected) < 0.01,
    `longitude span ratio ${ratio.toFixed(3)}, expected cos50/cos60 = ${expected.toFixed(3)}`);
  // But the ground distance is the same at both.
  assert.ok(Math.abs(greatCircleM(50, south.west, 50, south.east)
    - greatCircleM(60, north.west, 60, north.east)) < 1500);
});

test('only sites inside the box are listed as being in it', () => {
  const b = areaBox(55.5, -4.0, 120);          // central Scotland
  const got = sitesInBox(b, farms, radars);
  assert.ok(got.farms.length > 5, `only ${got.farms.length} farms found`);
  for (const f of got.farms) {
    assert.ok(f.lat >= b.south && f.lat <= b.north, `${f.name} latitude outside the box`);
    assert.ok(f.lon >= b.west && f.lon <= b.east, `${f.name} longitude outside the box`);
  }
});

test('a radar outside the box is kept if it can see into it', () => {
  // Leaving these out would be the most misleading thing this could do: the
  // radar that matters is often just outside the developer's red line.
  const b = areaBox(55.5, -4.0, 60);
  const got = sitesInBox(b, farms, radars, { radarReachKm: 80 });
  const outside = got.radars.filter((r) => !r.inside);
  assert.ok(outside.length > 0, 'no radar outside the box was kept');
  for (const r of outside) {
    assert.ok(r.rangeM <= b.halfM * 1.5 + 80000, `${r.name} kept but far out of reach`);
  }
  // And every one marked inside really is.
  for (const r of got.radars.filter((x) => x.inside)) {
    assert.ok(r.lat >= b.south && r.lat <= b.north && r.lon >= b.west && r.lon <= b.east);
  }
});

test('the projection puts the centre at the centre and keeps the aspect', () => {
  const b = areaBox(54, -2, 100);
  const p = boxProjection(b, 800, 600);
  const [cx, cy] = p.project(54, -2);
  assert.ok(Math.abs(cx - 400) < 0.5 && Math.abs(cy - 300) < 0.5,
    `centre projected to ${cx.toFixed(1)},${cy.toFixed(1)}`);
  // North is up.
  const [, yNorth] = p.project(b.north, -2);
  assert.ok(yNorth < cy, 'north is not up');
  // East is right.
  const [xEast] = p.project(54, b.east);
  assert.ok(xEast > cx, 'east is not right');
  // A square box must project to a square: the same ground distance across and
  // up must give the same pixel count.
  const [xw] = p.project(54, b.west);
  const [, yn] = p.project(b.north, -2);
  const [, ys] = p.project(b.south, -2);
  assert.ok(Math.abs((xEast - xw) - (ys - yn)) < 1.5,
    'a square box did not project to a square');
});

test('metres per pixel is consistent with the projection', () => {
  const b = areaBox(54, -2, 100);
  const p = boxProjection(b, 800, 600);
  const [x0] = p.project(54, -2);
  const [x1] = p.project(54, b.east);
  const groundM = greatCircleM(54, -2, 54, b.east);
  const measured = groundM / (x1 - x0);
  assert.ok(Math.abs(measured - p.metresPerPx) / p.metresPerPx < 0.02,
    `scale bar would be wrong: ${measured.toFixed(1)} m/px measured vs ${p.metresPerPx.toFixed(1)} stated`);
});
