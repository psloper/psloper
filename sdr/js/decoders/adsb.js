// ADS-B (Mode S Extended Squitter, DF17/18) demodulator, decoder, encoder and tracker.
// Reference: J. Sun, "The 1090 Megahertz Riddle" (2nd ed.), and the dump1090 preamble heuristic.
// Demodulation assumes exactly 2 samples per microsecond (2.0 MS/s).

const CPR_MAX = 131072; // 2^17
const NZ = 15;
const CHARSET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######';

const mod = (x, y) => x - y * Math.floor(x / y);

// ---------------------------------------------------------------- bit helpers

export function getBits(bits, start, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 2 + bits[start + i];
  return v;
}

function setBits(bits, start, len, value) {
  for (let i = 0; i < len; i++) bits[start + i] = Math.floor(value / 2 ** (len - 1 - i)) & 1;
}

export function hexToBits(hex) {
  const bits = new Uint8Array(hex.length * 4);
  for (let i = 0; i < hex.length; i++) setBits(bits, i * 4, 4, parseInt(hex[i], 16));
  return bits;
}

export function bitsToHex(bits) {
  let s = '';
  for (let i = 0; i < bits.length; i += 4) s += getBits(bits, i, 4).toString(16);
  return s.toUpperCase();
}

/** Mode S CRC-24 (generator 0x1FFF409) over the first `nbits` bits. */
export function crc24(bits, nbits = 88) {
  let rem = 0;
  for (let i = 0; i < nbits; i++) {
    const top = ((rem >>> 23) & 1) ^ bits[i];
    rem = (rem << 1) & 0xffffff;
    if (top) rem ^= 0xfff409;
  }
  return rem;
}

// ---------------------------------------------------------------- CPR

export function NL(lat) {
  if (lat === 0) return 59;
  const a = Math.abs(lat);
  if (a === 87) return 2;
  if (a > 87) return 1;
  const t = 1 - (1 - Math.cos(Math.PI / (2 * NZ))) / Math.cos((Math.PI * lat) / 180) ** 2;
  return Math.floor((2 * Math.PI) / Math.acos(t));
}

export function cprEncode(lat, lon, odd) {
  const i = odd ? 1 : 0;
  const dLat = 360 / (4 * NZ - i);
  const yz = Math.floor((CPR_MAX * mod(lat, dLat)) / dLat + 0.5);
  const rlat = dLat * (yz / CPR_MAX + Math.floor(lat / dLat));
  const dLon = 360 / Math.max(NL(rlat) - i, 1);
  const xz = Math.floor((CPR_MAX * mod(lon, dLon)) / dLon + 0.5);
  return { lat: yz % CPR_MAX, lon: xz % CPR_MAX };
}

/** Globally unambiguous airborne position from an even/odd pair. */
export function cprGlobal(even, odd, evenIsNewer) {
  const latE = even.lat / CPR_MAX, lonE = even.lon / CPR_MAX;
  const latO = odd.lat / CPR_MAX, lonO = odd.lon / CPR_MAX;
  const j = Math.floor(59 * latE - 60 * latO + 0.5);
  let rlatE = (360 / 60) * (mod(j, 60) + latE);
  let rlatO = (360 / 59) * (mod(j, 59) + latO);
  if (rlatE >= 270) rlatE -= 360;
  if (rlatO >= 270) rlatO -= 360;
  if (NL(rlatE) !== NL(rlatO)) return null; // pair straddles a longitude zone boundary
  let lat, lon;
  const nl = NL(rlatE);
  const m = Math.floor(lonE * (nl - 1) - lonO * nl + 0.5);
  if (evenIsNewer) {
    const ni = Math.max(nl, 1);
    lat = rlatE;
    lon = (360 / ni) * (mod(m, ni) + lonE);
  } else {
    const ni = Math.max(nl - 1, 1);
    lat = rlatO;
    lon = (360 / ni) * (mod(m, ni) + lonO);
  }
  if (lon >= 180) lon -= 360;
  return { lat, lon };
}

// ---------------------------------------------------------------- decode

/** Decode a 112-bit DF17/18 frame. Returns null if not DF17/18 or CRC fails. */
export function decodeFrame(bits) {
  const df = getBits(bits, 0, 5);
  if (df !== 17 && df !== 18) return null;
  if (crc24(bits, 88) !== getBits(bits, 88, 24)) return null;
  const icao = getBits(bits, 8, 24).toString(16).toUpperCase().padStart(6, '0');
  const tc = getBits(bits, 32, 5);
  const msg = { df, icao, tc, hex: bitsToHex(bits) };

  if (tc >= 1 && tc <= 4) {
    let cs = '';
    for (let i = 0; i < 8; i++) cs += CHARSET[getBits(bits, 40 + i * 6, 6)];
    msg.type = 'ident';
    msg.callsign = cs.replace(/#/g, '').trim();
  } else if (tc >= 9 && tc <= 18) {
    msg.type = 'position';
    const q = bits[47];
    msg.altitude = q ? (getBits(bits, 40, 7) * 16 + getBits(bits, 48, 4)) * 25 - 1000 : null;
    msg.odd = bits[53] === 1;
    msg.cprLat = getBits(bits, 54, 17);
    msg.cprLon = getBits(bits, 71, 17);
  } else if (tc === 19) {
    const st = getBits(bits, 37, 3);
    msg.type = 'velocity';
    if (st === 1 || st === 2) {
      const scale = st === 2 ? 4 : 1;
      const vewRaw = getBits(bits, 46, 10), vnsRaw = getBits(bits, 57, 10);
      if (vewRaw && vnsRaw) {
        const vew = (bits[45] ? -1 : 1) * (vewRaw - 1) * scale;
        const vns = (bits[56] ? -1 : 1) * (vnsRaw - 1) * scale;
        msg.groundSpeed = Math.hypot(vew, vns);
        msg.track = mod((Math.atan2(vew, vns) * 180) / Math.PI, 360);
      }
    } else if (st === 3 || st === 4) {
      if (bits[45]) msg.heading = (getBits(bits, 46, 10) * 360) / 1024;
      const as = getBits(bits, 57, 10);
      if (as) msg.airspeed = (as - 1) * (st === 4 ? 4 : 1);
    }
    const vr = getBits(bits, 69, 9);
    if (vr) msg.verticalRate = (bits[68] ? -1 : 1) * (vr - 1) * 64;
  } else {
    msg.type = 'other';
  }
  return msg;
}

// ---------------------------------------------------------------- encode (used by the simulator and tests)

function frame(icao, fillMe) {
  const bits = new Uint8Array(112);
  setBits(bits, 0, 5, 17);
  setBits(bits, 5, 3, 5);
  setBits(bits, 8, 24, icao);
  fillMe((start, len, v) => setBits(bits, 32 + start - 1, len, v)); // ME bit numbering is 1-based
  setBits(bits, 88, 24, crc24(bits, 88));
  return bits;
}

export function encodeIdentification(icao, callsign) {
  const cs = callsign.toUpperCase().padEnd(8, ' ').slice(0, 8);
  return frame(icao, (set) => {
    set(1, 5, 4);
    set(6, 3, 3);
    for (let i = 0; i < 8; i++) set(9 + i * 6, 6, Math.max(0, CHARSET.indexOf(cs[i])));
  });
}

export function encodeAirbornePosition(icao, lat, lon, altFt, odd) {
  const n = Math.max(0, Math.round((altFt + 1000) / 25));
  const alt12 = (Math.floor(n / 16) << 5) | 0x10 | (n & 0xf);
  const cpr = cprEncode(lat, lon, odd);
  return frame(icao, (set) => {
    set(1, 5, 11);
    set(9, 12, alt12);
    set(22, 1, odd ? 1 : 0);
    set(23, 17, cpr.lat);
    set(40, 17, cpr.lon);
  });
}

export function encodeVelocity(icao, gsKt, trackDeg, vrFpm) {
  const t = (trackDeg * Math.PI) / 180;
  const vew = gsKt * Math.sin(t), vns = gsKt * Math.cos(t);
  return frame(icao, (set) => {
    set(1, 5, 19);
    set(6, 3, 1);
    set(14, 1, vew < 0 ? 1 : 0);
    set(15, 10, Math.min(1023, Math.round(Math.abs(vew)) + 1));
    set(25, 1, vns < 0 ? 1 : 0);
    set(26, 10, Math.min(1023, Math.round(Math.abs(vns)) + 1));
    set(36, 1, 1);
    set(37, 1, vrFpm < 0 ? 1 : 0);
    set(38, 9, Math.min(511, Math.round(Math.abs(vrFpm) / 64) + 1));
  });
}

// ---------------------------------------------------------------- demodulator (2 MS/s IQ)

const FRAME_SAMPLES = 16 + 112 * 2;

export class AdsbDemod {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.carry = new Float32Array(0);
    this.mag = new Float32Array(0);
    this.bits = new Uint8Array(112);
    this.stats = { preambles: 0, frames: 0, crcFail: 0 };
  }

  process(re, im, n) {
    const carryLen = this.carry.length;
    const total = carryLen + n;
    if (this.mag.length < total) this.mag = new Float32Array(total * 1.5);
    const m = this.mag;
    m.set(this.carry, 0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      m[carryLen + i] = v;
      sum += v;
    }
    const floor = (sum / Math.max(n, 1)) * 2.5;
    const bits = this.bits;
    const end = total - FRAME_SAMPLES;
    let j = 0;
    for (; j < end; j++) {
      const m0 = m[j];
      if (m0 < floor) continue;
      if (!(m0 > m[j + 1] && m[j + 1] < m[j + 2] && m[j + 2] > m[j + 3] && m[j + 3] < m0 &&
            m[j + 4] < m0 && m[j + 5] < m0 && m[j + 6] < m0 && m[j + 7] > m[j + 8] &&
            m[j + 8] < m[j + 9] && m[j + 9] > m[j + 6])) continue;
      const high = (m0 + m[j + 2] + m[j + 7] + m[j + 9]) / 6;
      if (m[j + 4] >= high || m[j + 5] >= high) continue;
      if (m[j + 11] >= high || m[j + 12] >= high || m[j + 13] >= high || m[j + 14] >= high) continue;
      this.stats.preambles++;
      for (let b = 0; b < 112; b++) {
        const k = j + 16 + b * 2;
        bits[b] = m[k] > m[k + 1] ? 1 : 0;
      }
      const df = getBits(bits, 0, 5);
      if (df !== 17 && df !== 18) continue;
      const msg = decodeFrame(bits);
      if (!msg) { this.stats.crcFail++; continue; }
      this.stats.frames++;
      msg.signal = high * 1.5;
      this.onMessage(msg);
      j += FRAME_SAMPLES - 1;
    }
    this.carry = m.slice(Math.max(j, total - FRAME_SAMPLES), total);
  }
}

// ---------------------------------------------------------------- tracker

const NM_PER_DEG = 60;

export function rangeBearing(from, to) {
  const lat1 = (from.lat * Math.PI) / 180, lat2 = (to.lat * Math.PI) / 180;
  const dLat = lat2 - lat1, dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const range = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * (180 / Math.PI) * NM_PER_DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return { range, bearing: mod((Math.atan2(y, x) * 180) / Math.PI, 360) };
}

export class AircraftTracker {
  constructor() {
    this.aircraft = new Map();
    this.messages = 0;
  }

  ingest(msg, now) {
    this.messages++;
    let ac = this.aircraft.get(msg.icao);
    if (!ac) {
      ac = { icao: msg.icao, callsign: '', messages: 0, trail: [], firstSeen: now };
      this.aircraft.set(msg.icao, ac);
    }
    ac.messages++;
    ac.lastSeen = now;
    if (msg.signal) ac.signal = msg.signal;
    if (msg.type === 'ident') ac.callsign = msg.callsign;
    if (msg.type === 'velocity') {
      if (msg.groundSpeed != null) { ac.groundSpeed = msg.groundSpeed; ac.track = msg.track; }
      if (msg.heading != null) ac.track = msg.heading;
      if (msg.verticalRate != null) ac.verticalRate = msg.verticalRate;
    }
    if (msg.type === 'position') {
      if (msg.altitude != null) ac.altitude = msg.altitude;
      const cpr = { lat: msg.cprLat, lon: msg.cprLon, t: now };
      if (msg.odd) ac.odd = cpr; else ac.even = cpr;
      if (ac.even && ac.odd && Math.abs(ac.even.t - ac.odd.t) < 10000) {
        const pos = cprGlobal(ac.even, ac.odd, !msg.odd);
        if (pos) {
          ac.lat = pos.lat;
          ac.lon = pos.lon;
          ac.posTime = now;
          const last = ac.trail[ac.trail.length - 1];
          if (!last || now - last.t > 2000) {
            ac.trail.push({ lat: pos.lat, lon: pos.lon, t: now });
            if (ac.trail.length > 40) ac.trail.shift();
          }
        }
      }
    }
    return ac;
  }

  list(now, maxAgeMs = 60000) {
    for (const [k, ac] of this.aircraft) if (now - ac.lastSeen > maxAgeMs) this.aircraft.delete(k);
    return [...this.aircraft.values()];
  }
}
