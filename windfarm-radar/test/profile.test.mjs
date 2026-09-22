// Profiling a file nobody has described, and diffing it against what we hold.
//
// The tests use a real unknown-format case where possible: the WINDEL extract
// has 55 columns with names like TURBNUM and GEOSRC that none of the importer
// synonym lists know, which is exactly the situation this exists for.

import test from 'node:test';
import assert from 'node:assert/strict';
import { profileTable, headingConflicts, reconcileFarms, VALUE_SHAPES } from '../js/profile.js';
import { farmRecord, liveFarmIndices } from '../js/uksites.js';

const known = liveFarmIndices().slice(0, 400).map((i) => farmRecord(i));

test('an empty or absent table is described, not thrown at', () => {
  for (const bad of [[], null, undefined]) {
    const p = profileTable(bad);
    assert.equal(p.rowCount, 0);
    assert.match(p.note, /no rows/);
  }
});

test('columns are identified by their VALUES, not only their headings', () => {
  // Headings deliberately useless, which is the case this exists for.
  const rows = [
    ['A', 'B', 'C', 'D'],
    ['Site one', 54.5, -3.2, 12.5],
    ['Site two', 55.1, -2.8, 8.0],
    ['Site three', 53.9, -1.4, 20.0],
  ];
  const p = profileTable(rows);
  const byIdx = Object.fromEntries(p.columns.map((c) => [c.index, c]));
  assert.equal(byIdx[1].valueShape, 'latitude', 'a latitude column was not recognised by range');
  assert.equal(byIdx[2].valueShape, 'longitude', 'a longitude column was not recognised by range');
  assert.equal(byIdx[0].kind, 'text');
  // 12.5 is not an integer, so it cannot be a grid coordinate.
  assert.equal(byIdx[3].valueShape, null);
});

test('a data row is never mistaken for the header', () => {
  // When the real header matches no synonym the scorer has nothing to go on,
  // and a first data row called "Site one" scored a point for starting with
  // "site ". The profile then reported 2 rows for a 3-row table and named
  // column 0 after a turbine. The importer is unaffected: with headers it
  // cannot read it imports nothing and says which columns it needs.
  const rows = [
    ['A', 'B', 'C'],
    ['Site one', 54.5, -3.2],
    ['Site two', 55.1, -2.8],
    ['Site three', 53.9, -1.4],
  ];
  const p = profileTable(rows);
  assert.equal(p.headerRow, 0, 'a data row was taken as the header');
  assert.equal(p.rowCount, 3, 'a data row was eaten by the header');
  assert.equal(p.columns[0].name, 'A');
});

test('one stray value in range does not make a column a coordinate', () => {
  // 95% threshold: a column of capacities that happens to contain one 54.5
  // must not be read as latitudes.
  const rows = [['mw'], [12.5], [8], [20], [54.5], [3], [7], [11], [9], [15], [6],
    [4], [18], [22], [30], [2], [5], [13], [17], [25], [1]];
  const p = profileTable(rows);
  assert.equal(p.columns[0].valueShape, null,
    'a single in-range value was enough to call the column a latitude');
});

test('a column whose values contradict its heading is flagged', () => {
  // The damaging real case: someone converted a grid reference to degrees and
  // left the old heading on it. Importing that puts the site in the sea.
  const rows = [
    ['Name', 'Easting', 'Northing'],
    ['Alpha', 54.5, -3.2],
    ['Bravo', 55.1, -2.8],
    ['Charlie', 53.9, -1.4],
  ];
  const p = profileTable(rows);
  const conflicts = headingConflicts(p);
  assert.ok(conflicts.length >= 1, 'a degrees column headed Easting was not flagged');
  assert.equal(conflicts[0].headingSays, 'easting');
  assert.match(conflicts[0].valuesLookLike, /latitude|longitude/);
});

test('a correctly labelled grid column raises no conflict', () => {
  const rows = [
    ['Name', 'Easting', 'Northing'],
    ['Alpha', 470868, 278823],
    ['Bravo', 380006, 667129],
    ['Charlie', 412000, 318000],
  ];
  const p = profileTable(rows);
  assert.equal(p.columns[1].valueShape, 'grid');
  assert.deepEqual(headingConflicts(p), []);
});

test('rows are matched by reference, then name, then position, and it says which', () => {
  const a = known[0];
  const rows = [
    [a.repdRef, 'a name that does not match', a.lat, a.lon],      // reference
    ['999999999', a.name, a.lat, a.lon],                          // name
    ['999999998', 'nothing like it', a.lat + 0.001, a.lon],       // position
    ['999999997', 'nothing like it', 0, 0],                       // nothing
  ];
  const map = { reference: 0, name: 1, latitude: 2, longitude: 3 };
  const r = reconcileFarms(rows, known, { map });
  assert.deepEqual(r.rows.map((x) => x.matchedBy),
    ['reference', 'name', 'position', 'none']);
  // Every row must carry a plain-language reason, not just a label.
  for (const row of r.rows) assert.ok(row.matchExplanation.length > 10);
  assert.equal(r.summary.matched, 3);
  assert.equal(r.summary.unmatched, 1);
});

test('a position match beyond the radius is refused rather than stretched', () => {
  const a = known[0];
  const rows = [['x', 'nothing like it', a.lat + 0.5, a.lon]];   // ~55 km away
  const r = reconcileFarms(rows, known, { map: { reference: 0, name: 1, latitude: 2, longitude: 3 } });
  assert.equal(r.rows[0].matchedBy, 'none');
});

test('differences are reported and nothing is written back', () => {
  const a = known.find((k) => k.mwKnown && k.turbines);
  const rows = [[a.repdRef, a.name, a.lat, a.lon, a.mw + 5, a.turbines + 2]];
  const map = { reference: 0, name: 1, latitude: 2, longitude: 3, capacity: 4, turbines: 5 };
  const before = JSON.stringify(farmRecord(a.index));
  const r = reconcileFarms(rows, known, { map });
  assert.equal(r.rows[0].capacityDelta, 5);
  assert.equal(r.rows[0].turbineDelta, 2);
  assert.equal(r.rows[0].positionDeltaM, 0);
  assert.equal(JSON.stringify(farmRecord(a.index)), before,
    'reconciling altered the built-in table, which it must never do');
  assert.match(r.note, /Nothing here has been written/);
});

test('a reference match that disagrees about position is counted separately', () => {
  // A big delta on a reference match means two sources disagree about where a
  // known project is. The same delta on a position match is just a weak match,
  // and conflating the two hides the first.
  const a = known[0];
  const rows = [[a.repdRef, 'x', a.lat + 0.02, a.lon]];   // ~2.2 km
  const r = reconcileFarms(rows, known, { map: { reference: 0, name: 1, latitude: 2, longitude: 3 } });
  assert.equal(r.summary.referenceMatchesOver1km, 1);
  assert.ok(r.rows[0].positionDeltaM > 1000);
});

test('the profiler handles the real WINDEL workbook shape', async () => {
  // 55 columns, most of them named things no synonym list knows. The profile
  // must still find the coordinates and report sensible fill rates.
  const header = ['REFID', 'SITENAME', 'TURBNUM', 'GEOSRC', 'EASTING', 'NORTHING', 'LAT', 'LNG'];
  const body = [
    [4084, 'Kelmarsh Wind Farm (Resubmission)', 5, 'transform', 470868, 278823, 52.40286, -0.95975],
    [4600, 'Penmanshiel Wind Farm', 14, 'transform', 380006, 667129, 55.89686, -2.32130],
    [1, 'Another', 3, 'transform', 412000, 318000, 52.5, -1.5],
  ];
  const p = profileTable([header, ...body]);
  assert.equal(p.rowCount, 3);
  assert.equal(p.columnCount, 8);
  const shapes = Object.fromEntries(p.columns.map((c) => [c.name, c.valueShape]));
  assert.equal(shapes.LAT, 'latitude');
  // Both are reported as 'grid', not guessed apart: their ranges overlap.
  assert.equal(shapes.EASTING, 'grid');
  assert.equal(shapes.NORTHING, 'grid');
  // GEOSRC is the same value on every row, which is worth surfacing.
  assert.equal(p.columns.find((c) => c.name === 'GEOSRC').constant, true);
  assert.equal(p.columns.find((c) => c.name === 'REFID').unique, true);
});

test('the value shapes cover the region the tool actually serves', () => {
  const lat = VALUE_SHAPES.find((s) => s.kind === 'latitude');
  const lon = VALUE_SHAPES.find((s) => s.kind === 'longitude');
  assert.ok(lat.test(49.9) && lat.test(60.9), 'Lizard Point to Unst must both be inside');
  assert.ok(lon.test(-10.5) && lon.test(1.7), 'west Ireland to Lowestoft must both be inside');
  assert.ok(!lat.test(40) && !lon.test(20), 'the band is not the whole world');
});

test('a column type comes from the WHOLE cell, not a number buried in it', () => {
  // Found by running this on the real planning database: "NR32" contains 32
  // and "EN010056" contains 10056, so a lenient parse turned a postcode column
  // and a planning-reference column into numbers.
  const rows = [
    ['Postcode', 'Planning ref', 'Capacity'],
    ['NR32', 'EN010056', '12.5 MW'],
    ['DD4 0AD', 'EN010077', '8 MW'],
    ['AB1 2CD', 'EN010080', '20 MW'],
  ];
  const p = profileTable(rows);
  assert.equal(p.columns[0].kind, 'text', 'a postcode column was read as numbers');
  assert.equal(p.columns[1].kind, 'text', 'a planning reference column was read as numbers');
  // "12.5 MW" is decorated text too, and must not be claimed as a number here.
  assert.equal(p.columns[2].kind, 'text');
});

test('a repeated in-range value is not announced as a coordinate', () => {
  // The real database's Renewable Obligation banding column holds 0.9 on every
  // row. 0.9 is inside the longitude band and every row agreed, so it was
  // reported as longitudes.
  const rows = [['Band'], ...Array.from({ length: 50 }, (_, i) => [i % 3 === 0 ? 0.9 : 1.0])];
  const p = profileTable(rows);
  assert.equal(p.columns[0].valueShape, null,
    'a column of two repeated values was called a coordinate');
});

test('a number that could be a grid reference or a date says so', () => {
  // Excel writes dates as a day count from 1900, which lands inside the
  // British National Grid range. Every date column in the real database was
  // reported as a grid coordinate. They cannot be told apart by value, so
  // both are named rather than one being picked.
  const rows = [['When'], ...Array.from({ length: 20 }, (_, i) => [42570 + i * 7])];
  const p = profileTable(rows);
  const col = p.columns[0];
  assert.ok(col.ambiguousShape, 'an ambiguous column was reported as certain');
  assert.match(col.valueShape, /grid/);
  assert.match(col.valueShape, /date serial/);
});

test('an ambiguous shape does not raise a false heading conflict', () => {
  // A column that could be a grid reference or a date serial does not
  // contradict an "Easting" heading, and flagging it would bury the real
  // conflicts in noise.
  const rows = [
    ['Name', 'Easting', 'Northing'],
    ...Array.from({ length: 20 }, (_, i) => [`S${i}`, 42570 + i * 7, 42570 + i * 11]),
  ];
  assert.deepEqual(headingConflicts(profileTable(rows)), []);
});
