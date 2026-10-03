// Daily live check: calls the real Open-Meteo services with the app's exact
// requests for six UK spots and checks the answers still fit what the app
// expects. Optionally (with an Admiralty key) re-measures how far the
// modelled tide times are from official predictions.
//
// Failures mean the app would break or mislead; warnings mean something
// changed that a person should look at (for example a moved sea model point,
// which would make the browser tests' recorded data stale).
import { forecastUrls, geocodeUrl, WEATHER_HOURLY, MARINE_HOURLY, FORECAST_DAYS } from './requests.js';
import { rankPlaces, mergeHourly, findTideTurns, ensembleSpread, seaCoverage } from './logic.js';
import { fetchOfficialTides, compareWithModel } from './tides-official.js';

// Launch points, expected first search result and sea model point distance
// as recorded on 27 Sept 2026 (also used by the browser tests).
export const LIVE_SPOTS = [
  { query: 'Oban', expect: 'Oban', lat: 56.41535, lon: -5.47184, seaKm: 13.8 },
  { query: 'Rhoscolyn', expect: 'Rhoscolyn', lat: 53.25014, lon: -4.59793, seaKm: 5.0 },
  { query: 'Portland Bill', expect: 'Portland Bill', lat: 50.51733, lon: -2.45566, seaKm: 2.7 },
  { query: 'Hamble', expect: 'Hamble-le-Rice', lat: 50.85966, lon: -1.32432, seaKm: 8.4 },
  { query: 'Itchen', expect: 'Itchen', lat: 50.90451, lon: -1.36936, seaKm: 12.6 },
  { query: 'Poole', expect: 'Poole', lat: 50.71429, lon: -1.98458, seaKm: 10.1 },
];

const HOURS = FORECAST_DAYS * 24;
const KNOWN_SPEED_UNITS = ['km/h', 'm/s', 'kn', 'mph', 'mp/h'];
const share = (arr, ok) => (arr.length ? arr.filter(ok).length / arr.length : 0);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export async function checkSpot(spot, { fetchJson, admiraltyKey = '', fetchFn } = {}) {
  const failures = [];
  const warnings = [];
  const facts = {};
  const fail = (m) => failures.push(m);

  // 1. Place search ranking.
  try {
    const geo = await fetchJson(geocodeUrl(spot.query));
    const first = rankPlaces(geo.results || [], spot.query)[0];
    if (!first) fail(`search "${spot.query}": no results`);
    else if (first.name !== spot.expect || first.country_code !== 'GB') fail(`search "${spot.query}": first result is ${first.name} (${first.country_code}), expected ${spot.expect} (GB)`);
    else if (Math.abs(first.latitude - spot.lat) > 0.05 || Math.abs(first.longitude - spot.lon) > 0.05) warnings.push(`search "${spot.query}": position moved to ${first.latitude}, ${first.longitude}`);
  } catch (e) { fail(`search "${spot.query}": ${e.message}`); }

  const urls = forecastUrls(spot.lat, spot.lon);
  let weather = null;
  let marine = null;

  // 2. Weather forecast.
  try {
    weather = await fetchJson(urls.weather);
    for (const k of WEATHER_HOURLY) {
      if (!Array.isArray(weather.hourly?.[k]) || weather.hourly[k].length !== HOURS) fail(`weather: hourly ${k} missing or not ${HOURS} hours`);
    }
    if (weather.hourly_units?.wind_speed_10m !== 'kn') fail(`weather: wind unit is "${weather.hourly_units?.wind_speed_10m}", expected "kn"`);
    if ((weather.daily?.sunrise || []).length !== FORECAST_DAYS) fail('weather: daily sunrise missing');
    if (!isNum(weather.utc_offset_seconds)) fail('weather: utc_offset_seconds missing');
    const wind = weather.hourly?.wind_speed_10m || [];
    if (share(wind, (v) => isNum(v) && v >= 0 && v < 120) < 0.9) fail('weather: wind values missing or out of range');
  } catch (e) { fail(`weather: ${e.message}`); weather = null; }

  // 3. Marine forecast.
  try {
    marine = await fetchJson(urls.marine);
    for (const k of MARINE_HOURLY) {
      if (!Array.isArray(marine.hourly?.[k]) || marine.hourly[k].length !== HOURS) fail(`marine: hourly ${k} missing or not ${HOURS} hours`);
    }
    const cu = marine.hourly_units?.ocean_current_velocity;
    if (!KNOWN_SPEED_UNITS.includes(cu)) fail(`marine: current unit "${cu}" not understood by the app`);
    if (share(marine.hourly?.sea_level_height_msl || [], isNum) < 0.9) fail('marine: sea level mostly missing');
    if (share(marine.hourly?.wave_height || [], (v) => isNum(v) && v >= 0 && v < 20) < 0.9) fail('marine: wave heights missing or out of range');
    const cov = seaCoverage(marine, spot.lat, spot.lon);
    facts.seaKm = cov.distanceKm;
    if (cov.distanceKm != null && Math.abs(cov.distanceKm - spot.seaKm) > 1) {
      warnings.push(`marine: sea model point now ${cov.distanceKm.toFixed(1)} km away (recorded ${spot.seaKm} km)`);
    }
  } catch (e) { fail(`marine: ${e.message}`); marine = null; }

  // 4. What the app builds from them.
  let turns = [];
  if (weather && marine) {
    const rows = mergeHourly(weather, marine);
    if (share(rows, (h) => isNum(h.waveM)) < 0.9) fail('merge: marine hours do not line up with weather hours');
    const kn = rows.map((h) => h.currentKn).filter(isNum);
    if (!kn.length || Math.max(...kn) > 15) fail('merge: current speeds missing or implausible');
    turns = findTideTurns(rows);
    facts.tideTurns = turns.length;
    if (turns.length < 10 || turns.length > 20) fail(`tides: ${turns.length} high/low waters in ${HOURS} h (expected about 15)`);
  }

  // 5. Ensemble (forecast confidence).
  try {
    const ens = await fetchJson(urls.ensemble);
    const spread = ensembleSpread(ens);
    const runs = Math.max(0, ...[...spread.values()].map((s) => s.runs));
    facts.ensembleRuns = runs;
    if (spread.size < HOURS * 0.75) fail(`ensemble: spread for only ${spread.size} of ${HOURS} hours`);
    if (runs < 20) fail(`ensemble: only ${runs} model runs (expected about 51)`);
  } catch (e) { fail(`ensemble: ${e.message}`); }

  // 6. Official tides, if a key is available.
  if (admiraltyKey && weather) {
    try {
      const off = await fetchOfficialTides(admiraltyKey, spot.lat, spot.lon, { fetchFn });
      if (off.events.length < 4) fail(`admiralty: only ${off.events.length} events parsed`);
      const diffs = compareWithModel(off.events, turns, weather.utc_offset_seconds).map((e) => e.modelDiffMin).filter(isNum);
      facts.station = `${off.station.name} (${off.station.id})`;
      if (diffs.length) {
        facts.meanDiffMin = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
        facts.worstDiffMin = diffs.reduce((w, d) => (Math.abs(d) > Math.abs(w) ? d : w), 0);
        facts.matched = `${diffs.length}/${off.events.length}`;
      }
    } catch (e) { fail(`admiralty: ${e.message}`); }
  }

  return { spot: spot.query, failures, warnings, facts };
}

// Markdown report for the GitHub run summary.
export function formatReport(results, { admiralty = false, when = new Date().toISOString() } = {}) {
  const lines = [`## Kayak app live check (${when})`, ''];
  lines.push('| Spot | Result | Sea point km | Tide turns | Ensemble runs |' + (admiralty ? ' Official station | Model vs official, mean (worst) min |' : ''));
  lines.push('|---|---|---|---|---|' + (admiralty ? '---|---|' : ''));
  for (const r of results) {
    const f = r.facts;
    const result = r.failures.length ? `FAIL (${r.failures.length})` : r.warnings.length ? `warn (${r.warnings.length})` : 'pass';
    const row = [r.spot, result, f.seaKm?.toFixed(1) ?? '-', f.tideTurns ?? '-', f.ensembleRuns ?? '-'];
    if (admiralty) row.push(f.station ?? '-', f.meanDiffMin != null ? `${f.meanDiffMin} (${f.worstDiffMin})` : '-');
    lines.push(`| ${row.join(' | ')} |`);
  }
  const notes = results.flatMap((r) => [...r.failures.map((m) => `- FAIL ${r.spot}: ${m}`), ...r.warnings.map((m) => `- warn ${r.spot}: ${m}`)]);
  if (notes.length) lines.push('', ...notes);
  if (admiralty) lines.push('', 'Negative minutes: model earlier than the official prediction.');
  return lines.join('\n');
}
