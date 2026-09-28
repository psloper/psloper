// Heat map rendering for parameter sweeps, and image export.
//
// The colour treatment follows the metric's job, not taste. A signed quantity
// measured against a threshold (detection margin, where zero is the boundary
// between detected and not) is DIVERGING: two hues either side of a neutral
// midpoint pinned to zero. An unsigned magnitude (plot count, Doppler, decibels
// of loss) is SEQUENTIAL: one hue, monotonic in lightness. Never a rainbow, and
// never a hue at the diverging midpoint.
//
// The same routine draws the on-screen canvas and the exported image, so what
// you send someone is what you were looking at.

import { SWEEP_PARAMS } from './sweep.js';

const INK = '#cdd8e1';
const INK_DIM = '#8595a3';
const INK_MUTE = '#5d6b78';
const RULE = '#222c35';
const SURFACE = '#0e1317';
const BG = '#080b0e';

// Sequential: one hue, monotonic lightness, dark to bright on a dark ground.
const SEQUENTIAL = ['#111820', '#33202a', '#5c2c2c', '#8a3a2c', '#b94a2d', '#e46a3c', '#f9a26b'];

// Diverging: two hues with a NEUTRAL midpoint. Both poles bright so magnitude
// reads through lightness while hue carries the sign.
const DIVERGING = ['#e8524a', '#b04438', '#6d3a35', '#39424a', '#356e56', '#37a274', '#4fdc97'];

function lerpHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const p = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${p[0]},${p[1]},${p[2]})`;
}

function rampColor(stops, t) {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  return lerpHex(stops[i], stops[i + 1], x - i);
}

/**
 * Normalise a value to 0..1 for the ramp.
 * Diverging metrics are scaled symmetrically about the pivot so the neutral
 * midpoint lands exactly on it, whatever the data range happens to be.
 */
export function normaliseValue(v, sweep) {
  const m = sweep.metric;
  if (m.kind === 'diverging') {
    const pivot = m.pivot ?? 0;
    const reach = Math.max(Math.abs(sweep.max - pivot), Math.abs(sweep.min - pivot), 1e-6);
    return 0.5 + (v - pivot) / (2 * reach);
  }
  const span = Math.max(sweep.max - sweep.min, 1e-9);
  const t = (v - sweep.min) / span;
  // "worse is low" metrics are drawn with the bad end bright, like the others.
  return m.worse === 'low' ? 1 - t : t;
}

export function sweepColor(v, sweep) {
  if (!Number.isFinite(v)) return '#1a2027';
  const t = normaliseValue(v, sweep);
  return rampColor(sweep.metric.kind === 'diverging' ? DIVERGING : SEQUENTIAL, t);
}

function niceTicks(values, maxTicks) {
  const stride = Math.max(1, Math.ceil(values.length / maxTicks));
  const out = [];
  for (let i = 0; i < values.length; i += stride) out.push(i);
  if (out[out.length - 1] !== values.length - 1) out.push(values.length - 1);
  return out;
}

const fmtAxis = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1));

/**
 * Draw a sweep into a 2D context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} sweep  result from runSweep
 * @param {object} opts {width, height, hover:{i,j}|null, title, subtitle}
 */
export function drawSweep(ctx, sweep, opts = {}) {
  // Mark the canvas as carrying a real sweep, so the export knows whether
  // there is anything on it worth putting in a report. It is reached through
  // the context, because that is what this is handed.
  if (ctx && ctx.canvas && ctx.canvas.dataset) ctx.canvas.dataset.drawn = '1';
  const w = opts.width;
  const h = opts.height;
  const px = SWEEP_PARAMS[sweep.xParam];
  const py = SWEEP_PARAMS[sweep.yParam];
  const scale = opts.scale || 1;
  const F = (n) => `${n * scale}px`;

  ctx.fillStyle = opts.transparent ? 'rgba(0,0,0,0)' : BG;
  ctx.fillRect(0, 0, w, h);

  const pad = {
    l: 62 * scale,
    r: 78 * scale,
    t: (opts.title ? 44 : 16) * scale,
    b: 46 * scale,
  };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  if (plotW < 40 || plotH < 40) return;

  const n = sweep.steps;
  const cw = plotW / n;
  const ch = plotH / n;

  // --- title
  if (opts.title) {
    ctx.fillStyle = INK;
    ctx.font = `600 ${F(13)} system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.title, pad.l, 10 * scale);
    if (opts.subtitle) {
      ctx.fillStyle = INK_MUTE;
      ctx.font = `${F(10.5)} ui-monospace, Menlo, monospace`;
      ctx.fillText(opts.subtitle, pad.l, 27 * scale);
    }
  }

  // --- cells. A 1px surface gap between cells keeps adjacent fills legible
  //     instead of merging into one block of colour.
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = sweep.values[j * n + i];
      const x = pad.l + i * cw;
      // y ascends up the plot, so row 0 sits at the bottom.
      const y = pad.t + plotH - (j + 1) * ch;
      ctx.fillStyle = sweepColor(v, sweep);
      ctx.fillRect(x, y, Math.max(cw - scale, 1), Math.max(ch - scale, 1));
    }
  }

  // --- where the current scenario sits
  if (sweep.marker) {
    const ix = nearestIndex(sweep.xs, sweep.marker.x);
    const iy = nearestIndex(sweep.ys, sweep.marker.y);
    if (ix >= 0 && iy >= 0) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeRect(pad.l + ix * cw, pad.t + plotH - (iy + 1) * ch, cw - scale, ch - scale);
      ctx.fillStyle = INK;
      ctx.font = `${F(9)} ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('current', pad.l + ix * cw + cw / 2,
        pad.t + plotH - (iy + 1) * ch - 3 * scale);
    }
  }

  // --- hovered cell gets a ring, and its value is drawn directly
  if (opts.hover && opts.hover.i >= 0) {
    const { i, j } = opts.hover;
    const x = pad.l + i * cw;
    const y = pad.t + plotH - (j + 1) * ch;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(x - scale, y - scale, cw + scale, ch + scale);
  }

  // --- frame and axes
  ctx.strokeStyle = RULE;
  ctx.lineWidth = scale;
  ctx.strokeRect(pad.l, pad.t, plotW, plotH);

  ctx.font = `${F(10)} ui-monospace, Menlo, monospace`;
  ctx.fillStyle = INK_MUTE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const i of niceTicks(sweep.xs, Math.max(4, Math.floor(plotW / (54 * scale))))) {
    ctx.fillText(fmtAxis(sweep.xs[i]), pad.l + i * cw + cw / 2, pad.t + plotH + 5 * scale);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const j of niceTicks(sweep.ys, Math.max(4, Math.floor(plotH / (22 * scale))))) {
    ctx.fillText(fmtAxis(sweep.ys[j]), pad.l - 6 * scale, pad.t + plotH - (j + 0.5) * ch);
  }

  ctx.fillStyle = INK_DIM;
  ctx.font = `${F(11)} system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${px.label}${px.unit ? ` (${px.unit})` : ''}`, pad.l + plotW / 2, h - 6 * scale);
  ctx.save();
  ctx.translate(12 * scale, pad.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'top';
  ctx.fillText(`${py.label}${py.unit ? ` (${py.unit})` : ''}`, 0, 0);
  ctx.restore();

  // --- legend: a continuous bar, labelled at both ends and at the pivot for a
  //     diverging scale, so the neutral point is never guesswork.
  const lx = w - pad.r + 16 * scale;
  const lw = 13 * scale;
  const lh = plotH;
  const steps = 64;
  for (let k = 0; k < steps; k++) {
    const t = k / (steps - 1);
    const v = sweep.metric.kind === 'diverging'
      ? invertDiverging(t, sweep)
      : sweep.min + (sweep.max - sweep.min) * (sweep.metric.worse === 'low' ? 1 - t : t);
    ctx.fillStyle = rampColor(sweep.metric.kind === 'diverging' ? DIVERGING : SEQUENTIAL, t);
    ctx.fillRect(lx, pad.t + lh - (k + 1) * (lh / steps), lw, lh / steps + 1);
  }
  ctx.strokeStyle = RULE;
  ctx.lineWidth = scale;
  ctx.strokeRect(lx, pad.t, lw, lh);

  ctx.fillStyle = INK_MUTE;
  ctx.font = `${F(9.5)} ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'left';
  const labelAt = (t, text) => {
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + lw + 4 * scale, pad.t + lh - t * lh);
  };
  if (sweep.metric.kind === 'diverging') {
    labelAt(1, sweep.metric.format(invertDiverging(1, sweep)));
    labelAt(0.5, sweep.metric.format(sweep.metric.pivot ?? 0));
    labelAt(0, sweep.metric.format(invertDiverging(0, sweep)));
    // Mark the pivot on the bar itself.
    ctx.strokeStyle = INK;
    ctx.lineWidth = scale;
    ctx.beginPath();
    ctx.moveTo(lx, pad.t + lh * 0.5);
    ctx.lineTo(lx + lw, pad.t + lh * 0.5);
    ctx.stroke();
  } else {
    const hi = sweep.metric.worse === 'low' ? sweep.min : sweep.max;
    const lo = sweep.metric.worse === 'low' ? sweep.max : sweep.min;
    labelAt(1, sweep.metric.format(hi));
    labelAt(0, sweep.metric.format(lo));
  }
  ctx.save();
  ctx.fillStyle = INK_DIM;
  ctx.font = `${F(10)} system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.translate(w - 8 * scale, pad.t + lh / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textBaseline = 'top';
  ctx.fillText(`${sweep.metric.label}${sweep.metric.unit ? ` (${sweep.metric.unit})` : ''}`, 0, 0);
  ctx.restore();

  return { pad, plotW, plotH, cw, ch, n };
}

function invertDiverging(t, sweep) {
  const pivot = sweep.metric.pivot ?? 0;
  const reach = Math.max(Math.abs(sweep.max - pivot), Math.abs(sweep.min - pivot), 1e-6);
  return pivot + (t - 0.5) * 2 * reach;
}

function nearestIndex(arr, v) {
  if (!Number.isFinite(v)) return -1;
  let best = -1;
  let bd = Infinity;
  arr.forEach((x, i) => {
    const d = Math.abs(x - v);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** Which cell a pointer is over, or null. */
export function cellAt(layout, x, y) {
  if (!layout) return null;
  const { pad, plotW, plotH, cw, ch, n } = layout;
  if (x < pad.l || y < pad.t || x > pad.l + plotW || y > pad.t + plotH) return null;
  const i = Math.min(Math.floor((x - pad.l) / cw), n - 1);
  const j = Math.min(Math.floor((pad.t + plotH - y) / ch), n - 1);
  return { i, j };
}

// ------------------------------------------------------------------- export

/**
 * Render a sweep to a PNG data URL at export resolution.
 * Drawn at a higher scale rather than upscaled, so text stays sharp.
 */
export function sweepToPng(sweep, { width = 1400, height = 1000, title, subtitle } = {}) {
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = width * dpr;
  c.height = height * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  drawSweep(ctx, sweep, { width, height, title, subtitle, scale: 1 });
  return c.toDataURL('image/png');
}

/** The same map as standalone SVG, for dropping into a report. */
export function sweepToSvg(sweep, { width = 1100, height = 780, title, subtitle } = {}) {
  const px = SWEEP_PARAMS[sweep.xParam];
  const py = SWEEP_PARAMS[sweep.yParam];
  const pad = { l: 62, r: 78, t: title ? 44 : 16, b: 46 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const n = sweep.steps;
  const cw = plotW / n;
  const ch = plotH / n;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const cells = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = sweep.values[j * n + i];
      cells.push(`<rect x="${(pad.l + i * cw).toFixed(2)}" y="${(pad.t + plotH - (j + 1) * ch).toFixed(2)}" `
        + `width="${(cw - 1).toFixed(2)}" height="${(ch - 1).toFixed(2)}" fill="${sweepColor(v, sweep)}">`
        + `<title>${esc(`${px.label} ${sweep.xs[i]}${px.unit}, ${py.label} ${sweep.ys[j]}${py.unit}: `
          + `${Number.isFinite(v) ? sweep.metric.format(v) : 'n/a'} ${sweep.metric.unit}`)}</title></rect>`);
    }
  }

  const xTicks = niceTicks(sweep.xs, Math.max(4, Math.floor(plotW / 54)))
    .map((i) => `<text x="${(pad.l + i * cw + cw / 2).toFixed(2)}" y="${pad.t + plotH + 15}" `
      + `text-anchor="middle" fill="${INK_MUTE}" font-size="10" font-family="ui-monospace,monospace">${fmtAxis(sweep.xs[i])}</text>`);
  const yTicks = niceTicks(sweep.ys, Math.max(4, Math.floor(plotH / 22)))
    .map((j) => `<text x="${pad.l - 6}" y="${(pad.t + plotH - (j + 0.5) * ch + 3.5).toFixed(2)}" `
      + `text-anchor="end" fill="${INK_MUTE}" font-size="10" font-family="ui-monospace,monospace">${fmtAxis(sweep.ys[j])}</text>`);

  const stops = (sweep.metric.kind === 'diverging' ? DIVERGING : SEQUENTIAL)
    .map((c, i, a) => `<stop offset="${((i / (a.length - 1)) * 100).toFixed(1)}%" stop-color="${c}"/>`).join('');

  const legendHi = sweep.metric.kind === 'diverging'
    ? sweep.metric.format(invertDiverging(1, sweep))
    : sweep.metric.format(sweep.metric.worse === 'low' ? sweep.min : sweep.max);
  const legendLo = sweep.metric.kind === 'diverging'
    ? sweep.metric.format(invertDiverging(0, sweep))
    : sweep.metric.format(sweep.metric.worse === 'low' ? sweep.max : sweep.min);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif">
<defs><linearGradient id="ramp" x1="0" y1="1" x2="0" y2="0">${stops}</linearGradient></defs>
<rect width="${width}" height="${height}" fill="${BG}"/>
${title ? `<text x="${pad.l}" y="22" fill="${INK}" font-size="13" font-weight="600">${esc(title)}</text>` : ''}
${subtitle ? `<text x="${pad.l}" y="38" fill="${INK_MUTE}" font-size="10.5" font-family="ui-monospace,monospace">${esc(subtitle)}</text>` : ''}
${cells.join('\n')}
<rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="none" stroke="${RULE}"/>
${xTicks.join('\n')}
${yTicks.join('\n')}
<text x="${pad.l + plotW / 2}" y="${height - 6}" text-anchor="middle" fill="${INK_DIM}" font-size="11">${esc(px.label)}${px.unit ? ` (${esc(px.unit)})` : ''}</text>
<text transform="translate(14 ${pad.t + plotH / 2}) rotate(-90)" text-anchor="middle" fill="${INK_DIM}" font-size="11">${esc(py.label)}${py.unit ? ` (${esc(py.unit)})` : ''}</text>
<rect x="${width - pad.r + 16}" y="${pad.t}" width="13" height="${plotH}" fill="url(#ramp)" stroke="${RULE}"/>
<text x="${width - pad.r + 33}" y="${pad.t + 4}" fill="${INK_MUTE}" font-size="9.5" font-family="ui-monospace,monospace">${esc(legendHi)}</text>
<text x="${width - pad.r + 33}" y="${pad.t + plotH}" fill="${INK_MUTE}" font-size="9.5" font-family="ui-monospace,monospace">${esc(legendLo)}</text>
${sweep.metric.kind === 'diverging' ? `<line x1="${width - pad.r + 16}" y1="${pad.t + plotH / 2}" x2="${width - pad.r + 29}" y2="${pad.t + plotH / 2}" stroke="${INK}"/><text x="${width - pad.r + 33}" y="${pad.t + plotH / 2 + 3.5}" fill="${INK_MUTE}" font-size="9.5" font-family="ui-monospace,monospace">${esc(sweep.metric.format(sweep.metric.pivot ?? 0))}</text>` : ''}
<text transform="translate(${width - 8} ${pad.t + plotH / 2}) rotate(90)" text-anchor="middle" fill="${INK_DIM}" font-size="10">${esc(sweep.metric.label)}${sweep.metric.unit ? ` (${esc(sweep.metric.unit)})` : ''}</text>
</svg>`;
}
