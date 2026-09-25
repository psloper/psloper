// What a radar import did not contain, and the request that comes out of it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RADAR_FIELDS, auditRadarSites, requestText, hasValue,
} from '../js/completeness.js';
import { parseRadarSiteRows, frequencyHz, wattsFrom } from '../js/importers.js';

const full = {
  name: 'Complete', antennaHeightM: 20, azBeamwidthDeg: 1.4, elBeamwidthDeg: 4.8,
  elPeakDeg: 4, freqHz: 2.8e9, gainDbi: 34,
};

test('a site with all six deciding parameters audits clean', () => {
  const a = auditRadarSites([full]);
  assert.equal(a.complete, true);
  assert.equal(a.decidingMissing, 0);
  assert.equal(a.worstMissingDb, 0);
});

test('a name-and-position-only site is reported as missing all six', () => {
  const a = auditRadarSites([{ name: 'Bare', lat: 53, lon: -1 }]);
  assert.equal(a.complete, false);
  assert.equal(a.decidingMissing, 6);
  // Antenna height is the biggest measured lever, so it must be the figure the
  // panel leads on.
  assert.equal(a.worstMissingDb, 10.6);
});

test('the ranking is by measured effect, strictly descending within a tier', () => {
  const decides = RADAR_FIELDS.filter((f) => f.tier === 'decides');
  assert.equal(decides.length, 6);
  for (let i = 1; i < decides.length; i++) {
    assert.ok(decides[i].movesDb <= decides[i - 1].movesDb,
      `the deciding parameters are out of order at ${decides[i].label}`);
  }
  assert.equal(decides[0].key, 'antennaHeightM', 'antenna height must lead the list');
});

test('a value only counts when it is a usable number', () => {
  assert.equal(hasValue({ gainDbi: 34 }, 'gainDbi'), true);
  assert.equal(hasValue({ gainDbi: null }, 'gainDbi'), false);
  assert.equal(hasValue({ gainDbi: '34' }, 'gainDbi'), false, 'a string is not a measurement');
  assert.equal(hasValue({ gainDbi: NaN }, 'gainDbi'), false);
  assert.equal(hasValue({}, 'gainDbi'), false);
});

test('partial coverage is counted per field, not per site', () => {
  const a = auditRadarSites([full, { name: 'Bare' }]);
  const height = a.fields.find((f) => f.key === 'antennaHeightM');
  assert.equal(height.present, 1);
  assert.equal(height.missing, 1);
  assert.deepEqual(height.missingNames, ['Bare']);
});

test('the drafted request names the effect, not just the parameter', () => {
  const text = requestText(auditRadarSites([{ name: 'Bare' }]));
  assert.match(text, /Antenna height above ground/);
  assert.match(text, /10\.6 dB/, 'the request must say why the figure matters');
  assert.match(text, /all sites/);
  // A conditional parameter must not pad out a request that goes to a person.
  assert.doesNotMatch(text, /MTI rejection/);
});

test('a site complete on the deciding six still asks for the second tier', () => {
  // The panel only opens when a DECIDING parameter is missing, but the request
  // itself should still be worth sending: transmit power and system loss move
  // the answer by 3 dB each, which is not nothing.
  const text = requestText(auditRadarSites([full]));
  assert.match(text, /Transmit power/);
  assert.doesNotMatch(text, /Antenna height/, 'it must not ask for what was supplied');
});

test('a site with nothing missing anywhere produces no request', () => {
  const everything = { ...full };
  for (const f of RADAR_FIELDS) everything[f.key] = 1;
  assert.equal(requestText(auditRadarSites([everything])), '');
});

test('frequency and power are read in whatever unit the sheet used', () => {
  for (const v of [2.8, 2800, 2.8e9]) assert.equal(frequencyHz(v), 2.8e9);
  assert.equal(frequencyHz(1.3), 1.3e9);
  assert.equal(frequencyHz(''), null);
  assert.equal(frequencyHz(0), null);
  assert.equal(wattsFrom(25), 25000, '25 must read as kW');
  assert.equal(wattsFrom(25000), 25000);
  assert.equal(wattsFrom(null), null);
});

test('a longer column name is not swallowed by a shorter alias', () => {
  // 'elevation' is an alias for ground level. Before exact matching came
  // first, a column headed 'elevation beamwidth' was claimed by ground level
  // purely because ground level is declared earlier, and the beamwidth was
  // silently lost.
  const rows = [
    ['name', 'latitude', 'longitude', 'elevation', 'elevation beamwidth'],
    ['Site', '53.4', '-0.3', '177', '4.8'],
  ];
  const res = parseRadarSiteRows(rows, {});
  assert.equal(res.sites.length, 1);
  assert.equal(res.sites[0].groundLevelM, 177, 'ground level was lost');
  assert.equal(res.sites[0].elBeamwidthDeg, 4.8, 'elevation beamwidth was swallowed');
});

test('the shipped template still parses, and is deliberately incomplete', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const rows = readFileSync(join(root, 'samples', 'radar-sites-template.csv'), 'utf8')
    .trim().split('\n').map((l) => l.split(','));
  const res = parseRadarSiteRows(rows, {});
  assert.equal(res.sites.length, 4);
  const a = auditRadarSites(res.sites);
  // Two rows are filled in and two are not, on purpose: the template has to
  // demonstrate the completeness panel as well as the happy path.
  assert.ok(a.decidingMissing > 0 && !a.complete,
    'the template should show what an incomplete import looks like');
  assert.equal(res.sites[0].freqHz, 1.3e9, 'the en-route example should read as L-band');
});
