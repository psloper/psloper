// Band allocations (UK / ITU Region 1 flavoured), well-known channels and presets.
// `mode` is the demodulator normally used there; null means digital and not decoded here.

export const ALLOCATIONS = [
  { lo: 7.0e6, hi: 7.04e6, name: '40 m CW', mode: 'CW' },
  { lo: 7.04e6, hi: 7.2e6, name: '40 m amateur (phone)', mode: 'LSB' },
  { lo: 14.0e6, hi: 14.07e6, name: '20 m CW', mode: 'CW' },
  { lo: 14.07e6, hi: 14.099e6, name: '20 m digital (RTTY)', mode: 'USB' },
  { lo: 14.101e6, hi: 14.35e6, name: '20 m amateur (SSB)', mode: 'USB' },
  { lo: 87.5e6, hi: 108e6, name: 'FM broadcast', mode: 'WFM' },
  { lo: 108e6, hi: 117.975e6, name: 'Aero navigation (VOR / ILS)', mode: 'AM' },
  { lo: 117.975e6, hi: 137e6, name: 'Aeronautical VHF', mode: 'AM' },
  { lo: 137e6, hi: 138e6, name: 'Weather satellites', mode: 'NFM' },
  { lo: 144e6, hi: 146e6, name: '2 m amateur', mode: 'NFM' },
  { lo: 144.4e6, hi: 144.49e6, name: '2 m beacons', mode: 'CW' },
  { lo: 156e6, hi: 162.025e6, name: 'Marine VHF', mode: 'NFM' },
  { lo: 174e6, hi: 240e6, name: 'DAB (digital, not decoded)', mode: null },
  { lo: 430e6, hi: 440e6, name: '70 cm amateur', mode: 'NFM' },
  { lo: 433.05e6, hi: 434.79e6, name: 'ISM 433 MHz', mode: null },
  { lo: 446.0e6, hi: 446.2e6, name: 'PMR446', mode: 'NFM' },
  { lo: 1087e6, hi: 1093e6, name: 'Mode S / ADS-B 1090', mode: null },
];

export const CHANNELS = [
  { freq: 121.5e6, label: 'Guard 121.5', mode: 'AM' },
  { freq: 131.525e6, label: 'ACARS (not decoded)', mode: null },
  { freq: 136.975e6, label: 'VDL2 (not decoded)', mode: null },
  { freq: 144.8e6, label: 'APRS', mode: 'NFM' },
  { freq: 145.5e6, label: 'FM calling', mode: 'NFM' },
  { freq: 156.8e6, label: 'Marine ch 16', mode: 'NFM' },
  { freq: 161.975e6, label: 'AIS 1 (not decoded)', mode: null },
  { freq: 162.025e6, label: 'AIS 2 (not decoded)', mode: null },
  { freq: 1090e6, label: 'ADS-B', mode: null },
];

export const PRESETS = [
  { id: 'fm', name: 'FM Broadcast', center: 89.0e6, vfo: 88.6e6, mode: 'WFM', step: 100000 },
  { id: 'air', name: 'Airband', center: 118.9e6, vfo: 118.5e6, mode: 'AM', step: 25000 },
  { id: '2m', name: '2 m Amateur', center: 145.0e6, vfo: 145.5e6, mode: 'NFM', step: 12500 },
  { id: 'marine', name: 'Marine VHF', center: 156.5e6, vfo: 156.8e6, mode: 'NFM', step: 25000 },
  { id: 'pmr', name: 'PMR446', center: 446.1e6, vfo: 446.00625e6, mode: 'NFM', step: 12500 },
  { id: 'cw', name: '20 m CW', center: 14.1e6, vfo: 14.025e6, mode: 'CW', bw: 500, step: 100, tab: 'cw' },
  { id: 'rtty', name: '20 m RTTY', center: 14.1e6, vfo: 14.0835e6, mode: 'USB', bw: 2700, step: 100, tab: 'rtty' },
  { id: 'ssb', name: '20 m SSB', center: 14.1e6, vfo: 14.2e6, mode: 'USB', bw: 2700, step: 100 },
  { id: 'adsb', name: 'ADS-B 1090', center: 1090e6, vfo: 1090e6, mode: 'AM', step: 25000, tab: 'adsb', exact: true },
];

/** Narrowest allocation containing f. */
export function allocationAt(f) {
  let best = null;
  for (const a of ALLOCATIONS) {
    if (f >= a.lo && f <= a.hi && (!best || a.hi - a.lo < best.hi - best.lo)) best = a;
  }
  return best;
}

// ---------------------------------------------------------------- frequency text

export function formatHz(f, digits) {
  const a = Math.abs(f);
  if (a >= 1e9) return `${(f / 1e9).toFixed(digits ?? 6)} GHz`;
  if (a >= 1e6) return `${(f / 1e6).toFixed(digits ?? 4)} MHz`;
  if (a >= 1e3) return `${(f / 1e3).toFixed(digits ?? 2)} kHz`;
  return `${f.toFixed(0)} Hz`;
}

export function formatBw(bw) {
  return bw >= 1000 ? `${(bw / 1000).toFixed(bw >= 100000 ? 0 : 1)} kHz` : `${Math.round(bw)} Hz`;
}

/**
 * Parse user frequency text: "145.5M", "1090 MHz", "14083.5k", "446006250".
 * Without a unit: below 2000 is read as MHz, below 2 000 000 as kHz, otherwise Hz.
 */
export function parseFrequency(text) {
  const m = text.trim().toLowerCase().replace(/[,_\s]/g, '').match(/^(\d*\.?\d+)(ghz|g|mhz|m|khz|k|hz)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2] || (v < 2000 ? 'm' : v < 2e6 ? 'k' : 'hz');
  const mult = { g: 1e9, ghz: 1e9, m: 1e6, mhz: 1e6, k: 1e3, khz: 1e3, hz: 1 }[unit];
  const f = Math.round(v * mult);
  return f >= 10e3 && f <= 6e9 ? f : null;
}
