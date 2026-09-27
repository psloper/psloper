// Air-picture display for ADS-B and the channel IQ constellation.
import { rangeBearing } from '../decoders/adsb.js';

function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return dpr;
}

export class AirPicture {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.list = [];
    this.rx = null;
    this.range = 100;
    this.selected = null;
    this.onSelect = onSelect;
    this.hits = [];
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) * this.dpr, y = (e.clientY - r.top) * this.dpr;
      let best = null, bd = 18 * this.dpr;
      for (const h of this.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.icao; } }
      this.onSelect(best);
    });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(list, rx) { this.list = list; this.rx = rx; this.draw(); }

  /** Reference point: the receiver if known, else the centroid of positioned traffic. */
  centre() {
    if (this.rx) return { ...this.rx, known: true };
    const pos = this.list.filter((a) => a.lat != null);
    if (!pos.length) return null;
    return { lat: pos.reduce((s, a) => s + a.lat, 0) / pos.length, lon: pos.reduce((s, a) => s + a.lon, 0) / pos.length, known: false };
  }

  draw() {
    const dpr = (this.dpr = fitCanvas(this.canvas));
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 14 * dpr;
    this.hits = [];
    if (R < 20) return; // hidden tab or collapsed layout
    c.clearRect(0, 0, W, H);
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, '#0a1418'); g.addColorStop(1, '#05080a');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.font = `${10 * dpr}px ui-monospace, Menlo, Consolas, monospace`;
    c.textAlign = 'center'; c.textBaseline = 'middle';

    // range rings and bearing ticks
    for (let i = 1; i <= 4; i++) {
      const r = (R * i) / 4;
      c.strokeStyle = i === 4 ? 'rgba(98,201,255,0.28)' : 'rgba(98,201,255,0.12)';
      c.lineWidth = 1;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
      c.fillStyle = 'rgba(135,147,160,0.7)';
      c.fillText(`${(this.range * i) / 4}`, cx + r * 0.707 + 10 * dpr, cy - r * 0.707);
    }
    for (let b = 0; b < 360; b += 10) {
      const a = ((b - 90) * Math.PI) / 180, long = b % 30 === 0;
      c.strokeStyle = long ? 'rgba(98,201,255,0.35)' : 'rgba(98,201,255,0.15)';
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R - (long ? 8 : 4) * dpr), cy + Math.sin(a) * (R - (long ? 8 : 4) * dpr));
      c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      c.stroke();
    }
    c.fillStyle = 'rgba(214,220,227,0.8)';
    c.fillText('N', cx, cy - R - 7 * dpr);
    c.strokeStyle = 'rgba(98,201,255,0.25)';
    c.beginPath(); c.moveTo(cx - 5 * dpr, cy); c.lineTo(cx + 5 * dpr, cy); c.moveTo(cx, cy - 5 * dpr); c.lineTo(cx, cy + 5 * dpr); c.stroke();

    const ref = this.centre();
    this.hits = [];
    if (!ref) return;
    if (!ref.known) {
      c.fillStyle = 'rgba(255,181,71,0.8)'; c.textAlign = 'left';
      c.fillText('Receiver position unknown: centred on traffic', 8 * dpr, H - 10 * dpr);
    }
    const now = Date.now();
    const project = (p) => {
      const { range, bearing } = rangeBearing(ref, p);
      const a = ((bearing - 90) * Math.PI) / 180, r = (range / this.range) * R;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, range };
    };
    for (const ac of this.list) {
      if (ac.lat == null) continue;
      const p = project(ac);
      if (p.range > this.range * 1.05) continue;
      const stale = now - (ac.posTime || 0) > 15000;
      const sel = ac.icao === this.selected;
      const col = sel ? '255,181,71' : '98,201,255';
      const alpha = stale ? 0.35 : 1;
      // trail
      ac.trail.forEach((t, i) => {
        const q = project(t);
        c.fillStyle = `rgba(${col},${(0.08 + (0.4 * i) / ac.trail.length) * alpha})`;
        c.fillRect(q.x - 1 * dpr, q.y - 1 * dpr, 2 * dpr, 2 * dpr);
      });
      // one-minute speed vector
      if (ac.groundSpeed && ac.track != null) {
        const len = ((ac.groundSpeed / 60) / this.range) * R;
        const a = ((ac.track - 90) * Math.PI) / 180;
        c.strokeStyle = `rgba(${col},${0.7 * alpha})`; c.lineWidth = 1 * dpr;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len); c.stroke();
      }
      c.fillStyle = `rgba(${col},${alpha})`;
      const s = 3.5 * dpr;
      c.fillRect(p.x - s, p.y - s, s * 2, s * 2);
      if (sel) { c.strokeStyle = `rgba(${col},0.9)`; c.strokeRect(p.x - s * 2.2, p.y - s * 2.2, s * 4.4, s * 4.4); }
      // data block: callsign / level + trend / ground speed
      c.textAlign = 'left';
      const fl = ac.altitude != null ? String(Math.round(ac.altitude / 100)).padStart(3, '0') : '---';
      const trend = ac.verticalRate > 300 ? '↑' : ac.verticalRate < -300 ? '↓' : ' ';
      const lx = p.x + 9 * dpr, ly = p.y - 9 * dpr;
      c.fillStyle = `rgba(${sel ? '255,181,71' : '214,230,240'},${alpha})`;
      c.fillText(ac.callsign || ac.icao, lx, ly);
      c.fillStyle = `rgba(${col},${0.85 * alpha})`;
      c.fillText(`${fl}${trend} ${ac.groundSpeed ? Math.round(ac.groundSpeed / 10) : '--'}`, lx, ly + 12 * dpr);
      this.hits.push({ x: p.x, y: p.y, icao: ac.icao });
    }
  }
}

export class IqScope {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(iq) {
    const dpr = fitCanvas(this.canvas);
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    c.fillStyle = 'rgba(8,10,13,0.35)';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(98,201,255,0.14)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, W * 0.3, 0, Math.PI * 2); c.stroke();
    if (!iq) return;
    const n = iq.length / 2;
    let p = 0;
    for (let i = 0; i < iq.length; i++) p += iq[i] * iq[i];
    const rms = Math.sqrt(p / n) || 1;
    const k = (W * 0.3) / rms;
    c.fillStyle = 'rgba(143,245,196,0.75)';
    const s = 1.6 * dpr;
    for (let i = 0; i < n; i++) {
      c.fillRect(W / 2 + iq[2 * i] * k - s / 2, H / 2 - iq[2 * i + 1] * k - s / 2, s, s);
    }
  }
}
