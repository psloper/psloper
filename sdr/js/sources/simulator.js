// Built-in RF simulator: a 2.0 MS/s complex IQ stream containing realistic synthetic
// signals (broadcast FM, airband AM, NFM voice, CW, RTTY, SSB, APRS bursts and ADS-B)
// so the whole receive chain can be exercised with no hardware attached.
// Every station renders its modulation at a 50 kHz baseband rate, which is
// Catmull-Rom interpolated up to 2 MS/s and mixed onto its carrier.
import { morseTiming } from '../decoders/morse.js';
import { encodeBaudot } from '../decoders/baudot.js';
import { encodeIdentification, encodeAirbornePosition, encodeVelocity, rangeBearing } from '../decoders/adsb.js';
import { CLIPS, CLIP_RATE } from './speech-clips.js';

export const SIM_FS = 2_000_000;
export const SIM_REF = { lat: 51.4700, lon: -0.4543 }; // reference receiver position (London Heathrow area)
const BB = 50_000;
const R = SIM_FS / BB;
const LUT_N = 16384;
const SIN = new Float32Array(LUT_N);
const COS = new Float32Array(LUT_N);
for (let i = 0; i < LUT_N; i++) { SIN[i] = Math.sin((2 * Math.PI * i) / LUT_N); COS[i] = Math.cos((2 * Math.PI * i) / LUT_N); }
const CRW = new Float32Array(R * 4);
for (let p = 0; p < R; p++) {
  const t = p / R, t2 = t * t, t3 = t2 * t;
  CRW[p * 4] = 0.5 * (-t + 2 * t2 - t3);
  CRW[p * 4 + 1] = 0.5 * (2 - 5 * t2 + 3 * t3);
  CRW[p * 4 + 2] = 0.5 * (t + 4 * t2 - 3 * t3);
  CRW[p * 4 + 3] = 0.5 * (-t2 + t3);
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lut = (cycles) => ((cycles - Math.floor(cycles)) * LUT_N) | 0;
const clamp1 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

// ------------------------------------------------------------------ audio sources (50 kHz)

const VOWELS = [[270, 2290], [530, 1840], [730, 1090], [570, 840], [300, 870], [660, 1720], [490, 1350], [400, 2000]];

/** Additive "voice-like" synthesiser; emits analytic (complex) audio so it can drive SSB directly. */
class VoiceSource {
  constructor(rand, { f0 = 120, continuous = false, talk = [1.5, 5], quiet = [3, 9] } = {}) {
    Object.assign(this, { rand, base: f0, continuous, talkRange: talk, quietRange: quiet });
    this.ph = new Float64Array(48);
    this.amp = new Float32Array(48);
    this.F = [500, 1500, 2500];
    this.Ft = [500, 1500, 2500];
    this.env = 0; this.envT = 0;
    this.talking = continuous;
    this.left = (continuous ? 3600 : this.uni(quiet) * rand()) * BB;
    this.syl = 0; this.inGap = true; this.tick = 0; this.t = 0;
    this.f0 = f0; this.H = 20;
  }

  uni([a, b]) { return a + (b - a) * this.rand(); }

  control() {
    const step = 50;
    this.t += step;
    this.left -= step;
    if (this.left <= 0) {
      if (this.continuous) this.left = 3600 * BB;
      else {
        this.talking = !this.talking;
        this.left = this.uni(this.talking ? this.talkRange : this.quietRange) * BB;
      }
    }
    let target = 0;
    if (this.talking) {
      this.syl -= step;
      if (this.syl <= 0) {
        if (this.inGap || this.rand() > 0.28) {
          this.inGap = false;
          this.syl = this.uni([0.09, 0.23]) * BB;
          const v = VOWELS[(this.rand() * VOWELS.length) | 0];
          this.Ft = [v[0], v[1], 2500 + 300 * this.rand()];
          this.envT = 0.6 + 0.4 * this.rand();
          this.f0t = this.base * (0.9 + 0.25 * this.rand());
        } else {
          this.inGap = true;
          this.syl = this.uni([0.06, 0.2]) * BB;
        }
      }
      target = this.inGap || this.syl < 0.03 * BB ? 0 : this.envT;
    }
    this.env += (target - this.env) * 0.15;
    for (let k = 0; k < 3; k++) this.F[k] += (this.Ft[k] - this.F[k]) * 0.08;
    this.f0 += ((this.f0t || this.base) - this.f0) * 0.02;
    const f0 = this.f0 * (1 + 0.01 * Math.sin(this.t * 0.0004));
    this.f0now = f0;
    this.H = Math.min(48, Math.floor(3300 / f0));
    let sum = 0;
    const B = [120, 150, 200], A = [1, 0.6, 0.3];
    for (let h = 0; h < this.H; h++) {
      const f = (h + 1) * f0;
      let g = 0;
      for (let k = 0; k < 3; k++) g += A[k] / (1 + ((f - this.F[k]) / (B[k] / 2)) ** 2);
      g /= 1 + f / 900;
      this.amp[h] = g;
      sum += g;
    }
    const k = (1.5 * this.env) / (sum || 1);
    for (let h = 0; h < this.H; h++) this.amp[h] *= k;
  }

  render(oRe, oIm, gate, off, count) {
    for (let i = 0; i < count; i++) {
      if (this.tick-- <= 0) { this.tick = 49; this.control(); }
      let re = 0, im = 0;
      if (this.env > 1e-4) {
        const f0 = this.f0now / BB;
        for (let h = 0; h < this.H; h++) {
          let p = this.ph[h] + (h + 1) * f0;
          p -= Math.floor(p);
          this.ph[h] = p;
          const idx = (p * LUT_N) | 0;
          re += this.amp[h] * COS[idx];
          im += this.amp[h] * SIN[idx];
        }
      }
      oRe[off + i] = re; oIm[off + i] = im;
      gate[off + i] = this.talking ? 1 : 0;
    }
  }
}

/** Simple chord / bass / arpeggio synth for broadcast FM stations. Real output. */
VoiceSource.prototype.isVoice = true;

// Hilbert transformer (63 taps, Hamming window) used to make recorded speech analytic for SSB.
const HILBERT = (() => {
  const N = 63, M = (N - 1) / 2, h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const n = i - M;
    if (n % 2 !== 0) h[i] = (2 / (Math.PI * n)) * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  return h;
})();

/** Decode base64 signed 8-bit PCM clips once; optionally build the quadrature (Hilbert) part. */
function decodeClips(list, analytic) {
  return list.map((b64) => {
    const bin = atob(b64);
    const re = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) { const v = bin.charCodeAt(i); re[i] = (v > 127 ? v - 256 : v) / 127; }
    if (!analytic) return { re, im: null };
    const N = HILBERT.length, M = (N - 1) / 2;
    const im = new Float32Array(re.length);
    for (let i = 0; i < re.length; i++) {
      let acc = 0;
      for (let k = 0; k < N; k++) { const j = i + M - k; if (j >= 0 && j < re.length) acc += HILBERT[k] * re[j]; }
      im[i] = acc;
    }
    return { re, im };
  });
}

/**
 * Plays recorded phrases like a real push-to-talk station: carrier up, short pause,
 * the phrase, a short tail, then silence until the next over. Clips play in order,
 * so call-and-reply exchanges stay in sequence.
 */
class SpeechSource {
  constructor(rand, clips, { continuous = false, quiet = [2, 7], analytic = false } = {}) {
    Object.assign(this, { rand, continuous, quiet });
    this.clips = decodeClips(clips, analytic);
    this.idx = Math.floor(rand() * this.clips.length);
    this.state = 'gap';
    this.left = rand() * 3 * BB;
    this.pos = 0;
    this.step = CLIP_RATE / BB;
  }

  next(state, seconds) { this.state = state; this.left = seconds * BB; }

  render(oRe, oIm, gate, off, count) {
    for (let i = 0; i < count; i++) {
      let re = 0, im = 0, g = 1;
      switch (this.state) {
        case 'gap':
          g = this.continuous ? 1 : 0;
          if (--this.left <= 0) this.next('key', this.continuous ? 0 : 0.2 + 0.2 * this.rand());
          break;
        case 'key':
          if (--this.left <= 0) { this.state = 'talk'; this.pos = 0; }
          break;
        case 'talk': {
          const c = this.clips[this.idx];
          const k = Math.floor(this.pos), f = this.pos - k;
          if (k + 1 >= c.re.length) {
            this.idx = (this.idx + 1) % this.clips.length;
            this.next('tail', 0.12 + 0.1 * this.rand());
            break;
          }
          re = c.re[k] + (c.re[k + 1] - c.re[k]) * f;
          if (c.im) im = c.im[k] + (c.im[k + 1] - c.im[k]) * f;
          this.pos += this.step;
          break;
        }
        case 'tail':
          if (--this.left <= 0) {
            const [a, b] = this.continuous ? [0.6, 1.2] : this.quiet;
            this.next('gap', a + (b - a) * this.rand());
          }
          break;
      }
      oRe[off + i] = re; oIm[off + i] = im; gate[off + i] = g;
    }
  }
}
SpeechSource.prototype.isVoice = true;

class MusicSource {
  constructor(rand, { tempo = 112, key = 0, prog = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]] } = {}) {
    Object.assign(this, { rand, tempo, key, prog });
    this.n = 0;
    this.ph = new Float64Array(8);
  }

  render(out, off, count) {
    const beat = (60 / this.tempo) * BB;
    for (let i = 0; i < count; i++) {
      const n = this.n++;
      const b = n / beat;
      const chord = this.prog[Math.floor(b / 4) % this.prog.length];
      const ph = this.ph;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        ph[k] += midiHz(60 + this.key + chord[k]) / BB;
        v += 0.1 * (SIN[lut(ph[k])] + 0.3 * SIN[lut(ph[k] * 2)]);
      }
      const bb = b - Math.floor(b);
      ph[3] += midiHz(36 + this.key + chord[0]) / BB;
      v += 0.28 * Math.exp(-bb * 3) * (SIN[lut(ph[3])] + 0.4 * SIN[lut(ph[3] * 2)]);
      const e = b * 2, eb = e - Math.floor(e);
      const note = chord[Math.floor(e) % 3] + (Math.floor(e / 3) % 2) * 12;
      ph[4] += midiHz(72 + this.key + note) / BB;
      v += 0.2 * Math.exp(-eb * 5) * SIN[lut(ph[4])];
      out[off + i] = v;
    }
  }
}

/** Morse keying envelope with 5 ms raised-cosine edges. */
class KeyingSource {
  constructor(text, wpm, pause = 4) {
    Object.assign(this, { text, wpm, pause });
    this.q = []; this.left = 0; this.on = false; this.ramp = 0;
  }

  refill() {
    const dit = (1.2 / this.wpm) * BB;
    this.q = morseTiming(this.text).map(([on, u]) => [on, u * dit]);
    this.q.push([false, this.pause * BB]);
  }

  render(env, off, count) {
    const rs = 1 / (0.005 * BB);
    for (let i = 0; i < count; i++) {
      while (this.left <= 0) {
        if (!this.q.length) this.refill();
        const [on, d] = this.q.shift();
        this.on = on; this.left += d;
      }
      this.left--;
      this.ramp = Math.min(1, Math.max(0, this.ramp + (this.on ? rs : -rs)));
      env[off + i] = 0.5 - 0.5 * Math.cos(Math.PI * this.ramp);
    }
  }
}

/** Baudot FSK: returns the instantaneous tone offset (Hz above the dial) and carrier gate. */
class FskSource {
  constructor(text, { baud = 45.45, low = 2125, shift = 170 } = {}) {
    Object.assign(this, { text, baud, low, shift });
    this.q = []; this.left = 0; this.bit = 1; this.gate = 0;
  }

  refill() {
    const bit = BB / this.baud;
    const q = [[1, 1, 1.2 * BB]];
    for (let rep = 0; rep < 2; rep++) {
      for (const code of encodeBaudot(this.text)) {
        q.push([1, 0, bit]);
        for (let b = 0; b < 5; b++) q.push([1, (code >> b) & 1, bit]);
        q.push([1, 1, bit * 1.5]);
      }
    }
    q.push([1, 1, 0.4 * BB], [0, 1, 5 * BB]);
    this.q = q;
  }

  render(freq, gate, off, count) {
    for (let i = 0; i < count; i++) {
      while (this.left <= 0) {
        if (!this.q.length) this.refill();
        const [g, b, d] = this.q.shift();
        this.gate = g; this.bit = b; this.left += d;
      }
      this.left--;
      // Real-world convention: mark is the higher RF frequency.
      freq[off + i] = this.low + (this.bit ? this.shift : 0);
      gate[off + i] = this.gate;
    }
  }
}

/** Short 1200 Bd AFSK bursts (APRS-like). Not decoded; present for realism. */
class AfskSource {
  constructor(rand) {
    this.rand = rand; this.left = rand() * 8 * BB; this.on = false; this.ph = 0; this.bitLeft = 0; this.tone = 1200;
  }

  render(audio, gate, off, count) {
    for (let i = 0; i < count; i++) {
      if (--this.left <= 0) {
        this.on = !this.on;
        this.left = (this.on ? 0.6 + 0.4 * this.rand() : 10 + 10 * this.rand()) * BB;
      }
      if (this.on) {
        if (--this.bitLeft <= 0) { this.bitLeft += BB / 1200; if (this.rand() < 0.5) this.tone = this.tone === 1200 ? 2200 : 1200; }
        this.ph += this.tone / BB;
        audio[off + i] = SIN[lut(this.ph)];
      } else audio[off + i] = 0;
      gate[off + i] = this.on ? 1 : 0;
    }
  }
}

// ------------------------------------------------------------------ stations

class Station {
  constructor(o) {
    Object.assign(this, o);
    this.theta = 0;
    this.bbStart = -1; this.bbLen = 0;
    this.cap = 8192;
    this.are = new Float32Array(this.cap);
    this.aim = new Float32Array(this.cap);
    this.af = new Float32Array(this.cap);
    this.t1 = new Float32Array(this.cap);
    this.t2 = new Float32Array(this.cap);
    this.t3 = new Float32Array(this.cap);
    this.prevPe = 0; this.pilot = 0;
    this.hasIm = this.kind === 'usb';
    this.hasF = ['nfm', 'afsk', 'wfm', 'fsk'].includes(this.kind);
  }

  fillBB(off, count) {
    const L = this.level, are = this.are, aim = this.aim, af = this.af, t1 = this.t1, t2 = this.t2, t3 = this.t3;
    switch (this.kind) {
      case 'am':
        this.src.render(t1, t2, t3, 0, count);
        for (let i = 0; i < count; i++) are[off + i] = L * t3[i] * (1 + 0.8 * clamp1(t1[i]));
        break;
      case 'nfm':
        this.src.render(t1, t2, t3, 0, count);
        for (let i = 0; i < count; i++) { are[off + i] = L * t3[i]; af[off + i] = 2500 * clamp1(t1[i]); }
        break;
      case 'afsk':
        this.src.render(t1, t3, 0, count);
        for (let i = 0; i < count; i++) { are[off + i] = L * t3[i]; af[off + i] = 3000 * t1[i]; }
        break;
      case 'wfm':
        if (this.src.isVoice) this.src.render(t1, t2, t3, 0, count);
        else this.src.render(t1, 0, count);
        for (let i = 0; i < count; i++) {
          const m = t1[i];
          const pe = m + 2.5 * (m - this.prevPe); // 50 us pre-emphasis at the 50 kHz baseband rate
          this.prevPe = m;
          this.pilot += 19000 / BB;
          are[off + i] = L;
          af[off + i] = Math.max(-75000, Math.min(75000, 60000 * pe)) + 6750 * SIN[lut(this.pilot)];
        }
        break;
      case 'usb':
        this.src.render(t1, t2, t3, 0, count);
        for (let i = 0; i < count; i++) {
          const mag = Math.hypot(t1[i], t2[i]);
          const g = mag > 1 ? L / mag : L;
          are[off + i] = t1[i] * g; aim[off + i] = t2[i] * g;
        }
        break;
      case 'cw':
        this.src.render(t1, 0, count);
        for (let i = 0; i < count; i++) are[off + i] = L * t1[i];
        break;
      case 'fsk':
        this.src.render(t1, t3, 0, count);
        for (let i = 0; i < count; i++) { are[off + i] = L * t3[i]; af[off + i] = t1[i]; }
        break;
    }
  }

  ensureBB(k0, k1) {
    if (this.bbStart < 0 || k0 < this.bbStart || k0 > this.bbStart + this.bbLen) {
      this.bbStart = k0; this.bbLen = 0;
    } else if (k0 > this.bbStart) {
      const drop = k0 - this.bbStart;
      for (const a of [this.are, this.aim, this.af]) a.copyWithin(0, drop, this.bbLen);
      this.bbLen -= drop; this.bbStart = k0;
    }
    const need = k1 - this.bbStart + 1 - this.bbLen;
    if (need <= 0) return;
    if (this.bbLen + need > this.cap) {
      this.cap = (this.bbLen + need) * 2;
      for (const k of ['are', 'aim', 'af']) { const b = new Float32Array(this.cap); b.set(this[k]); this[k] = b; }
      for (const k of ['t1', 't2', 't3']) this[k] = new Float32Array(this.cap);
    }
    this.fillBB(this.bbLen, need);
    this.bbLen += need;
  }

  render(re, im, n, g0, offsetHz) {
    const k0 = Math.floor(g0 / R) - 1;
    const k1 = Math.floor((g0 + n - 1) / R) + 2;
    this.ensureBB(k0, k1);
    const are = this.are, aim = this.aim, af = this.af, hasIm = this.hasIm, hasF = this.hasF;
    const base = offsetHz / SIM_FS, fk = 1 / SIM_FS;
    let k = Math.floor(g0 / R), ph = g0 - k * R, idx = k - 1 - this.bbStart;
    let theta = this.theta;
    for (let i = 0; i < n; i++) {
      const w = ph * 4;
      const w0 = CRW[w], w1 = CRW[w + 1], w2 = CRW[w + 2], w3 = CRW[w + 3];
      const ar = w0 * are[idx] + w1 * are[idx + 1] + w2 * are[idx + 2] + w3 * are[idx + 3];
      const ai = hasIm ? w0 * aim[idx] + w1 * aim[idx + 1] + w2 * aim[idx + 2] + w3 * aim[idx + 3] : 0;
      const f = hasF ? w0 * af[idx] + w1 * af[idx + 1] + w2 * af[idx + 2] + w3 * af[idx + 3] : 0;
      theta += base + f * fk;
      theta -= Math.floor(theta);
      if (ar !== 0 || ai !== 0) {
        const li = (theta * LUT_N) | 0;
        const c = COS[li], s = SIN[li];
        re[i] += ar * c - ai * s;
        im[i] += ar * s + ai * c;
      }
      if (++ph === R) { ph = 0; idx++; }
    }
    this.theta = theta;
  }
}

function buildStations(rand) {
  const S = (o) => new Station(o);
  // Recorded phrases when speech-clips.js has them (see tools/make_speech.py), else the synthetic voice.
  const voice = (o, key, extra = {}) => (CLIPS[key] && CLIPS[key].length
    ? new SpeechSource(rand, CLIPS[key], { continuous: o.continuous, quiet: o.quiet, ...extra })
    : new VoiceSource(rand, o));
  return [
    // Broadcast FM (Band II)
    S({ freq: 88.6e6, label: 'SIM FM One', kind: 'wfm', mode: 'WFM', level: 0.06, halfBw: 100e3,
        src: new MusicSource(rand, { tempo: 116, key: 0 }) }),
    S({ freq: 89.1e6, label: 'SIM Talk', kind: 'wfm', mode: 'WFM', level: 0.03, halfBw: 100e3,
        src: voice({ f0: 115, continuous: true }, 'talk') }),
    S({ freq: 89.8e6, label: 'SIM FM Classic', kind: 'wfm', mode: 'WFM', level: 0.012, halfBw: 100e3,
        src: new MusicSource(rand, { tempo: 72, key: 5, prog: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]] }) }),
    // Aeronautical VHF (AM, push-to-talk)
    S({ freq: 118.5e6, label: 'Tower (sim)', kind: 'am', mode: 'AM', level: 0.012, halfBw: 5e3,
        src: voice({ f0: 125, talk: [2, 5], quiet: [1.5, 5] }, 'tower') }),
    S({ freq: 118.75e6, label: 'ATIS (sim)', kind: 'am', mode: 'AM', level: 0.006, halfBw: 5e3,
        src: voice({ f0: 105, continuous: true }, 'atis') }),
    S({ freq: 119.225e6, label: 'Approach (sim)', kind: 'am', mode: 'AM', level: 0.009, halfBw: 5e3,
        src: voice({ f0: 140, talk: [2, 6], quiet: [2, 6] }, 'approach') }),
    // 2 m amateur band
    S({ freq: 144.43e6, label: 'CW beacon (sim)', kind: 'cw', mode: 'CW', level: 0.003, halfBw: 200,
        src: new KeyingSource('VVV VVV DE SIM1BCN SIM1BCN LOC IO91', 16, 3) }),
    S({ freq: 144.8e6, label: 'APRS (not decoded)', kind: 'afsk', mode: 'NFM', level: 0.01, halfBw: 8e3,
        src: new AfskSource(rand) }),
    S({ freq: 145.5e6, label: 'FM calling (sim)', kind: 'nfm', mode: 'NFM', level: 0.008, halfBw: 8e3,
        src: voice({ f0: 110, talk: [3, 7], quiet: [3, 8] }, 'calling') }),
    // Marine VHF
    S({ freq: 156.8e6, label: 'Ch 16 (sim)', kind: 'nfm', mode: 'NFM', level: 0.01, halfBw: 8e3,
        src: voice({ f0: 118, talk: [2, 5], quiet: [3, 8] }, 'ch16') }),
    S({ freq: 156.3e6, label: 'Ch 06 (sim)', kind: 'nfm', mode: 'NFM', level: 0.004, halfBw: 8e3,
        src: voice({ f0: 135, talk: [2, 4], quiet: [5, 12] }, 'ch06') }),
    // PMR446
    S({ freq: 446.00625e6, label: 'PMR ch1 (sim)', kind: 'nfm', mode: 'NFM', level: 0.005, halfBw: 6e3,
        src: voice({ f0: 150, talk: [1.5, 4], quiet: [2, 6] }, 'pmr') }),
    // HF 20 m
    S({ freq: 14.025e6, label: 'CW CQ (sim)', kind: 'cw', mode: 'CW', level: 0.004, halfBw: 200,
        src: new KeyingSource('CQ CQ CQ DE SIM1CW SIM1CW K', 18, 5) }),
    S({ freq: 14.0835e6, label: 'RTTY 45 Bd (sim)', kind: 'fsk', mode: 'USB', level: 0.006, halfBw: 2.5e3,
        src: new FskSource('RYRYRY CQ CQ CQ DE SIM1RT SIM1RT 599 TNX QSO 73 K\n') }),
    S({ freq: 14.2e6, label: 'SSB voice (sim)', kind: 'usb', mode: 'USB', level: 0.02, halfBw: 3.2e3,
        src: voice({ f0: 105, talk: [3, 8], quiet: [2, 5] }, 'ssb', { analytic: true }) }),
  ];
}

// ------------------------------------------------------------------ ADS-B traffic

const CALLSIGNS = ['SIMA12', 'SIMB47', 'TRNG01', 'DEMO77', 'VECTR5', 'NOVA31', 'ALPHA9', 'ECHO42'];

class AdsbSim {
  constructor(rand) {
    this.rand = rand;
    this.aircraft = CALLSIGNS.map((cs) => {
      const brg = rand() * 360, rng = 5 + rand() * 65;
      const lat = SIM_REF.lat + (rng / 60) * Math.cos((brg * Math.PI) / 180);
      const lon = SIM_REF.lon + ((rng / 60) * Math.sin((brg * Math.PI) / 180)) / Math.cos((SIM_REF.lat * Math.PI) / 180);
      const alt = Math.round((3000 + rand() * 36000) / 100) * 100;
      return {
        icao: 0x400000 + ((rand() * 0x3ffff) | 0), callsign: cs, lat, lon, alt, altT: alt,
        gs: 180 + rand() * 300, trk: rand() * 360, vr: 0, odd: false,
        nextPos: 0, nextVel: 0, nextId: 0, phase: rand() * Math.PI * 2,
      };
    });
  }

  move(dt) {
    for (const a of this.aircraft) {
      const { range, bearing } = rangeBearing(SIM_REF, a);
      if (range > 75) {
        const want = (bearing + 180) % 360;
        const diff = ((want - a.trk + 540) % 360) - 180;
        a.trk = (a.trk + Math.sign(diff) * Math.min(Math.abs(diff), 3 * dt) + 360) % 360;
      }
      if (Math.abs(a.alt - a.altT) < 50) {
        a.vr = 0;
        if (this.rand() < dt / 60) a.altT = Math.round((3000 + this.rand() * 36000) / 1000) * 1000;
      } else a.vr = Math.sign(a.altT - a.alt) * 1500;
      a.alt += (a.vr / 60) * dt;
      const d = (a.gs * dt) / 3600 / 60; // degrees of arc
      a.lat += d * Math.cos((a.trk * Math.PI) / 180);
      a.lon += (d * Math.sin((a.trk * Math.PI) / 180)) / Math.cos((a.lat * Math.PI) / 180);
    }
  }

  render(re, im, n, g0, offsetHz) {
    const end = g0 + n - 240;
    for (const a of this.aircraft) {
      const { range } = rangeBearing(SIM_REF, a);
      const amp = Math.min(0.5, Math.max(0.015, 0.3 * (12 / Math.max(range, 3))));
      const due = (key, interval, make) => {
        while (a[key] < end) {
          const s = Math.floor(Math.max(a[key], g0) - g0);
          this.pulse(re, im, s, make(), amp, a, offsetHz);
          a[key] = Math.max(a[key], g0) + interval * SIM_FS * (0.8 + 0.4 * this.rand());
        }
      };
      due('nextPos', 0.5, () => { a.odd = !a.odd; return encodeAirbornePosition(a.icao, a.lat, a.lon, Math.round(a.alt / 25) * 25, a.odd); });
      due('nextVel', 0.5, () => encodeVelocity(a.icao, a.gs, a.trk, a.vr));
      due('nextId', 5, () => encodeIdentification(a.icao, a.callsign));
    }
  }

  pulse(re, im, s, bits, amp, a, offsetHz) {
    const w = (2 * Math.PI * offsetHz) / SIM_FS;
    const put = (k) => {
      const p = a.phase + w * k;
      re[s + k] += amp * Math.cos(p);
      im[s + k] += amp * Math.sin(p);
    };
    for (const k of [0, 2, 7, 9]) put(k);
    for (let b = 0; b < 112; b++) put(16 + b * 2 + (bits[b] ? 0 : 1));
    a.phase += 1.3;
  }
}

// ------------------------------------------------------------------ simulator source

export class Simulator {
  constructor({ onData, seed = 1090 }) {
    this.onData = onData;
    this.fs = SIM_FS;
    this.center = 145e6;
    this.gainDb = 30;
    this.g = 0;
    this.debt = 0;
    const rand = mulberry32(seed);
    this.rand = rand;
    this.stations = buildStations(rand);
    this.adsb = new AdsbSim(rand);
    this.noise = new Float32Array(1 << 16);
    for (let i = 0; i < this.noise.length; i += 2) {
      const u = Math.max(rand(), 1e-12), v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      this.noise[i] = r * Math.cos(2 * Math.PI * v);
      this.noise[i + 1] = r * Math.sin(2 * Math.PI * v);
    }
    this.re = new Float32Array(0);
    this.im = new Float32Array(0);
  }

  get markers() {
    return this.stations.map((s) => ({ freq: s.freq, label: s.label, mode: s.mode }))
      .concat([{ freq: 1090e6, label: 'ADS-B traffic (sim)', mode: 'ADS-B' }]);
  }

  setCenter(f) { this.center = f; }
  setGain(db) { this.gainDb = db; }

  start() {
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), 20);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  tick() {
    const now = performance.now();
    this.debt += ((now - this.last) * this.fs) / 1000;
    this.last = now;
    let n = Math.floor(this.debt);
    this.debt -= n;
    n = Math.min(n, this.fs * 0.1); // never try to catch up more than 100 ms after a stall
    if (n > 0) this.generate(n);
  }

  generate(n) {
    if (this.re.length < n) { this.re = new Float32Array(n); this.im = new Float32Array(n); }
    const re = this.re, im = this.im;
    re.fill(0, 0, n); im.fill(0, 0, n);
    const half = this.fs / 2;
    for (const st of this.stations) {
      const off = st.freq - this.center;
      if (Math.abs(off) + st.halfBw < half) st.render(re, im, n, this.g, off);
    }
    this.adsb.move(n / this.fs);
    const aoff = 1090e6 - this.center;
    if (Math.abs(aoff) < 200e3) this.adsb.render(re, im, n, this.g, aoff);

    const gain = 10 ** ((this.gainDb - 30) / 20);
    const T = this.noise, mask = T.length - 1;
    const a = (this.rand() * mask) | 0, b = (this.rand() * mask) | 0;
    const c = (this.rand() * mask) | 0, d = (this.rand() * mask) | 0;
    const rf = 0.0012, adc = 0.0004;
    for (let i = 0; i < n; i++) {
      let r = (re[i] + T[(a + i) & mask] * rf) * gain + T[(c + i) & mask] * adc;
      let q = (im[i] + T[(b + i) & mask] * rf) * gain + T[(d + i) & mask] * adc;
      re[i] = r > 1 ? 1 : r < -1 ? -1 : r;
      im[i] = q > 1 ? 1 : q < -1 ? -1 : q;
    }
    this.g += n;
    this.onData(re, im, n);
  }
}
