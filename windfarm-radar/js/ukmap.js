// The national map: coastline, wind farms, radars, and where the two meet.
//
// Drawn to a 2D canvas from an outline stored in the repository. There is no
// tile server and no base map, because this tool makes no network request; the
// coastline is Natural Earth 1:10m, simplified, and is for drawing only. Do
// not measure anything off it.

import { STATUS_GROUPS, distanceM } from './national.js';

/**
 * How far each farm's visibility spreads in the heat layer, in kilometres on
 * the ground. Fixed in GROUND distance so the colour means the same thing at
 * every zoom; it is stated on the map next to the scale bar.
 */
export const HEAT_RADIUS_KM = 12;

/** Colours, kept here so the legend and the canvas cannot disagree. */
export const MAP_COLORS = {
  sea: '#0b1620',
  land: '#1b2630',
  coast: '#3c5567',
  farmActive: '#6fd3a2',
  farmPipeline: '#e8c23f',
  farmDead: '#5a6b77',
  farmHidden: '#416f83',
  radar: '#ff6b52',
  radarQuiet: '#8fa3b0',
  // Imported air defence sites are drawn apart from civil radar, so one is
  // never read as the other on a map that mixes both.
  radarMil: '#b98cff',
  sight: 'rgba(111, 211, 162, 0.16)',
  selected: '#ffffff',
};

/**
 * An equirectangular projection fitted to the rings it is given.
 *
 * Longitude is scaled by the cosine of the middle latitude so the country is
 * not stretched sideways. That is enough for a national overview and is wrong
 * for measurement, which is why nothing measures with it: distances come from
 * distanceM in national.js, which works on the real ellipsoid-ish numbers.
 */
export function createProjection(rings, width, height, pad = 16) {
  let lat0 = 90, lat1 = -90, lon0 = 180, lon1 = -180;
  for (const r of rings) {
    for (const p of r) {
      if (p[0] < lon0) lon0 = p[0];
      if (p[0] > lon1) lon1 = p[0];
      if (p[1] < lat0) lat0 = p[1];
      if (p[1] > lat1) lat1 = p[1];
    }
  }
  const midLat = (lat0 + lat1) / 2;
  const kx = Math.cos(midLat * Math.PI / 180);
  const spanX = (lon1 - lon0) * kx;
  const spanY = lat1 - lat0;
  const base = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);

  const view = { zoom: 1, panX: 0, panY: 0 };
  const cx = width / 2, cy = height / 2;
  const mx = (lon0 + lon1) / 2, my = (lat0 + lat1) / 2;

  const project = (lat, lon) => {
    const s = base * view.zoom;
    return {
      x: cx + ((lon - mx) * kx) * s + view.panX,
      y: cy - (lat - my) * s + view.panY,
    };
  };
  const unproject = (x, y) => {
    const s = base * view.zoom;
    return {
      lon: mx + (x - cx - view.panX) / (s * kx),
      lat: my - (y - cy - view.panY) / s,
    };
  };
  return {
    project,
    unproject,
    view,
    bounds: { lat0, lat1, lon0, lon1 },
    /** Pixels per metre at the current zoom, for drawing range rings. */
    pxPerMetre() { return (base * view.zoom) / 111132.92; },
    reset() { view.zoom = 1; view.panX = 0; view.panY = 0; },
  };
}

/** Which status group a farm falls in, or null if the status is unknown. */
export function groupOf(status) {
  for (const [key, g] of Object.entries(STATUS_GROUPS)) {
    if (g.match.includes(status)) return key;
  }
  return null;
}

/**
 * The map.
 *
 * Owns a canvas, a projection and the layer switches. It does not own the
 * screening result: the caller computes that and hands it in, so the map can
 * be drawn before the screen has run and redrawn when it has.
 */
export class UkMap {
  constructor(canvas, { rings, farms, radars, onSelectRadar = null, onHover = null }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rings = rings;
    this.farms = farms;
    this.radars = radars;
    this.onSelectRadar = onSelectRadar;
    this.onHover = onHover;
    this.screen = null;
    this.selected = null;     // index into radars
    this.hover = null;        // { kind, index }
    this.layers = {
      active: true, pipeline: false, dead: false,
      radars: true, heat: true, sightlines: false, coverage: false,
    };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.resize();
    this._bind();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, Math.round(rect.width));
    this.h = Math.max(240, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.proj = createProjection(this.rings, this.w, this.h);
    this.heat = null;
    this.draw();
  }

  setScreen(screen) { this.screen = screen; this.heat = null; this.draw(); }
  setLayer(key, on) { this.layers[key] = on; if (key === 'heat') this.heat = null; this.draw(); }

  /** Farms the current layer switches say to draw. */
  visibleFarms() {
    const out = [];
    for (let i = 0; i < this.farms.length; i++) {
      const g = groupOf(this.farms[i].status);
      if (g && this.layers[g]) out.push(i);
    }
    return out;
  }

  _bind() {
    let dragging = false, lastX = 0, lastY = 0, moved = 0;
    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true; moved = 0;
      const p = pos(e); lastX = p.x; lastY = p.y;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (dragging) {
        const dx = p.x - lastX, dy = p.y - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        this.proj.view.panX += dx; this.proj.view.panY += dy;
        lastX = p.x; lastY = p.y;
        this.heat = null;
        this.draw();
        return;
      }
      const hit = this.hitTest(p.x, p.y);
      const changed = JSON.stringify(hit) !== JSON.stringify(this.hover);
      this.hover = hit;
      this.canvas.style.cursor = hit ? 'pointer' : 'grab';
      if (changed) { this.draw(); if (this.onHover) this.onHover(hit); }
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      // A drag is not a click. Without this every pan selected a radar.
      if (moved > 4) return;
      const p = pos(e);
      const hit = this.hitTest(p.x, p.y);
      if (hit && hit.kind === 'radar') {
        // Report the radar that was clicked and whether it was already the
        // selected one, and let the caller decide what a repeat click means.
        // Toggling the selection to null here and passing that on made the
        // second click indistinguishable from clicking empty sea, so the
        // "click again to load it" path could never fire.
        const repeat = this.selected === hit.index;
        this.selected = hit.index;
        this.draw();
        if (this.onSelectRadar) this.onSelectRadar(hit.index, repeat);
      } else if (hit === null) {
        this.selected = null;
        this.draw();
        if (this.onSelectRadar) this.onSelectRadar(null, false);
      }
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      const before = this.proj.unproject(p.x, p.y);
      const k = Math.exp(-e.deltaY * 0.0015);
      this.proj.view.zoom = Math.max(0.6, Math.min(40, this.proj.view.zoom * k));
      // Keep the point under the cursor fixed, which is what makes zooming
      // feel like a map rather than a slideshow.
      const after = this.proj.project(before.lat, before.lon);
      this.proj.view.panX += p.x - after.x;
      this.proj.view.panY += p.y - after.y;
      this.heat = null;
      this.draw();
    }, { passive: false });
  }

  /** Nearest radar or farm within a few pixels, radars first. */
  hitTest(x, y) {
    const R = 9;
    let best = null, bestD = R * R;
    if (this.layers.radars) {
      for (let i = 0; i < this.radars.length; i++) {
        const p = this.proj.project(this.radars[i].lat, this.radars[i].lon);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) { bestD = d; best = { kind: 'radar', index: i }; }
      }
    }
    if (best) return best;
    bestD = 36;
    for (const i of this.visibleFarms()) {
      const p = this.proj.project(this.farms[i].lat, this.farms[i].lon);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) { bestD = d; best = { kind: 'farm', index: i }; }
    }
    return best;
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.fillStyle = MAP_COLORS.sea;
    ctx.fillRect(0, 0, w, h);

    // Land.
    ctx.beginPath();
    for (const ring of this.rings) {
      const p0 = this.proj.project(ring[0][1], ring[0][0]);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < ring.length; i++) {
        const p = this.proj.project(ring[i][1], ring[i][0]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = MAP_COLORS.land;
    ctx.fill('evenodd');
    ctx.strokeStyle = MAP_COLORS.coast;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    if (this.layers.heat && this.screen) this._drawHeat();
    if (this.layers.coverage && this.screen) this._drawCoverage();
    if (this.layers.sightlines && this.screen) this._drawSightlines();
    this._drawFarms();
    if (this.layers.radars) this._drawRadars();
    this._drawScaleBar();
  }

  _drawHeat() {
    // Rebuilt lazily, because it is the expensive layer and pan and zoom
    // invalidate it.
    if (!this.heat) {
      const step = 3;                       // compute at a third of the
      const gw = Math.ceil(this.w / step);  // resolution and scale up: the
      const gh = Math.ceil(this.h / step);  // field is smooth, so it costs
      const field = new Float32Array(gw * gh);  // nothing visible.
      // The kernel is a fixed distance ON THE GROUND, not a fixed number of
      // pixels. It used to be 27 screen pixels, which meant a 42 km
      // neighbourhood at the default view and a 1.1 km one zoomed in: the same
      // colour meant a different thing depending on how far you had zoomed,
      // which is the one thing a heat map must never do. Clamped at the top so
      // a deep zoom cannot turn one farm into a screen-filling wash, and at
      // the bottom so it stays visible when zoomed out.
      const wantPx = HEAT_RADIUS_KM * 1000 * this.proj.pxPerMetre();
      // Zoomed in far enough that one farm's kernel covers a third of the
      // view, the field stops being a field: it is one blob, it hides the
      // coastline and the markers, and it tells you nothing you could not read
      // off the farm itself. Below that scale the layer switches itself off
      // and says why, rather than drawing something unreadable.
      this.heatTooClose = wantPx * 2 > Math.min(this.w, this.h) * 0.66;
      if (this.heatTooClose) { this.heat = { skip: true }; return this._heatNote(); }
      const radius = Math.max(4, Math.round(wantPx / step));
      this.heatRadiusKm = (radius * step) / (this.proj.pxPerMetre() * 1000);
      const r2 = radius * radius;
      let max = 0;
      for (const fb of this.screen.byFarm) {
        if (fb.seenBy <= 0) continue;
        const p = this.proj.project(fb.farm.lat, fb.farm.lon);
        const cx = Math.round(p.x / step), cy = Math.round(p.y / step);
        if (cx < -radius || cy < -radius || cx > gw + radius || cy > gh + radius) continue;
        for (let y = Math.max(0, cy - radius); y < Math.min(gh, cy + radius); y++) {
          for (let x = Math.max(0, cx - radius); x < Math.min(gw, cx + radius); x++) {
            const d2 = (x - cx) ** 2 + (y - cy) ** 2;
            if (d2 > r2) continue;
            const t = 1 - d2 / r2;
            const v = field[y * gw + x] += fb.seenBy * t * t;
            if (v > max) max = v;
          }
        }
      }
      const img = this.ctx.createImageData(gw, gh);
      for (let i = 0; i < field.length; i++) {
        const t = max > 0 ? Math.min(1, field[i] / max) : 0;
        if (t <= 0.01) continue;
        // Green through amber to red. Deliberately not a rainbow: the point
        // is "more radars can see this", which is one-directional.
        const r = Math.round(255 * Math.min(1, t * 1.6));
        const g = Math.round(210 * Math.min(1, (1 - t) * 1.5 + 0.25));
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = 70;
        img.data[i * 4 + 3] = Math.round(225 * Math.min(1, t * 1.6));
      }
      const off = document.createElement('canvas');
      off.width = gw; off.height = gh;
      off.getContext('2d').putImageData(img, 0, 0);
      this.heat = { canvas: off, max, step, radius };
    }
    if (this.heat.skip) return this._heatNote();
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.heat.canvas, 0, 0, this.w, this.h);
    ctx.restore();
  }

  /** Say why the heat layer is not drawn, rather than leaving it blank. */
  _heatNote() {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232, 194, 63, 0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(`Heat map hidden: zoomed in past its ${HEAT_RADIUS_KM} km resolution. `
      + 'Zoom out to read it.', this.w / 2, 22);
    ctx.restore();
  }

  _drawCoverage() {
    // The horizon circle of each radar: how far a 150 m tip could be seen over
    // a smooth earth. It is an upper bound, not a coverage claim.
    const ctx = this.ctx;
    const ppm = this.proj.pxPerMetre();
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 107, 82, 0.22)';
    ctx.lineWidth = 1;
    for (const r of this.radars) {
      const p = this.proj.project(r.lat, r.lon);
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.screen.reachM * ppm, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawSightlines() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = MAP_COLORS.sight;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (const pr of this.screen.pairings) {
      if (this.selected !== null && pr.ri !== this.selected) continue;
      const a = this.proj.project(this.radars[pr.ri].lat, this.radars[pr.ri].lon);
      const f = this.screen.byFarm[pr.fi].farm;
      const b = this.proj.project(f.lat, f.lon);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawFarms() {
    const ctx = this.ctx;
    const seen = this.screen
      ? new Map(this.screen.byFarm.map((b, i) => [b.farm, b.seenBy]))
      : null;
    for (const i of this.visibleFarms()) {
      const f = this.farms[i];
      const p = this.proj.project(f.lat, f.lon);
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      const g = groupOf(f.status);
      let colour = g === 'active' ? MAP_COLORS.farmActive
        : g === 'pipeline' ? MAP_COLORS.farmPipeline : MAP_COLORS.farmDead;
      // A farm no radar can see is drawn cooler, so the map distinguishes
      // "there is a turbine here" from "a radar can see it".
      if (seen && seen.get(f) === 0) colour = MAP_COLORS.farmHidden;
      // Scaled with zoom, clamped. At a fixed 2.2 px a farm was 3.4 km across
      // at the national view and 86 m across at full zoom, so zooming in to
      // look at something made it disappear.
      const r = (f.offshore ? 2.6 : 2.2) * this.markerScale();
      ctx.beginPath();
      ctx.fillStyle = colour;
      if (f.offshore) {
        ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
      } else {
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      if (this.hover && this.hover.kind === 'farm' && this.hover.index === i) {
        ctx.strokeStyle = MAP_COLORS.selected;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  _drawRadars() {
    const ctx = this.ctx;
    for (let i = 0; i < this.radars.length; i++) {
      const r = this.radars[i];
      const p = this.proj.project(r.lat, r.lon);
      const sees = this.screen ? this.screen.byRadar[i].visible : null;
      const quiet = sees === 0;
      const size = 5.5 * this.markerScale();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - size);
      ctx.lineTo(p.x + size, p.y + size * 0.8);
      ctx.lineTo(p.x - size, p.y + size * 0.8);
      ctx.closePath();
      ctx.fillStyle = r.role === 'air-defence' ? MAP_COLORS.radarMil
        : quiet ? MAP_COLORS.radarQuiet : MAP_COLORS.radar;
      ctx.fill();
      if (r.role === 'air-defence') {
        // A square notch under the triangle: colour alone is not enough on a
        // dark map, and this survives a greyscale print of the report.
        ctx.fillRect(p.x - size * 0.45, p.y + size * 0.8, size * 0.9, size * 0.5);
      }
      if (i === this.selected || (this.hover && this.hover.kind === 'radar' && this.hover.index === i)) {
        ctx.strokeStyle = MAP_COLORS.selected;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }
  }

  /**
   * How much to grow a marker at the current zoom.
   *
   * Not linear: markers should grow so they stay findable, but a wind farm
   * drawn to its true footprint would be a dot at any national zoom and the
   * map is not a site plan. The fourth root keeps them legible across the
   * whole range without pretending to be a scale drawing.
   */
  markerScale() {
    return Math.max(1, Math.min(3.2, Math.pow(this.proj.view.zoom, 0.25)));
  }

  /**
   * A scale bar, because without one a heat blob has no size and a distance on
   * screen means nothing. Picks a round number of kilometres that fits in
   * about a fifth of the width.
   */
  _drawScaleBar() {
    const ctx = this.ctx;
    const ppm = this.proj.pxPerMetre();
    if (!Number.isFinite(ppm) || ppm <= 0) return;
    const targetPx = this.w * 0.18;
    const rounds = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let km = rounds[rounds.length - 1];
    for (const r of rounds) { if (r * 1000 * ppm >= targetPx) { km = r; break; } }
    const px = km * 1000 * ppm;
    // Bottom centre. Bottom right put it underneath the readout panel, which
    // is an HTML overlay, so it was drawn every frame and never seen.
    const x = Math.max(18, this.w / 2 - px / 2), y = this.h - 16;
    const heatNote = this.layers.heat && this.heatRadiusKm && !this.heatTooClose
      ? `heat spreads each farm over ${this.heatRadiusKm.toFixed(0)} km` : null;
    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';

    // A plate behind the block. Both captions and the bar were being drawn
    // straight onto the map: at 500 km the heat note landed on top of the
    // '500 km' label and on a site marker, and all three were unreadable.
    const plateW = Math.max(px, heatNote ? ctx.measureText(heatNote).width : 0) + 26;
    const plateH = heatNote ? 50 : 32;
    const cx = x + px / 2;
    ctx.fillStyle = 'rgba(8, 11, 14, 0.72)';
    ctx.beginPath();
    ctx.roundRect(cx - plateW / 2, y - plateH + 8, plateW, plateH, 3);
    ctx.fill();

    ctx.strokeStyle = 'rgba(220, 232, 240, 0.9)';
    ctx.fillStyle = 'rgba(220, 232, 240, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5);
    ctx.stroke();
    ctx.fillText(`${km} km`, cx, y - 9);
    if (heatNote) {
      ctx.fillStyle = 'rgba(220, 232, 240, 0.62)';
      ctx.fillText(heatNote, cx, y - 28);
    }
    ctx.restore();
  }

  /** The nearest farm to a radar, used when a click loads a pairing. */
  nearestFarmTo(radarIndex, statuses = null) {
    const r = this.radars[radarIndex];
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.farms.length; i++) {
      const f = this.farms[i];
      if (statuses && !statuses.includes(f.status)) continue;
      const d = distanceM(r.lat, r.lon, f.lat, f.lon);
      if (d < bestD) { bestD = d; best = { index: i, farm: f, distanceM: d }; }
    }
    return best;
  }
}
