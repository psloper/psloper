// Trip log: record the conditions you paddled in and how it felt, then
// suggest limits from your own experience. Pure functions; the page keeps
// the log in this browser only (with export and import).

export const FEELS = {
  easy: 'Easy',
  ok: 'OK, within my comfort',
  hard: 'Hard work',
  'too-much': 'Too much',
};

// The limits a log can say something about, with the step used when
// suggesting a lower limit than a "too much" trip.
export const LOG_METRICS = [
  { key: 'windKn', limit: 'maxWindKn', label: 'Wind', unit: 'kn', step: 1, digits: 0 },
  { key: 'gustKn', limit: 'maxGustKn', label: 'Gusts', unit: 'kn', step: 1, digits: 0 },
  { key: 'waveM', limit: 'maxWaveM', label: 'Waves', unit: 'm', step: 0.1, digits: 1 },
];
export const MIN_TRIPS = 3;

const COMFORTABLE = new Set(['easy', 'ok']);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function makeEntry({ place, hour, feel, notes = '', now = Date.now() }) {
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    when: hour.time, place: place.name, lat: place.lat, lon: place.lon,
    windKn: num(hour.windKn), gustKn: num(hour.gustKn), waveM: num(hour.waveM), windDir: num(hour.windDir),
    feel, notes: String(notes).slice(0, 500),
  };
}

// Keeps only well-formed entries; used for imports, which may be edited by
// hand or come from an older version.
export function cleanEntries(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e && typeof e.id === 'string' && typeof e.when === 'string' && FEELS[e.feel])
    .map((e) => ({
      id: e.id, when: e.when, place: String(e.place ?? ''), lat: num(e.lat), lon: num(e.lon),
      windKn: num(e.windKn), gustKn: num(e.gustKn), waveM: num(e.waveM), windDir: num(e.windDir),
      feel: e.feel, notes: String(e.notes ?? '').slice(0, 500),
    }));
}

// Merges imported entries into the log; same id = same trip.
export function mergeEntries(existing, incoming) {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of cleanEntries(incoming)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.when.localeCompare(a.when));
}

// One suggestion per metric: { metric, current, suggested, reason }.
// suggested === current means "keep".
export function suggestLimits(entries, limits) {
  return LOG_METRICS.map((m) => {
    const current = limits[m.limit];
    const fmt = (v) => `${v.toFixed(m.digits)} ${m.unit}`;
    const trips = entries.filter((e) => num(e[m.key]) != null);
    if (trips.length < MIN_TRIPS) {
      return { metric: m, current, suggested: current, reason: `Not enough trips yet (${trips.length} of ${MIN_TRIPS}).` };
    }
    // 1. Something within your limit felt too much: come down below it.
    const tooMuch = trips.filter((e) => e.feel === 'too-much' && e[m.key] <= current).map((e) => e[m.key]);
    if (tooMuch.length) {
      const worst = Math.min(...tooMuch);
      const suggested = Math.max(0, Number((worst - m.step).toFixed(m.digits)));
      return { metric: m, current, suggested, reason: `${m.label} of ${fmt(worst)} felt too much, which is inside your limit.` };
    }
    // 2. At least two comfortable trips above your limit, and nothing hard
    //    or too much at or below the second highest: raise, cautiously.
    const above = trips.filter((e) => COMFORTABLE.has(e.feel) && e[m.key] > current).map((e) => e[m.key]).sort((a, b) => b - a);
    if (above.length >= 2) {
      const candidate = above[1];
      const contradicted = trips.some((e) => !COMFORTABLE.has(e.feel) && e[m.key] <= candidate);
      if (!contradicted) {
        return { metric: m, current, suggested: Number(candidate.toFixed(m.digits)), reason: `${above.length} trips above your limit felt fine; the second highest was ${fmt(candidate)}.` };
      }
      return { metric: m, current, suggested: current, reason: 'Mixed results above your limit: keeping it.' };
    }
    return { metric: m, current, suggested: current, reason: 'Your trips fit your current limit.' };
  });
}
