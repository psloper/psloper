// The two flat displays: a plan position indicator and a vertical section.
//
// The PPI is what a controller would actually be looking at, so it is the
// quickest way to see what the farm does to the picture: turbine plots sitting
// in the middle of the airspace, a desensitised region around them, and any
// blanked sector drawn as the hole it really is.
//
// The section view is the quickest way to see WHY, because masking, beam
// elevation and earth curvature are all vertical effects that a plan view
// cannot show.

import { DEG, RAD, clamp, offsetByBearing, angleDelta, curvatureDrop } from './geo.js';
import { elevationGainDb, dbToLin } from './rf.js';

const CSS = {
  ink: '#cdd8e1', dim: '#8595a3', mute: '#5d6b78',
  rule: '#222c35', ruleStrong: '#33414d',
  rf: '#45b8d8', ok: '#3fd18b', warn: '#f0a83a', bad: '#e8524a', info: '#8d7fe8',
  surface: '#0e1317', bg: '#080b0e',
};
const MONO = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const MONO_SM = '9.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function fitCanvas(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(canvas.clientWidth, 10);
  const h = Math.max(canvas.clientHeight, 10);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// ================================================================ PPI display

export class PpiDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.result = null;
    this.sweepDeg = 0;
    this.rangeScaleM = null;
  }

  setResult(result) {
    this.result = result;
    const r = result;
    const maxTurbine = r.turbineResults.reduce((a, t) => Math.max(a, t.hub.ground), 0);
    const maxTrack = r.points.reduce((a, p) => Math.max(a, p.geom.ground), 0);
    this.rangeScaleM = Math.max(maxTurbine, maxTrack, 5000) * 1.15;
  }

  draw(timeS) {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CSS.bg;
    ctx.fillRect(0, 0, w, h);

    const r = this.result;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 16;
    if (!r || R < 30) return;

    const scale = R / this.rangeScaleM;
    const toXY = (rangeM, bearingDeg) => {
      const a = (bearingDeg - 90) * DEG;
      const d = rangeM * scale;
      return [cx + d * Math.cos(a), cy + d * Math.sin(a)];
    };

    // --- range rings and bearing ticks
    const ringStepM = niceStep(this.rangeScaleM / 4);
    ctx.strokeStyle = CSS.rule;
    ctx.lineWidth = 1;
    ctx.font = MONO_SM;
    ctx.fillStyle = CSS.mute;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let rng = ringStepM; rng <= this.rangeScaleM + 1; rng += ringStepM) {
      ctx.beginPath();
      ctx.arc(cx, cy, rng * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${(rng / 1000).toFixed(0)}`, cx + 3, cy - rng * scale);
    }
    ctx.strokeStyle = CSS.rule;
    for (let b = 0; b < 360; b += 10) {
      const major = b % 30 === 0;
      const [x1, y1] = toXY(this.rangeScaleM * (major ? 0.955 : 0.978), b);
      const [x2, y2] = toXY(this.rangeScaleM, b);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (major) {
        const [tx, ty] = toXY(this.rangeScaleM * 0.90, b);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = CSS.mute;
        ctx.fillText(String(b).padStart(3, '0'), tx, ty);
        ctx.restore();
      }
    }

    // --- blanked sector, drawn as the coverage hole it is
    if (r.blankZone) {
      drawSector(ctx, cx, cy, scale, r.blankZone, 'rgba(141,127,232,0.16)', CSS.info, true);
    }
    if (r.naizZone && !r.blankZone) {
      drawSector(ctx, cx, cy, scale, r.naizZone, 'rgba(201,162,39,0.08)', '#c9a227', false);
    }

    // --- desensitised region: where turbine clutter costs detection margin
    for (const t of r.turbineResults) {
      if (t.visibility === 'masked' || !t.plotted) continue;
      const azHalf = Math.max(r.radar.azBeamwidthDeg, 0.4);
      const skirt = clamp(
        r.radar.rangeResolutionM * Math.pow(10, (t.snrEffDb - r.radar.requiredSnrDb + r.radar.rangeSidelobeDb) / 20),
        r.radar.rangeResolutionM, this.rangeScaleM * 0.4);
      drawSector(ctx, cx, cy, scale, {
        centreDeg: t.hub.bearing, halfWidthDeg: azHalf,
        rangeMinM: Math.max(t.hub.slant - skirt * 0.25, 0),
        rangeMaxM: t.hub.slant + skirt,
      }, 'rgba(232,82,74,0.09)', null, false);
    }

    // --- turbine returns
    for (const t of r.turbineResults) {
      const [x, y] = toXY(t.hub.slant, t.hub.bearing);
      if (t.visibility === 'masked') {
        ctx.strokeStyle = 'rgba(93,107,120,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      const over = clamp((t.snrEffDb - r.radar.requiredSnrDb) / 30, 0, 1);
      const rad = 2.2 + over * 4.5;
      if (t.blanked) {
        // Above threshold, but the cell it lands in is discarded.
        ctx.strokeStyle = 'rgba(141,127,232,0.75)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      } else if (t.falsePlot) {
        ctx.fillStyle = `rgba(232,82,74,${0.35 + over * 0.5})`;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = CSS.bad; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, rad + 1.5, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(240,168,58,0.8)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // --- flight track: plots, dropouts and the tracker's view
    const pts = r.points;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      if (p.outOfRange) { started = false; continue; }
      const [x, y] = toXY(p.geom.slant, p.geom.bearing);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(205,216,225,0.28)';
    ctx.stroke();

    const stepP = Math.max(1, Math.floor(pts.length / 60));
    for (let i = 0; i < pts.length; i += stepP) {
      const p = pts[i];
      if (p.outOfRange) continue;
      const [x, y] = toXY(p.geom.slant, p.geom.bearing);
      if (p.blanked) {
        ctx.strokeStyle = CSS.info; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3);
        ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
      } else if (p.plot) {
        ctx.fillStyle = p.tracked ? CSS.ok : CSS.warn;
        ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
      } else {
        ctx.strokeStyle = CSS.bad; ctx.lineWidth = 1.1;
        ctx.strokeRect(x - 2.4, y - 2.4, 4.8, 4.8);
      }
    }

    // --- sweep
    if (timeS !== undefined && r.radar.scanPeriodS) {
      const az = ((timeS / r.radar.scanPeriodS) * 360) % 360;
      this.sweepDeg = az;
      const grad = ctx.createConicGradient
        ? null : null;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 18; k++) {
        const a = az - k * 1.6;
        const [x, y] = toXY(this.rangeScaleM, a);
        ctx.strokeStyle = `rgba(69,184,216,${0.16 * (1 - k / 18)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      }
      ctx.restore();
    }

    // --- radar site
    ctx.fillStyle = CSS.rf;
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    if (r.infill) {
      const [x, y] = toXY(
        Math.hypot(r.infill.east - r.radar.east, r.infill.north - r.radar.north),
        (Math.atan2(r.infill.east - r.radar.east, r.infill.north - r.radar.north) * RAD + 360) % 360);
      ctx.fillStyle = CSS.info;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }

    // --- corner annotation
    ctx.font = MONO_SM;
    ctx.fillStyle = CSS.mute;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`rings ${(ringStepM / 1000).toFixed(0)} km`, 6, 6);
    ctx.fillText(`${(this.rangeScaleM / 1000).toFixed(0)} km scale`, 6, 18);
    ctx.textAlign = 'right';
    const fp = r.summary.displayedPlotCount;
    ctx.fillStyle = fp ? CSS.bad : CSS.mute;
    ctx.fillText(`${fp} turbine plots/scan`
      + (r.summary.suppressedPlotCount ? ` (+${r.summary.suppressedPlotCount} blanked)` : ''), w - 6, 6);
    ctx.fillStyle = r.summary.untrackedCount ? CSS.warn : CSS.mute;
    ctx.fillText(`${r.summary.untrackedCount} samples untracked`, w - 6, 18);
  }
}

function drawSector(ctx, cx, cy, scale, zone, fill, stroke, hatch) {
  const a0 = (zone.centreDeg - zone.halfWidthDeg - 90) * DEG;
  const a1 = (zone.centreDeg + zone.halfWidthDeg - 90) * DEG;
  const r0 = zone.rangeMinM * scale;
  const r1 = zone.rangeMaxM * scale;
  ctx.beginPath();
  ctx.arc(cx, cy, r1, a0, a1);
  ctx.arc(cx, cy, r0, a1, a0, true);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  if (hatch) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(141,127,232,0.35)';
    ctx.lineWidth = 0.8;
    for (let d = -r1 * 2; d < r1 * 2; d += 7) {
      ctx.beginPath();
      ctx.moveTo(cx + d, cy - r1); ctx.lineTo(cx + d + r1 * 2, cy + r1);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function niceStep(x) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1))));
  const n = x / pow;
  const m = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return m * pow;
}

// ============================================================ section display

export class ProfileDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.result = null;
    this.bearingDeg = null;   // null = auto (bearing to farm centre)
  }

  setResult(result) {
    this.result = result;
    if (this.bearingDeg === null && result.turbines.length) {
      const c = result.turbines.reduce(
        (a, t) => ({ e: a.e + t.east / result.turbines.length, n: a.n + t.north / result.turbines.length }),
        { e: 0, n: 0 });
      this.autoBearing = (Math.atan2(c.e - result.radar.east, c.n - result.radar.north) * RAD + 360) % 360;
    }
  }

  get activeBearing() {
    return this.bearingDeg !== null ? this.bearingDeg : (this.autoBearing || 0);
  }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CSS.bg;
    ctx.fillRect(0, 0, w, h);

    const r = this.result;
    if (!r || w < 60 || h < 60) return;

    const pad = { l: 44, r: 12, t: 12, b: 26 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const brg = this.activeBearing;

    const maxRangeM = Math.max(
      r.turbineResults.reduce((a, t) => Math.max(a, t.hub.ground), 0) * 1.6,
      r.points.reduce((a, p) => Math.max(a, p.geom.ground), 0),
      8000);

    // Vertical span: terrain plus the airspace of interest.
    const samples = 240;
    const ground = [];
    let gMin = Infinity, gMax = -Infinity;
    for (let i = 0; i <= samples; i++) {
      const d = maxRangeM * (i / samples);
      const o = offsetByBearing(d, brg);
      const east = r.radar.east + o.east;
      const north = r.radar.north + o.north;
      const hReal = r.terrain.heightAt(east, north);
      const hEff = hReal - curvatureDrop(d, r.ae);
      ground.push({ d, hReal, hEff });
      gMin = Math.min(gMin, hEff);
      gMax = Math.max(gMax, hEff);
    }
    const topM = Math.max(
      gMax + 400,
      r.radar.amslM + maxRangeM * Math.tan(Math.min(r.radar.cscMaxDeg, 12) * DEG) * 0.35,
      r.points.reduce((a, p) => Math.max(a, p.amsl - curvatureDrop(p.geom.ground, r.ae)), 0) * 1.15,
      r.turbineResults.reduce((a, t) => Math.max(a, t.turbine.tipAmslM), 0) * 1.6);
    const botM = Math.min(gMin - 60, r.radar.amslM - 120);

    const X = (d) => pad.l + (d / maxRangeM) * plotW;
    const Y = (m) => pad.t + plotH - ((m - botM) / (topM - botM)) * plotH;

    // --- grid
    ctx.strokeStyle = CSS.rule;
    ctx.lineWidth = 1;
    ctx.font = MONO_SM;
    ctx.fillStyle = CSS.mute;
    const vStep = niceStep((topM - botM) / 5);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let m = Math.ceil(botM / vStep) * vStep; m <= topM; m += vStep) {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(m)); ctx.lineTo(w - pad.r, Y(m)); ctx.stroke();
      ctx.fillText(`${m.toFixed(0)}`, pad.l - 5, Y(m));
    }
    ctx.save();
    ctx.translate(11, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('m AMSL (curvature applied)', 0, 0);
    ctx.restore();

    const hStep = niceStep(maxRangeM / 6);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let d = 0; d <= maxRangeM; d += hStep) {
      ctx.strokeStyle = CSS.rule;
      ctx.beginPath(); ctx.moveTo(X(d), pad.t); ctx.lineTo(X(d), pad.t + plotH); ctx.stroke();
      ctx.fillStyle = CSS.mute;
      ctx.fillText(`${(d / 1000).toFixed(0)}`, X(d), pad.t + plotH + 5);
    }
    ctx.fillText('km ground range', pad.l + plotW / 2, pad.t + plotH + 15);

    // --- beam envelope in elevation
    const peakRange = Math.pow(
      r.radar.peakPowerW * r.radar.g0Lin ** 2 * r.radar.lambdaM ** 2 * dbToLin(r.scenario.target.rcsDbsm)
      / (Math.pow(4 * Math.PI, 3) * r.radar.lossLin * r.radar.noiseW * dbToLin(r.radar.requiredSnrDb)),
      0.25);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(r.radar.amslM));
    for (let el = 0; el <= Math.min(r.radar.cscMaxDeg + 6, 45); el += 0.4) {
      const range = Math.min(
        peakRange * Math.pow(10, elevationGainDb(el, r.radar) / 20),
        r.radar.instrumentedRangeM, maxRangeM * 1.02);
      const d = range * Math.cos(el * DEG);
      const m = r.radar.amslM + range * Math.sin(el * DEG) - curvatureDrop(d, r.ae);
      ctx.lineTo(X(Math.min(d, maxRangeM)), Y(m));
    }
    ctx.lineTo(X(0), Y(r.radar.amslM));
    ctx.closePath();
    ctx.fillStyle = 'rgba(69,184,216,0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(69,184,216,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // --- terrain
    ctx.beginPath();
    ctx.moveTo(X(0), Y(botM));
    for (const g of ground) ctx.lineTo(X(g.d), Y(g.hEff));
    ctx.lineTo(X(maxRangeM), Y(botM));
    ctx.closePath();
    ctx.fillStyle = '#242e29';
    ctx.fill();
    ctx.strokeStyle = '#6b7a63';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ground.forEach((g, i) => (i ? ctx.lineTo(X(g.d), Y(g.hEff)) : ctx.moveTo(X(g.d), Y(g.hEff))));
    ctx.stroke();

    // --- turbines within a corridor of the section bearing
    const corridorDeg = 6;
    for (const t of r.turbineResults) {
      if (Math.abs(angleDelta(t.hub.bearing, brg)) > corridorDeg) continue;
      const d = t.hub.ground;
      if (d > maxRangeM) continue;
      const drop = curvatureDrop(d, r.ae);
      const base = t.turbine.groundM - drop;
      const hub = t.turbine.hubAmslM - drop;
      const tip = t.turbine.tipAmslM - drop;
      const colour = t.visibility === 'masked' ? CSS.mute : t.falsePlot ? CSS.bad : CSS.warn;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(X(d), Y(base)); ctx.lineTo(X(d), Y(hub)); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(X(d), Y(hub), Math.max(Math.abs(Y(tip) - Y(hub)), 2), 0, Math.PI * 2); ctx.stroke();

      // Line of sight from the radar to the tip.
      ctx.strokeStyle = t.visibility === 'masked' ? 'rgba(93,107,120,0.5)'
        : t.visibility === 'clear' ? 'rgba(63,209,139,0.45)' : 'rgba(240,168,58,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(0), Y(r.radar.amslM)); ctx.lineTo(X(d), Y(tip)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- radio horizon marker
    const horizD = r.radar.horizonM;
    if (horizD < maxRangeM) {
      ctx.strokeStyle = 'rgba(69,184,216,0.5)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(X(horizD), pad.t); ctx.lineTo(X(horizD), pad.t + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.fillStyle = 'rgba(69,184,216,0.8)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('surface horizon', X(horizD) + 3, pad.t + 2);
      ctx.restore();
    }

    // --- flight track
    if (r.points.length) {
      ctx.lineWidth = 1.8;
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1];
        const b = r.points[i];
        if (a.outOfRange || b.outOfRange) continue;
        ctx.strokeStyle = b.blanked ? CSS.info
          : !b.tracked ? CSS.bad
            : b.status === 'marginal' ? CSS.warn : CSS.ok;
        ctx.beginPath();
        ctx.moveTo(X(Math.min(a.geom.ground, maxRangeM)), Y(a.amsl - curvatureDrop(a.geom.ground, r.ae)));
        ctx.lineTo(X(Math.min(b.geom.ground, maxRangeM)), Y(b.amsl - curvatureDrop(b.geom.ground, r.ae)));
        ctx.stroke();
      }
    }

    // --- radar mast
    ctx.strokeStyle = CSS.rf;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(r.radar.groundM));
    ctx.lineTo(X(0), Y(r.radar.amslM));
    ctx.stroke();
    ctx.fillStyle = CSS.rf;
    ctx.beginPath(); ctx.arc(X(0), Y(r.radar.amslM), 3, 0, Math.PI * 2); ctx.fill();

    ctx.font = MONO_SM;
    ctx.fillStyle = CSS.mute;
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(`section on ${brg.toFixed(0).padStart(3, '0')}°  ·  k = ${r.scenario.environment.kFactor.toFixed(2)}`, w - pad.r, 4);
  }
}

// ============================================================== wind rose

/**
 * The wind climate, and what the radar sees in each direction.
 *
 * Two things are encoded on one rose because they have to be read together:
 * the petal length is how often the wind blows from that direction, and its
 * fill is the severity of the interference when it does. A direction that is
 * bad but rare and one that is bad and common look different here, which is
 * the distinction an assessment turns on.
 */
export class WindRoseDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.rose = null;
    this.assessedDeg = null;
    this.metric = 'plots';
  }

  setRose(rose, assessedDeg) {
    this.rose = rose;
    this.assessedDeg = assessedDeg;
  }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CSS.bg;
    ctx.fillRect(0, 0, w, h);
    if (w < 60 || h < 60) return;

    const cx = w / 2;
    const cy = h / 2 + 4;
    const R = Math.min(w, h) / 2 - 26;

    if (!this.rose) {
      ctx.fillStyle = CSS.mute;
      ctx.font = MONO_SM;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Run the wind rose sweep on the Wind tab', cx, cy - 6);
      ctx.fillText('to see every direction, not just this one', cx, cy + 8);
      return;
    }

    const sectors = this.rose.sectors;
    const maxFreq = Math.max(...sectors.map((s) => s.frequency), 1e-6);
    const maxPlots = Math.max(...sectors.map((s) => s.plots), 1);
    const half = (360 / sectors.length) / 2;

    // Frequency rings
    ctx.strokeStyle = CSS.rule;
    ctx.lineWidth = 1;
    ctx.font = MONO_SM;
    ctx.fillStyle = CSS.mute;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const frac of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * frac, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${(maxFreq * frac * 100).toFixed(0)}%`, cx + 3, cy - R * frac);
    }

    // Petals
    for (const s of sectors) {
      const a0 = (s.directionDeg - half - 90) * DEG;
      const a1 = (s.directionDeg + half - 90) * DEG;
      const r = R * (s.frequency / maxFreq);
      const sev = s.plots / maxPlots;
      // Sequential severity fill: one hue, brighter means worse.
      const alpha = 0.25 + 0.6 * sev;
      ctx.fillStyle = s.plots > 0
        ? `rgba(232,82,74,${alpha.toFixed(3)})`
        : 'rgba(63,209,139,0.35)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = s.plots > 0 ? CSS.bad : CSS.ok;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // The direction currently being assessed
    if (Number.isFinite(this.assessedDeg)) {
      const a = (this.assessedDeg - 90) * DEG;
      ctx.strokeStyle = CSS.ink;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * 1.06 * Math.cos(a), cy + R * 1.06 * Math.sin(a));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Cardinals
    ctx.fillStyle = CSS.dim;
    ctx.font = MONO_SM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [deg, label] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
      const a = (deg - 90) * DEG;
      ctx.fillText(label, cx + (R + 13) * Math.cos(a), cy + (R + 13) * Math.sin(a));
    }

    // Read-out
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = CSS.mute;
    ctx.fillText(`plots ${(this.rose.exposureWithPlots * 100).toFixed(0)}% of year`, 6, 6);
    ctx.fillStyle = this.rose.exposureUntracked > 0.01 ? CSS.warn : CSS.mute;
    ctx.fillText(`track degraded ${(this.rose.exposureUntracked * 100).toFixed(0)}%`, 6, 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = CSS.mute;
    ctx.fillText(`petal = how often`, w - 6, 6);
    ctx.fillText(`fill = severity`, w - 6, 18);
  }
}
