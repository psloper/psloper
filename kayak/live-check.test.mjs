// Unit tests for the live check's rules, using fake service responses.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_SPOTS, checkSpot, formatReport } from './live-check-lib.mjs';
import { WEATHER_HOURLY, MARINE_HOURLY } from './requests.js';

const HOURS = 96;
const times = Array.from({ length: HOURS }, (_, i) => new Date(Date.UTC(2026, 9, 3) + i * 3600e3).toISOString().slice(0, 16));
const days = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];
const fill = (v) => times.map(() => v);
const RECORDED_SEA = { Oban: [56.291664, -5.4583282], Hamble: [50.791664, -1.3749847] };

// A healthy answer for each service; `tweak(kind, body)` can break one.
function fakeServices(spot, tweak = () => {}) {
  return async (url) => {
    let kind;
    let body;
    if (url.includes('geocoding-api')) {
      kind = 'geo';
      body = { results: [{ name: 'Elsewhere', country_code: 'US', latitude: 1, longitude: 1 }, { name: spot.expect, country_code: 'GB', latitude: spot.lat, longitude: spot.lon }] };
    } else if (url.includes('marine-api')) {
      kind = 'marine';
      const [lat, lon] = RECORDED_SEA[spot.query] || [spot.lat, spot.lon];
      body = {
        latitude: lat, longitude: lon, hourly_units: { ocean_current_velocity: 'km/h' },
        hourly: { time: times, ...Object.fromEntries(MARINE_HOURLY.map((k) => [k, fill(0.5)])) },
      };
      body.hourly.sea_level_height_msl = times.map((_, i) => 2 * Math.cos((2 * Math.PI * i) / 12.42));
    } else if (url.includes('ensemble-api')) {
      kind = 'ensemble';
      body = { hourly_units: { wind_speed_10m: 'kn' }, hourly: { time: times } };
      for (let m = 0; m < 51; m += 1) body.hourly[m ? `wind_speed_10m_member${String(m).padStart(2, '0')}` : 'wind_speed_10m'] = fill(5 + m * 0.1);
    } else {
      kind = 'weather';
      body = {
        utc_offset_seconds: 3600, hourly_units: { wind_speed_10m: 'kn' },
        hourly: { time: times, ...Object.fromEntries(WEATHER_HOURLY.map((k) => [k, fill(8)])) },
        daily: { time: days, sunrise: days.map((d) => `${d}T07:00`), sunset: days.map((d) => `${d}T19:00`) },
      };
    }
    tweak(kind, body);
    return body;
  };
}

const oban = LIVE_SPOTS[0];
const hamble = LIVE_SPOTS[3];

test('live check: healthy services pass', async () => {
  const r = await checkSpot(oban, { fetchJson: fakeServices(oban) });
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.facts.ensembleRuns, 51);
  assert.ok(r.facts.tideTurns >= 14 && r.facts.tideTurns <= 16);
});

test('live check: wrong first search result fails', async () => {
  // As if the service stopped returning Hamble-le-Rice for "Hamble".
  const fetchJson = fakeServices(hamble, (k, b) => { if (k === 'geo') b.results = [{ name: 'Hambleton', country_code: 'GB', latitude: 53.77, longitude: -1.17 }]; });
  const r = await checkSpot(hamble, { fetchJson });
  assert.ok(r.failures.some((m) => /first result is Hambleton/.test(m)), r.failures.join('; '));
});

test('live check: missing field, wrong unit and unknown current unit fail', async () => {
  const fetchJson = fakeServices(oban, (k, b) => {
    if (k === 'marine') { delete b.hourly.sea_level_height_msl; b.hourly_units.ocean_current_velocity = 'furlongs/fortnight'; }
    if (k === 'weather') b.hourly_units.wind_speed_10m = 'km/h';
  });
  const r = await checkSpot(oban, { fetchJson });
  assert.ok(r.failures.some((m) => /sea_level_height_msl missing/.test(m)));
  assert.ok(r.failures.some((m) => /wind unit is "km\/h"/.test(m)));
  assert.ok(r.failures.some((m) => /current unit "furlongs\/fortnight"/.test(m)));
});

test('live check: misaligned hours and too few ensemble runs fail', async () => {
  const fetchJson = fakeServices(oban, (k, b) => {
    if (k === 'marine') b.hourly.time = b.hourly.time.map((t) => t.replace('2026-10', '2025-10'));
    if (k === 'ensemble') for (const key of Object.keys(b.hourly)) if (/member(1\d|[2-5]\d)/.test(key)) delete b.hourly[key];
  });
  const r = await checkSpot(oban, { fetchJson });
  assert.ok(r.failures.some((m) => /do not line up/.test(m)), r.failures.join('; '));
  assert.ok(r.failures.some((m) => /only 10 model runs/.test(m)), r.failures.join('; '));
});

test('live check: moved sea model point is a warning, not a failure', async () => {
  const fetchJson = fakeServices(hamble, (k, b) => { if (k === 'marine') { b.latitude = 50.70; b.longitude = -1.30; } });
  const r = await checkSpot(hamble, { fetchJson });
  assert.deepEqual(r.failures, []);
  assert.ok(r.warnings.some((m) => /sea model point now .* km away \(recorded 8.4 km\)/.test(m)));
});

test('live check: service error is reported, not thrown', async () => {
  const r = await checkSpot(oban, { fetchJson: async (url) => { if (url.includes('marine-api')) throw new Error('The service is overloaded'); return fakeServices(oban)(url); } });
  assert.ok(r.failures.some((m) => /marine: The service is overloaded/.test(m)));
});

test('live check: official tide comparison with a key', async () => {
  // Official high water 1 h 30 min after the fake model's first high (00:00 local = 23:00 UTC the day before).
  const fetchFn = async (url) => ({
    ok: true, status: 200,
    json: async () => (url.endsWith('/Stations')
      ? { features: [{ geometry: { coordinates: [-5.47, 56.41] }, properties: { Id: '0372', Name: 'OBAN' } }] }
      : [
        { EventType: 'HighWater', DateTime: '2026-10-03T11:55:00Z', Height: 3.9 },
        { EventType: 'LowWater', DateTime: '2026-10-03T18:05:00Z', Height: 0.5 },
        { EventType: 'HighWater', DateTime: '2026-10-04T00:20:00Z', Height: 4.0 },
        { EventType: 'LowWater', DateTime: '2026-10-04T06:30:00Z', Height: 0.4 },
      ]),
  });
  const r = await checkSpot(oban, { fetchJson: fakeServices(oban), admiraltyKey: 'k', fetchFn });
  assert.deepEqual(r.failures, []);
  assert.equal(r.facts.station, 'OBAN (0372)');
  assert.equal(r.facts.matched, '4/4');
  assert.ok(Number.isInteger(r.facts.meanDiffMin));
  const report = formatReport([r], { admiralty: true, when: 'test' });
  assert.match(report, /\| Oban \| pass \| 13\.8 \| \d+ \| 51 \| OBAN \(0372\) \| -?\d+ \(-?\d+\) \|/);
});

test('live check: report lists failures', () => {
  const report = formatReport([{ spot: 'Poole', failures: ['marine: boom'], warnings: [], facts: {} }], { when: 'test' });
  assert.match(report, /\| Poole \| FAIL \(1\) \|/);
  assert.match(report, /- FAIL Poole: marine: boom/);
});
