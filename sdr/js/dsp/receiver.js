// Single-channel receiver: NCO mix -> multi-stage decimation -> channel filter -> demodulator -> audio.
import { lowpassTaps, DecimFIR, Resampler, chooseDecimation, decimationStages } from './filters.js';

export const MODES = {
  AM:  { bw: 8000,   minIF: 40000,  audioBW: 4500,  agc: true },
  NFM: { bw: 12500,  minIF: 40000,  audioBW: 4000,  dev: 5000 },
  WFM: { bw: 180000, minIF: 180000, audioBW: 15000, dev: 75000, deemph: true },
  USB: { bw: 2700,   minIF: 40000,  audioBW: 3200,  agc: true, ssb: 1 },
  LSB: { bw: 2700,   minIF: 40000,  audioBW: 3200,  agc: true, ssb: -1 },
  CW:  { bw: 500,    minIF: 40000,  audioBW: 1500,  agc: true, cw: true },
};

/** Where the passband sits relative to the tuned (carrier / dial) frequency, in Hz. */
export function passband(mode, bw) {
  if (mode === 'USB') return [300, 300 + bw];
  if (mode === 'LSB') return [-300 - bw, -300];
  return [-bw / 2, bw / 2];
}

class AGC {
  constructor(fs) {
    this.attack = 1 - Math.exp(-1 / (0.002 * fs));
    this.release = Math.exp(-1 / (0.5 * fs));
    this.peak = 1e-3;
  }
  process(x, n) {
    let peak = this.peak;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(x[i]);
      peak = a > peak ? peak + this.attack * (a - peak) : peak * this.release;
      if (peak < 2e-5) peak = 2e-5;
      x[i] *= 0.3 / peak;
    }
    this.peak = peak;
  }
}

export class Receiver {
  constructor(audioRate) {
    this.audioRate = audioRate;
    this.fs = 0;
    this.mode = 'NFM';
    this.bw = MODES.NFM.bw;
    this.offset = 0;
    this.cwPitch = 700;
    this.deemphTau = 50e-6;
    this.squelchDb = -200;
    this.squelchOpen = true;
    this.phC = 1; this.phS = 0;
    this.mixR = new Float32Array(8192);
    this.mixI = new Float32Array(8192);
    this.demod = new Float32Array(4096);
    this.powerDb = -150;
    this.iqSnap = new Float32Array(512);
  }

  configure({ fs = this.fs, mode = this.mode, bw = this.bw, offset = this.offset, cwPitch = this.cwPitch,
              squelchDb = this.squelchDb, deemphTau = this.deemphTau }) {
    const rebuild = fs !== this.fs || mode !== this.mode || bw !== this.bw || cwPitch !== this.cwPitch ||
                    deemphTau !== this.deemphTau;
    Object.assign(this, { fs, mode, bw, offset, cwPitch, squelchDb, deemphTau });
    if (rebuild && fs > 0) this.build();
  }

  build() {
    const def = MODES[this.mode];
    const fs = this.fs;
    const D = chooseDecimation(fs, def.minIF);
    this.ifRate = fs / D;
    const pb = passband(this.mode, this.bw);
    // For SSB the channel is shifted so the passband is centred on 0 Hz before filtering.
    this.shift = def.ssb ? (pb[0] + pb[1]) / 2 : 0;
    this.halfWidth = (pb[1] - pb[0]) / 2;
    const protect = Math.min(this.halfWidth, 0.42 * this.ifRate);

    this.stages = [];
    let rate = fs;
    for (const d of decimationStages(D)) {
      const out = rate / d;
      const trans = Math.max((out - 2 * protect) / rate, 0.08 / d);
      this.stages.push(new DecimFIR(lowpassTaps(0.5 / d, trans, 255), d, true));
      rate = out;
    }
    this.chan = this.mode === 'WFM' ? null
      : new DecimFIR(lowpassTaps(this.halfWidth / rate, Math.max(this.halfWidth * 0.5, 1) / rate, 401), 1, true);

    // Audio: low-pass (+ integer decimation when the IF is far above the audio rate), then fractional resample.
    const dA = Math.max(1, Math.floor(this.ifRate / this.audioRate));
    const aOut = this.ifRate / dA;
    const aBW = Math.min(def.audioBW, aOut * 0.45);
    const stop = dA > 1 ? aOut - aBW : Math.min(aOut / 2, aBW * 1.5);
    this.audioFir = new DecimFIR(lowpassTaps(aBW / this.ifRate, Math.max(stop - aBW, 500) / this.ifRate, 255), dA, false);
    this.resampler = new Resampler(aOut, this.audioRate);

    this.agc = def.agc ? new AGC(this.ifRate) : null;
    this.prevR = 0; this.prevI = 0;
    this.dc = 0; this.de = 0;
    this.postPh = 0;
    this.deAlpha = 1 - Math.exp(-1 / (this.ifRate * this.deemphTau));
  }

  trimAudio(factor) { if (this.resampler) this.resampler.trim(factor); }

  /** Process complex baseband samples. Returns {audio, audioN, demod, demodN, ifRate}. */
  process(re, im, n) {
    if (this.mixR.length < n) { this.mixR = new Float32Array(n); this.mixI = new Float32Array(n); }
    const mr = this.mixR, mi = this.mixI;
    const w = (-2 * Math.PI * (this.offset + this.shift)) / this.fs;
    const dc = Math.cos(w), ds = Math.sin(w);
    let c = this.phC, s = this.phS;
    for (let i = 0; i < n; i++) {
      const xr = re[i], xi = im[i];
      mr[i] = xr * c - xi * s;
      mi[i] = xr * s + xi * c;
      const t = c * dc - s * ds;
      s = c * ds + s * dc;
      c = t;
    }
    const g = 1 / Math.hypot(c, s);
    this.phC = c * g; this.phS = s * g;

    let bR = mr, bI = mi, len = n;
    for (const st of this.stages) { len = st.process(bR, bI, len); bR = st.outR; bI = st.outI; }
    if (this.chan) { len = this.chan.process(bR, bI, len); bR = this.chan.outR; bI = this.chan.outI; }

    // Channel power and a constellation snapshot.
    let p = 0;
    for (let i = 0; i < len; i++) p += bR[i] * bR[i] + bI[i] * bI[i];
    if (len) {
      this.powerDb = 10 * Math.log10(p / len + 1e-20);
      const k = Math.min(256, len), off = len - k;
      for (let i = 0; i < k; i++) { this.iqSnap[2 * i] = bR[off + i]; this.iqSnap[2 * i + 1] = bI[off + i]; }
      this.iqSnapN = k;
    }
    const hyst = this.squelchOpen ? -2 : 2;
    this.squelchOpen = this.powerDb >= this.squelchDb + hyst;

    if (this.demod.length < len) this.demod = new Float32Array(len * 1.5 | 0);
    const out = this.demod;
    this.demodulate(bR, bI, len, out);

    let aN = this.audioFir.process(out, null, len);
    aN = this.resampler.process(this.audioFir.outR, aN);
    const audio = this.resampler.out;
    if (!this.squelchOpen) audio.fill(0, 0, aN);
    return { audio, audioN: aN, demod: out, demodN: len, ifRate: this.ifRate };
  }

  demodulate(bR, bI, len, out) {
    const mode = this.mode, def = MODES[mode];
    if (mode === 'AM') {
      let dc = this.dc;
      for (let i = 0; i < len; i++) {
        const e = Math.sqrt(bR[i] * bR[i] + bI[i] * bI[i]);
        dc += 0.0005 * (e - dc);
        out[i] = e - dc;
      }
      this.dc = dc;
    } else if (mode === 'NFM' || mode === 'WFM') {
      const k = this.ifRate / (2 * Math.PI * def.dev);
      let pr = this.prevR, pi = this.prevI, de = this.de;
      const a = this.deAlpha;
      for (let i = 0; i < len; i++) {
        const r = bR[i], q = bI[i];
        let v = Math.atan2(q * pr - r * pi, r * pr + q * pi) * k;
        if (def.deemph) { de += a * (v - de); v = de; }
        out[i] = v;
        pr = r; pi = q;
      }
      this.prevR = pr; this.prevI = pi; this.de = de;
    } else {
      // SSB / CW: shift the filtered channel back up (or to the BFO pitch) and take the real part.
      const f = def.cw ? this.cwPitch : this.shift;
      const w = (2 * Math.PI * f) / this.ifRate;
      let ph = this.postPh;
      for (let i = 0; i < len; i++) {
        out[i] = bR[i] * Math.cos(ph) - bI[i] * Math.sin(ph);
        ph += w;
      }
      this.postPh = ph % (2 * Math.PI);
    }
    if (this.agc) this.agc.process(out, len);
  }
}
