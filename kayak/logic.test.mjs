// Run with: node --test kayak/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RATING, PROFILES, toKnots, angleDiff, compassPoint, beaufort, windRelativeToShore,
  parseLocal, formatLocal, findTideTurns, rateHour, findWindows, mergeHourly, tideTrend, ukFirst,
} from './logic.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('unit conversion to knots', () => {
  near(toKnots(1.852, 'km/h'), 1);
  near(toKnots(1, 'm/s'), 1.943844);
  assert.equal(toKnots(5, 'kn'), 5);
  assert.equal(toKnots(null, 'km/h'), null);
});

test('angles and compass points', () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(0, 180), 180);
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(225), 'SW');
});

test('beaufort scale boundaries', () => {
  assert.equal(beaufort(0), 0);
  assert.equal(beaufort(5), 2);
  assert.equal(beaufort(11), 4);
  assert.equal(beaufort(18), 5);
  assert.equal(beaufort(70), 12);
});

test('wind relative to a south-facing beach', () => {
  // Beach looks out to the south (180).
  assert.equal(windRelativeToShore(180, 180), 'onshore'); // wind from the sea
  assert.equal(windRelativeToShore(0, 180), 'offshore'); // wind from the land
  assert.equal(windRelativeToShore(90, 180), 'cross-shore');
  assert.equal(windRelativeToShore(90, null), null);
});

test('local time strings stay in location wall-clock time', () => {
  assert.equal(formatLocal(parseLocal('2026-09-27T14:00')), '14:00');
});

test('tide turns found and interpolated between hours', () => {
  // Sampled cosine with a 12 h period, high water at 3.5 h.
  const hours = Array.from({ length: 24 }, (_, i) => ({
    t: i * 3600e3,
    seaLevelM: 2 * Math.cos((2 * Math.PI * (i - 3.5)) / 12),
  }));
  const turns = findTideTurns(hours);
  assert.equal(turns[0].type, 'high');
  assert.ok(Math.abs(turns[0].t / 3600e3 - 3.5) < 0.1, `high at ${turns[0].t / 3600e3}`);
  assert.equal(turns[1].type, 'low');
  assert.ok(Math.abs(turns[1].t / 3600e3 - 9.5) < 0.1);
  assert.ok(Math.abs(turns[0].heightM - 2) < 0.1);
});

test('tide turns skip missing data', () => {
  assert.deepEqual(findTideTurns([{ t: 0, seaLevelM: null }, { t: 1, seaLevelM: null }, { t: 2, seaLevelM: null }]), []);
});

const calm = { t: 0, windKn: 5, gustKn: 8, windDir: 180, waveM: 0.2, currentKn: 0.3, currentDir: 0, visibilityM: 20000, code: 1 };

test('calm hour is GO', () => {
  const r = rateHour(calm, PROFILES.beginner);
  assert.equal(r.rating, RATING.GO);
  assert.equal(r.reasons.length, 0);
});

test('strong wind is NO-GO for beginner, fine for advanced', () => {
  const h = { ...calm, windKn: 14, gustKn: 18 };
  assert.equal(rateHour(h, PROFILES.beginner).rating, RATING.NOGO);
  assert.equal(rateHour(h, PROFILES.advanced).rating, RATING.GO);
});

test('near a limit gives CAUTION', () => {
  assert.equal(rateHour({ ...calm, windKn: 9 }, PROFILES.beginner).rating, RATING.CAUTION);
});

test('offshore wind escalates only when a beach bearing is set', () => {
  const h = { ...calm, windKn: 7, windDir: 0 }; // from the north
  assert.equal(rateHour(h, PROFILES.beginner).rating, RATING.GO);
  assert.equal(rateHour(h, PROFILES.beginner, { seaBearing: 180 }).rating, RATING.NOGO);
  assert.equal(rateHour(h, PROFILES.intermediate, { seaBearing: 180 }).rating, RATING.CAUTION);
});

test('fog and thunder are NO-GO', () => {
  assert.equal(rateHour({ ...calm, visibilityM: 500 }, PROFILES.advanced).rating, RATING.NOGO);
  assert.equal(rateHour({ ...calm, code: 95 }, PROFILES.advanced).rating, RATING.NOGO);
});

test('wind against current gives CAUTION', () => {
  // Current flows towards the west (270); wind blows from the west.
  const h = { ...calm, windKn: 12, gustKn: 14, windDir: 270, currentKn: 1.5, currentDir: 270 };
  const r = rateHour(h, PROFILES.advanced);
  assert.equal(r.rating, RATING.CAUTION);
  assert.ok(r.reasons.some((x) => x.text.includes('against current')));
});

test('darkness gives CAUTION', () => {
  const daylight = [{ sunrise: 6 * 3600e3, sunset: 18 * 3600e3 }];
  assert.equal(rateHour({ ...calm, t: 3 * 3600e3 }, PROFILES.advanced, { daylight }).rating, RATING.CAUTION);
  assert.equal(rateHour({ ...calm, t: 12 * 3600e3 }, PROFILES.advanced, { daylight }).rating, RATING.GO);
});

test('paddling windows are runs of GO hours', () => {
  const r = ['go', 'go', 'go', 'nogo', 'go', 'caution', 'go', 'go'].map((rating, i) => ({ t: i * 3600e3, rating }));
  const w = findWindows(r, 2);
  assert.equal(w.length, 2);
  assert.equal(w[0].hours, 3);
  assert.equal(w[1].end, 8 * 3600e3);
});

test('merge aligns marine data by timestamp and converts current', () => {
  const weather = { hourly: {
    time: ['2026-09-27T00:00', '2026-09-27T01:00'],
    wind_speed_10m: [5, 6], wind_gusts_10m: [8, 9], wind_direction_10m: [180, 190],
    temperature_2m: [12, 12], apparent_temperature: [10, 10], precipitation_probability: [0, 0],
    precipitation: [0, 0], visibility: [20000, 20000], weather_code: [1, 1],
  } };
  const marine = {
    hourly_units: { ocean_current_velocity: 'km/h' },
    hourly: { time: ['2026-09-27T01:00'], wave_height: [0.4], ocean_current_velocity: [1.852] },
  };
  const rows = mergeHourly(weather, marine);
  assert.equal(rows[0].waveM, null);
  assert.equal(rows[1].waveM, 0.4);
  near(rows[1].currentKn, 1);
});

test('tide trend rising, falling and missing', () => {
  const hours = [1, 1.5, 1.2, null].map((seaLevelM) => ({ seaLevelM }));
  assert.equal(tideTrend(hours, 0), 'rising');
  assert.equal(tideTrend(hours, 1), 'falling');
  assert.equal(tideTrend(hours, 2), 'falling'); // next is missing, uses previous
  assert.equal(tideTrend(hours, 3), null);
});

test('place search puts UK results first', () => {
  const r = ukFirst([
    { name: 'Newport', country_code: 'US' },
    { name: 'Newport', country_code: 'GB', admin1: 'Wales' },
    { name: 'Newport', country_code: 'AU' },
    { name: 'Newport', country_code: 'GB', admin1: 'Isle of Wight' },
  ]);
  assert.deepEqual(r.map((x) => x.admin1 || x.country_code), ['Wales', 'Isle of Wight', 'US', 'AU']);
});
