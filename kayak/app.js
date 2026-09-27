// UI wiring for the sea kayak conditions app. Fetches Open-Meteo weather,
// marine and geocoding data (free, no API key) and renders the report.
import {
  PROFILES, RATING, mergeHourly, buildDaylight, isDaylight, findTideTurns, rateHour,
  findWindows, compassPoint, beaufort, windRelativeToShore, formatLocal, localNow, weatherText,
} from './logic.js';

const HOURS_SHOWN = 72;
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const LIMIT_KEYS = ['maxWindKn', 'maxGustKn', 'maxWaveM', 'maxOffshoreKn', 'maxCurrentKn'];
const STORE_KEY = 'seaKayakConditions.v1';
const RATING_LABEL = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' };

const $ = (id) => document.getElementById(id);
const state = { place: null, data: null };

// ---------- persistence (per-browser convenience only) ----------
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function savePrefs() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      place: state.place, profile: $('profile').value, seaBearing: $('sea-bearing').value, limits: readLimits(),
    }));
  } catch { /* storage unavailable: settings just won't persist */ }
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
async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.reason || `HTTP ${res.status}`);
  return body;
}

async function fetchConditions(lat, lon) {
  const common = `latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=4`;
  const weatherUrl = `${WEATHER_URL}?${common}&wind_speed_unit=kn&hourly=${[
    'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation',
    'weather_code', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  ].join(',')}&daily=sunrise,sunset`;
  const marineUrl = `${MARINE_URL}?${common}&hourly=${[
    'wave_height', 'wave_direction', 'wave_period', 'swell_wave_height', 'swell_wave_period',
    'sea_surface_temperature', 'sea_level_height_msl', 'ocean_current_velocity', 'ocean_current_direction',
  ].join(',')}`;

  const [weather, marine] = await Promise.allSettled([getJson(weatherUrl), getJson(marineUrl)]);
  if (weather.status === 'rejected') throw new Error(`Weather forecast failed: ${weather.reason.message}`);
  return {
    weather: weather.value,
    marine: marine.status === 'fulfilled' ? marine.value : null,
    marineError: marine.status === 'rejected' ? marine.reason.message : null,
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
    render();
    setStatus(`Forecast for ${place.name} (${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}).`
      + (state.data.marineError ? ` Marine data unavailable: ${state.data.marineError}` : ''));
  } catch (err) {
    setStatus(`${err.message}. Check your connection and try again.`, true);
  }
}

async function search(query) {
  const list = $('search-results');
  list.hidden = true;
  list.replaceChildren();
  setStatus('Searching...');
  try {
    const body = await getJson(`${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`);
    const results = body.results || [];
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

  const all = mergeHourly(weather, marine).map((h) => ({ ...h, ...rateHour(h, limits, { seaBearing, daylight }) }));
  const rows = all.filter((h) => h.t >= hourStart).slice(0, HOURS_SHOWN);
  if (!rows.length) { setStatus('Forecast returned no future hours.', true); return; }

  $('report').hidden = false;
  renderVerdict(rows[0], seaBearing);
  renderNow(rows[0], seaBearing);
  renderTides(all, hourStart);
  renderWindows(rows);
  renderDaylight(daylight, hourStart);
  renderChart(rows, daylight, limits);
  renderTable(rows, daylight);
}

function renderVerdict(h, seaBearing) {
  const box = $('verdict');
  box.className = `verdict ${h.rating}`;
  const text = {
    go: 'Conditions are inside your limits right now.',
    caution: 'Possible, but something is close to your limits. Read the reasons below.',
    nogo: 'Conditions are outside your limits right now.',
  }[h.rating];
  const reasons = h.reasons.map((r) => el('li', {}, r.text));
  box.replaceChildren(...[
    el('h2', {}, `${RATING_LABEL[h.rating]} for ${formatLocal(h.t)}`),
    el('p', {}, text),
    reasons.length ? el('ul', {}, ...reasons) : null,
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
    card('Gusts', fmt(h.gustKn, 0, ' kn')),
    card('Waves', fmt(h.waveM, 1, ' m'), h.wavePeriodS != null ? `${h.wavePeriodS.toFixed(0)} s period, from ${compassPoint(h.waveDir)}` : 'No marine data'),
    card('Swell', fmt(h.swellM, 1, ' m'), h.swellPeriodS != null ? `${h.swellPeriodS.toFixed(0)} s period` : null),
    card('Current', fmt(h.currentKn, 1, ' kn'), h.currentDir != null ? `setting towards ${compassPoint(h.currentDir)}` : null),
    card('Sea temp', fmt(h.seaTempC, 0, ' °C'), h.seaTempC != null && h.seaTempC < 15 ? 'Cold water: dress for immersion' : null),
    card('Air', fmt(h.tempC, 0, ' °C'), `Feels like ${fmt(h.feelsC, 0, ' °C')}`),
    card('Sky', weatherText(h.code), h.rainProb != null ? `${h.rainProb}% chance of rain` : null),
    card('Visibility', h.visibilityM == null ? '--' : `${(h.visibilityM / 1000).toFixed(h.visibilityM < 10000 ? 1 : 0)} km`),
  ];
  $('now-cards').replaceChildren(...cards);
}

function renderTides(all, hourStart) {
  const turns = findTideTurns(all).filter((t) => t.t >= hourStart - 6 * 3600e3);
  const list = $('tides');
  if (!turns.length) {
    list.replaceChildren(el('li', {}, 'No tide data for this point. It may be too far inland or in a sheltered inlet the model does not resolve.'));
    return;
  }
  list.replaceChildren(...turns.slice(0, 8).map((t) => el('li', {},
    el('strong', {}, t.type === 'high' ? 'High ' : 'Low '),
    `${formatLocal(t.t, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}  ${t.heightM >= 0 ? '+' : ''}${t.heightM.toFixed(2)} m`,
    t.t < hourStart ? el('span', { class: 'fine' }, ' (passed)') : null,
  )));
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
    { key: 'wind', series: [['gustKn', 'var(--c-gust)'], ['windKn', 'var(--c-wind)']], unit: 'kn', limit: limits.maxWindKn, min0: true },
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
    const vals = rows.flatMap((h) => p.series.map(([k]) => h[k])).filter((v) => v != null);
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
      out.push(el('tr', { class: 'day-break' }, el('td', { colspan: '12' }, day)));
      lastDay = day;
    }
    out.push(el('tr', { class: isDaylight(h.t, daylight) ? '' : 'night' },
      el('td', {}, formatLocal(h.t)),
      el('td', {}, el('span', { class: `pill ${h.rating}` }, RATING_LABEL[h.rating])),
      el('td', {}, fmt(h.windKn, 0)),
      el('td', {}, fmt(h.gustKn, 0)),
      el('td', {}, h.windDir != null ? el('span', {}, compassPoint(h.windDir), windArrow(h.windDir)) : '--'),
      el('td', {}, fmt(h.waveM, 1, ' m')),
      el('td', {}, h.swellM == null ? '--' : `${h.swellM.toFixed(1)} m / ${fmt(h.swellPeriodS, 0, 's')}`),
      el('td', {}, fmt(h.currentKn, 1, ' kn')),
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

  if (prefs.place) loadPlace(prefs.place);
  else setStatus('Search for a launch spot to see conditions.');
}

init();
