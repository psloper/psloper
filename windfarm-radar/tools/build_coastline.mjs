// Build the coastline the national map draws.
//
// The tool makes no network request at runtime, so the outline has to be in
// the repository. Source is Natural Earth 1:10m admin-0 countries, which is
// public domain (CC0) and is on GitHub, one of the few hosts reachable from
// the environment this was built in.
//
//   curl -sSL -o /tmp/ne.json \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
//   node tools/build_coastline.mjs /tmp/ne.json
//
// Five records are kept: the United Kingdom, Ireland, the Isle of Man, Jersey
// and Guernsey. The UK record is 57 polygons, which is what carries Shetland,
// Orkney, the Hebrides and the rest of the outlying islands; dropping small
// rings to save bytes would drop those, so the area threshold is set low and
// the saving is taken from simplification instead.
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2] || '/tmp/ne.json';
const out = 'data/uk-coastline.json';

// Perpendicular distance of p from the line a-b, in degrees. Longitude is
// scaled by cos(lat) so the tolerance means roughly the same distance
// everywhere rather than shrinking towards the pole.
function segDist(p, a, b, kx) {
  const px = (p[0] - a[0]) * kx, py = p[1] - a[1];
  const bx = (b[0] - a[0]) * kx, by = b[1] - a[1];
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  let t = (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - bx * t, py - by * t);
}

// Douglas-Peucker, iterative so a long ring cannot blow the stack.
function simplify(ring, tol, kx) {
  if (ring.length < 3) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1; keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let far = -1, best = tol;
    for (let i = lo + 1; i < hi; i++) {
      const d = segDist(ring[i], ring[lo], ring[hi], kx);
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([lo, far], [far, hi]); }
  }
  return ring.filter((_, i) => keep[i]);
}

// Shoelace area in square degrees, used only to drop rings too small to draw.
function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(a / 2);
}

const WANT = ['United Kingdom', 'Ireland', 'Isle of Man', 'Jersey', 'Guernsey'];
const TOL = 0.004;        // degrees, about 440 m of latitude
const MIN_AREA = 2e-5;    // square degrees, about 0.25 km2: keeps real islets

const geo = JSON.parse(readFileSync(src, 'utf8'));
const shapes = [];
const stats = [];
for (const f of geo.features) {
  const name = f.properties.NAME || f.properties.name;
  if (!WANT.includes(name)) continue;
  const polys = f.geometry.type === 'Polygon'
    ? [f.geometry.coordinates] : f.geometry.coordinates;
  let before = 0, after = 0, dropped = 0;
  for (const poly of polys) {
    // Ring 0 is the outer boundary; later rings are holes, which at this
    // scale are lakes and are not drawn.
    const ring = poly[0];
    before += ring.length;
    if (area(ring) < MIN_AREA) { dropped++; continue; }
    const mid = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const kx = Math.cos(mid * Math.PI / 180);
    const s = simplify(ring, TOL, kx);
    if (s.length < 4) { dropped++; continue; }
    after += s.length;
    // 4 decimal places is about 11 m of latitude, far finer than the
    // simplification tolerance, so it costs nothing in accuracy.
    shapes.push(s.map((p) => [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))]));
  }
  stats.push({ name, polys: polys.length, before, after, dropped });
}

const doc = {
  source: 'Natural Earth 1:10m Admin 0 Countries',
  licence: 'Public domain (CC0). Made with Natural Earth.',
  url: 'https://www.naturalearthdata.com/',
  built: new Date().toISOString().slice(0, 10),
  includes: WANT,
  simplifiedToleranceDeg: TOL,
  minRingAreaSqDeg: MIN_AREA,
  note: 'Outer rings only. Coastline for drawing, not for measurement: it is '
    + 'simplified and must not be used to decide whether a point is on land.',
  rings: shapes,
};
writeFileSync(out, JSON.stringify(doc));
const n = shapes.reduce((s, r) => s + r.length, 0);
console.table(stats);
console.log(`${shapes.length} rings, ${n} points, ${(readFileSync(out).length / 1024).toFixed(0)} KB`);
