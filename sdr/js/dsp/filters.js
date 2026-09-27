// FIR design and streaming filter building blocks.

/**
 * Windowed-sinc (Blackman) low-pass taps, unity DC gain.
 * cutoff and transition are normalised to the sample rate (cycles/sample).
 */
export function lowpassTaps(cutoff, transition, maxTaps = 401) {
  let n = Math.ceil(5.5 / Math.max(transition, 1e-5));
  n = Math.min(Math.max(n, 7), maxTaps) | 1;
  const taps = new Float32Array(n);
  const M = n - 1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const k = i - M / 2;
    const sinc = k === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / M) + 0.08 * Math.cos((4 * Math.PI * i) / M);
    taps[i] = sinc * w;
    sum += taps[i];
  }
  for (let i = 0; i < n; i++) taps[i] /= sum;
  return taps;
}

/** Streaming FIR with integer decimation, real or complex. Output buffers are reused between calls. */
export class DecimFIR {
  constructor(taps, decim = 1, complex = true) {
    this.h = taps;
    this.D = decim;
    this.cx = complex;
    this.H = taps.length - 1;
    this.wr = new Float32Array(this.H + 8192);
    this.wi = complex ? new Float32Array(this.H + 8192) : null;
    this.pos = 0;
    this.outR = new Float32Array(1024);
    this.outI = complex ? new Float32Array(1024) : null;
  }

  grow(total) {
    const grow = (buf) => { const b = new Float32Array(total * 1.5 | 0); b.set(buf.subarray(0, this.H)); return b; };
    this.wr = grow(this.wr);
    if (this.cx) this.wi = grow(this.wi);
  }

  /** Returns the number of output samples written to outR/outI. */
  process(re, im, n) {
    const H = this.H, total = H + n, h = this.h, L = h.length, D = this.D;
    if (this.wr.length < total) this.grow(total);
    const wr = this.wr, wi = this.wi;
    wr.set(re.subarray(0, n), H);
    if (this.cx) wi.set(im.subarray(0, n), H);
    const maxOut = Math.ceil(n / D) + 1;
    if (this.outR.length < maxOut) {
      this.outR = new Float32Array(maxOut * 1.5 | 0);
      if (this.cx) this.outI = new Float32Array(maxOut * 1.5 | 0);
    }
    const oR = this.outR, oI = this.outI;
    let o = 0, p = this.pos;
    if (this.cx) {
      for (; p + L <= total; p += D) {
        let ar = 0, ai = 0;
        for (let k = 0; k < L; k++) { const c = h[k]; ar += c * wr[p + k]; ai += c * wi[p + k]; }
        oR[o] = ar; oI[o] = ai; o++;
      }
    } else {
      for (; p + L <= total; p += D) {
        let ar = 0;
        for (let k = 0; k < L; k++) ar += h[k] * wr[p + k];
        oR[o++] = ar;
      }
    }
    this.pos = p - n;
    wr.copyWithin(0, total - H, total);
    if (this.cx) wi.copyWithin(0, total - H, total);
    return o;
  }
}

/** Linear-interpolating fractional resampler with a trimmable ratio (for clock-drift control). */
export class Resampler {
  constructor(inRate, outRate) {
    this.base = inRate / outRate;
    this.ratio = this.base;
    this.p = 0;
    this.last = 0;
    this.out = new Float32Array(4096);
  }

  trim(factor) { this.ratio = this.base * factor; }

  process(x, n) {
    const maxOut = Math.ceil((n + 1) / this.ratio) + 2;
    if (this.out.length < maxOut) this.out = new Float32Array(maxOut * 1.5 | 0);
    const out = this.out, r = this.ratio;
    let p = this.p, o = 0;
    while (p < n - 1) {
      const i = Math.floor(p), f = p - i;
      const a = i < 0 ? this.last : x[i];
      out[o++] = a + (x[i + 1] - a) * f;
      p += r;
    }
    this.p = p - n;
    if (n) this.last = x[n - 1];
    return o;
  }
}

/** Pick an integer decimation >= 1 whose prime factors are all <= 7, keeping the output rate >= minRate. */
export function chooseDecimation(fs, minRate) {
  let D = Math.max(1, Math.floor(fs / minRate));
  const smooth = (d) => { for (const p of [2, 3, 5, 7]) while (d % p === 0) d /= p; return d === 1; };
  while (D > 1 && !smooth(D)) D--;
  return D;
}

/** Split D into stage factors of at most 8, largest first. */
export function decimationStages(D) {
  const primes = [];
  let d = D;
  for (const p of [7, 5, 3, 2]) while (d % p === 0) { primes.push(p); d /= p; }
  const stages = [];
  for (const p of primes) {
    const last = stages.length - 1;
    if (last >= 0 && stages[last] * p <= 8) stages[last] *= p;
    else stages.push(p);
  }
  return stages.sort((a, b) => b - a);
}
