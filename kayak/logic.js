// Pure logic for the sea kayak conditions app: data merging, unit
// conversion, tide turning points and per-hour GO / CAUTION / NO-GO rating.
// No DOM or network access here so it can be unit tested under Node.

export const RATING = { GO: 'go', CAUTION: 'caution', NOGO: 'nogo' };

// Default limits per paddler profile. These are starting points, loosely
// based on common sea kayak club guidance (sheltered water up to about F3,
// moderate water about F4, advanced about F5). Every value is editable in
// the UI because local geography matters more than any generic number.
export const PROFILES = {
  beginner: {
    label: 'Beginner (sheltered water)',
    maxWindKn: 10, maxGustKn: 15, maxWaveM: 0.5, maxOffshoreKn: 5, maxCurrentKn: 1,
  },
  intermediate: {
    label: 'Intermediate (moderate water)',
    maxWindKn: 15, maxGustKn: 21, maxWaveM: 1.0, maxOffshoreKn: 8, maxCurrentKn: 2,
  },
  advanced: {
    label: 'Advanced (open coast)',
    maxWindKn: 21, maxGustKn: 27, maxWaveM: 1.8, maxOffshoreKn: 12, maxCurrentKn: 3.5,
  },
};

const CAUTION_FRACTION = 0.8; // within 80% of a limit counts as caution
const THUNDER_CODES = new Set([95, 96, 99]);

// ---------- units and angles ----------

export function toKnots(value, unit) {
  if (value == null || Number.isNaN(value)) return null;
  const u = String(unit || '').toLowerCase();
  if (u.includes('km/h')) return value / 1.852;
  if (u.includes('m/s')) return value * 1.943844;
  if (u.includes('mp/h') || u.includes('mph')) return value * 0.868976;
  return value; // already knots ("kn")
}

// Smallest difference between two compass bearings, 0..180 degrees.
export function angleDiff(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compassPoint(deg) {
  if (deg == null) return '--';
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// Beaufort force from knots (upper bounds of each force, WMO table).
const BEAUFORT_MAX_KN = [1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];
export function beaufort(kn) {
  if (kn == null) return null;
  const idx = BEAUFORT_MAX_KN.findIndex((max) => kn < max + 0.5);
  return idx === -1 ? 12 : idx;
}

// Wind relative to the shore. seaBearing = direction you face when standing
// on the beach looking out to sea. Wind direction is "from" (meteorological).
export function windRelativeToShore(windFromDeg, seaBearing) {
  if (windFromDeg == null || seaBearing == null) return null;
  if (angleDiff(windFromDeg, seaBearing) <= 45) return 'onshore';
  if (angleDiff((windFromDeg + 180) % 360, seaBearing) <= 45) return 'offshore';
  return 'cross-shore';
}

// ---------- time handling ----------
// Open-Meteo with timezone=auto returns local wall-clock strings with no
// offset ("2026-09-27T14:00"). Treating them as UTC keeps arithmetic and
// formatting in the location's local time, whatever the browser's zone.

export function parseLocal(str) {
  return Date.parse(str.length === 16 ? `${str}:00Z` : `${str}Z`);
}

export function formatLocal(ms, opts = { hour: '2-digit', minute: '2-digit' }) {
  return new Date(ms).toLocaleString('en-GB', { ...opts, timeZone: 'UTC' });
}

// Current wall-clock time at the forecast location, in the same "fake UTC".
export function localNow(utcOffsetSeconds, nowMs = Date.now()) {
  return nowMs + utcOffsetSeconds * 1000;
}

// ---------- merging API responses ----------

export function mergeHourly(weather, marine) {
  const w = weather.hourly;
  const m = marine?.hourly || {};
  const mUnits = marine?.hourly_units || {};
  const marineIndex = new Map((m.time || []).map((t, i) => [t, i]));
  const pick = (key, i) => (i == null || !m[key] ? null : m[key][i]);

  return w.time.map((time, i) => {
    const mi = marineIndex.get(time);
    return {
      time,
      t: parseLocal(time),
      windKn: w.wind_speed_10m[i],
      gustKn: w.wind_gusts_10m[i],
      windDir: w.wind_direction_10m[i],
      tempC: w.temperature_2m[i],
      feelsC: w.apparent_temperature[i],
      rainProb: w.precipitation_probability?.[i] ?? null,
      rainMm: w.precipitation[i],
      visibilityM: w.visibility?.[i] ?? null,
      code: w.weather_code[i],
      waveM: pick('wave_height', mi),
      waveDir: pick('wave_direction', mi),
      wavePeriodS: pick('wave_period', mi),
      swellM: pick('swell_wave_height', mi),
      swellPeriodS: pick('swell_wave_period', mi),
      seaTempC: pick('sea_surface_temperature', mi),
      seaLevelM: pick('sea_level_height_msl', mi),
      currentKn: toKnots(pick('ocean_current_velocity', mi), mUnits.ocean_current_velocity),
      currentDir: pick('ocean_current_direction', mi),
    };
  });
}

export function buildDaylight(daily) {
  return daily.time.map((day, i) => ({
    day,
    sunrise: parseLocal(daily.sunrise[i]),
    sunset: parseLocal(daily.sunset[i]),
  }));
}

export function isDaylight(t, daylight) {
  return daylight.some((d) => t >= d.sunrise && t < d.sunset);
}

// ---------- tides ----------
// Finds high and low water from the modelled sea level series, refining
// each hourly extreme with a parabola through its neighbours.
export function findTideTurns(hours) {
  const turns = [];
  for (let i = 1; i < hours.length - 1; i++) {
    const a = hours[i - 1].seaLevelM;
    const b = hours[i].seaLevelM;
    const c = hours[i + 1].seaLevelM;
    if (a == null || b == null || c == null) continue;
    const isHigh = b > a && b >= c;
    const isLow = b < a && b <= c;
    if (!isHigh && !isLow) continue;
    const denom = a - 2 * b + c;
    const offset = denom === 0 ? 0 : 0.5 * (a - c) / denom; // hours, -0.5..0.5
    const height = b - 0.25 * (a - c) * offset;
    turns.push({
      type: isHigh ? 'high' : 'low',
      t: hours[i].t + offset * 3600e3,
      heightM: height,
    });
  }
  return turns;
}

// Rising or falling at each hour, from the change to the next hour (the
// last hour uses the change from the previous one).
export function tideTrend(hours, i) {
  const cur = hours[i]?.seaLevelM;
  const next = hours[i + 1]?.seaLevelM;
  const prev = hours[i - 1]?.seaLevelM;
  if (cur == null) return null;
  const delta = next != null ? next - cur : prev != null ? cur - prev : null;
  if (delta == null) return null;
  return delta >= 0 ? 'rising' : 'falling';
}

// Orders place search results for UK paddlers: UK first, then by how well
// the name matches. A whole-word match ("Hamble-le-Rice" for "Hamble") beats
// a partial one ("Hambleton"). Otherwise keeps the service's own order.
export function rankPlaces(results, query) {
  const q = String(query).trim().toLowerCase();
  const matchRank = (name) => {
    const n = String(name).toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q) && !/[a-z]/.test(n.charAt(q.length))) return 1;
    if (n.startsWith(q)) return 2;
    return 3;
  };
  return results
    .map((r, i) => ({ r, i, uk: r.country_code === 'GB' ? 0 : 1, m: matchRank(r.name) }))
    .sort((a, b) => a.uk - b.uk || a.m - b.m || a.i - b.i)
    .map((x) => x.r);
}

// Great-circle distance in km (haversine).
export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Sea data beyond this distance from the launch may not represent it.
export const FAR_SEA_POINT_KM = 5;

// How well the marine model covers the launch. The marine API returns the
// nearest grid point, and for inland points every sea value is null.
export function seaCoverage(marine, launchLat, launchLon) {
  if (!marine?.hourly) return { status: 'none', distanceKm: null };
  const keys = ['wave_height', 'sea_level_height_msl'];
  const hasData = keys.some((k) => (marine.hourly[k] || []).some((v) => v != null));
  const km = distanceKm(launchLat, launchLon, marine.latitude, marine.longitude);
  if (!hasData) return { status: 'none', distanceKm: km };
  return { status: km > FAR_SEA_POINT_KM ? 'far' : 'near', distanceKm: km, lat: marine.latitude, lon: marine.longitude };
}

// ---------- tide reliability ----------
// Areas where the modelled tide was compared with official Admiralty
// EasyTide predictions (one check, 27 Sept 2026, about four days, roughly
// 15 high and low waters per area). Centres are the launch points used in
// that check. Station IDs are the EasyTide ones seen in that check.
export const TIDE_CHECKED_ON = '27 September 2026';
export const TIDE_CHECKS = [
  { area: 'Oban', lat: 56.41535, lon: -5.47184, radiusKm: 10, station: 'Oban', id: '0372', level: 'medium',
    summary: 'Model times were 17 to 36 minutes early. Tidal range was close (3.6 m model, 3.3 m official).' },
  { area: 'Rhoscolyn, Holy Island', lat: 53.25014, lon: -4.59793, radiusKm: 6, station: 'Trearddur Bay', id: '0479', level: 'medium',
    summary: 'Model times were 14 to 36 minutes early. Tidal range was close (4.4 m model, 4.5 m official).' },
  { area: 'Portland', lat: 50.51733, lon: -2.45566, radiusKm: 6, station: 'Portland', id: '0033', level: 'low',
    summary: 'Model high water was about 50 minutes early and the tidal range was overstated (3.4 m model, 1.9 m official). Portland\'s double low water is not shown.' },
  { area: 'Hamble River', lat: 50.85966, lon: -1.32432, radiusKm: 4, station: 'Warsash', id: '0063A', level: 'low',
    summary: 'Model times were 80 to 133 minutes early and the tidal range was about half the official one (1.8 m model, 3.7 m official).' },
  { area: 'Southampton Water and the Itchen', lat: 50.90451, lon: -1.36936, radiusKm: 4, station: 'Southampton', id: '0062', level: 'low',
    summary: 'Model times were 80 to 122 minutes early and the tidal range was less than half the official one (1.8 m model, 4.0 m official).' },
  { area: 'Poole Harbour', lat: 50.71429, lon: -1.98458, radiusKm: 6, station: 'Poole Harbour', id: '0036A', level: 'low',
    summary: 'Model times were 109 to 163 minutes early.' },
];

export const EASYTIDE_HOME = 'https://easytide.admiralty.co.uk/';
export function easyTideUrl(stationId) {
  return `${EASYTIDE_HOME}?PortID=${encodeURIComponent(stationId)}`;
}

// How far to trust the modelled tide at a launch, and where to find the
// official times. Levels: medium, low, unchecked, none (no sea data).
export function tideReliability(lat, lon, coverage) {
  if (!coverage || coverage.status === 'none') {
    return { level: 'none', summary: 'No modelled tide for this spot.', officialUrl: EASYTIDE_HOME };
  }
  const nearest = TIDE_CHECKS
    .map((c) => ({ c, km: distanceKm(lat, lon, c.lat, c.lon) }))
    .filter(({ c, km }) => km <= c.radiusKm)
    .sort((a, b) => a.km - b.km)[0];
  if (nearest) {
    const { c } = nearest;
    return { level: c.level, area: c.area, summary: c.summary, station: c.station, stationId: c.id, officialUrl: easyTideUrl(c.id) };
  }
  if (coverage.status === 'far') {
    return {
      level: 'low', officialUrl: EASYTIDE_HOME,
      summary: `Not checked here, but the sea model point is ${coverage.distanceKm.toFixed(1)} km away. Where that was true in testing (Hamble, Itchen, Poole), model times were 1.5 to 2.5 hours early.`,
    };
  }
  return {
    level: 'unchecked', officialUrl: EASYTIDE_HOME,
    summary: 'Not checked here. On the open coasts that were checked, model times were 15 to 35 minutes early.',
  };
}

// ---------- rating ----------

function worse(a, b) {
  const order = [RATING.GO, RATING.CAUTION, RATING.NOGO];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}

export function rateHour(h, limits, opts = {}) {
  const { seaBearing = null, daylight = [] } = opts;
  let rating = RATING.GO;
  const reasons = [];
  const flag = (level, text, tag) => { rating = worse(rating, level); reasons.push({ level, text, tag }); };
  const check = (value, max, label, unit, digits = 0) => {
    if (value == null || max == null) return;
    const v = `${value.toFixed(digits)}${unit}`;
    if (value > max) flag(RATING.NOGO, `${label} ${v} over your ${max}${unit} limit`, label);
    else if (value > max * CAUTION_FRACTION) flag(RATING.CAUTION, `${label} ${v} near your ${max}${unit} limit`, label);
  };

  check(h.windKn, limits.maxWindKn, 'Wind', ' kn');
  if (h.windP90 != null && h.windKn != null && h.windKn <= limits.maxWindKn && h.windP90 > limits.maxWindKn) {
    flag(RATING.CAUTION, `Forecast uncertain: 1 in 10 model runs show ${h.windP90.toFixed(0)} kn or more, over your ${limits.maxWindKn} kn limit`, 'Uncertain');
  }
  check(h.gustKn, limits.maxGustKn, 'Gusts', ' kn');
  check(h.waveM, limits.maxWaveM, 'Waves', ' m', 1);
  check(h.currentKn, limits.maxCurrentKn, 'Current', ' kn', 1);

  const rel = windRelativeToShore(h.windDir, seaBearing);
  if (rel === 'offshore' && h.windKn != null) {
    if (h.windKn > limits.maxOffshoreKn) {
      flag(RATING.NOGO, `Offshore wind ${h.windKn.toFixed(0)} kn: it will push you out to sea`, 'Offshore');
    } else if (h.windKn >= 5) {
      flag(RATING.CAUTION, 'Offshore wind: returning to shore will be harder than leaving', 'Offshore');
    }
  }

  // Wind against current steepens waves. Wind direction is "from", current
  // direction is taken as "towards" (oceanographic convention), so the wind
  // opposes the flow when the wind comes FROM roughly where the water goes TO.
  if (h.currentKn != null && h.currentKn >= 1 && h.windKn >= 10 && h.currentDir != null && h.windDir != null
      && angleDiff(h.windDir, h.currentDir) <= 45) {
    flag(RATING.CAUTION, 'Wind against current: expect short, steep waves', 'Wind v current');
  }

  if (h.visibilityM != null) {
    if (h.visibilityM < 1000) flag(RATING.NOGO, `Fog: visibility ${Math.round(h.visibilityM)} m`, 'Fog');
    else if (h.visibilityM < 4000) flag(RATING.CAUTION, `Poor visibility ${(h.visibilityM / 1000).toFixed(1)} km`, 'Visibility');
  }

  if (h.waveM == null) {
    flag(RATING.CAUTION, 'No sea data: waves, tide and current not checked', 'No sea data');
  }

  if (THUNDER_CODES.has(h.code)) flag(RATING.NOGO, 'Thunderstorm risk: get off the water', 'Thunder');

  if (daylight.length && !isDaylight(h.t, daylight)) flag(RATING.CAUTION, 'Outside daylight hours', 'Dark');

  return { rating, reasons };
}

// Contiguous runs of GO hours in daylight, at least minHours long.
export function findWindows(rated, minHours = 2) {
  const windows = [];
  let start = null;
  const close = (endIdx) => {
    if (start != null && endIdx - start >= minHours) {
      windows.push({ start: rated[start].t, end: rated[endIdx - 1].t + 3600e3, hours: endIdx - start });
    }
    start = null;
  };
  rated.forEach((h, i) => {
    if (h.rating === RATING.GO) { if (start == null) start = i; } else close(i);
  });
  close(rated.length);
  return windows;
}

// WMO weather codes used by Open-Meteo, shortened for display.
const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail',
};
export function weatherText(code) {
  return WMO[code] ?? '--';
}

// ---------- offline ----------
// Plain-English age of a saved forecast, e.g. "45 minutes", "3 hours", "2 days".
export function describeAge(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

// A saved forecast is usable for a place if it was saved for the same spot.
export function savedForecastFor(saved, place) {
  if (!saved?.data || !saved.place || !place) return null;
  const same = Math.abs(saved.place.lat - place.lat) < 1e-6 && Math.abs(saved.place.lon - place.lon) < 1e-6;
  return same ? saved : null;
}

// ---------- forecast confidence (ensemble) ----------
// Linear-interpolated percentile of a sorted array, p in 0..1.
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Wind spread per hour from an Open-Meteo ensemble response. Every hourly
// key starting "wind_speed_10m" (the control run and each member) counts as
// one model run, so exact member naming does not matter.
export function ensembleSpread(ens) {
  const out = new Map();
  const h = ens?.hourly;
  if (!h?.time) return out;
  const keys = Object.keys(h).filter((k) => k.startsWith('wind_speed_10m'));
  if (!keys.length) return out;
  const unit = ens.hourly_units?.[keys[0]] || 'kn';
  h.time.forEach((time, i) => {
    const vals = keys.map((k) => toKnots(h[k][i], unit)).filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
    if (vals.length < 5) return; // too few runs to say anything
    out.set(time, { p10: percentile(vals, 0.1), p50: percentile(vals, 0.5), p90: percentile(vals, 0.9), runs: vals.length });
  });
  return out;
}

export function attachSpread(rows, spread) {
  return rows.map((h) => {
    const s = spread.get(h.time);
    return s ? { ...h, windP10: s.p10, windP90: s.p90, windRuns: s.runs } : h;
  });
}

// How much the model runs agree, from the 10th to 90th percentile range.
export function windConfidence(p10, p90) {
  if (p10 == null || p90 == null) return null;
  const range = p90 - p10;
  if (range <= 6) return 'high';
  if (range <= 12) return 'medium';
  return 'low';
}
