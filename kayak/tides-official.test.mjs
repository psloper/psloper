// Run with: npm test (part of the unit tests)
// Run in a non-UTC zone so a UTC/local mix-up cannot hide on UTC machines.
process.env.TZ = 'America/New_York';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseStations, nearestStation, parseTidalEvents, compareWithModel, fetchOfficialTides, ADMIRALTY_BASE,
} from './tides-official.js';

// Station positions here are illustrative, not official.
const GEO = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-1.4, 50.89] }, properties: { Id: '0062', Name: 'SOUTHAMPTON' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-1.31, 50.85] }, properties: { Id: '0063A', Name: 'WARSASH' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-2.43, 50.57] }, properties: { Id: '0033', Name: 'PORTLAND' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: { Id: 'BAD', Name: 'no position' } },
  ],
};

test('official tides: station list parsed, bad entries dropped', () => {
  const s = parseStations(GEO);
  assert.equal(s.length, 3);
  assert.deepEqual(s[0], { id: '0062', name: 'SOUTHAMPTON', lat: 50.89, lon: -1.4 });
});

test('official tides: nearest station', () => {
  const s = parseStations(GEO);
  assert.equal(nearestStation(s, 50.90451, -1.36936).id, '0062'); // Itchen
  assert.equal(nearestStation(s, 50.85966, -1.32432).id, '0063A'); // Hamble
  assert.equal(nearestStation([], 50, -1), null);
});

test('official tides: events parsed from text or number types, UTC times', () => {
  const e = parseTidalEvents([
    { EventType: 'LowWater', DateTime: '2026-10-03T11:54:00', Height: 0.3 },
    { EventType: 'HighWater', DateTime: '2026-10-03T07:13:00Z', Height: 2.1 },
    { eventType: 0, dateTime: '2026-10-03T19:30:00', height: 2.2 },
    { EventType: 'Unknown', DateTime: '2026-10-03T20:00:00' },
  ]);
  assert.deepEqual(e.map((x) => x.type), ['high', 'low', 'high']);
  assert.equal(e[0].utcMs, Date.UTC(2026, 9, 3, 7, 13));
  assert.equal(e[1].utcMs, Date.UTC(2026, 9, 3, 11, 54)); // no zone: taken as UTC
  assert.equal(e[1].heightM, 0.3);
  assert.deepEqual(parseTidalEvents(null), []);
});

test('official tides: model difference in minutes, in local time', () => {
  // Official HW 07:13 UTC = 08:13 BST. Model HW at 07:30 local: 43 min early.
  const official = parseTidalEvents([{ EventType: 'HighWater', DateTime: '2026-10-03T07:13:00Z', Height: 2 }]);
  const localMs = (h, m) => Date.UTC(2026, 9, 3, h, m);
  const model = [{ type: 'high', t: localMs(7, 30) }, { type: 'low', t: localMs(8, 10) }, { type: 'high', t: localMs(20, 0) }];
  const [c] = compareWithModel(official, model, 3600);
  assert.equal(c.t, localMs(8, 13));
  assert.equal(c.modelDiffMin, -43);
  assert.equal(compareWithModel(official, [{ type: 'high', t: localMs(14, 0) }], 3600)[0].modelDiffMin, null); // > 4 h away
});

function fakeFetch(routes, calls = []) {
  return async (url, opts) => {
    calls.push({ url, key: opts?.headers?.['Ocp-Apim-Subscription-Key'] });
    const r = routes(url);
    if (r instanceof Error) throw r;
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
}

test('official tides: fetch sends the key and uses the nearest station', async () => {
  const calls = [];
  const fetchFn = fakeFetch((url) => (url.endsWith('/Stations')
    ? { status: 200, body: GEO }
    : { status: 200, body: [{ EventType: 'HighWater', DateTime: '2026-10-03T10:48:00', Height: 4.2 }] }), calls);
  const r = await fetchOfficialTides('my-key', 50.90451, -1.36936, { fetchFn });
  assert.equal(r.station.id, '0062');
  assert.equal(r.events.length, 1);
  assert.equal(calls[1].url, `${ADMIRALTY_BASE}/Stations/0062/TidalEvents?duration=4`);
  assert.ok(calls.every((c) => c.key === 'my-key'));
  // With a saved station list, the list is not fetched again.
  const calls2 = [];
  await fetchOfficialTides('my-key', 50.9, -1.37, { fetchFn: fakeFetch(() => ({ status: 200, body: [] }), calls2), stations: r.stations });
  assert.equal(calls2.length, 1);
});

test('official tides: clear errors for a bad key or no connection', async () => {
  await assert.rejects(fetchOfficialTides('bad', 50, -1, { fetchFn: fakeFetch(() => ({ status: 401, body: {} })) }), /key was rejected/);
  await assert.rejects(fetchOfficialTides('k', 50, -1, { fetchFn: fakeFetch(() => new TypeError('Failed to fetch')) }), /Could not reach the Admiralty service/);
  await assert.rejects(fetchOfficialTides('k', 50, -1, { fetchFn: fakeFetch(() => ({ status: 500, body: {} })) }), /HTTP 500/);
});

test('offline cache lists every file the app loads', () => {
  const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/from '\.\/([\w.-]+\.js)'/g)) visit(m[1]);
  };
  visit('app.js');
  for (const f of seen) assert.ok(shell.includes(f), `${f} missing from the offline cache list in sw.js`);
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([\w.-]+\.(?:css|js|webmanifest|svg))"/g)) {
    assert.ok(shell.includes(m[1]), `${m[1]} (from index.html) missing from the offline cache list`);
  }
});
