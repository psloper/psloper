// Baudot RTTY (FSK) decoder working on SSB-demodulated audio.
// Two quadrature tone detectors (mark / space) feed an asynchronous UART
// (1 start bit, 5 data bits LSB first, >= 1 stop bit).
import { LETTERS, FIGURES, LTRS, FIGS } from './baudot.js';

export class RttyDecoder {
  constructor(sampleRate, onText) {
    this.onText = onText;
    this.fs = sampleRate;
    this.cfg = { baud: 45.45, shift: 170, lowTone: 2125, markIsHigh: true };
    this.configure({});
  }

  configure(opts) {
    Object.assign(this.cfg, opts);
    if (opts.sampleRate) this.fs = opts.sampleRate;
    const { baud, shift, lowTone, markIsHigh } = this.cfg;
    const markHz = markIsHigh ? lowTone + shift : lowTone;
    const spaceHz = markIsHigh ? lowTone : lowTone + shift;
    this.mw = (2 * Math.PI * markHz) / this.fs;
    this.sw = (2 * Math.PI * spaceHz) / this.fs;
    this.alpha = 1 - Math.exp((-2 * Math.PI * baud * 0.65) / this.fs);
    this.pAlpha = 1 - Math.exp(-1 / (0.05 * this.fs));
    this.spb = this.fs / baud;
    this.reset();
  }

  reset() {
    this.mp = 0; this.sp = 0;
    this.f = new Float64Array(8); // two cascaded one-pole LPFs on I/Q of mark and space
    this.power = 1e-9; this.tone = 0;
    this.markLevel = 0; this.spaceLevel = 0;
    this.state = 0; this.t = 0; this.next = 0; this.bitIdx = 0; this.code = 0;
    this.prev = 1; this.figs = false;
  }

  process(x, n) {
    const f = this.f, a = this.alpha, pa = this.pAlpha, spb = this.spb;
    for (let i = 0; i < n; i++) {
      const v = x[i];
      this.mp += this.mw; this.sp += this.sw;
      if (this.mp > 6.283185307179586) this.mp -= 6.283185307179586;
      if (this.sp > 6.283185307179586) this.sp -= 6.283185307179586;
      const mi = v * Math.cos(this.mp), mq = v * Math.sin(this.mp);
      const si = v * Math.cos(this.sp), sq = v * Math.sin(this.sp);
      f[0] += a * (mi - f[0]); f[1] += a * (f[0] - f[1]);
      f[2] += a * (mq - f[2]); f[3] += a * (f[2] - f[3]);
      f[4] += a * (si - f[4]); f[5] += a * (f[4] - f[5]);
      f[6] += a * (sq - f[6]); f[7] += a * (f[6] - f[7]);
      const me = f[1] * f[1] + f[3] * f[3];
      const se = f[5] * f[5] + f[7] * f[7];
      this.power += pa * (v * v - this.power);
      this.tone += pa * ((me + se) * 2 - this.tone);
      this.markLevel += pa * (me - this.markLevel);
      this.spaceLevel += pa * (se - this.spaceLevel);
      const bit = me > se ? 1 : 0;
      this.uart(bit, spb);
    }
  }

  /** Fraction of input power inside the two tone filters (0..1): a tuning/lock indicator. */
  get lock() { return Math.min(1, this.tone / (this.power + 1e-12)); }

  uart(bit, spb) {
    switch (this.state) {
      case 0: // idle: wait for mark -> space edge
        if (this.prev === 1 && bit === 0 && this.lock > 0.15) { this.state = 1; this.t = 0; }
        break;
      case 1: // verify start bit at its centre
        if (++this.t >= spb * 0.5) {
          if (bit === 0) { this.state = 2; this.next = spb * 1.5; this.bitIdx = 0; this.code = 0; }
          else this.state = 0;
        }
        break;
      case 2: // data bits
        if (++this.t >= this.next) {
          this.code |= bit << this.bitIdx;
          this.next += spb;
          if (++this.bitIdx === 5) this.state = 3;
        }
        break;
      case 3: // stop bit
        if (++this.t >= this.next) {
          if (bit === 1) this.emit(this.code);
          this.state = 0;
        }
        break;
    }
    this.prev = bit;
  }

  emit(code) {
    if (code === LTRS) { this.figs = false; return; }
    if (code === FIGS) { this.figs = true; return; }
    const ch = (this.figs ? FIGURES : LETTERS)[code];
    if (ch === ' ') this.figs = false; // unshift on space
    if (!ch || ch === '\0' || ch === '\r' || ch === '\x07') return;
    this.onText(ch);
  }
}
