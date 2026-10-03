// UI wiring for the sea kayak conditions app. Fetches Open-Meteo weather,
// marine and geocoding data (free, no API key) and renders the report.
import {
  PROFILES, RATING, mergeHourly, buildDaylight, isDaylight, findTideTurns, rateHour,
  findWindows, tideTrend, rankPlaces, seaCoverage, describeAge, savedForecastFor, easyTideUrl, ensembleSpread, attachSpread, windConfidence, FAR_SEA_POINT_KM, tideReliability, TIDE_CHECKED_ON, compassPoint, beaufort, windRelativeToShore, formatLocal, localNow, weatherText,
} from './logic.js';
import { hazardsNear, HAZARD_RADIUS_KM } from './hazards.js';
import { fetchOfficialTides, compareWithModel } from './tides-official.js';
import { forecastUrls, geocodeUrl } from './requests.js';
import { planDepartures } from './planner.js';
import { FEELS, LOG_METRICS, makeEntry, mergeEntries, suggestLimits } from './triplog.js';

const HOURS_SHOWN = 72;
const LIMIT_KEYS = ['maxWindKn', 'maxGustKn', 'maxWaveM', 'maxOffshoreKn', 'maxCurrentKn'];
const STORE_KEY = 'seaKayakConditions.v1';
const FORECAST_KEY = 'seaKayakConditions.lastForecast.v1';
const ADMIRALTY_KEY = 'seaKayakConditions.admiraltyKey';
const STATIONS_KEY = 'seaKayakConditions.admiraltyStations.v1';
const STATIONS_MAX_AGE_MS = 30 * 864e5;
const LOG_KEY = 'seaKayakConditions.tripLog.v1';
const RATING_LABEL = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' };

const $ = (id) => document.getElementById(id);
const state = { place: null, data: null, official: null };

// ---------- persistence (per-browser convenience only) ----------
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function savePrefs() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      place: state.place, profile: $('profile').value, seaBearing: $('sea-bearing').value, limits: readLimits(), plan: readPlan(),
    }));
  } catch { /* storage unavailable: settings just won't persist */ }
}

// Last good forecast, so the page still works at a beach with no signal.
function saveForecast(place, data) {
  try {
    localStorage.setItem(FORECAST_KEY, JSON.stringify({ place, data, savedAt: Date.now() }));
  } catch { /* storage full or blocked: offline copy just won't be kept */ }
}
function loadSavedForecast() {
  try { return JSON.parse(localStorage.getItem(FORECAST_KEY)); } catch { return null; }
}

// Admiralty key and station list: this browser only.
function getAdmiraltyKey() {
  try { return localStorage.getItem(ADMIRALTY_KEY) || ''; } catch { return ''; }
}
function setAdmiraltyKey(key) {
  try { if (key) localStorage.setItem(ADMIRALTY_KEY, key); else localStorage.removeItem(ADMIRALTY_KEY); } catch { /* not kept */ }
}
function loadStations() {
  try {
    const s = JSON.parse(localStorage.getItem(STATIONS_KEY));
    return s && Date.now() - s.savedAt < STATIONS_MAX_AGE_MS ? s.stations : null;
  } catch { return null; }
}
function saveStations(stations) {
  try { localStorage.setItem(STATIONS_KEY, JSON.stringify({ savedAt: Date.now(), stations })); } catch { /* not kept */ }
}

// Trip log: this browser only (export/import to move or back it up).
function loadLog() {
  try { return mergeEntries([], JSON.parse(localStorage.getItem(LOG_KEY)) || []); } catch { return []; }
}
function saveLog(entries) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(entries)); } catch { /* not kept */ }
}

// ---------- trip planner inputs ----------
const PLAN_IDS = ['plan-bearing', 'plan-distance', 'plan-speed', 'plan-type'];
function readPlan() {
  return {
    bearing: Number($('plan-bearing').value), distanceNm: parseFloat($('plan-distance').value),
    speedKn: parseFloat($('plan-speed').value), roundTrip: $('plan-type').value === 'return',
  };
}
function writePlan(p) {
  if (!p) return;
  $('plan-bearing').value = p.bearing;
  $('plan-distance').value = p.distanceNm;
  $('plan-speed').value = p.speedKn;
  $('plan-type').value = p.roundTrip ? 'return' : 'oneway';
}

// ---------- settings ----------
function readLimits() {
  return Object.fromEntries(LIMIT_KEYS.map((k) => [k, parseFloat($(k).value)]));
}
function writeLimits(limits) {
  LIMIT_KEYS.forEach((k) => { $(k).value = limits[k]; });
}
function readSeaBearing() {
  const v = $('sea-bearing').value;
  return v === '' ? null : Number(v);
}

// ---------- fetching ----------
const RETRY_DELAY_MS = 1500;

// Open-Meteo occasionally answers "The service is overloaded" (seen in
// testing); one retry after a short pause usually succeeds.
async function getJson(url, retries = 1) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (res.ok && !body.error) return body;
  const transient = res.status >= 500 || res.status === 429 || /overload/i.test(body.reason || '');
  if (transient && retries > 0) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return getJson(url, retries - 1);
  }
  throw new Error(body.reason || `HTTP ${res.status}`);
}

async function fetchConditions(lat, lon) {
  const urls = forecastUrls(lat, lon);
  const [weather, marine, ensemble] = await Promise.allSettled([getJson(urls.weather), getJson(urls.marine), getJson(urls.ensemble)]);
  if (weather.status === 'rejected') throw new Error(`Weather forecast failed: ${weather.reason.message}`);
  return {
    weather: weather.value,
    marine: marine.status === 'fulfilled' ? marine.value : null,
    marineError: marine.status === 'rejected' ? marine.reason.message : null,
    ensemble: ensemble.status === 'fulfilled' ? ensemble.value : null,
  };
}

// ---------- flow ----------
function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

async function loadPlace(place) {
  state.place = place;
  $('lat').value = place.lat;
  $('lon').value = place.lon;
  savePrefs();
  setStatus(`Loading forecast for ${place.name}...`);
  try {
    state.data = await fetchConditions(place.lat, place.lon);
    showOfflineBanner(null);
    state.official = null;
    render();
    saveForecast(place, state.data);
    loadOfficialTides(place);
    setStatus(`Forecast for ${place.name} (${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}).`
      + (state.data.marineError ? ` Marine data unavailable: ${state.data.marineError}` : ''));
  } catch (err) {
    const saved = savedForecastFor(loadSavedForecast(), place);
    if (saved) {
      state.data = saved.data;
      showOfflineBanner(saved.savedAt);
      render();
      setStatus(`Showing the saved forecast for ${place.name}.`);
    } else {
      setStatus(`${err.message}. Check your connection and try again.`, true);
    }
  }
}

// Official tide times, if the user has added an Admiralty key. Runs after
// the main forecast so a slow or failing Admiralty call never blocks it.
async function loadOfficialTides(place) {
  const key = getAdmiraltyKey();
  if (!key) { state.official = null; return; }
  state.official = { status: 'loading' };
  setOfficialStatus('Getting official tide times from the Admiralty service...');
  try {
    const res = await fetchOfficialTides(key, place.lat, place.lon, { stations: loadStations() });
    if (state.place !== place) return; // user moved on
    saveStations(res.stations);
    state.official = { status: 'ok', station: res.station, events: res.events };
    setOfficialStatus('');
  } catch (err) {
    if (state.place !== place) return;
    state.official = { status: 'error', error: err.message };
    setOfficialStatus(`Official tide times not shown: ${err.message}. Showing the model estimate.`, true);
  }
  if (state.data) render();
}

function setOfficialStatus(text, isError = false) {
  const p = $('official-status');
  p.textContent = text;
  p.hidden = !text;
  p.classList.toggle('error', isError);
}

function showOfflineBanner(savedAt) {
  const box = $('offline-banner');
  if (savedAt == null) { box.hidden = true; return; }
  const when = new Date(savedAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  box.textContent = `No connection. Showing the forecast saved ${describeAge(Date.now() - savedAt)} ago (${when}). `
    + 'Conditions may have changed: check again when you have signal.';
  box.hidden = false;
}

async function search(query) {
  const list = $('search-results');
  list.hidden = true;
  list.replaceChildren();
  setStatus('Searching...');
  try {
    const body = await getJson(geocodeUrl(query));
    const results = rankPlaces(body.results || [], query).slice(0, 8);
    if (!results.length) { setStatus(`No places found for "${query}".`, true); return; }
    setStatus('Pick your launch spot:');
    results.forEach((r) => {
      const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        list.hidden = true;
        loadPlace({ name: label, lat: r.latitude, lon: r.longitude });
      });
      const li = document.createElement('li');
      li.append(btn);
      list.append(li);
    });
    list.hidden = false;
  } catch (err) {
    setStatus(`Search failed: ${err.message}`, true);
  }
}

// ---------- rendering ----------
const fmt = (v, digits = 0, unit = '') => (v == null ? '--' : `${v.toFixed(digits)}${unit}`);
const dayFmt = { weekday: 'short', day: 'numeric', month: 'short' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v; else if (k === 'style') node.style.cssText = v; else node.setAttribute(k, v);
  });
  node.append(...children.filter((c) => c != null));
  return node;
}

function render() {
  const { weather, marine } = state.data;
  const limits = readLimits();
  const seaBearing = readSeaBearing();
  const daylight = buildDaylight(weather.daily);
  const nowT = localNow(weather.utc_offset_seconds);
  const hourStart = nowT - (nowT % 3600e3);

  const spread = ensembleSpread(state.data.ensemble);
  const all = attachSpread(mergeHourly(weather, marine), spread)
    .map((h, i, arr) => ({ ...h, tide: tideTrend(arr, i), ...rateHour(h, limits, { seaBearing, daylight }) }));
  const rows = all.filter((h) => h.t >= hourStart).slice(0, HOURS_SHOWN);
  if (!rows.length) { setStatus('Forecast returned no future hours.', true); return; }

  $('report').hidden = false;
  const coverage = seaCoverage(marine, state.place.lat, state.place.lon);
  renderSeaPoint(coverage);
  const off = state.official;
  renderTideReliability(off?.status === 'ok'
    ? {
      level: 'official', area: off.station.name, station: off.station.name, officialUrl: easyTideUrl(off.station.id),
      summary: `Official Admiralty predictions for ${off.station.name}, the nearest tidal station (${off.station.km.toFixed(1)} km from your launch). Times below are official; the model's difference is shown for each.`,
    }
    : tideReliability(state.place.lat, state.place.lon, coverage));
  const hazards = hazardsNear(state.place.lat, state.place.lon);
  renderHazards(hazards);
  renderVerdict(rows[0], seaBearing, hazards);
  renderNow(rows[0], seaBearing);
  renderTides(all, hourStart);
  renderWindows(rows);
  renderDaylight(daylight, hourStart);
  renderChart(rows, daylight, limits);
  renderTable(rows, daylight);
  renderPlan(rows, daylight);
  state.logHours = all.filter((h) => h.t <= hourStart);
  renderLogForm();
  renderLog();
}

function renderSeaPoint(cov) {
  const box = $('sea-point');
  if (cov.status === 'none') {
    box.className = 'sea-point bad';
    box.textContent = state.data.marine
      ? 'No sea data for this spot: it looks inland. Check you picked the right place, or enter the coordinates of your launch beach.'
      : `Sea data could not be loaded (${state.data.marineError}). Waves, tide and current are not being checked.`;
    return;
  }
  const where = `${Math.abs(cov.lat).toFixed(2)}\u00b0${cov.lat >= 0 ? 'N' : 'S'} ${Math.abs(cov.lon).toFixed(2)}\u00b0${cov.lon >= 0 ? 'E' : 'W'}`;
  box.className = `sea-point ${cov.status}`;
  box.textContent = `Waves, tide and current are for the nearest sea model point (${where}), ${cov.distanceKm.toFixed(1)} km from your launch.`
    + (cov.status === 'far'
      ? ` That is more than ${FAR_SEA_POINT_KM} km away, so it may be open water rather than your bay, harbour or river.`
      : '');
}

const CONFIDENCE_TEXT = {
  high: 'Model runs agree: high confidence',
  medium: 'Model runs differ: medium confidence',
  low: 'Model runs disagree: low confidence',
};

const RELIABILITY_LABEL = { official: 'OFFICIAL', medium: 'MEDIUM', low: 'LOW', unchecked: 'NOT CHECKED', none: 'NO DATA' };

function renderTideReliability(rel) {
  const box = $('tide-reliability');
  box.className = `reliability ${rel.level}`;
  const linkText = rel.station
    ? `Official tide times: ${rel.station} (Admiralty EasyTide)`
    : 'Find official tide times for the nearest port (Admiralty EasyTide)';
  box.replaceChildren(
    el('p', { class: 'rel-head' },
      el('span', { class: `badge ${rel.level}` }, `Tide reliability: ${RELIABILITY_LABEL[rel.level]}`),
      rel.area ? ` ${rel.area}` : null),
    el('p', {}, rel.summary, rel.area ? ` Checked against official predictions on ${TIDE_CHECKED_ON}.` : null),
    el('p', {}, el('a', { class: 'official', href: rel.officialUrl, rel: 'noopener', target: '_blank' }, linkText)),
  );
}

function renderHazards(hazards) {
  const list = $('hazards');
  if (!hazards.length) {
    list.replaceChildren(el('li', {}, `None on this list within ${HAZARD_RADIUS_KM} km. That does not mean there are none: check a chart and pilot guide.`));
    return;
  }
  list.replaceChildren(...hazards.map((h) => el('li', {},
    el('strong', {}, h.name), ` ${h.km.toFixed(1)} km ${h.direction}`,
    el('span', { class: h.checked ? 'pos checked' : 'pos' }, h.checked ? ' position checked' : ' position approximate'),
    el('br'), h.note)));
}

function renderVerdict(h, seaBearing, hazards = []) {
  const box = $('verdict');
  box.className = `verdict ${h.rating}`;
  const text = {
    go: 'Conditions are inside your limits right now.',
    caution: 'Possible with care, but check each reason below before you decide.',
    nogo: 'Conditions are outside your limits right now.',
  }[h.rating];
  const reasons = h.reasons.map((r) => el('li', {}, r.text));
  box.replaceChildren(...[
    el('h2', {}, `${RATING_LABEL[h.rating]} for ${formatLocal(h.t)}`),
    el('p', {}, text),
    reasons.length ? el('ul', {}, ...reasons) : null,
    hazards.length ? el('p', { class: 'hazard-line' }, `Known tidal race nearby: ${hazards[0].name}, ${hazards[0].km.toFixed(1)} km ${hazards[0].direction}`
      + `${hazards.length > 1 ? ` (and ${hazards.length - 1} more)` : ''}. Plan your route and timing around it.`) : null,
    seaBearing == null ? el('p', { class: 'fine' }, 'Tip: set which way your beach faces to get offshore wind warnings.') : null,
  ].filter(Boolean));
}

function card(k, v, d) {
  return el('div', { class: 'card' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v), d ? el('div', { class: 'd' }, d) : null);
}

function windArrow(fromDeg) {
  // Arrow points the way the wind is blowing (downwind).
  return el('span', { class: 'arrow', style: `transform: rotate(${fromDeg + 180}deg)`, 'aria-hidden': 'true' }, '↑');
}

function renderNow(h, seaBearing) {
  const rel = windRelativeToShore(h.windDir, seaBearing);
  const windV = el('span', {}, fmt(h.windKn, 0, ' kn'), h.windDir != null ? windArrow(h.windDir) : null);
  const cards = [
    card('Wind', windV, `Force ${beaufort(h.windKn) ?? '--'} from ${compassPoint(h.windDir)}${rel ? `, ${rel}` : ''}`),
    card('Wind range', h.windP90 == null ? '--' : `${h.windP10.toFixed(0)} to ${h.windP90.toFixed(0)} kn`,
      h.windP90 == null ? 'Forecast confidence unavailable' : CONFIDENCE_TEXT[windConfidence(h.windP10, h.windP90)]),
    card('Gusts', fmt(h.gustKn, 0, ' kn')),
    card('Waves', fmt(h.waveM, 1, ' m'), h.wavePeriodS != null ? `${h.wavePeriodS.toFixed(0)} s period, from ${compassPoint(h.waveDir)}` : 'No marine data'),
    card('Swell', fmt(h.swellM, 1, ' m'), h.swellPeriodS != null ? `${h.swellPeriodS.toFixed(0)} s period` : null),
    card('Tide (model)', h.seaLevelM == null ? '--' : `${h.seaLevelM >= 0 ? '+' : ''}${h.seaLevelM.toFixed(1)} m`,
      h.tide ? `${h.tide === 'rising' ? '\u2191 Rising' : '\u2193 Falling'}, relative to mean sea level` : 'No tide data here'),
    card('Current (model)', fmt(h.currentKn, 1, ' kn'), h.currentDir != null ? `setting towards ${compassPoint(h.currentDir)}` : null),
    card('Sea temp', fmt(h.seaTempC, 0, ' °C'), h.seaTempC != null && h.seaTempC < 15 ? 'Cold water: dress for immersion' : null),
    card('Air', fmt(h.tempC, 0, ' °C'), `Feels like ${fmt(h.feelsC, 0, ' °C')}`),
    card('Sky', weatherText(h.code), h.rainProb != null ? `${h.rainProb}% chance of rain` : null),
    card('Visibility', h.visibilityM == null ? '--' : `${(h.visibilityM / 1000).toFixed(h.visibilityM < 10000 ? 1 : 0)} km`),
  ];
  $('now-cards').replaceChildren(...cards);
}

function renderTides(all, hourStart) {
  const list = $('tides');
  if (state.official?.status === 'ok') {
    const events = compareWithModel(state.official.events, findTideTurns(all), state.data.weather.utc_offset_seconds)
      .filter((e) => e.t >= hourStart - 6 * 3600e3).slice(0, 8);
    list.replaceChildren(...events.map((e) => el('li', {},
      el('strong', {}, e.type === 'high' ? 'High ' : 'Low '),
      `${formatLocal(e.t, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}  ${e.heightM == null ? '' : `${e.heightM.toFixed(2)} m`}`,
      el('span', { class: 'fine model-diff' }, e.modelDiffMin == null ? '  (no matching model time)'
        : e.modelDiffMin === 0 ? '  (model agrees)'
          : `  (model ${Math.abs(e.modelDiffMin)} min ${e.modelDiffMin < 0 ? 'early' : 'late'})`),
      e.t < hourStart ? el('span', { class: 'fine' }, ' (passed)') : null,
    )));
    $('tides-heading').textContent = 'Tides (official)';
    return;
  }
  $('tides-heading').textContent = 'Tides (modelled)';
  const turns = findTideTurns(all).filter((t) => t.t >= hourStart - 6 * 3600e3);
  if (!turns.length) {
    list.replaceChildren(el('li', {}, 'No tide data for this point. It may be too far inland or in a sheltered inlet the model does not resolve.'));
    return;
  }
  list.replaceChildren(...turns.slice(0, 8).map((t) => el('li', {},
    el('strong', {}, t.type === 'high' ? 'High ' : 'Low '),
    `${formatLocal(t.t, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}  ${t.heightM >= 0 ? '+' : ''}${t.heightM.toFixed(2)} m`,
    t.secondT ? el('span', { class: 'fine' }, `  double ${t.type === 'high' ? 'high' : 'low'} water, second peak ${formatLocal(t.secondT)}`) : null,
    t.t < hourStart ? el('span', { class: 'fine' }, ' (passed)') : null,
  )));
}

function formatDuration(hours) {
  const min = Math.round(hours * 60);
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

function renderPlan(rows, daylight) {
  const opts = readPlan();
  const body = $('plan-table').querySelector('tbody');
  const note = $('plan-note');
  if (!(opts.distanceNm > 0) || !(opts.speedKn > 0)) {
    body.replaceChildren();
    note.textContent = 'Enter a distance and paddling speed above zero.';
    return;
  }
  const { best, infeasible } = planDepartures(rows, daylight, opts);
  const dayTime = (t) => formatLocal(t, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  body.replaceChildren(...best.slice(0, 6).map((p, i) => el('tr', { class: i === 0 ? 'best' : '' },
    el('td', {}, dayTime(p.start)),
    el('td', {}, `${dayTime(p.end)}${p.endsInDaylight ? '' : ' (dark)'}`),
    el('td', {}, formatDuration(p.hours)),
    el('td', {}, `${p.avgAssistKn >= 0 ? '+' : ''}${p.avgAssistKn.toFixed(1)} kn`),
    el('td', {}, el('span', { class: `pill ${p.worst}` }, RATING_LABEL[p.worst])),
    el('td', { class: 'why' }, p.reasons.join(', ')),
  )));
  const parts = [];
  if (!best.length) parts.push('No daylight departure in the forecast finishes this trip.');
  if (infeasible.length) parts.push(`${infeasible.length} daylight departure${infeasible.length === 1 ? '' : 's'} left out: ${infeasible[0].why}${infeasible.length > 1 ? ', and others' : ''}.`);
  note.textContent = parts.join(' ');
}

// ---------- trip log ----------
function renderLogForm() {
  const sel = $('log-hour');
  const keep = sel.value;
  sel.replaceChildren(...state.logHours.slice().reverse().map((h) => el('option', { value: h.time },
    formatLocal(h.t, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))));
  if (keep && state.logHours.some((h) => h.time === keep)) sel.value = keep; else prefillLog();
}

function prefillLog() {
  const h = state.logHours.find((x) => x.time === $('log-hour').value);
  if (!h) return;
  $('log-wind').value = h.windKn == null ? '' : Math.round(h.windKn);
  $('log-gust').value = h.gustKn == null ? '' : Math.round(h.gustKn);
  $('log-wave').value = h.waveM == null ? '' : h.waveM.toFixed(1);
}

function renderLog() {
  const entries = loadLog();
  const list = $('log-list');
  list.replaceChildren(...(entries.length ? entries.map((e) => {
    const del = el('button', { type: 'button', class: 'secondary small', 'data-id': e.id }, 'Delete');
    del.addEventListener('click', () => { saveLog(loadLog().filter((x) => x.id !== e.id)); renderLog(); });
    const when = formatLocal(Date.parse(`${e.when}:00Z`), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const cond = [e.windKn != null && `wind ${Math.round(e.windKn)} kn`, e.gustKn != null && `gusts ${Math.round(e.gustKn)} kn`, e.waveM != null && `waves ${e.waveM.toFixed(1)} m`].filter(Boolean).join(', ');
    return el('li', {}, el('strong', {}, `${when}, ${e.place}`), `: ${cond}. `, el('span', { class: `feel ${e.feel}` }, FEELS[e.feel]),
      e.notes ? ` "${e.notes}"` : '', ' ', del);
  }) : [el('li', {}, 'No trips logged yet.')]));

  const suggestions = suggestLimits(entries, readLimits());
  $('log-suggest').querySelector('tbody').replaceChildren(...suggestions.map((s) => el('tr', { class: s.suggested !== s.current ? 'change' : '' },
    el('td', {}, s.metric.label),
    el('td', {}, `${s.current} ${s.metric.unit}`),
    el('td', {}, s.suggested === s.current ? 'Keep' : `${s.suggested} ${s.metric.unit}`),
    el('td', { class: 'why' }, s.reason))));
  $('log-apply').disabled = !suggestions.some((s) => s.suggested !== s.current);
  state.suggestions = suggestions;
}

function renderWindows(rows) {
  const windows = findWindows(rows, 2);
  const list = $('windows');
  if (!windows.length) {
    list.replaceChildren(el('li', {}, 'No 2+ hour daylight window inside your limits in the next 3 days.'));
    return;
  }
  list.replaceChildren(...windows.slice(0, 6).map((w) => el('li', {},
    el('strong', {}, formatLocal(w.start, dayFmt)), ` ${formatLocal(w.start)} to ${formatLocal(w.end)} (${w.hours} h)`)));
}

function renderDaylight(daylight, hourStart) {
  $('daylight').replaceChildren(...daylight.filter((d) => d.sunset >= hourStart).slice(0, 3).map((d) => el('li', {},
    el('strong', {}, formatLocal(d.sunrise, dayFmt)), ` sunrise ${formatLocal(d.sunrise)}, sunset ${formatLocal(d.sunset)}`)));
}

// Three stacked mini-charts (wind, waves, sea level) with a rating strip,
// night shading and your limits drawn as dashed lines.
function renderChart(rows, daylight, limits) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000; const left = 44; const right = 10; const top = 14;
  const stripH = 10; const panelH = 90; const gap = 22;
  const panels = [
    { key: 'wind', series: [['gustKn', 'var(--c-gust)'], ['windKn', 'var(--c-wind)']], band: ['windP10', 'windP90'], unit: 'kn', limit: limits.maxWindKn, min0: true },
    { key: 'wave', series: [['waveM', 'var(--c-wave)']], unit: 'm', limit: limits.maxWaveM, min0: true },
    { key: 'tide', series: [['seaLevelM', 'var(--c-tide)']], unit: 'm', limit: null, min0: false },
  ];
  const H = top + stripH + 8 + panels.length * (panelH + gap) + 10;
  const t0 = rows[0].t; const t1 = rows[rows.length - 1].t + 3600e3;
  const x = (t) => left + ((t - t0) / (t1 - t0)) * (W - left - right);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Chart of wind, waves and sea level for the next 72 hours');
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };

  // Night shading across the full height.
  rows.forEach((h) => {
    if (!isDaylight(h.t, daylight)) add('rect', { x: x(h.t), y: top, width: x(h.t + 3600e3) - x(h.t), height: H - top, fill: 'var(--night)' });
  });
  // Rating strip.
  rows.forEach((h) => add('rect', {
    x: x(h.t), y: top, width: Math.max(1, x(h.t + 3600e3) - x(h.t) - 0.5), height: stripH, fill: `var(--${h.rating})`,
  }));
  // Midnight lines and day labels.
  // The first label is skipped when the next midnight is too close to fit it.
  const firstMidnight = rows.find((h) => new Date(h.t).getUTCHours() === 0);
  rows.forEach((h) => {
    const isMidnight = new Date(h.t).getUTCHours() === 0;
    const fitsFirst = h === rows[0] && !isMidnight && (!firstMidnight || x(firstMidnight.t) - x(h.t) > 60);
    if (isMidnight) add('line', { x1: x(h.t), x2: x(h.t), y1: top, y2: H - 10, stroke: 'var(--line)' });
    if (isMidnight || fitsFirst) add('text', { x: x(h.t) + 4, y: top - 3 }, formatLocal(h.t, { weekday: 'short', day: 'numeric' }));
  });

  panels.forEach((p, pi) => {
    const y0 = top + stripH + 8 + pi * (panelH + gap);
    const keys = [...p.series.map(([k]) => k), ...(p.band || [])];
    const vals = rows.flatMap((h) => keys.map((k) => h[k])).filter((v) => v != null);
    if (!vals.length) {
      add('text', { x: left + 8, y: y0 + panelH / 2 }, `No ${p.key} data`);
      return;
    }
    let lo = p.min0 ? 0 : Math.min(...vals);
    let hi = Math.max(...vals, p.limit ?? -Infinity);
    if (hi - lo < 0.5) { hi += 0.25; lo -= p.min0 ? 0 : 0.25; }
    hi += (hi - lo) * 0.1;
    const y = (v) => y0 + panelH - ((v - lo) / (hi - lo)) * panelH;

    add('line', { x1: left, x2: W - right, y1: y0 + panelH, y2: y0 + panelH, stroke: 'var(--line)' });
    [lo, (lo + hi) / 2, hi].forEach((v) => add('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end' }, v.toFixed(hi < 5 ? 1 : 0)));
    add('text', { x: left - 6, y: y0 - 10, 'text-anchor': 'end' }, p.unit);
    if (p.limit != null) {
      add('line', { x1: left, x2: W - right, y1: y(p.limit), y2: y(p.limit), stroke: 'var(--nogo)', 'stroke-dasharray': '5 4', 'stroke-width': 1 });
      add('text', { x: W - right, y: y(p.limit) - 4, 'text-anchor': 'end' }, 'your limit');
    }
    if (p.band) {
      // Shaded 10th to 90th percentile range of the model runs.
      const [kLo, kHi] = p.band;
      const pts = rows.filter((h) => h[kLo] != null && h[kHi] != null);
      if (pts.length > 1) {
        const upper = pts.map((h) => `${x(h.t + 1800e3).toFixed(1)},${y(h[kHi]).toFixed(1)}`);
        const lower = pts.slice().reverse().map((h) => `${x(h.t + 1800e3).toFixed(1)},${y(h[kLo]).toFixed(1)}`);
        add('path', { d: `M${upper.join('L')}L${lower.join('L')}Z`, fill: 'var(--c-wind)', 'fill-opacity': 0.15, stroke: 'none', class: 'spread-band' });
      }
    }
    p.series.forEach(([k, color]) => {
      let d = ''; let pen = false;
      rows.forEach((h) => {
        if (h[k] == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(h.t + 1800e3).toFixed(1)},${y(h[k]).toFixed(1)}`;
        pen = true;
      });
      add('path', { d, fill: 'none', stroke: color, 'stroke-width': k === 'gustKn' ? 1.5 : 2.5, 'stroke-linejoin': 'round' });
    });
  });

  $('chart').replaceChildren(svg);
}

function renderTable(rows, daylight) {
  const body = $('hourly').querySelector('tbody');
  const out = [];
  let lastDay = null;
  rows.forEach((h) => {
    const day = formatLocal(h.t, dayFmt);
    if (day !== lastDay) {
      out.push(el('tr', { class: 'day-break' }, el('td', { colspan: '15' }, day)));
      lastDay = day;
    }
    out.push(el('tr', { class: isDaylight(h.t, daylight) ? '' : 'night' },
      el('td', {}, formatLocal(h.t)),
      el('td', {}, el('span', { class: `pill ${h.rating}` }, RATING_LABEL[h.rating])),
      el('td', {}, fmt(h.windKn, 0)),
      el('td', {}, fmt(h.gustKn, 0)),
      el('td', {}, h.windP90 == null ? '--' : `${h.windP10.toFixed(0)}-${h.windP90.toFixed(0)}`),
      el('td', {}, h.windDir != null ? el('span', {}, compassPoint(h.windDir), windArrow(h.windDir)) : '--'),
      el('td', {}, fmt(h.waveM, 1, ' m')),
      el('td', {}, h.swellM == null ? '--' : `${h.swellM.toFixed(1)} m / ${fmt(h.swellPeriodS, 0, 's')}`),
      el('td', {}, fmt(h.currentKn, 1, ' kn')),
      el('td', {}, h.seaLevelM == null ? '--' : `${h.seaLevelM.toFixed(1)} ${h.tide === 'rising' ? '\u2191' : '\u2193'}`),
      el('td', {}, fmt(h.seaTempC, 0, '°')),
      el('td', {}, fmt(h.tempC, 0, '°')),
      el('td', {}, h.rainProb == null ? '--' : `${h.rainProb}%`),
      el('td', {}, weatherText(h.code)),
      el('td', { class: 'why', title: h.reasons.map((r) => r.text).join('\n') }, h.reasons.map((r) => r.tag).join(', ')),
    ));
  });
  body.replaceChildren(...out);
}

// ---------- init ----------
function init() {
  const prefs = loadPrefs();
  Object.entries(PROFILES).forEach(([key, p]) => $('profile').append(el('option', { value: key }, p.label)));
  $('profile').value = prefs.profile && PROFILES[prefs.profile] ? prefs.profile : 'beginner';
  writeLimits({ ...PROFILES[$('profile').value], ...(prefs.limits || {}) });
  if (prefs.seaBearing != null) $('sea-bearing').value = prefs.seaBearing;

  const onSettingsChange = () => { savePrefs(); if (state.data) render(); };
  $('profile').addEventListener('change', () => { writeLimits(PROFILES[$('profile').value]); onSettingsChange(); });
  $('sea-bearing').addEventListener('change', onSettingsChange);
  LIMIT_KEYS.forEach((k) => $(k).addEventListener('input', onSettingsChange));
  writePlan(prefs.plan);
  Object.entries(FEELS).forEach(([k, label]) => $('log-feel').append(el('option', { value: k }, label)));
  $('log-feel').value = 'ok';
  $('log-hour').addEventListener('change', prefillLog);
  $('log-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const h = state.logHours?.find((x) => x.time === $('log-hour').value);
    if (!h || !state.place) return;
    const val = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
    const entry = makeEntry({
      place: state.place, feel: $('log-feel').value, notes: $('log-notes').value,
      hour: { ...h, windKn: val('log-wind'), gustKn: val('log-gust'), waveM: val('log-wave') },
    });
    saveLog(mergeEntries(loadLog(), [entry]));
    $('log-notes').value = '';
    renderLog();
  });
  $('log-apply').addEventListener('click', () => {
    const limits = readLimits();
    for (const s of state.suggestions || []) limits[s.metric.limit] = s.suggested;
    writeLimits(limits);
    onSettingsChange();
  });
  $('log-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(loadLog(), null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'kayak-trip-log.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('log-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const before = loadLog().length;
      const merged = mergeEntries(loadLog(), JSON.parse(await file.text()));
      saveLog(merged);
      $('log-status').textContent = `Imported: ${merged.length - before} new trip(s).`;
    } catch {
      $('log-status').textContent = 'That file is not a trip log.';
    }
    e.target.value = '';
    renderLog();
  });
  PLAN_IDS.forEach((id) => $(id).addEventListener('input', onSettingsChange));

  $('admiralty-key').value = getAdmiraltyKey();
  $('admiralty-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setAdmiraltyKey($('admiralty-key').value.trim());
    setOfficialStatus(getAdmiraltyKey() ? 'Key saved in this browser.' : 'Key removed.');
    if (state.place && state.data) { state.official = null; render(); loadOfficialTides(state.place); }
  });

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('search').value.trim();
    if (q) search(q);
  });
  $('coord-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const lat = parseFloat($('lat').value); const lon = parseFloat($('lon').value);
    loadPlace({ name: 'Custom point', lat, lon });
  });
  $('geo-btn').addEventListener('click', () => {
    if (!navigator.geolocation) { setStatus('Location is not available in this browser.', true); return; }
    setStatus('Finding your location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => loadPlace({ name: 'Your location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => setStatus(`Could not get your location: ${err.message}`, true),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });

  renderLog();
  if (prefs.place) loadPlace(prefs.place);
  else setStatus('Search for a launch spot to see conditions.');
}

// Cache the page itself so it opens without signal. Skipped on file:// pages.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
}

init();
