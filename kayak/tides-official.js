// Optional official tide times from the ADMIRALTY UK Tidal API (Discovery
// tier is free, but needs your own subscription key). The key is kept in this
// browser only and sent only to the Admiralty API.
//
// Endpoint and header are from the Admiralty developer portal:
//   GET https://admiraltyapi.azure-api.net/uktidalapi/api/V1/Stations
//   GET https://admiraltyapi.azure-api.net/uktidalapi/api/V1/Stations/{id}/TidalEvents?duration=N
//   header Ocp-Apim-Subscription-Key: <key>
// Not verified from here: the exact response field names (parsed loosely
// below) and whether the API allows calls from a web page.
import { distanceKm } from './logic.js';

export const ADMIRALTY_BASE = 'https://admiraltyapi.azure-api.net/uktidalapi/api/V1';

// Station list (GeoJSON FeatureCollection) -> [{ id, name, lat, lon }].
export function parseStations(geojson) {
  const features = geojson?.features || (Array.isArray(geojson) ? geojson : []);
  return features.map((f) => {
    const p = f.properties || f;
    const c = f.geometry?.coordinates || [];
    return { id: String(p.Id ?? p.id ?? ''), name: p.Name ?? p.name ?? '', lon: Number(c[0]), lat: Number(c[1]) };
  }).filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

export function nearestStation(stations, lat, lon) {
  let best = null;
  for (const s of stations) {
    const km = distanceKm(lat, lon, s.lat, s.lon);
    if (!best || km < best.km) best = { ...s, km };
  }
  return best;
}

// Tidal events -> [{ type: 'high'|'low', utcMs, heightM }]. Times without a
// zone are taken as UTC (as EasyTide's own data is; assumed for the API).
export function parseTidalEvents(events) {
  return (Array.isArray(events) ? events : []).map((e) => {
    const rawType = e.EventType ?? e.eventType;
    const type = rawType === 0 || /high/i.test(String(rawType)) ? 'high'
      : rawType === 1 || /low/i.test(String(rawType)) ? 'low' : null;
    const dt = String(e.DateTime ?? e.dateTime ?? '');
    const utcMs = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(dt) ? dt : `${dt}Z`);
    const heightM = Number(e.Height ?? e.height);
    return { type, utcMs, heightM: Number.isFinite(heightM) ? heightM : null };
  }).filter((e) => e.type && Number.isFinite(e.utcMs)).sort((a, b) => a.utcMs - b.utcMs);
}

// Official events in the location's wall-clock "fake UTC" (see parseLocal),
// each paired with the nearest modelled turn of the same type within 4 h,
// so the page can show how far out the model is right here.
export function compareWithModel(official, modelTurns, utcOffsetSeconds) {
  return official.map((e) => {
    const t = e.utcMs + utcOffsetSeconds * 1000;
    const match = modelTurns
      .filter((m) => m.type === e.type && Math.abs(m.t - t) <= 4 * 3600e3)
      .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
    return { ...e, t, modelDiffMin: match ? Math.round((match.t - t) / 60000) : null };
  });
}

// Fetches nearest-station events. `fetchFn` is injectable for tests.
export async function fetchOfficialTides(key, lat, lon, { fetchFn = fetch, stations = null, days = 4 } = {}) {
  const headers = { 'Ocp-Apim-Subscription-Key': key };
  const get = async (url) => {
    let res;
    try {
      res = await fetchFn(url, { headers });
    } catch {
      throw new Error('Could not reach the Admiralty service from this page (no connection, or the service does not allow web pages)');
    }
    if (res.status === 401 || res.status === 403) throw new Error('Admiralty API key was rejected');
    if (!res.ok) throw new Error(`Admiralty service error (HTTP ${res.status})`);
    return res.json();
  };
  const list = stations || parseStations(await get(`${ADMIRALTY_BASE}/Stations`));
  const station = nearestStation(list, lat, lon);
  if (!station) throw new Error('No Admiralty stations returned');
  const events = parseTidalEvents(await get(`${ADMIRALTY_BASE}/Stations/${encodeURIComponent(station.id)}/TidalEvents?duration=${days}`));
  return { station, events, stations: list };
}
