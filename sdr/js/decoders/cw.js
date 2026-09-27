// Adaptive Morse (CW) decoder working on demodulated audio.
// A Goertzel filter at the BFO pitch gives a tone envelope every 4 ms; an adaptive
// threshold keys marks and spaces; the dit length tracks the sender's speed.
import { MORSE_REVERSE } from './morse.js';

export class CwDecoder {
  constructor(sampleRate, onText, pitch = 700) {
    this.onText = onText;
    this.pitch = pitch;
    this.setRate(sampleRate);
    this.reset();
  }

  setRate(fs) {
    this.fs = fs;
    this.block = Math.max(16, Math.round(fs * 0.004));
    this.blockMs = (this.block / fs) * 1000;
    this.setPitch(this.pitch);
  }

  setPitch(pitch) {
    this.pitch = pitch;
    this.coeff = 2 * Math.cos((2 * Math.PI * pitch) / this.fs);
  }

  reset() {
    this.s1 = 0; this.s2 = 0; this.count = 0;
    this.hi = 0; this.lo = 0;
    this.key = false; this.run = 0;
    this.dit = 60; // ms, 20 WPM starting guess
    this.symbols = '';
    this.charDone = true;
    this.wordDone = true;
    this.level = 0;
  }

  get wpm() { return 1200 / this.dit; }

  process(x, n) {
    const coeff = this.coeff, block = this.block;
    let s1 = this.s1, s2 = this.s2, c = this.count;
    for (let i = 0; i < n; i++) {
      const s0 = x[i] + coeff * s1 - s2;
      s2 = s1; s1 = s0;
      if (++c === block) {
        const p = s1 * s1 + s2 * s2 - coeff * s1 * s2;
        this.step(Math.sqrt(Math.max(p, 0)) / block);
        s1 = 0; s2 = 0; c = 0;
      }
    }
    this.s1 = s1; this.s2 = s2; this.count = c;
  }

  step(mag) {
    this.hi += (mag > this.hi ? 0.3 : 0.004) * (mag - this.hi);
    this.lo += (mag < this.lo ? 0.3 : 0.002) * (mag - this.lo);
    const span = this.hi - this.lo;
    const valid = this.hi > this.lo * 3 && this.hi > 1e-4;
    const thr = this.lo + span * (this.key ? 0.4 : 0.6);
    const key = valid && mag > thr;
    this.level = valid ? Math.min(1, Math.max(0, (mag - this.lo) / (span || 1))) : 0;
    this.run++;
    if (key !== this.key) {
      const ms = this.run * this.blockMs;
      if (this.key) this.mark(ms);
      else this.space(ms);
      this.key = key;
      this.run = 0;
    } else if (!key) {
      this.space(this.run * this.blockMs, true);
    }
  }

  mark(ms) {
    if (ms < 12) return; // glitch
    this.charDone = false;
    this.wordDone = false;
    if (ms < this.dit * 2) {
      this.symbols += '.';
      this.dit = this.dit * 0.75 + ms * 0.25;
    } else {
      this.symbols += '-';
      this.dit = this.dit * 0.75 + (ms / 3) * 0.25;
    }
    this.dit = Math.min(300, Math.max(20, this.dit));
    if (this.symbols.length > 8) this.symbols = '';
  }

  space(ms) {
    if (!this.charDone && ms > this.dit * 2.5) {
      this.charDone = true;
      if (this.symbols) this.onText(MORSE_REVERSE[this.symbols] ?? '*');
      this.symbols = '';
    }
    if (!this.wordDone && ms > this.dit * 5.5) {
      this.wordDone = true;
      this.onText(' ');
    }
  }
}
