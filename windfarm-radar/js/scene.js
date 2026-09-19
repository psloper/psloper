// The 3D view.
//
// A NOTE ON VERTICAL EXAGGERATION. At true scale a 185 m turbine inside a
// 40 km scene is a hairline, so the view offers a vertical multiplier. Every
// height in the scene goes through the same multiplier - terrain, curvature
// drop, turbine heights, ray heights, beam envelope - and scaling all heights
// by one constant is a linear map, so straight lines stay straight and every
// "does A block B" relationship in the picture stays exactly as the maths has
// it. Horizontal distances are never scaled. The badge in the corner says what
// multiplier is in force.

import * as THREE from 'three';
import { curvatureDrop, DEG, clamp, lerp, offsetByBearing, hypot2 } from './geo.js';
import { elevationGainDb, dbToLin } from './rf.js';

export const COLORS = {
  rf: 0x45b8d8,
  ok: 0x3fd18b,
  warn: 0xf0a83a,
  bad: 0xe8524a,
  info: 0x8d7fe8,
  masked: 0x5d6b78,
  tower: 0xd6dde3,
  ground: 0x6b7a63,
};

// --------------------------------------------------------------- colour ramps

function ramp(stops, t) {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0] || i === stops.length - 1) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
      return new THREE.Color(c0).lerp(new THREE.Color(c1), clamp(k, 0, 1));
    }
  }
  return new THREE.Color(stops[0][1]);
}

const ELEVATION_RAMP = [
  [0.00, 0x2b3a43], [0.22, 0x3f5a4a], [0.48, 0x63764f],
  [0.72, 0x8b8560], [0.90, 0xa89a80], [1.00, 0xd8d5cc],
];

// Detection margin is a signed quantity measured against a threshold, so it is
// a DIVERGING scale: two hues with a neutral midpoint pinned to 0 dB, never a
// rainbow. Below threshold reads red, above reads green, and the threshold
// itself recedes into the surface.
const MARGIN_RAMP = [
  [0.00, 0xe8524a], [0.22, 0xb04438], [0.38, 0x6d3a35],
  [0.4444, 0x39424a],
  [0.51, 0x356e56], [0.72, 0x37a274], [1.00, 0x4fdc97],
];

// Loss caused by the farm: transparent-ish base through to deep red.
const LOSS_RAMP = [
  [0.00, 0x27313a], [0.18, 0x2f4a55], [0.40, 0xd9a13a],
  [0.68, 0xe06a3c], [1.00, 0xb51f18],
];

export function marginColor(db) {
  // -20 dB to +25 dB, which places 0 dB, the detection threshold, at 0.4444 -
  // exactly where the ramp's neutral step sits.
  return ramp(MARGIN_RAMP, (db + 20) / 45);
}
export function lossColor(db) {
  return ramp(LOSS_RAMP, db / 25);                 // 0 .. 25 dB of degradation
}

export function statusColor(status) {
  switch (status) {
    case 'detected': return COLORS.ok;
    case 'marginal': return COLORS.warn;
    case 'lost': return COLORS.bad;
    case 'terrain-masked': return COLORS.masked;
    case 'no-cover': return 0x3a444d;
    default: return COLORS.masked;
  }
}

// -------------------------------------------------------------- orbit camera
//
// Small purpose-built controller. Nothing is vendored beyond three.js itself,
// so the tool stays a straight static-file drop with no build step.

export class Orbit {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 0, 0);
    this.radius = 26000;
    this.theta = Math.PI * 0.25;      // azimuth
    this.phi = Math.PI * 0.30;        // polar from +Y
    this.minRadius = 300;
    this.maxRadius = 260000;
    this.enabled = true;
    this._drag = null;
    this._bind();
    this.apply();
  }

  _bind() {
    const d = this.dom;
    d.style.touchAction = 'none';
    d.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      d.setPointerCapture(e.pointerId);
      this._drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    });
    d.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
      if (this._drag.pan) this.pan(dx, dy);
      else {
        this.theta -= dx * 0.005;
        this.phi = clamp(this.phi - dy * 0.005, 0.02, Math.PI * 0.499);
      }
      this.apply();
    });
    const end = (e) => {
      if (this._drag) { try { d.releasePointerCapture(e.pointerId); } catch (_) {} }
      this._drag = null;
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const before = this.radius;
      this.radius = clamp(this.radius * Math.exp(e.deltaY * 0.0012), this.minRadius, this.maxRadius);
      // Zooming in draws the orbit target towards whatever is under the
      // pointer. Without this the wheel always drives at the scene origin,
      // which is the radar, so you cannot get close to anything else: the
      // turbines stay small however far you zoom and the camera ends up in
      // the ground at the mast.
      if (this.radius < before) {
        const hit = this.groundUnderPointer(e);
        if (hit) this.target.lerp(hit, clamp((1 - this.radius / before) * 1.6, 0, 0.7));
      }
      this.apply();
    }, { passive: false });
  }

  // Where the pointer ray meets the horizontal plane through the current
  // target. Cheap, and close enough for steering a zoom.
  groundUnderPointer(e) {
    const rect = this.dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ray = new THREE.Vector3(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
      0.5,
    ).unproject(this.camera).sub(this.camera.position).normalize();
    if (Math.abs(ray.y) < 1e-4) return null;
    const t = (this.target.y - this.camera.position.y) / ray.y;
    if (!Number.isFinite(t) || t <= 0) return null;
    return this.camera.position.clone().addScaledVector(ray, t);
  }

  pan(dx, dy) {
    const scale = this.radius * 0.0013;
    const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
    const fwd = new THREE.Vector3(Math.sin(this.theta), 0, Math.cos(this.theta));
    this.target.addScaledVector(right, -dx * scale);
    this.target.addScaledVector(fwd, -dy * scale);
  }

  set(theta, phi, radius, target) {
    if (theta !== undefined) this.theta = theta;
    if (phi !== undefined) this.phi = clamp(phi, 0.02, Math.PI * 0.499);
    if (radius !== undefined) this.radius = clamp(radius, this.minRadius, this.maxRadius);
    if (target) this.target.copy(target);
    this.apply();
  }

  apply() {
    const s = Math.sin(this.phi) * this.radius;
    const x = this.target.x + s * Math.sin(this.theta);
    const z = this.target.z + s * Math.cos(this.theta);
    let y = this.target.y + Math.cos(this.phi) * this.radius;

    // Never put the eye inside the ground. The polar angle can come within a
    // fraction of a degree of horizontal, so at close range the camera used to
    // sink into a hill and the view went blank, which is what happens if you
    // try to zoom in on a turbine. The floor is set in scene units, so it
    // already carries the vertical exaggeration the terrain is drawn with.
    const floorAt = this.groundY ? this.groundY(x, z) : null;
    if (Number.isFinite(floorAt)) {
      y = Math.max(y, floorAt + Math.max(this.radius * 0.03, 15));
    }

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }
}

// ------------------------------------------------------------------- viewer

// --------------------------------------------------------- turbine geometry
//
// The turbines are drawn from the dimensions the model actually carries: tower
// base and top diameter, blade length, blade chord, blade count. Earlier these
// were a cylinder, a box and three flat slabs sized from the scene extent, so
// changing a tower diameter or a blade chord did nothing to the picture even
// though both feed the shadow and clutter maths.
//
// TWO EXAGGERATIONS ARE IN FORCE AND THEY ARE DIFFERENT. Heights go through
// the vertical multiplier, as everything in this scene does. Structural GIRTH
// goes through a separate multiplier, because a 5.5 m tower across a 40 km
// scene is a quarter of a pixel. Girth exaggeration is uniform across every
// structure, so relative proportions are true: a fatter tower really is drawn
// fatter. Lengths along the blade span are NOT exaggerated in girth, so the
// rotor covers the ground area it really covers.

// Loft a closed surface through a series of rings. Every ring must have the
// same number of points. Returns an indexed BufferGeometry with vertex normals.
export function loftRings(rings, { capStart = true, capEnd = true } = {}) {
  const ringCount = rings.length;
  const n = rings[0].length;
  const verts = [];
  for (const ring of rings) for (const p of ring) verts.push(p.x, p.y, p.z);

  const idx = [];
  for (let s = 0; s < ringCount - 1; s += 1) {
    const a = s * n;
    const b = (s + 1) * n;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      idx.push(a + i, b + i, b + j);
      idx.push(a + i, b + j, a + j);
    }
  }

  // Caps are triangle fans about the ring centroid.
  const cap = (ring, base, flip) => {
    let cx = 0, cy = 0, cz = 0;
    for (const p of ring) { cx += p.x; cy += p.y; cz += p.z; }
    const c = verts.length / 3;
    verts.push(cx / n, cy / n, cz / n);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      if (flip) idx.push(c, base + j, base + i);
      else idx.push(c, base + i, base + j);
    }
  };
  if (capStart) cap(rings[0], 0, true);
  if (capEnd) cap(rings[ringCount - 1], (ringCount - 1) * n, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// NACA four-digit thickness distribution. xc is the chordwise fraction.
function naca(xc, tc) {
  return 5 * tc * (0.2969 * Math.sqrt(xc) - 0.1260 * xc - 0.3516 * xc * xc
    + 0.2843 * xc * xc * xc - 0.1015 * xc * xc * xc * xc);
}

// One aerofoil section, in blade-local axes: x chordwise, y spanwise, z thick.
// Twist is about the span axis, taken at the quarter-chord pitch axis.
export function aerofoilRing(spanY, chord, tc, twistRad, halfPoints = 14) {
  const ring = [];
  const pitchAxis = 0.3;
  const add = (xc, zc) => {
    const x = (xc - pitchAxis) * chord;
    const z = zc * chord;
    const c = Math.cos(twistRad), s = Math.sin(twistRad);
    ring.push(new THREE.Vector3(x * c - z * s, spanY, x * s + z * c));
  };
  // Cosine spacing clusters points at the leading and trailing edges, which is
  // where the curvature is.
  for (let i = 0; i <= halfPoints; i += 1) {
    const xc = 0.5 - 0.5 * Math.cos((i / halfPoints) * Math.PI);
    add(xc, naca(xc, tc));
  }
  for (let i = halfPoints - 1; i >= 1; i -= 1) {
    const xc = 0.5 - 0.5 * Math.cos((i / halfPoints) * Math.PI);
    add(xc, -naca(xc, tc));
  }
  return ring;
}

// A blade: circular at the root, widest at about an eighth of span, tapering
// and untwisting to a thin tip. Span runs along +y from the hub.
const BLADE_STATIONS = [0.00, 0.04, 0.10, 0.18, 0.30, 0.45, 0.62, 0.78, 0.90, 0.97, 1.00];
const BLADE_CHORD_F  = [0.42, 0.60, 0.96, 1.00, 0.84, 0.66, 0.50, 0.36, 0.25, 0.13, 0.04];
const BLADE_TWIST_D  = [16.0, 15.2, 13.0, 10.0, 6.2, 3.4, 1.8, 0.8, 0.3, 0.05, 0.0];
const BLADE_TC       = [1.00, 0.86, 0.50, 0.36, 0.27, 0.22, 0.19, 0.17, 0.155, 0.15, 0.15];

export function bladeGeometry(spanM, maxChordM) {
  const rings = BLADE_STATIONS.map((st, i) => aerofoilRing(
    st * spanM,
    Math.max(maxChordM * BLADE_CHORD_F[i], maxChordM * 0.03),
    BLADE_TC[i],
    BLADE_TWIST_D[i] * DEG,
  ));
  return loftRings(rings);
}

// The nacelle: a rounded box that tapers towards the rear, lofted along +z,
// which is the direction the rotor faces.
function roundedRectRing(z, halfW, halfH, radius, perQuadrant = 5) {
  const ring = [];
  const r = Math.min(radius, halfW * 0.9, halfH * 0.9);
  const corners = [[halfW - r, halfH - r], [-(halfW - r), halfH - r],
    [-(halfW - r), -(halfH - r)], [halfW - r, -(halfH - r)]];
  for (let c = 0; c < 4; c += 1) {
    const a0 = c * Math.PI / 2;
    for (let i = 0; i <= perQuadrant; i += 1) {
      const a = a0 + (i / perQuadrant) * Math.PI / 2;
      ring.push(new THREE.Vector3(corners[c][0] + r * Math.cos(a),
        corners[c][1] + r * Math.sin(a), z));
    }
  }
  return ring;
}

export function nacelleGeometry(lengthM, widthM, heightM) {
  const hw = widthM / 2, hh = heightM / 2;
  const prof = [
    [-0.50, 0.62, 0.55], [-0.42, 0.86, 0.82], [-0.10, 1.00, 1.00],
    [0.30, 1.00, 1.00], [0.44, 0.92, 0.94], [0.50, 0.72, 0.78],
  ];
  return loftRings(prof.map(([zf, wf, hf]) => roundedRectRing(
    zf * lengthM, hw * wf, hh * hf, Math.min(hw, hh) * 0.45,
  )));
}

// The spinner, a nose cone over the hub, lofted along +z.
export function spinnerGeometry(radiusM, lengthM, sides = 14) {
  const prof = [[0.0, 0.55], [0.25, 0.92], [0.55, 1.00], [0.80, 0.80], [0.96, 0.45], [1.0, 0.06]];
  return loftRings(prof.map(([zf, rf]) => {
    const ring = [];
    for (let i = 0; i < sides; i += 1) {
      const a = (i / sides) * Math.PI * 2;
      ring.push(new THREE.Vector3(radiusM * rf * Math.cos(a),
        radiusM * rf * Math.sin(a), zf * lengthM));
    }
    return ring;
  }));
}

export class SceneView {
  constructor(canvas) {
    this.canvas = canvas;
    this.vExag = 4;
    this.result = null;
    this.hovered = null;
    this.shadeMode = 'terrain';
    this.layers = {
      beam: true, envelope: true, shadows: true, los: true,
      track: true, zones: true, rings: true, labels: true,
    };
    this.time = 0;
    this.animate = true;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      // Needed so the view can be captured to a PNG after the frame is drawn.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x080b0e, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x080b0e, 30000, 140000);

    this.camera = new THREE.PerspectiveCamera(42, 1, 5, 400000);
    this.controls = new Orbit(this.camera, canvas);
    // The camera asks the terrain how high the ground is under it. Null until
    // a result is loaded, which leaves the clamp switched off rather than
    // guessing a floor.
    this.controls.groundY = (x, z) => {
      const r = this.result;
      if (!r || !r.terrain || typeof r.terrain.heightAt !== 'function') return null;
      const east = x, north = -z;
      return this.y(r.terrain.heightAt(east, north), this.rangeFromRadar(east, north));
    };

    this.scene.add(new THREE.HemisphereLight(0x7f95a8, 0x1d241d, 1.15));
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.35);
    sun.position.set(-1, 1.6, 0.9).multiplyScalar(30000);
    this.scene.add(sun);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.groups = {};
    for (const k of ['terrain', 'rings', 'radar', 'beam', 'envelope', 'turbines',
                     'shadows', 'los', 'track', 'zones', 'labels']) {
      this.groups[k] = new THREE.Group();
      this.root.add(this.groups[k]);
    }

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._pickables = [];
    canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    canvas.addEventListener('pointerleave', () => this._setHover(null));

    this.onHover = null;
    this.resize();
  }

  // Height of a point in scene units: real metres, curvature-corrected,
  // then multiplied by the vertical exaggeration.
  y(amsl, groundRangeM) {
    const drop = groundRangeM === undefined ? 0 : curvatureDrop(groundRangeM, this.ae);
    return (amsl - drop) * this.vExag;
  }

  // Curvature is referenced to the radar, so ground range is measured from it.
  rangeFromRadar(east, north) {
    return hypot2(east - this.radarEast, north - this.radarNorth);
  }

  pos(east, north, amsl) {
    return new THREE.Vector3(
      east,
      this.y(amsl, this.rangeFromRadar(east, north)),
      -north,                        // scene z runs south so that -z is north
    );
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clearGroup(name) {
    const g = this.groups[name];
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse?.((o) => {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose?.();
      });
    }
  }

  // ------------------------------------------------------------------ build

  build(result) {
    this.result = result;
    this.ae = result.ae;
    this.radarEast = result.radar.east;
    this.radarNorth = result.radar.north;
    this.extent = result.extent;

    this.scene.fog.near = result.extent * 0.9;
    this.scene.fog.far = result.extent * 4.2;
    this.controls.maxRadius = result.extent * 9;

    // The terrain mesh is the most expensive thing to rebuild, and it only
    // changes when the ground, the curvature assumption or the vertical
    // multiplier does. Everything else gets rebuilt on every run.
    const sig = JSON.stringify([
      result.scenario.environment, result.extent, this.vExag,
      result.radar.east, result.radar.north, result.radar.heightAgl,
    ]);
    if (sig !== this._terrainSig) {
      this._buildTerrain();
      this._terrainSig = sig;
    } else {
      this.shadeTerrain(this.shadeMode);
    }
    this._buildRings();
    this._buildRadar();
    this._buildEnvelope();
    this._buildBeam();
    this._buildTurbines();
    this._buildShadows();
    this._buildLos();
    this._buildTrack();
    this._buildZones();
    this.applyLayers();
  }

  _buildTerrain() {
    this.clearGroup('terrain');
    const r = this.result;
    const n = 248;
    const ext = r.extent;
    const geo = new THREE.PlaneGeometry(2 * ext, 2 * ext, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const heights = new Float32Array(pos.count);
    let hMin = Infinity, hMax = -Infinity;

    for (let i = 0; i < pos.count; i++) {
      const east = pos.getX(i);
      const north = -pos.getZ(i);
      const h = r.terrain.heightAt(east, north);
      heights[i] = h;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
      pos.setY(i, this.y(h, this.rangeFromRadar(east, north)));
    }
    this._terrainRange = { hMin, hMax };
    this._terrainHeights = heights;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.0, flatShading: false,
    });
    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.groups.terrain.add(this.terrainMesh);
    this.shadeTerrain(this.shadeMode);
  }

  shadeTerrain(mode) {
    this.shadeMode = mode;
    if (!this.terrainMesh) return;
    const r = this.result;
    const geo = this.terrainMesh.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const { hMin, hMax } = this._terrainRange;
    const span = Math.max(hMax - hMin, 1);
    const cov = r.coverage;

    const sampleGrid = (arr, east, north) => {
      if (!cov) return NaN;
      const fx = clamp((east + cov.extent) / cov.step, 0, cov.size - 1.001);
      const fz = clamp((north + cov.extent) / cov.step, 0, cov.size - 1.001);
      const i = fx | 0, j = fz | 0;
      const tx = fx - i, tz = fz - j;
      const a = arr[j * cov.size + i], b = arr[j * cov.size + i + 1];
      const c = arr[(j + 1) * cov.size + i], d = arr[(j + 1) * cov.size + i + 1];
      if (![a, b, c, d].every(Number.isFinite)) return NaN;
      return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
    };

    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const east = pos.getX(i);
      const north = -pos.getZ(i);
      const h = this._terrainHeights[i];

      if (mode === 'coverage' && cov) {
        const m = sampleGrid(cov.margin, east, north);
        if (Number.isFinite(m)) c.copy(marginColor(m));
        else c.setHex(0x14191e);
      } else if (mode === 'delta' && cov) {
        const m = sampleGrid(cov.margin, east, north);
        const cl = sampleGrid(cov.clean, east, north);
        if (Number.isFinite(m) && Number.isFinite(cl)) c.copy(lossColor(Math.max(cl - m, 0)));
        else c.setHex(0x14191e);
      } else {
        c.copy(ramp(ELEVATION_RAMP, (h - hMin) / span));
      }
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  _buildRings() {
    this.clearGroup('rings');
    const r = this.result;
    const stepM = r.extent > 60000 ? 20000 : r.extent > 25000 ? 10000 : 5000;
    const mat = new THREE.LineBasicMaterial({
      color: 0x38505e, transparent: true, opacity: 0.55,
    });
    for (let rng = stepM; rng <= r.extent * 1.1; rng += stepM) {
      const pts = [];
      for (let a = 0; a <= 360; a += 2) {
        const o = offsetByBearing(rng, a);
        const east = r.radar.east + o.east;
        const north = r.radar.north + o.north;
        const h = r.terrain.heightAt(east, north) + 8;
        pts.push(this.pos(east, north, h));
      }
      this.groups.rings.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    // Cardinal radials
    for (const brg of [0, 90, 180, 270]) {
      const pts = [];
      for (let d = 0; d <= r.extent * 1.1; d += r.extent / 40) {
        const o = offsetByBearing(d, brg);
        const east = r.radar.east + o.east;
        const north = r.radar.north + o.north;
        pts.push(this.pos(east, north, r.terrain.heightAt(east, north) + 8));
      }
      this.groups.rings.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    this.ringStepM = stepM;
  }

  _buildRadar() {
    this.clearGroup('radar');
    const r = this.result;
    const g = new THREE.Group();
    const base = this.pos(r.radar.east, r.radar.north, r.radar.groundM);
    g.position.copy(base);

    const hTower = r.radar.heightAgl * this.vExag;
    const towerR = Math.max(this.extent * 0.0016, 3);
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(towerR * 0.7, towerR, hTower, 10),
      new THREE.MeshStandardMaterial({ color: 0xa9b6c0, roughness: 0.6, metalness: 0.3 }),
    );
    tower.position.y = hTower / 2;
    g.add(tower);

    // Rotating antenna reflector.
    const ant = new THREE.Group();
    ant.position.y = hTower;
    const w = Math.max(this.extent * 0.012, 60);
    const refl = new THREE.Mesh(
      new THREE.BoxGeometry(w, w * 0.30, w * 0.05),
      new THREE.MeshStandardMaterial({ color: 0xe2e8ec, roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide }),
    );
    refl.position.z = -w * 0.05;
    ant.add(refl);
    ant.add(new THREE.Mesh(
      new THREE.SphereGeometry(w * 0.05, 8, 6),
      new THREE.MeshStandardMaterial({ color: COLORS.rf, emissive: COLORS.rf, emissiveIntensity: 0.6 }),
    ));
    g.add(ant);
    this.antenna = ant;

    this.groups.radar.add(g);

    if (r.infill) {
      const gi = new THREE.Group();
      gi.position.copy(this.pos(r.infill.east, r.infill.north, r.infill.groundM));
      const hi = r.infill.heightAgl * this.vExag;
      const t2 = new THREE.Mesh(
        new THREE.CylinderGeometry(towerR * 0.6, towerR * 0.8, hi, 8),
        new THREE.MeshStandardMaterial({ color: COLORS.info, roughness: 0.6, metalness: 0.3 }),
      );
      t2.position.y = hi / 2;
      gi.add(t2);
      const d2 = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.7, w * 0.22, w * 0.05),
        new THREE.MeshStandardMaterial({ color: COLORS.info, emissive: COLORS.info, emissiveIntensity: 0.25 }),
      );
      d2.position.y = hi;
      gi.add(d2);
      this.infillAntenna = d2;
      this.groups.radar.add(gi);
    } else {
      this.infillAntenna = null;
    }
  }

  // Detection envelope: the range at which the reference target reaches the
  // detection threshold, as a function of elevation. R scales as G^(1/2), so
  // the envelope shape is the antenna pattern in half-power terms - which is
  // why a cosecant-squared radar shows the familiar tilted-wedge coverage.
  _envelopeProfile() {
    const r = this.result;
    const radar = r.radar;
    const pts = [];
    const peakRange = this._peakDetectionRange();
    // Detection range is often far larger than the area of interest, so the
    // drawn envelope is clipped to the scene. The real figure is in the panel.
    const displayCap = Math.min(radar.instrumentedRangeM, this.extent * 1.02);
    for (let el = 0; el <= Math.min(radar.cscMaxDeg + 8, 60); el += 0.5) {
      const gDb = elevationGainDb(el, radar);
      const range = Math.min(peakRange * Math.pow(10, gDb / 20), displayCap);
      pts.push({ el, range });
    }
    return pts;
  }

  _peakDetectionRange() {
    const r = this.result;
    const radar = r.radar;
    const sigma = dbToLin(r.scenario.target.rcsDbsm);
    const g = radar.g0Lin;
    const num = radar.peakPowerW * g * g * radar.lambdaM ** 2 * sigma;
    const den = Math.pow(4 * Math.PI, 3) * radar.lossLin
      * radar.noiseW * dbToLin(radar.requiredSnrDb);
    return Math.min(Math.pow(num / den, 0.25), radar.instrumentedRangeM);
  }

  _buildEnvelope() {
    this.clearGroup('envelope');
    const r = this.result;
    const prof = this._envelopeProfile();
    const az = 96;
    const verts = [];
    const idx = [];
    const baseY = this.y(r.radar.amslM, 0);

    for (let a = 0; a <= az; a++) {
      const theta = (a / az) * Math.PI * 2;
      for (let p = 0; p < prof.length; p++) {
        const { el, range } = prof[p];
        const gr = range * Math.cos(el * DEG);
        const h = r.radar.amslM + range * Math.sin(el * DEG);
        const east = r.radar.east + gr * Math.sin(theta);
        const north = r.radar.north + gr * Math.cos(theta);
        verts.push(east, this.y(h, gr), -north);
      }
    }
    const stride = prof.length;
    for (let a = 0; a < az; a++) {
      for (let p = 0; p < stride - 1; p++) {
        const i0 = a * stride + p;
        const i1 = (a + 1) * stride + p;
        idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: COLORS.rf, transparent: true, opacity: 0.035,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.groups.envelope.add(mesh);

    // Hairline along the envelope edge so the shape reads without the fill.
    const edge = [];
    for (const { el, range } of prof) {
      const gr = range * Math.cos(el * DEG);
      edge.push(new THREE.Vector3(
        r.radar.east + gr * Math.sin(Math.PI * 0.25),
        this.y(r.radar.amslM + range * Math.sin(el * DEG), gr),
        -(r.radar.north + gr * Math.cos(Math.PI * 0.25)),
      ));
    }
    this.groups.envelope.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(edge),
      new THREE.LineBasicMaterial({ color: COLORS.rf, transparent: true, opacity: 0.3 }),
    ));
    this.envelopePeakRange = this._peakDetectionRange();
  }

  _buildBeam() {
    this.clearGroup('beam');
    const r = this.result;
    const prof = this._envelopeProfile();
    const halfAz = r.radar.azBeamwidthDeg / 2 * DEG;
    const verts = [];
    const idx = [];

    // Two azimuth faces swept by the mainlobe, so the beam reads as a volume.
    for (let s = 0; s < 2; s++) {
      const theta = s === 0 ? -halfAz : halfAz;
      verts.push(0, this.y(r.radar.amslM, 0), 0);
      for (const { el, range } of prof) {
        const gr = range * Math.cos(el * DEG);
        verts.push(gr * Math.sin(theta), this.y(r.radar.amslM + range * Math.sin(el * DEG), gr), -gr * Math.cos(theta));
      }
    }
    const stride = prof.length + 1;
    for (let p = 1; p < stride - 1; p++) {
      idx.push(0, p, p + 1);
      idx.push(stride, stride + p + 1, stride + p);
      idx.push(p, stride + p, p + 1);
      idx.push(p + 1, stride + p, stride + p + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: COLORS.rf, transparent: true, opacity: 0.11,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const holder = new THREE.Group();
    holder.position.copy(this.pos(r.radar.east, r.radar.north, r.radar.groundM));
    holder.position.y = this.y(r.radar.amslM, 0);
    holder.add(mesh);
    this.beamHolder = holder;
    this.groups.beam.add(holder);
  }

  _buildTurbines() {
    this.clearGroup('turbines');
    this._pickables = [];
    const r = this.result;
    // Structures are drawn thicker than scale so they are visible across a
    // 40 km scene; HEIGHTS are true (times the vertical multiplier).
    const shaftR = Math.max(this.extent * 0.0016, 3.0);

    // ONE factor, applied to EVERY structural girth and to nothing else.
    //
    // A 5.5 m tower across a 40 km scene is a fraction of a pixel, so girths
    // have to be drawn thicker than life. Earlier there were three different
    // factors here: one for the tower, its square root for the nacelle, and a
    // third, capped one for blade chord. Three factors means the drawn machine
    // is not a machine of any proportions, so no proportion in the picture can
    // be trusted. There is now one, it is under the user's control, and the
    // badge states it.
    //
    // It is applied to tower diameters, nacelle width, height and length, hub
    // diameter, blade chord and blade thickness. It is NEVER applied to a SPAN:
    // blade span and hub height stay true, so tip heights and the ground area
    // the rotor covers are real. Girth and span therefore cannot both be to
    // scale, and that is a property of the problem rather than a fudge: say it
    // on the badge instead of hiding it in three constants.
    if (this.girthExag == null) {
      // First build: choose a factor that makes the thinnest structure, the
      // blade chord, about a pixel and a half across. The user can change it.
      const t0 = r.turbineResults[0]?.turbine;
      const thinnest = t0 ? Math.min(t0.bladeChordM ?? 3, (t0.towerTopDiameterM ?? 3)) : 3;
      this.girthExag = clamp(Math.round((this.extent * 0.00045) / Math.max(thinnest, 0.5)), 1, 40);
    }
    const girth = clamp(this.girthExag, 1, 40);

    // Geometry is shared between machines of the same specification. The cache
    // is local to this build: clearGroup disposes what it finds, so a cache
    // that outlived a rebuild would hand out disposed buffers.
    const cache = new Map();
    const geoCache = (key, make) => {
      if (!cache.has(key)) cache.set(key, make());
      return cache.get(key);
    };

    for (const tr of r.turbineResults) {
      const t = tr.turbine;
      const g = new THREE.Group();
      g.position.copy(this.pos(t.east, t.north, t.groundM));
      g.userData.turbine = tr;

      const colour = tr.visibility === 'masked' ? COLORS.masked
        : tr.falsePlot ? COLORS.bad
          : tr.snrEffDb > r.radar.requiredSnrDb - 10 ? COLORS.warn : COLORS.ok;

      const hubY = t.hubHeightM * this.vExag;
      const towerMat = new THREE.MeshStandardMaterial({
        color: COLORS.tower, roughness: 0.55, metalness: 0.15,
        emissive: colour, emissiveIntensity: 0.22,
      });
      // TRUE tower taper, from the model's own base and top diameters, widened
      // by the girth multiplier so it is visible across the scene.
      const baseR = (t.towerBaseDiameterM ?? 5) / 2 * girth;
      const topR = (t.towerTopDiameterM ?? 3) / 2 * girth;
      const tower = new THREE.Mesh(
        geoCache(`tw:${baseR.toFixed(1)}:${topR.toFixed(1)}:${hubY.toFixed(0)}`,
          () => new THREE.CylinderGeometry(topR, baseR, hubY, 20, 1)),
        towerMat,
      );
      tower.userData.part = 'tower';
      tower.position.y = hubY / 2;
      g.add(tower);

      const rotor = new THREE.Group();
      rotor.position.y = hubY;
      // Rotor axis points into the wind; scene z is south, so bearing maps to
      // a rotation about +Y of (180 - bearing) degrees.
      rotor.rotation.y = (180 - t.yawDeg) * DEG;
      g.add(rotor);

      // Nacelle length is a span along the rotor axis, so it is NOT widened;
      // its width and height are girths, so they are.
      const nacL = t.nacelleLengthM;
      const nacW = t.nacelleWidthM * girth;
      const nacH = t.nacelleHeightM * girth;
      const nacelle = new THREE.Mesh(
        geoCache(`nc:${nacL.toFixed(1)}:${nacW.toFixed(1)}:${nacH.toFixed(1)}`,
          () => nacelleGeometry(nacL, nacW, nacH)),
        new THREE.MeshStandardMaterial({ color: 0xe6ebee, roughness: 0.5, metalness: 0.2 }),
      );
      nacelle.userData.part = 'nacelle';
      rotor.add(nacelle);

      const spinner = new THREE.Group();
      spinner.position.z = nacL * 0.52;
      rotor.add(spinner);
      // Blade span is exaggerated VERTICALLY only, by scaling the rotor disc,
      // so the rotor covers the ground width it really covers. Scaling y after
      // a rotation about y is safe: the two commute.
      spinner.scale.y = this.vExag;

      const spinR = t.hubDiameterM / 2 * girth;
      const spinL = t.hubDiameterM * 0.95;   // a span, so left alone
      const nose = new THREE.Mesh(
        geoCache(`sp:${spinR.toFixed(1)}:${spinL.toFixed(1)}`, () => spinnerGeometry(spinR, spinL)),
        new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 0.45, metalness: 0.1 }),
      );
      nose.userData.part = 'spinner';
      spinner.add(nose);

      const bladeLen = t.rotorRadiusM;
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0xf2f5f7, roughness: 0.4, metalness: 0.05,
        emissive: colour, emissiveIntensity: 0.3,
      });
      // Chord is a girth, so it takes the same factor as everything else.
      const chord = (t.bladeChordM ?? 3) * girth;
      const bladeGeo = geoCache(`bl:${bladeLen.toFixed(0)}:${chord.toFixed(1)}`,
        () => bladeGeometry(bladeLen, chord));
      for (let b = 0; b < t.bladeCount; b++) {
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.userData.part = 'blade';
        blade.position.y = spinR * 0.5;
        const arm = new THREE.Group();
        arm.rotation.z = (b / t.bladeCount) * Math.PI * 2;
        arm.add(blade);
        spinner.add(arm);
      }
      spinner.userData.rpm = tr.rpm;
      spinner.userData.phase = t.phase;
      g.userData.spinner = spinner;

      // Invisible pick proxy, sized generously so hovering is not fiddly.
      const proxyR = Math.max(bladeLen * 0.55, shaftR * 3);
      const proxyH = hubY + bladeLen * this.vExag;
      const proxy = new THREE.Mesh(
        geoCache(`px:${proxyR.toFixed(0)}:${proxyH.toFixed(0)}`,
          () => new THREE.CylinderGeometry(proxyR, proxyR, proxyH, 6)),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      proxy.position.y = proxyH / 2;
      proxy.userData.part = 'pick';
      proxy.userData.turbine = tr;
      g.add(proxy);
      this._pickables.push(proxy);

      this.groups.turbines.add(g);
    }
  }

  // Geometric shadow of the rotor disc: the volume behind a turbine that the
  // structure occludes as seen from the radar. The MODELLED loss through it is
  // in the track results and the section view; this is the geometry.
  _buildShadows() {
    this.clearGroup('shadows');
    const r = this.result;

    for (const tr of r.turbineResults) {
      if (tr.visibility === 'masked') continue;
      const t = tr.turbine;
      const d1 = Math.max(tr.hub.ground, 1);
      // Drawn to a readable length rather than to the scene edge: past a few
      // rotor diameters the geometric shadow is wide, shallow and not the
      // thing doing the damage. The modelled loss is in the track results.
      const far = Math.min(d1 * 2.4, r.extent * 1.05);
      if (d1 >= far) continue;
      const k = far / d1;

      const brg = tr.hub.bearing * DEG;
      const ux = Math.sin(brg), uz = Math.cos(brg);       // radially outward
      const px = Math.cos(brg), pz = -Math.sin(brg);      // across the bearing

      const site = r.radar.site;
      const rTop = t.groundM + t.hubHeightM + t.rotorRadiusM;
      const rBot = Math.max(t.groundM + t.hubHeightM - t.rotorRadiusM, t.groundM);
      const half = t.rotorRadiusM;

      const corner = (dist, lateral, amsl) => {
        const east = site.east + ux * dist + px * lateral;
        const north = site.north + uz * dist + pz * lateral;
        return new THREE.Vector3(east, this.y(amsl, dist), -north);
      };
      // Rays diverge from the radar, so the far face is the near face scaled
      // about the radar by far/d1 - in height as well as laterally.
      const projAmsl = (amsl) => site.height + (amsl - site.height) * k;

      const near = [
        corner(d1, -half, rTop), corner(d1, half, rTop),
        corner(d1, half, rBot), corner(d1, -half, rBot),
      ];
      const fars = [
        corner(far, -half * k, projAmsl(rTop)), corner(far, half * k, projAmsl(rTop)),
        corner(far, half * k, projAmsl(rBot)), corner(far, -half * k, projAmsl(rBot)),
      ];

      const verts = [];
      const push = (v) => verts.push(v.x, v.y, v.z);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        push(near[i]); push(fars[i]); push(fars[j]);
        push(near[i]); push(fars[j]); push(near[j]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const intensity = clamp(0.022 + (tr.snrEffDb - r.radar.requiredSnrDb) / 900, 0.02, 0.07);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: tr.falsePlot ? COLORS.bad : COLORS.warn,
        transparent: true, opacity: intensity,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.userData.turbine = tr;
      this.groups.shadows.add(mesh);
    }
  }

  _buildLos() {
    this.clearGroup('los');
    const r = this.result;
    const from = this.pos(r.radar.east, r.radar.north, r.radar.amslM);
    for (const tr of r.turbineResults) {
      const t = tr.turbine;
      const to = this.pos(t.east, t.north, t.hubAmslM);
      const colour = tr.visibility === 'masked' ? COLORS.masked
        : tr.visibility === 'clear' ? COLORS.ok : COLORS.warn;
      this.groups.los.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([from, to]),
        new THREE.LineBasicMaterial({
          color: colour, transparent: true,
          opacity: tr.visibility === 'masked' ? 0.22 : 0.5,
        }),
      ));
    }
  }

  _buildTrack() {
    this.clearGroup('track');
    const r = this.result;
    if (!r.points.length) return;

    const verts = [];
    const cols = [];
    const c = new THREE.Color();
    for (const p of r.points) {
      const v = this.pos(p.east, p.north, p.amsl);
      verts.push(v.x, v.y, v.z);
      c.setHex(p.blanked ? COLORS.info : statusColor(p.tracked ? p.status : 'lost'));
      cols.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.groups.track.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, linewidth: 2,
    })));

    // Drop lines to the ground every so often, so altitude is readable.
    const dropVerts = [];
    for (let i = 0; i < r.points.length; i += Math.max(1, Math.floor(r.points.length / 24))) {
      const p = r.points[i];
      const a = this.pos(p.east, p.north, p.amsl);
      const b = this.pos(p.east, p.north, p.groundM);
      dropVerts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dropVerts, 3));
    this.groups.track.add(new THREE.LineSegments(dg, new THREE.LineBasicMaterial({
      color: 0x4a5c68, transparent: true, opacity: 0.35,
    })));

    // Markers where the tracker has no track.
    const lost = r.points.filter((p) => !p.tracked && !p.warmup && !p.outOfRange);
    if (lost.length) {
      const size = Math.max(this.extent * 0.004, 40);
      const geoM = new THREE.SphereGeometry(size, 8, 6);
      const matM = new THREE.MeshBasicMaterial({ color: COLORS.bad });
      for (const p of lost) {
        const m = new THREE.Mesh(geoM, matM);
        m.position.copy(this.pos(p.east, p.north, p.amsl));
        this.groups.track.add(m);
      }
    }

    const acSize = Math.max(this.extent * 0.006, 60);
    this.aircraft = new THREE.Mesh(
      new THREE.ConeGeometry(acSize * 0.55, acSize * 1.8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35 }),
    );
    this.aircraft.rotation.x = Math.PI / 2;
    this.groups.track.add(this.aircraft);
  }

  _buildZones() {
    this.clearGroup('zones');
    const r = this.result;
    const addSector = (zone, colour, opacity, wire) => {
      if (!zone) return;
      const steps = 40;
      const verts = [];
      const topAmsl = r.radar.amslM + Math.max(r.scenario.target.altitudeFt * 0.3048, 1500);
      const botAmsl = Number.isFinite(r.terrain.min) ? r.terrain.min : r.scenario.environment.terrain.baseHeight;
      const ring = (rng, amsl) => {
        const out = [];
        for (let i = 0; i <= steps; i++) {
          const a = zone.centreDeg - zone.halfWidthDeg + (2 * zone.halfWidthDeg) * (i / steps);
          const o = offsetByBearing(rng, a);
          out.push(this.pos(r.radar.east + o.east, r.radar.north + o.north, amsl));
        }
        return out;
      };
      const innerB = ring(zone.rangeMinM, botAmsl);
      const outerB = ring(zone.rangeMaxM, botAmsl);
      const innerT = ring(zone.rangeMinM, topAmsl);
      const outerT = ring(zone.rangeMaxM, topAmsl);

      const quad = (a, b, c2, d) => {
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c2.x, c2.y, c2.z);
        verts.push(a.x, a.y, a.z, c2.x, c2.y, c2.z, d.x, d.y, d.z);
      };
      for (let i = 0; i < steps; i++) {
        quad(innerT[i], innerT[i + 1], outerT[i + 1], outerT[i]);   // top
        quad(outerB[i], outerB[i + 1], outerT[i + 1], outerT[i]);   // outer wall
        quad(innerB[i], innerB[i + 1], innerT[i + 1], innerT[i]);   // inner wall
      }
      quad(innerB[0], outerB[0], outerT[0], innerT[0]);
      const n = steps;
      quad(innerB[n], outerB[n], outerT[n], innerT[n]);

      if (!verts.every(Number.isFinite)) {
        console.warn('Zone geometry produced non-finite vertices; zone not drawn.');
        return;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      this.groups.zones.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity,
        side: THREE.DoubleSide, depthWrite: false, wireframe: !!wire,
      })));

      const outline = [...innerT, ...outerT.slice().reverse(), innerT[0]];
      this.groups.zones.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(outline),
        new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.8 }),
      ));
    };

    addSector(r.blankZone, COLORS.info, 0.16, false);
    addSector(r.naizZone && !r.blankZone ? r.naizZone : null, 0xc9a227, 0.07, true);
  }

  // ------------------------------------------------------------ interaction

  _onPointerMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this._pickables, false);
    this._setHover(hits.length ? hits[0].object.userData.turbine : null);
  }

  _setHover(tr) {
    if (this.hovered === tr) return;
    this.hovered = tr;
    this.onHover?.(tr);
  }

  highlight(id) {
    for (const g of this.groups.turbines.children) {
      const on = g.userData.turbine?.turbine.id === id;
      g.scale.setScalar(on ? 1.35 : 1);
    }
  }

  applyLayers() {
    this.groups.beam.visible = this.layers.beam;
    this.groups.envelope.visible = this.layers.envelope;
    this.groups.shadows.visible = this.layers.shadows;
    this.groups.los.visible = this.layers.los;
    this.groups.track.visible = this.layers.track;
    this.groups.zones.visible = this.layers.zones;
    this.groups.rings.visible = this.layers.rings;
  }

  setView(kind) {
    const r = this.result;
    if (!r) return;
    const farm = r.turbines.length
      ? r.turbines.reduce((a, t) => ({ east: a.east + t.east / r.turbines.length, north: a.north + t.north / r.turbines.length }), { east: 0, north: 0 })
      : { east: 0, north: 0 };
    const farmBrg = Math.atan2(farm.east - r.radar.east, farm.north - r.radar.north);
    const mid = this.pos((r.radar.east + farm.east) / 2, (r.radar.north + farm.north) / 2,
      r.terrain.heightAt((r.radar.east + farm.east) / 2, (r.radar.north + farm.north) / 2));
    const span = Math.max(hypot2(farm.east - r.radar.east, farm.north - r.radar.north) * 2.4, r.extent * 0.7);

    if (kind === 'plan') {
      this.controls.set(farmBrg, 0.03, r.extent * 1.8, mid);
    } else if (kind === 'profile') {
      this.controls.set(farmBrg + Math.PI / 2, Math.PI * 0.487, span * 1.2, mid);
    } else if (kind === 'radar') {
      this.controls.set(farmBrg + Math.PI, Math.PI * 0.46, span * 0.16,
        this.pos(r.radar.east, r.radar.north, r.radar.amslM));
    } else {
      this.controls.set(farmBrg + Math.PI * 0.80, Math.PI * 0.36, span * 0.95, mid);
    }
  }

  setVerticalExaggeration(v) {
    this.vExag = v;
    if (this.result) this.build(this.result);
  }

  // ------------------------------------------------------------------ frame

  render(dt) {
    this.time += dt;
    const r = this.result;
    if (r) {
      if (this.animate) {
        const az = (this.time / r.radar.scanPeriodS) * Math.PI * 2;
        if (this.antenna) this.antenna.rotation.y = -az;
        if (this.beamHolder) this.beamHolder.rotation.y = -az;
        if (this.infillAntenna) {
          this.infillAntenna.rotation.y = -(this.time / (r.infill?.scanPeriodS || 4)) * Math.PI * 2;
        }
        for (const g of this.groups.turbines.children) {
          const s = g.userData.spinner;
          if (s) s.rotation.z = s.userData.phase + this.time * (s.userData.rpm / 60) * Math.PI * 2;
        }
        if (this.aircraft && r.points.length) {
          const period = Math.max(r.points[r.points.length - 1].timeS, 1);
          const tt = (this.time * 4) % period;
          let i = r.points.findIndex((p) => p.timeS >= tt);
          if (i < 1) i = 1;
          const a = r.points[i - 1];
          const b = r.points[i];
          const k = (tt - a.timeS) / Math.max(b.timeS - a.timeS, 1e-6);
          const pa = this.pos(a.east, a.north, a.amsl);
          const pb = this.pos(b.east, b.north, b.amsl);
          this.aircraft.position.lerpVectors(pa, pb, clamp(k, 0, 1));
          this.aircraft.lookAt(pb);
          this.aircraft.rotateX(Math.PI / 2);
          const st = b.tracked ? b.status : 'lost';
          this.aircraft.material.color.setHex(b.blanked ? COLORS.info : statusColor(st));
          this.aircraft.material.emissive.setHex(b.blanked ? COLORS.info : statusColor(st));
          this.currentPoint = b;
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
