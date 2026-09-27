// Radix-2 in-place complex FFT plus the spectrum analyser used for the display.

export class FFT {
  constructor(n) {
    if (n & (n - 1)) throw new Error('FFT size must be a power of two');
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
      this.rev[i] = r;
    }
  }

  forward(re, im) {
    const n = this.n, rev = this.rev, cs = this.cos, sn = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, w = 0; k < half; k++, w += step) {
          const a = start + k, b = a + half;
          const wr = cs[w], wi = sn[w];
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

/**
 * Averaging power spectrum in dBFS (a full-scale complex tone reads 0 dBFS).
 * Limits itself to ~maxRate FFTs per second so wide sample rates stay cheap.
 */
export class SpectrumAnalyzer {
  constructor(size = 4096) {
    this.setSize(size);
  }

  setSize(n) {
    this.n = n;
    this.fft = new FFT(n);
    this.win = new Float64Array(n);
    let sum = 0, sum2 = 0;
    for (let i = 0; i < n; i++) {
      const x = (2 * Math.PI * i) / (n - 1);
      const w = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
      this.win[i] = w; sum += w; sum2 += w * w;
    }
    this.norm = 1 / (sum * sum);
    this.enbw = (n * sum2) / (sum * sum); // equivalent noise bandwidth in bins
    this.bre = new Float64Array(n);
    this.bim = new Float64Array(n);
    this.wre = new Float64Array(n);
    this.wim = new Float64Array(n);
    this.acc = new Float64Array(n);
    this.fill = 0;
    this.skip = 0;
    this.frames = 0;
  }

  /** Push samples. `im` may be null for real (audio) input. */
  push(re, im, n, sampleRate, maxRate = 90) {
    const N = this.n;
    const gap = Math.max(0, Math.floor(sampleRate / maxRate) - N);
    let i = 0;
    while (i < n) {
      if (this.skip > 0) {
        const s = Math.min(this.skip, n - i);
        this.skip -= s; i += s;
        continue;
      }
      const take = Math.min(N - this.fill, n - i);
      for (let k = 0; k < take; k++) {
        this.bre[this.fill + k] = re[i + k];
        this.bim[this.fill + k] = im ? im[i + k] : 0;
      }
      this.fill += take; i += take;
      if (this.fill === N) {
        this.compute();
        this.fill = 0;
        this.skip = gap;
      }
    }
  }

  compute() {
    const N = this.n, w = this.win, re = this.wre, im = this.wim;
    for (let i = 0; i < N; i++) { re[i] = this.bre[i] * w[i]; im[i] = this.bim[i] * w[i]; }
    this.fft.forward(re, im);
    for (let i = 0; i < N; i++) this.acc[i] += re[i] * re[i] + im[i] * im[i];
    this.frames++;
  }

  /** Returns averaged dB bins since the last call (fft-shifted), or null. Real input returns 0..fs/2 only. */
  take(realOnly = false) {
    if (!this.frames) return null;
    const N = this.n, half = N >> 1;
    const k = this.norm / this.frames;
    const out = new Float32Array(realOnly ? half : N);
    if (realOnly) {
      // Real input: fold negative frequencies back (x2 power) so a real tone also reads correctly.
      for (let i = 0; i < half; i++) out[i] = 10 * Math.log10(this.acc[i] * k * 4 + 1e-20);
    } else {
      for (let i = 0; i < N; i++) out[i] = 10 * Math.log10(this.acc[(i + half) % N] * k + 1e-20);
    }
    this.acc.fill(0);
    this.frames = 0;
    return out;
  }
}
