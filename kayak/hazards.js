// Well-known UK tidal races, overfalls and fast tidal narrows, for a
// "nearby hazards" warning. NOT a complete list and NOT for navigation:
// positions mark the headland or narrows the hazard forms off, and races
// move and grow with the tide and wind. Always use a chart and pilot guide.
//
// `checked: true` means the position was checked against a published source
// (listed in `source`); the rest are approximate (within a few km).
import { distanceKm, compassPoint } from './logic.js';

export const HAZARD_RADIUS_KM = 20;

export const HAZARDS = [
  // South coast of England
  { name: 'Portland Race', lat: 50.49, lon: -2.456, checked: true, source: 'eOceanic pilotage notes; Yachting Monthly',
    note: 'Worst 1 to 2 miles south of the Bill; streams up to 7 knots at springs, can reach 10. Overfalls can extend 7 miles offshore in bad weather.' },
  { name: "St Alban's Ledge race (St Alban's Head)", lat: 50.5792, lon: -2.0567, checked: true, source: 'eOceanic pilotage notes',
    note: 'Race up to 2.5 miles off the head; south-west of it on the west-going stream, north-east on the east-going.' },
  { name: 'Poole Harbour entrance', lat: 50.678, lon: -1.948, checked: false,
    note: 'Narrow entrance with strong streams and the chain ferry; busy with shipping.' },
  { name: 'Hurst Narrows', lat: 50.706, lon: -1.55, checked: false,
    note: 'Western Solent entrance; strong streams and overfalls, worst with wind against tide.' },
  { name: 'Needles Channel and the Bridge', lat: 50.66, lon: -1.6, checked: false,
    note: 'Overfalls off the Needles and over the Bridge reef.' },
  { name: "St Catherine's Point race", lat: 50.575, lon: -1.297, checked: false,
    note: 'Race off the southern tip of the Isle of Wight.' },
  { name: 'Start Point race', lat: 50.215, lon: -3.64, checked: false, note: 'Race and overfalls off Start Point.' },
  { name: 'Lizard race', lat: 49.95, lon: -5.2, checked: false, note: 'Race off Lizard Point; can be severe.' },
  { name: "Runnel Stone and Land's End", lat: 50.02, lon: -5.67, checked: false, note: 'Strong streams and overfalls around the Runnel Stone.' },
  // Wales
  { name: 'Jack Sound', lat: 51.735, lon: -5.25, checked: false, note: 'Fast narrow sound off Pembrokeshire.' },
  { name: 'Ramsey Sound and the Bitches', lat: 51.86, lon: -5.33, checked: false, note: 'Very fast streams through Ramsey Sound and over the Bitches reef.' },
  { name: 'Strumble Head', lat: 52.03, lon: -5.07, checked: false, note: 'Overfalls off the head.' },
  { name: 'Bardsey Sound', lat: 52.77, lon: -4.78, checked: false, note: 'Fast streams and overfalls between Bardsey and the Llyn.' },
  { name: 'Penrhyn Mawr', lat: 53.284, lon: -4.676, checked: false,
    note: 'Tide race on the west coast of Holy Island; works on the flood, about 7 knots at springs and 4 at neaps (club guides).' },
  { name: 'South Stack race', lat: 53.307, lon: -4.698, checked: false, note: 'Race off South Stack, Holy Island.' },
  { name: 'The Swellies, Menai Strait', lat: 53.218, lon: -4.18, checked: false, note: 'Fast, turbulent narrows between the bridges; time it for slack water.' },
  // Scotland, Northern Ireland, north-east England
  { name: 'Falls of Lora', lat: 56.4564, lon: -5.391, checked: true, source: 'Wikipedia (Falls of Lora, Connel Bridge)',
    note: 'Tidal rapids under Connel Bridge, reversing about every 6 hours.' },
  { name: 'Gulf of Corryvreckan', lat: 56.155, lon: -5.71, checked: false, note: 'Major whirlpool and overfalls between Jura and Scarba.' },
  { name: 'Grey Dogs', lat: 56.17, lon: -5.665, checked: false, note: 'Very fast narrow channel between Scarba and Lunga.' },
  { name: 'Dorus Mor', lat: 56.12, lon: -5.59, checked: false, note: 'Fast streams and overfalls off Craignish Point.' },
  { name: 'Mull of Kintyre', lat: 55.31, lon: -5.8, checked: false, note: 'Race and overfalls off the Mull.' },
  { name: 'Mull of Galloway', lat: 54.635, lon: -4.856, checked: false, note: 'Race off the Mull.' },
  { name: 'Strangford Narrows', lat: 54.37, lon: -5.55, checked: false, note: 'Very fast streams through the Narrows.' },
  { name: 'Pentland Firth', lat: 58.68, lon: -3.2, checked: false, note: 'Among the fastest streams in UK waters; races including the Merry Men of Mey.' },
  { name: 'Flamborough Head', lat: 54.116, lon: -0.08, checked: false, note: 'Overfalls off the head.' },
];

// Initial great-circle bearing from point 1 to point 2, degrees true.
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

// Hazards within `radiusKm` of the launch, nearest first.
export function hazardsNear(lat, lon, radiusKm = HAZARD_RADIUS_KM) {
  return HAZARDS
    .map((h) => ({ ...h, km: distanceKm(lat, lon, h.lat, h.lon), direction: compassPoint(bearingDeg(lat, lon, h.lat, h.lon)) }))
    .filter((h) => h.km <= radiusKm)
    .sort((a, b) => a.km - b.km);
}
