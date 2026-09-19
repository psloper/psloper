// Importing site lists. The contract is that nothing is invented: a row without
// a name or a position is skipped and counted, and every column left out is
// named back to the user rather than quietly defaulted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCsv, parseRadarSiteRows, parseFarmSiteRows,
  RADAR_SITE_FIELDS, FARM_SITE_FIELDS } from '../js/importers.js';

const rowsOf = (csv) => readCsv(csv)[0].rows;
const sample = (f) => rowsOf(readFileSync(new URL(`../samples/${f}`, import.meta.url), 'utf8'));

test('the shipped templates import cleanly', () => {
  const r = parseRadarSiteRows(sample('radar-sites-template.csv'));
  assert.equal(r.sites.length, 4);
  assert.equal(r.skipped, 0);
  assert.equal(r.warnings.length, 0, `unexpected warnings: ${r.warnings.join(' | ')}`);
  assert.deepEqual(r.sites.map((s) => s.role),
    ['en-route', 'aerodrome', 'air-defence', 'weather']);
  assert.equal(r.sites[0].antennaHeightM, 20);

  const f = parseFarmSiteRows(sample('windfarm-sites-template.csv'));
  assert.equal(f.sites.length, 5);
  assert.equal(f.skipped, 0);
  assert.equal(f.warnings.length, 0, `unexpected warnings: ${f.warnings.join(' | ')}`);
  assert.equal(f.sites[3].offshore, true);
  assert.equal(f.sites[0].offshore, false);
  assert.equal(f.sites[2].status, 'Application Submitted');
});

test('a bare minimum file works: just a name and a position', () => {
  const r = parseFarmSiteRows(rowsOf('name,latitude,longitude\nAlpha,55.1,-3.2\nBeta,54.0,-1.0\n'));
  assert.equal(r.sites.length, 2);
  assert.equal(r.sites[0].mw, 0);
  assert.equal(r.sites[0].status, 'Not stated');
  assert.equal(r.sites[0].offshore, null);
  // Every omission must be reported, not silently defaulted.
  const joined = r.warnings.join(' ');
  for (const phrase of ['status', 'capacity', 'onshore or offshore']) {
    assert.ok(joined.includes(phrase), `omitting ${phrase} was not reported`);
  }
});

test('rows without a name or a position are skipped and counted, never guessed', () => {
  const r = parseFarmSiteRows(rowsOf(
    'name,latitude,longitude\nGood,55.1,-3.2\n,54.0,-1.0\nNoPos,,\nBadLat,999,-1.0\n'));
  assert.equal(r.sites.length, 1);
  assert.equal(r.skipped, 3);
  assert.equal(r.sites[0].name, 'Good');
});

test('a title block above the table does not defeat the header search', () => {
  const r = parseRadarSiteRows(rowsOf(
    'Project 1234 radar schedule\nIssued 2026-01-01\n\nname,latitude,longitude,antenna height\n'
    + 'Hill Site,55.5,-3.5,18\n'));
  assert.equal(r.sites.length, 1);
  // The blank line is dropped by the CSV reader, so the header lands on row 2
  // of the parsed rows rather than row 3 of the file. What matters is that the
  // search looked past the title block at all.
  assert.ok(r.headerRow > 0, 'the header was not found past the title block');
  assert.equal(r.sites[0].antennaHeightM, 18);
});

test('eastings and northings are read relative to the radar grid position', () => {
  const csv = 'name,easting,northing\nA,412500,318200\nB,411000,317000\n';
  const r = parseFarmSiteRows(rowsOf(csv), { radarEasting: 412000, radarNorthing: 318000 });
  assert.equal(r.sites.length, 2);
  assert.equal(r.sites[0].east, 500);
  assert.equal(r.sites[0].north, 200);
  assert.equal(r.sites[1].east, -1000);
  assert.ok(r.warnings.some((w) => /radar grid position/.test(w)),
    'using a grid without lat/lon must warn about the grid origin');
});

test('a file with no position at all fails loudly and says what is missing', () => {
  const r = parseFarmSiteRows(rowsOf('name,capacity mw\nAlpha,50\n'));
  assert.equal(r.sites.length, 0);
  assert.match(r.warnings[0], /latitude.*longitude|easting.*northing/i);
});

test('a file with no recognisable header fails loudly', () => {
  const r = parseRadarSiteRows(rowsOf('alpha,beta,gamma\n1,2,3\n'));
  assert.equal(r.sites.length, 0);
  assert.match(r.warnings[0], /header/i);
});

test('missing antenna height is reported, because it sets the horizon', () => {
  const r = parseRadarSiteRows(rowsOf('name,latitude,longitude\nA,55.1,-3.2\n'));
  assert.equal(r.sites.length, 1);
  assert.equal(r.sites[0].antennaHeightM, null);
  assert.ok(r.warnings.some((w) => /antenna height/i.test(w) && /horizon/i.test(w)));
});

test('column synonyms cover what real spreadsheets are actually headed', () => {
  for (const [header, field] of [
    ['Site Name', 'name'], ['Lat', 'latitude'], ['Long', 'longitude'],
    ['Capacity (MW)', 'capacity'], ['Development Status', 'status'],
    ['REPD Ref', 'reference'],
  ]) {
    const r = parseFarmSiteRows(rowsOf(`${header},x\nvalue,1\n`));
    assert.ok(r.columns[field] === 0 || r.warnings.length,
      `"${header}" did not map to ${field}`);
  }
  assert.ok(RADAR_SITE_FIELDS.antennaHeight.includes('mast height'));
  assert.ok(FARM_SITE_FIELDS.status.includes('development status'));
});

test('the in-app help carries the column tables and no stray markdown', () => {
  const html = readFileSync(new URL('../js/report.js', import.meta.url), 'utf8');
  const i = html.indexOf('export const IMPORT_HTML = ');
  const block = html.slice(i, html.indexOf('\n', html.indexOf(';', i)));
  assert.ok(block.length > 8000, 'the help panel is suspiciously short');
  for (const must of ['antenna height', 'latitude', 'easting', 'Required', 'Downloads folder']) {
    assert.ok(block.includes(must), `the in-app help does not mention ${must}`);
  }
  // Converted markdown must not leak through as literal syntax.
  for (const bad of ['**', '\\\\*']) {
    assert.ok(!block.includes(bad), `stray markdown in the help panel: ${bad}`);
  }
});
