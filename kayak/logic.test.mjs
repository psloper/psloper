// Run with: node --test kayak/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RATING, PROFILES, toKnots, angleDiff, compassPoint, beaufort, windRelativeToShore,
  parseLocal, formatLocal, findTideTurns, rateHour, findWindows, mergeHourly, tideTrend, rankPlaces, distanceKm, seaCoverage, tideReliability, easyTideUrl, describeAge, savedForecastFor, percentile, ensembleSpread, attachSpread, windConfidence,
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
  // Without the null check, null compares as 0 and fakes a high and a low.
  const hours = [1, 2, null, 0, 1].map((seaLevelM, i) => ({ t: i * 3600e3, seaLevelM }));
  assert.deepEqual(findTideTurns(hours), []);
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

// Result order and names below are as returned by the live Open-Meteo
// geocoding service on 27 Sept 2026 (count=20), trimmed to the fields used.
test('search for "Hamble" puts Hamble-le-Rice first, not Hambleton', () => {
  const live = [
    ['Hamble', 'US'], ['Hambleton', 'US'], ['Hambleton', 'GB'], ['Hambledon', 'GB'], ['Hambledon', 'AU'],
    ['Upper Hambleton', 'GB'], ['Hambleton', 'GB'], ['Hambledon', 'GB'], ['Hambleden', 'GB'], ['Hambleton', 'US'],
    ['Hamble-le-Rice', 'GB'],
  ].map(([name, country_code]) => ({ name, country_code }));
  const r = rankPlaces(live, 'Hamble');
  assert.equal(r[0].name, 'Hamble-le-Rice');
  assert.equal(r[1].name, 'Hambleton'); // then partial UK matches, in service order
  assert.equal(r.at(-1).country_code, 'US');
});

test('search for "Oban" puts Oban, Scotland before Assaria, Kansas', () => {
  const live = [
    { name: 'Assaria', country_code: 'US' }, { name: 'Oban', country_code: 'GB', admin1: 'Scotland' },
    { name: 'Oban', country_code: 'NZ' },
  ];
  assert.equal(rankPlaces(live, 'Oban')[0].admin1, 'Scotland');
});

// Launch points from the live geocoder, sea points from the live marine API.
const SPOTS = {
  oban: { launch: [56.41535, -5.47184], sea: [56.291664, -5.4583282], km: 13.8 },
  rhoscolyn: { launch: [53.25014, -4.59793], sea: [53.291664, -4.6249847], km: 5.0 },
  'portland bill': { launch: [50.51733, -2.45566], sea: [50.541664, -2.4583282], km: 2.7 },
  hamble: { launch: [50.85966, -1.32432], sea: [50.791664, -1.3749847], km: 8.4 },
  itchen: { launch: [50.90451, -1.36936], sea: [50.791664, -1.3749847], km: 12.6 },
  poole: { launch: [50.71429, -1.98458], sea: [50.625008, -1.9583282], km: 10.1 },
};

test('distance from launch to sea model point matches the live check', () => {
  for (const [name, s] of Object.entries(SPOTS)) {
    const km = distanceKm(...s.launch, ...s.sea);
    assert.ok(Math.abs(km - s.km) < 0.1, `${name}: ${km.toFixed(2)} km, expected ${s.km}`);
  }
});

test('sea coverage: near, far and inland', () => {
  const marine = (lat, lon, value) => ({ latitude: lat, longitude: lon, hourly: { wave_height: [value], sea_level_height_msl: [value] } });
  const pb = SPOTS['portland bill'];
  assert.equal(seaCoverage(marine(...pb.sea, 0.5), ...pb.launch).status, 'near');
  const h = SPOTS.hamble;
  assert.equal(seaCoverage(marine(...h.sea, 0.5), ...h.launch).status, 'far');
  // Hambleton, North Yorkshire: the live marine API returned all nulls.
  assert.equal(seaCoverage(marine(53.791664, -1.2083282, null), 53.76667, -1.16667).status, 'none');
  assert.equal(seaCoverage(null, 50, -1).status, 'none');
});

test('missing sea data is never rated GO', () => {
  const r = rateHour({ ...calm, waveM: null }, PROFILES.advanced);
  assert.equal(r.rating, RATING.CAUTION);
  assert.ok(r.reasons.some((x) => x.tag === 'No sea data'));
});

test('tide reliability for the six checked UK spots', () => {
  const expected = {
    oban: ['medium', 'Oban', '0372'],
    rhoscolyn: ['medium', 'Trearddur Bay', '0479'],
    'portland bill': ['low', 'Portland', '0033'],
    hamble: ['low', 'Warsash', '0063A'],
    itchen: ['low', 'Southampton', '0062'],
    poole: ['low', 'Poole Harbour', '0036A'],
  };
  for (const [name, [level, station, id]] of Object.entries(expected)) {
    const s = SPOTS[name];
    const r = tideReliability(...s.launch, { status: s.km > 5 ? 'far' : 'near', distanceKm: s.km });
    assert.equal(r.level, level, name);
    assert.equal(r.station, station, name);
    assert.equal(r.officialUrl, `https://easytide.admiralty.co.uk/?PortID=${id}`, name);
  }
});

test('tide reliability outside the checked areas', () => {
  // A point inside both the Hamble and Itchen circles (1.9 km and 3.9 km
  // away) must get the nearer station.
  assert.equal(tideReliability(50.87461, -1.33933, { status: 'far', distanceKm: 8 }).station, 'Warsash');
  // Unchecked, sea point close: open-coast wording, generic EasyTide link.
  const open = tideReliability(50.21, -5.48, { status: 'near', distanceKm: 2 });
  assert.equal(open.level, 'unchecked');
  assert.equal(open.officialUrl, 'https://easytide.admiralty.co.uk/');
  // Unchecked, sea point far: rated low and says why.
  const far = tideReliability(51.5, -3.2, { status: 'far', distanceKm: 9.3 });
  assert.equal(far.level, 'low');
  assert.match(far.summary, /9\.3 km away/);
  // No sea data at all.
  assert.equal(tideReliability(53.7, -1.1, { status: 'none' }).level, 'none');
});

test('EasyTide station link format', () => {
  // Format seen on a live EasyTide page: https://easytide.admiralty.co.uk/?PortID=0345
  assert.equal(easyTideUrl('0345'), 'https://easytide.admiralty.co.uk/?PortID=0345');
});

test('offline: age of a saved forecast in plain English', () => {
  assert.equal(describeAge(45 * 60e3), '45 minutes');
  assert.equal(describeAge(60e3), '1 minute');
  assert.equal(describeAge(3 * 3600e3), '3 hours');
  assert.equal(describeAge(3 * 86400e3), '3 days');
});

test('offline: saved forecast only reused for the same spot', () => {
  const saved = { place: { lat: 50.71429, lon: -1.98458 }, data: { weather: {} }, savedAt: 0 };
  assert.equal(savedForecastFor(saved, { lat: 50.71429, lon: -1.98458 }), saved);
  assert.equal(savedForecastFor(saved, { lat: 50.85966, lon: -1.32432 }), null);
  assert.equal(savedForecastFor(null, { lat: 1, lon: 1 }), null);
});

test('confidence: percentile of model runs', () => {
  const v = Array.from({ length: 11 }, (_, i) => i); // 0..10
  assert.equal(percentile(v, 0.1), 1);
  assert.equal(percentile(v, 0.5), 5);
  assert.equal(percentile(v, 0.9), 9);
  assert.equal(percentile([0, 10], 0.25), 2.5); // between two runs: interpolated
  assert.equal(percentile([], 0.5), null);
});

test('confidence: spread read from any wind_speed_10m key, in knots', () => {
  const runs = Array.from({ length: 11 }, (_, i) => i * 1.852); // km/h, 0..10 kn
  const hourly = { time: ['2026-10-03T12:00'] };
  runs.forEach((v, i) => { hourly[i ? `wind_speed_10m_member${i}` : 'wind_speed_10m'] = [v]; });
  hourly.temperature_2m = [99]; // ignored
  const s = ensembleSpread({ hourly, hourly_units: { wind_speed_10m: 'km/h' } }).get('2026-10-03T12:00');
  near(s.p10, 1); near(s.p90, 9); assert.equal(s.runs, 11);
  // Too few runs: no spread rather than a misleading one.
  assert.equal(ensembleSpread({ hourly: { time: ['t'], wind_speed_10m: [1], wind_speed_10m_member01: [2] } }).size, 0);
  assert.equal(ensembleSpread(null).size, 0);
  const rows = attachSpread([{ time: '2026-10-03T12:00' }, { time: 'other' }], new Map([['2026-10-03T12:00', s]]));
  near(rows[0].windP90, 9); assert.equal(rows[1].windP90, undefined);
});

test('confidence: wording bands and rating', () => {
  assert.equal(windConfidence(5, 10), 'high');
  assert.equal(windConfidence(5, 15), 'medium');
  assert.equal(windConfidence(5, 20), 'low');
  assert.equal(windConfidence(null, 5), null);
  // Forecast inside the limit but the high end over it: CAUTION, Uncertain.
  const r = rateHour({ ...calm, windKn: 6, windP90: 14 }, PROFILES.beginner);
  assert.equal(r.rating, RATING.CAUTION);
  assert.ok(r.reasons.some((x) => x.tag === 'Uncertain'));
  assert.equal(rateHour({ ...calm, windKn: 6, windP90: 9 }, PROFILES.beginner).rating, RATING.GO);
});
