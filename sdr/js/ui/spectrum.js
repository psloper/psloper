// Spectrum trace + waterfall renderer with click-to-tune, drag-to-pan, wheel-to-step and zoom.
import { formatHz, formatBw, ALLOCATIONS, CHANNELS } from './bandplan.js';

const PALETTE = (() => {
  const stops = [
    [0.0, [4, 6, 10]], [0.22, [10, 30, 58]], [0.42, [14, 96, 128]], [0.6, [40, 190, 150]],
    [0.76, [255, 196, 90]], [0.9, [255, 110, 60]], [1.0, [255, 246, 228]],
  ];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    const u = (t - t0) / (t1 - t0);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * u;
  }
  return lut;
})();

function niceStep(span, target) {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export class SpectrumView {
  constructor({ spec, wf, onTune, onDrag, onStep, onZoom, onHover }) {
    Object.assign(this, { spec, wf, onTune, onDrag, onStep, onZoom, onHover });
    this.sctx = spec.getContext('2d');
    this.wctx = wf.getContext('2d');
    this.buf = document.createElement('canvas');
    this.bctx = this.buf.getContext('2d', { willReadFrequently: false });
    this.data = null;
    this.avg = 0.6;
    this.top = -20; this.bottom = -120;
    this.zoom = 1;
    this.peakOn = false;
    this.tuning = { vfo: 0, pb: [-5000, 5000], mode: 'NFM', bw: 10000, step: 1000 };
    this.markers = [];
    this.hoverX = null;
    this.dirty = true;
    this.enabled = true;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(spec.parentElement);
    for (const c of [spec, wf]) this.bindPointer(c);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    for (const c of [this.spec, this.wf]) {
      const r = c.getBoundingClientRect();
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    }
    const old = this.buf.width ? this.buf : null;
    const nb = document.createElement('canvas');
    nb.width = this.wf.width; nb.height = this.wf.height;
    const nctx = nb.getContext('2d');
    nctx.fillStyle = '#04060a';
    nctx.fillRect(0, 0, nb.width, nb.height);
    if (old && old.width) nctx.drawImage(old, 0, 0, nb.width, nb.height);
    this.buf = nb; this.bctx = nctx;
    this.row = this.bctx.createImageData(nb.width, 1);
    this.dirty = true;
  }

  // ------------------------------------------------------------ state setters
  setData({ bins, center, span, noiseDb }) {
    if (this.auto && noiseDb != null) {
      // Auto range: keep the noise floor near the bottom so the waterfall stays dark and signals pop.
      // Clamped so digital silence (-200 dB) does not drag the scale off the chart.
      const nfNow = Math.max(-150, Math.min(-20, noiseDb));
      this.nf = this.nf == null ? nfNow : this.nf + 0.05 * (nfNow - this.nf);
      this.bottom = Math.round(this.nf - 12);
      this.top = this.bottom + 90;
    }
    const d = this.data;
    if (!d || d.center !== center || d.span !== span || d.smooth.length !== bins.length) {
      this.data = { center, span, smooth: Float32Array.from(bins), peak: Float32Array.from(bins), noiseDb };
    } else {
      const a = this.avg, s = d.smooth, p = d.peak;
      for (let i = 0; i < bins.length; i++) {
        s[i] = a * s[i] + (1 - a) * bins[i];
        p[i] = Math.max(p[i] - 0.15, s[i]);
      }
      d.noiseDb = noiseDb;
    }
    this.pushRow(bins);
    this.dirty = true;
  }

  clearPeak() { if (this.data) this.data.peak.set(this.data.smooth); }
  setTuning(t) { Object.assign(this.tuning, t); this.dirty = true; }
  setMarkers(list) { this.markers = list; this.dirty = true; }
  setRange(top, bottom) {
    this.auto = top === 'auto';
    if (!this.auto) { this.top = top; this.bottom = bottom; }
    this.dirty = true;
  }
  setZoom(z) { this.zoom = z; this.dirty = true; }

  view() {
    const d = this.data;
    if (!d) return null;
    const vs = d.span / this.zoom;
    let vc = d.center;
    if (this.zoom > 1) {
      const lo = d.center - d.span / 2 + vs / 2, hi = d.center + d.span / 2 - vs / 2;
      vc = Math.min(hi, Math.max(lo, this.tuning.vfo));
    }
    return { f0: vc - vs / 2, span: vs, center: vc };
  }

  xToHz(xCss) {
    const v = this.view();
    const w = this.spec.getBoundingClientRect().width;
    return v ? v.f0 + (xCss / w) * v.span : 0;
  }

  /** Reduce bins to one value per pixel column (max over the bins each column covers). */
  columns(src, W) {
    const d = this.data, v = this.view();
    const N = src.length;
    const out = new Float32Array(W);
    const start = d.center - d.span / 2;
    for (let x = 0; x < W; x++) {
      const fa = v.f0 + (x / W) * v.span, fb = v.f0 + ((x + 1) / W) * v.span;
      const ba = ((fa - start) / d.span) * N, bb = ((fb - start) / d.span) * N;
      let i0 = Math.floor(ba), i1 = Math.ceil(bb) - 1;
      if (i1 <= i0) {
        const i = Math.min(N - 2, Math.max(0, Math.floor(ba))), t = ba - i;
        out[x] = src[i] + (src[i + 1] - src[i]) * Math.min(1, Math.max(0, t));
        continue;
      }
      i0 = Math.max(0, i0); i1 = Math.min(N - 1, i1);
      let m = -300;
      for (let i = i0; i <= i1; i++) if (src[i] > m) m = src[i];
      out[x] = m;
    }
    return out;
  }

  pushRow(bins) {
    if (!this.data) return;
    const W = this.buf.width, H = this.buf.height;
    const cols = this.columns(bins, W);
    const px = this.row.data, range = this.top - this.bottom;
    for (let x = 0; x < W; x++) {
      const t = Math.min(255, Math.max(0, ((cols[x] - this.bottom) / range) * 255)) | 0;
      px[x * 4] = PALETTE[t * 3]; px[x * 4 + 1] = PALETTE[t * 3 + 1]; px[x * 4 + 2] = PALETTE[t * 3 + 2]; px[x * 4 + 3] = 255;
    }
    const step = Math.max(1, Math.round(this.dpr));
    this.bctx.drawImage(this.buf, 0, 0, W, H - step, 0, step, W, H - step);
    for (let s = 0; s < step; s++) this.bctx.putImageData(this.row, 0, s);
  }

  // ------------------------------------------------------------ drawing
  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const c = this.sctx, W = this.spec.width, H = this.spec.height, dpr = this.dpr;
    c.clearRect(0, 0, W, H);
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#070a0e'); bg.addColorStop(1, '#0a0f13');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const d = this.data, v = this.view();
    const w = this.wctx;
    w.drawImage(this.buf, 0, 0);
    if (!d) return;

    const stripH = 16 * dpr, axisH = 18 * dpr;
    const plotTop = stripH + 14 * dpr, plotBot = H - axisH;
    const yOf = (db) => plotTop + ((this.top - db) / (this.top - this.bottom)) * (plotBot - plotTop);
    const xOf = (f) => ((f - v.f0) / v.span) * W;
    c.font = `${10 * dpr}px ui-monospace, Menlo, Consolas, monospace`;
    c.textBaseline = 'middle';

    // dB grid
    c.strokeStyle = 'rgba(120,140,160,0.10)';
    c.fillStyle = 'rgba(135,147,160,0.7)';
    c.lineWidth = 1;
    for (let db = Math.ceil(this.bottom / 10) * 10; db <= this.top; db += 10) {
      const y = Math.round(yOf(db)) + 0.5;
      c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
      c.fillText(`${db}`, 4 * dpr, y - 6 * dpr);
    }
    // frequency grid + axis
    const fstep = niceStep(v.span, W / dpr / 90);
    c.textAlign = 'center';
    for (let f = Math.ceil(v.f0 / fstep) * fstep; f <= v.f0 + v.span; f += fstep) {
      const x = Math.round(xOf(f)) + 0.5;
      c.strokeStyle = 'rgba(120,140,160,0.08)';
      c.beginPath(); c.moveTo(x, plotTop); c.lineTo(x, plotBot); c.stroke();
      const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(fstep / (v.center >= 1e6 ? 1e6 : 1e3)))));
      c.fillStyle = 'rgba(135,147,160,0.85)';
      c.fillText(v.center >= 1e6 ? (f / 1e6).toFixed(decimals) : (f / 1e3).toFixed(decimals), x, H - axisH / 2);
    }

    // allocation strip
    c.textAlign = 'left';
    for (const a of ALLOCATIONS) {
      const x0 = xOf(a.lo), x1 = xOf(a.hi);
      if (x1 < 0 || x0 > W) continue;
      const nested = ALLOCATIONS.some((b) => b !== a && b.lo <= a.lo && b.hi >= a.hi);
      const y = nested ? stripH * 0.55 : 2 * dpr, h = nested ? stripH * 0.4 : stripH * 0.5;
      c.fillStyle = a.mode ? 'rgba(98,201,255,0.16)' : 'rgba(135,147,160,0.12)';
      c.fillRect(Math.max(0, x0), y, Math.min(W, x1) - Math.max(0, x0), h);
      const label = a.name;
      const lx = Math.max(4 * dpr, x0 + 4 * dpr);
      if (Math.min(W, x1) - lx > c.measureText(label).width + 4 * dpr) {
        c.fillStyle = 'rgba(190,210,225,0.75)';
        c.fillText(label, lx, y + h / 2 + 0.5);
      }
    }

    // passband
    const t = this.tuning;
    const pbx0 = xOf(t.vfo + t.pb[0]), pbx1 = xOf(t.vfo + t.pb[1]), vx = xOf(t.vfo);
    c.fillStyle = 'rgba(255,181,71,0.10)';
    c.fillRect(pbx0, plotTop, Math.max(1, pbx1 - pbx0), plotBot - plotTop);

    // trace
    const cols = this.columns(d.smooth, W);
    const grad = c.createLinearGradient(0, plotTop, 0, plotBot);
    grad.addColorStop(0, 'rgba(79,227,156,0.45)');
    grad.addColorStop(1, 'rgba(79,227,156,0.02)');
    c.beginPath();
    c.moveTo(0, plotBot);
    for (let x = 0; x < W; x++) c.lineTo(x, Math.max(plotTop, Math.min(plotBot, yOf(cols[x]))));
    c.lineTo(W, plotBot);
    c.closePath();
    c.fillStyle = grad; c.fill();
    c.beginPath();
    for (let x = 0; x < W; x++) {
      const y = Math.max(plotTop, Math.min(plotBot, yOf(cols[x])));
      x ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.strokeStyle = '#8ff5c4'; c.lineWidth = 1.2 * dpr;
    c.shadowColor = 'rgba(79,227,156,0.6)'; c.shadowBlur = 6 * dpr;
    c.stroke();
    c.shadowBlur = 0;

    if (this.peakOn) {
      const pc = this.columns(d.peak, W);
      c.beginPath();
      for (let x = 0; x < W; x++) { const y = Math.max(plotTop, yOf(pc[x])); x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1 * dpr; c.stroke();
    }

    // noise floor
    if (d.noiseDb != null) {
      const y = Math.round(yOf(d.noiseDb)) + 0.5;
      c.setLineDash([4 * dpr, 4 * dpr]);
      c.strokeStyle = 'rgba(135,147,160,0.35)';
      c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
      c.setLineDash([]);
    }

    // known stations / channels
    c.textAlign = 'center';
    const drawn = [];
    for (const m of this.markers.concat(CHANNELS)) {
      const x = xOf(m.freq);
      if (x < 0 || x > W || drawn.some((px) => Math.abs(px - x) < 70 * dpr)) continue;
      drawn.push(x);
      const y = stripH + 7 * dpr;
      c.fillStyle = 'rgba(214,220,227,0.8)';
      c.beginPath(); c.moveTo(x, y + 5 * dpr); c.lineTo(x - 3.5 * dpr, y - 1 * dpr); c.lineTo(x + 3.5 * dpr, y - 1 * dpr); c.fill();
      c.fillStyle = 'rgba(214,220,227,0.65)';
      c.fillText(m.label, Math.min(W - 40 * dpr, Math.max(40 * dpr, x)), y + 13 * dpr);
    }

    // VFO line and label
    c.strokeStyle = '#ffb547'; c.lineWidth = 1.5 * dpr;
    c.beginPath(); c.moveTo(vx, plotTop); c.lineTo(vx, plotBot); c.stroke();
    c.fillStyle = '#ffb547';
    c.textAlign = vx > W - 140 * dpr ? 'right' : 'left';
    c.fillText(`${t.mode} ${formatBw(t.bw)}`, vx + (c.textAlign === 'left' ? 6 : -6) * dpr, plotBot - 9 * dpr);

    // hover cursor
    if (this.hoverX != null) {
      const hx = this.hoverX * dpr;
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(hx, plotTop); c.lineTo(hx, plotBot); c.stroke();
    }

    // waterfall overlay: passband edges + VFO
    const wh = this.wf.height;
    w.fillStyle = 'rgba(255,181,71,0.07)';
    w.fillRect(pbx0, 0, Math.max(1, pbx1 - pbx0), wh);
    w.strokeStyle = 'rgba(255,181,71,0.7)'; w.lineWidth = 1 * dpr;
    w.beginPath(); w.moveTo(vx, 0); w.lineTo(vx, wh); w.stroke();
    if (this.hoverX != null) {
      w.strokeStyle = 'rgba(255,255,255,0.25)';
      w.beginPath(); w.moveTo(this.hoverX * dpr, 0); w.lineTo(this.hoverX * dpr, wh); w.stroke();
    }
    this.lastCols = cols;
  }

  levelAt(xCss) {
    if (!this.lastCols) return null;
    const i = Math.round(xCss * this.dpr);
    return this.lastCols[Math.max(0, Math.min(this.lastCols.length - 1, i))];
  }

  // ------------------------------------------------------------ interaction
  bindPointer(el) {
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || !this.data) return;
      el.setPointerCapture(e.pointerId);
      down = { x: e.clientX, dragging: false, last: e.clientX };
    });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (down) {
        if (!down.dragging && Math.abs(e.clientX - down.x) > 4) down.dragging = true;
        if (down.dragging) {
          const v = this.view();
          const hz = ((e.clientX - down.last) / r.width) * v.span;
          down.last = e.clientX;
          this.onDrag(hz, this.zoom > 1);
        }
      }
      this.hoverX = x;
      this.dirty = true;
      if (this.data) this.onHover(this.xToHz(x), this.levelAt(x));
    });
    el.addEventListener('pointerup', (e) => {
      if (down && !down.dragging) {
        const r = el.getBoundingClientRect();
        this.onTune(this.xToHz(e.clientX - r.left));
      }
      down = null;
    });
    el.addEventListener('pointercancel', () => { down = null; });
    el.addEventListener('pointerleave', () => { this.hoverX = null; this.dirty = true; this.onHover(null); });
    el.addEventListener('wheel', (e) => {
      if (!this.enabled || !this.data) return;
      e.preventDefault();
      if (e.shiftKey) this.onZoom(e.deltaY < 0 ? 1 : -1);
      else this.onStep(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }
}

export { formatHz };
