// The persistence and backup store.
//
// These are the checks that would have caught the defect this module exists to
// fix: an import that worked perfectly and then vanished on reload, because the
// data lived outside the only thing being saved.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptySites, normaliseSites, saveSites, loadSites, isDecommissioned,
  withDecommissioned, liveRadars, makeBackup, readBackup,
  SITES_KEY, BACKUP_FORMAT,
} from '../js/store.js';

/** A minimal localStorage, because node has none and the real one can throw. */
function stubStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  return map;
}

test('imported sites survive a save and load round trip', () => {
  const map = stubStorage();
  const sites = emptySites();
  sites.radars = [{ name: 'Example Airport', lat: 52.8, lon: -1.3, role: 'aerodrome' }];
  sites.source.radars = 'my-radars.csv';
  assert.equal(saveSites(sites), true);
  assert.ok(map.has(SITES_KEY), 'nothing was written to storage');

  const back = loadSites();
  assert.equal(back.radars.length, 1);
  assert.equal(back.radars[0].name, 'Example Airport');
  assert.equal(back.source.radars, 'my-radars.csv');
});

test('a storage that refuses to write does not take the application down', () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('quota exceeded'); },
  };
  assert.equal(saveSites(emptySites()), false, 'a failed write must report, not throw');
  assert.deepEqual(loadSites(), emptySites(), 'a failed read must give an empty store');
});

test('anything read back from storage is forced into shape', () => {
  // A hand-edited file, or a store written by an older build. A missing array
  // here becomes a crash on the first .map somewhere else entirely.
  const s = normaliseSites({ radars: 'not an array', farms: [null, 3, { name: 'ok' }],
    decommissioned: ['A', 'A', '', 7, 'B'] });
  assert.deepEqual(s.radars, []);
  assert.deepEqual(s.farms, [{ name: 'ok' }]);
  assert.deepEqual(s.decommissioned, ['A', 'B'], 'duplicates and non-strings must go');
  assert.deepEqual(normaliseSites(null), emptySites());
  assert.deepEqual(normaliseSites('nonsense'), emptySites());
});

test('a radar can be marked out of service and brought back', () => {
  let sites = emptySites();
  assert.equal(isDecommissioned(sites, 'Allanshill'), false);
  sites = { ...sites, decommissioned: withDecommissioned(sites, 'Allanshill', true) };
  assert.equal(isDecommissioned(sites, 'Allanshill'), true);
  // Marking twice must not produce two entries.
  sites = { ...sites, decommissioned: withDecommissioned(sites, 'Allanshill', true) };
  assert.deepEqual(sites.decommissioned, ['Allanshill']);
  sites = { ...sites, decommissioned: withDecommissioned(sites, 'Allanshill', false) };
  assert.deepEqual(sites.decommissioned, []);
});

test('withDecommissioned does not mutate the list it was given', () => {
  const sites = { ...emptySites(), decommissioned: ['A'] };
  const next = withDecommissioned(sites, 'B', true);
  assert.deepEqual(sites.decommissioned, ['A'], 'the original list was mutated');
  assert.deepEqual(next, ['A', 'B']);
});

test('a decommissioned built-in radar drops out, an imported one never does', () => {
  const rows = [
    { name: 'Allanshill' },
    { name: 'Example Airport', imported: true },
    { name: 'Clee Hill' },
  ];
  const sites = { ...emptySites(), decommissioned: ['Allanshill', 'Example Airport'] };
  const live = liveRadars(rows, sites);
  assert.deepEqual(live.map((r) => r.name), ['Example Airport', 'Clee Hill'],
    'an imported radar must not be filtered: Clear is what removes those');
  assert.equal(liveRadars(rows, emptySites()).length, 3, 'an empty list must filter nothing');
});

test('a backup carries the settings AND the imported data', () => {
  const scenario = { radar: { freqHz: 2.8e9 } };
  const sites = { ...emptySites(), radars: [{ name: 'Mine' }], decommissioned: ['Allanshill'] };
  const text = JSON.stringify(makeBackup(scenario, sites));

  assert.match(text, /windfarm-radar-backup/);
  assert.match(text, /Imported elevation data is not in this file/,
    'the backup must say what it does not contain');

  const back = readBackup(text);
  assert.equal(back.legacy, false);
  assert.equal(back.scenario.radar.freqHz, 2.8e9);
  assert.equal(back.sites.radars[0].name, 'Mine');
  assert.deepEqual(back.sites.decommissioned, ['Allanshill']);
});

test('a bare scenario file written before this format still opens', () => {
  // A tool that cannot read its own older exports teaches people not to trust
  // its exports at all.
  const old = JSON.stringify({ radar: { freqHz: 1.3e9 } });
  const back = readBackup(old);
  assert.equal(back.legacy, true, 'an old file must be recognised as one');
  assert.equal(back.scenario.radar.freqHz, 1.3e9);
  assert.deepEqual(back.sites, emptySites());
});

test('the backup format is declared, not inferred from shape', () => {
  assert.equal(BACKUP_FORMAT, 'windfarm-radar-backup');
  const b = makeBackup({}, emptySites());
  assert.equal(b.format, BACKUP_FORMAT);
  assert.ok(b.version >= 1);
  assert.ok(b.savedAt, 'a backup with no date is hard to choose between');
});
