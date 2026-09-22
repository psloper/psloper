// The UK site data is real data with real limits. These tests hold it to both:
// that the numbers are sane, and that the limits are stated where a user sees
// them rather than buried.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UK_WIND_FARMS, UK_RADAR_SITES, UK_MILITARY_RADAR_NOTE, LIVE_STATUSES,
  POSITION_UNCERTAINTY_M, STATED_PRECISION_M,
  greatCircleM, initialBearingDeg, nearestRadar, pairingGeometry, farmRecord, radarRecord,
  liveFarmIndices, farmCapacityLabel, farmAttributeCoverage,
  TERRITORIES, territoryCounts, offshoreFlagConflicts,
} from '../js/uksites.js';

test('every record sits inside the UK and Ireland bounding box', () => {
  // The box runs to 3 degrees east because the Norfolk and East Anglia
  // offshore zones genuinely sit out there.
  for (const [name, lat, lon] of UK_WIND_FARMS) {
    assert.ok(lat > 49 && lat < 61.5, `${name} latitude ${lat}`);
    assert.ok(lon > -11 && lon < 3.0, `${name} longitude ${lon}`);
  }
  for (const [name, , lat, lon] of UK_RADAR_SITES) {
    assert.ok(lat > 49 && lat < 61.5, `${name} latitude ${lat}`);
    assert.ok(lon > -11 && lon < 2.5, `${name} longitude ${lon}`);
  }
});

test('capacities and roles are plausible', () => {
  // Berwick Bank alone is consented at 4,100 MW, so the ceiling is not 2 GW.
  // Zero is allowed and means NOT RECORDED: 46 records, nearly all
  // single-turbine schemes, carry no installed capacity in the database. A
  // negative or absurd figure is still a fault.
  let unrecorded = 0;
  for (const [name, , , mw] of UK_WIND_FARMS) {
    assert.ok(mw >= 0 && mw <= 5000, `${name} capacity ${mw} MW`);
    if (mw === 0) unrecorded += 1;
  }
  // If this ever runs away, the source has changed shape and the zeros are no
  // longer a handful of small schemes.
  assert.ok(unrecorded < UK_WIND_FARMS.length * 0.05,
    `${unrecorded} records carry no capacity, which is too many to call an exception`);
  // And an unrecorded capacity must never be PRINTED as zero.
  const blank = UK_WIND_FARMS.findIndex((f) => f[3] === 0);
  assert.match(farmCapacityLabel(farmRecord(blank)), /not recorded/);
  assert.match(farmCapacityLabel(farmRecord(UK_WIND_FARMS.findIndex((f) => f[3] > 0))), /MW/);
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
  for (const phrase of ['PLANNING RECORDS', 'PRECISION, NOT ACCURACY', 'STATUS MATTERS',
    'disagree', 'No military radar']) {
    assert.ok(head.toLowerCase().includes(phrase.toLowerCase()),
      `the header must say "${phrase}"`);
  }
});

test('every record carries a development status, and most are not operating plant', () => {
  const seen = new Set();
  for (const [name, , , , status, offshore] of UK_WIND_FARMS) {
    assert.ok(typeof status === 'string' && status.length, `${name} has no status`);
    assert.ok(offshore === 0 || offshore === 1, `${name} has a bad offshore flag`);
    seen.add(status);
  }
  for (const s of LIVE_STATUSES) assert.ok(seen.has(s), `no record has status ${s}`);
  // The headline reason the filter exists: two thirds of the table will not be
  // built as recorded. If that stops being true the warnings need rewriting.
  const live = liveFarmIndices();
  assert.ok(live.length < UK_WIND_FARMS.length * 0.6,
    `${live.length} of ${UK_WIND_FARMS.length} are live; the "most are not plant" warning is stale`);
  assert.ok(live.length > 500, 'the live pipeline should not be nearly empty');
});

test('farmRecord reports status truthfully and liveFarmIndices agrees with it', () => {
  const live = new Set(liveFarmIndices());
  for (let i = 0; i < UK_WIND_FARMS.length; i += 1) {
    const r = farmRecord(i);
    assert.equal(r.live, live.has(i), `${r.name}: live flag disagrees with the index list`);
    assert.equal(r.live, LIVE_STATUSES.includes(r.status), `${r.name}: live flag disagrees with status`);
  }
});

test('offshore records really are offshore, and vice versa', () => {
  // Not a coastline test, which this tool has no data for. A weaker but honest
  // one: the offshore set must be dominated by large projects, and the biggest
  // records in the table must be flagged offshore.
  const offshore = UK_WIND_FARMS.filter((r) => r[5] === 1);
  assert.ok(offshore.length > 50 && offshore.length < 200, `${offshore.length} offshore records`);
  const biggest = [...UK_WIND_FARMS].sort((a, b) => b[3] - a[3]).slice(0, 20);
  assert.ok(biggest.every((r) => r[5] === 1), 'the twenty largest projects should all be offshore');
});

// ---------------------------------------------------------------------------
// Precision is not accuracy. These tests exist so that a later change cannot
// quietly present a position as better than it has been measured to be.
// ---------------------------------------------------------------------------

test('the measured position uncertainty is carried, and dwarfs the stated precision', () => {
  // Measured at the only two sites with real turbine coordinates: 1,140 m at
  // Kelmarsh (array radius 483 m) and 1,121 m at Penmanshiel.
  assert.ok(POSITION_UNCERTAINTY_M >= 1000 && POSITION_UNCERTAINTY_M <= 1400,
    `uncertainty ${POSITION_UNCERTAINTY_M} m is not what the two measurements support`);
  assert.ok(POSITION_UNCERTAINTY_M > STATED_PRECISION_M * 100,
    'the whole point is that accuracy is orders worse than precision');
  for (let i = 0; i < 25; i += 1) {
    assert.equal(farmRecord(i).uncertaintyM, POSITION_UNCERTAINTY_M);
  }
});

test('a pairing reports the position error as a fraction of its own range', () => {
  for (const i of liveFarmIndices().slice(0, 300)) {
    const g = pairingGeometry(i);
    assert.ok(Number.isFinite(g.uncertaintyFraction) && g.uncertaintyFraction > 0);
    assert.ok(Math.abs(g.uncertaintyFraction - POSITION_UNCERTAINTY_M / g.rangeM) < 1e-9,
      `${g.farm.name}: fraction does not match range`);
  }
  // At least one real pairing is close enough that the error exceeds the range.
  // Rivox sits 0.9 km from the Lowther Hill en-route radar.
  const worst = liveFarmIndices()
    .map((i) => pairingGeometry(i))
    .sort((a, b) => b.uncertaintyFraction - a.uncertaintyFraction)[0];
  assert.ok(worst.uncertaintyFraction > 1,
    'the closest pairing should have an error larger than its own range');
});

test('the module never claims a position is better than measured', () => {
  const src = readFileSync(new URL('../js/uksites.js', import.meta.url), 'utf8');
  const head = src.slice(0, src.indexOf('export const UK_WIND_FARMS'));
  assert.ok(/PRECISION, NOT ACCURACY/.test(head),
    'the header must distinguish precision from accuracy in those words');
  // The uncertainty constant must show its working, not just assert a number.
  const block = src.slice(src.indexOf('MEASURED POSITIONAL UNCERTAINTY'),
    src.indexOf('export const POSITION_UNCERTAINTY_M'));
  for (const phrase of ['Kelmarsh', 'Penmanshiel', 'n = 2']) {
    assert.ok(block.includes(phrase), `the constant must cite ${phrase}`);
  }
});

test('the turbine attributes from the July 2024 extract are present and sane', () => {
  const cov = farmAttributeCoverage();
  // Counts, not assertions about what "most" means.
  assert.ok(cov.withCount > cov.live * 0.85,
    `turbine count on only ${cov.withCount} of ${cov.live} live farms`);
  assert.ok(cov.turbines > 12000 && cov.turbines < 30000,
    `${cov.turbines} turbines across the live fleet is outside a believable range`);
  // Tip height is much thinner cover, and that is the point of reporting it.
  assert.ok(cov.withHeight > cov.live * 0.25 && cov.withHeight < cov.live,
    `tip height on ${cov.withHeight} of ${cov.live} live farms`);

  // The coverage counter reads the raw rows; farmRecord builds the object the
  // application actually screens. If those two disagree, the builder is
  // dropping a field, which is silent: the missing value reads as undefined
  // and the screen quietly falls back to its assumption. Counting both and
  // comparing is the only way that shows up.
  let recCount = 0, recHeight = 0, recTurbines = 0;
  for (const i of liveFarmIndices()) {
    const f = farmRecord(i);
    if (f.turbines) { recCount += 1; recTurbines += f.turbines; }
    if (f.tipHeightM) recHeight += 1;
  }
  assert.equal(recCount, cov.withCount, 'farmRecord drops turbine counts the table holds');
  assert.equal(recTurbines, cov.turbines, 'farmRecord disagrees on the fleet total');
  assert.equal(recHeight, cov.withHeight, 'farmRecord drops tip heights the table holds');

  for (const i of liveFarmIndices()) {
    const f = farmRecord(i);
    // A zero must never survive into the record as a real figure: the fields
    // are null when the database has nothing, because a farm with no recorded
    // turbine count is not a farm with no turbines.
    assert.ok(f.turbines === null || f.turbines >= 1, `${f.name} turbine count ${f.turbines}`);
    assert.ok(f.tipHeightM === null || (f.tipHeightM >= 20 && f.tipHeightM <= 400),
      `${f.name} tip height ${f.tipHeightM} m`);
    assert.ok(f.turbineMw === null || f.turbineMw > 0, `${f.name} turbine MW ${f.turbineMw}`);
    // A grid reference rounded to the kilometre cannot be better than that.
    assert.ok(f.gridPrecisionM === null || [1, 10, 100, 500, 1000].includes(f.gridPrecisionM),
      `${f.name} grid precision ${f.gridPrecisionM}`);
  }
});

test('turbine counts and positions are not confused for one another', () => {
  // The extract gives how MANY turbines a project has. It does not give where
  // any of them is, and nothing in the table may imply otherwise.
  const f = farmRecord(liveFarmIndices()[0]);
  assert.equal(f.turbinePositions, undefined);
  assert.ok(Object.keys(f).every((k) => !/positions?$/i.test(k)),
    `farmRecord exposes a field that sounds like per-turbine positions: ${Object.keys(f)}`);
  // And the header has to say so, because that is where someone looks first.
  const src = readFileSync(new URL('../js/uksites.js', import.meta.url), 'utf8');
  assert.match(src, /NO PER-TURBINE POSITIONS HERE/);
});

test('one row mapping, not three', () => {
  // main.js, this file and uksites.js each had their own hand-written copy of
  // the compact-row mapping. When the July 2024 extract added a turbine count
  // and a tip height, only one copy was updated: the sensitivity tool saw the
  // new heights, the test did not, and the application did not either, and the
  // disagreement was 108 pairings with nothing to say which was right. A
  // missing field reads as undefined and falls silently back to an assumption,
  // so this checks there is one mapping and the others defer to it.
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('export function farmRowToObject'),
    main.indexOf('export function radarRowToObject'));
  assert.match(body, /farmRecord\(/, 'main.js has its own copy of the row mapping again');
  assert.ok(!/lat:\s*r\[1\]/.test(body), 'main.js is reading the row by index again');

  const tool = readFileSync(new URL('../tools/measure_sensitivity.mjs', import.meta.url), 'utf8');
  assert.match(tool, /farmRecord\(/,
    'the sensitivity tool measures something other than what the app screens');
});

test('every site carries the territory it stands in', () => {
  const counts = territoryCounts();
  // Counted, not asserted: these are what the boundaries actually give.
  assert.ok(counts.Scotland > 1000, `Scotland has ${counts.Scotland} farms`);
  assert.ok(counts.England > 700, `England has ${counts.England} farms`);
  assert.ok(counts['Northern Ireland'] > 200);
  assert.ok(counts.Wales > 150);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, UK_WIND_FARMS.length, 'every record must land in exactly one bucket');

  // Null is not a gap. An offshore site is in no country, and the record must
  // say null rather than pick a nearest one.
  let offshoreWithNull = 0;
  for (let i = 0; i < UK_WIND_FARMS.length; i += 1) {
    const f = farmRecord(i);
    assert.ok(f.territory === null || TERRITORIES.includes(f.territory),
      `${f.name} has territory ${f.territory}`);
    if (f.offshore && f.territory === null) offshoreWithNull += 1;
  }
  assert.ok(offshoreWithNull > 50, 'offshore sites should mostly be in no territory');

  // Radars too, and the Irish ones must come out as Ireland rather than being
  // forced into a UK territory.
  const irish = UK_RADAR_SITES.filter((_, i) => radarRecord(i).territory === 'Ireland');
  assert.ok(irish.length >= 3, `only ${irish.length} radars placed in Ireland`);
});

test('the offshore flag is cross-checked against the geography', () => {
  // Two independent facts: a field somebody typed, and a point-in-polygon test.
  // Where they disagree is worth surfacing, and the count must stay small or
  // the boundaries or the flag have moved.
  const c = offshoreFlagConflicts();
  const total = c.onshoreInSea.length + c.offshoreOnLand.length;
  assert.ok(total < UK_WIND_FARMS.length * 0.01,
    `${total} records disagree, which is too many to treat as exceptions`);
  assert.ok(total > 0, 'no disagreements at all suggests the check is not running');
  // Every conflict must be a real record the caller can go and look at.
  for (const f of [...c.onshoreInSea, ...c.offshoreOnLand]) {
    assert.ok(Number.isFinite(f.lat) && Number.isFinite(f.lon));
    assert.ok(typeof f.name === 'string');
  }
  // The direction has to be right: onshore-in-sea have no territory, and
  // offshore-on-land have one.
  for (const f of c.onshoreInSea) assert.equal(f.territory, null);
  for (const f of c.offshoreOnLand) assert.notEqual(f.territory, null);
});

test('the compact row width matches what the record builder reads', () => {
  // The builder reads f[11]; a generator that writes 11 fields would hand it
  // undefined and every site would silently lose its territory. This pins the
  // width to the highest index anything actually reads.
  const src = readFileSync(new URL('../js/uksites.js', import.meta.url), 'utf8');
  const reads = [...src.matchAll(/\bf\[(\d+)\]/g)].map((m) => Number(m[1]));
  const widest = Math.max(...reads);
  for (const row of UK_WIND_FARMS) {
    assert.ok(row.length > widest,
      `a row has ${row.length} fields but the builder reads f[${widest}]`);
  }
});
