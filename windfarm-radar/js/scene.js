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

// Relief shading for the elevation view, baked into the vertex colours.
//
// The hypsometric tint alone maps height to hue. Over ground whose relief is
// small next to the extent drawn, that puts almost every vertex in the same
// band and the whole scene reads as one olive wash: the terrain is there, but
// its shape is not. A hillshade restores the shape.
//
// It is computed from the mesh normals against a fixed north-west sun, the
// cartographic convention, so relief reads the same wherever the camera is.
// The scene light cannot do this job: orbit round to look down-sun and it
// flattens everything, which is exactly the view the screenshots showed.
//
// It is applied to the ELEVATION view only. Coverage and loss views encode a
// measured value in the colour, and multiplying that by a shading term would
// make the surface a prettier picture of a wrong number.
const SHADE_SUN = [-0.60, 0.72, -0.35];
// Flat ground (normal straight up) gives lambert = SHADE_SUN[1] = 0.72, so
// these are chosen to put it at 0.40 + 0.72 * 0.62 = 0.85. A slope turned into
// the sun reaches 1.0 and a slope turned away falls to the floor. Getting this
// wrong the first time lit the plain instead of shading it.
const SHADE_FLOOR = 0.40;
const SHADE_GAIN = 0.62;

const ELEVATION_RAMP = [
  [0.00, 0x18242c], [0.24, 0x26362f], [0.50, 0x3a4636],
  [0.74, 0x55543d], [0.90, 0x6f6852], [1.00, 0x8d8574],
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

// --------------------------------------------------------- aircraft geometry
//
// The target used to be a six-sided cone sized from the scene extent, so a
// light single and a widebody were drawn identically and changing the target
// class changed nothing you could see. It is now built from the span and
// length the model carries, like the turbines.
//
// The same girth rule applies as for the turbines: ONE exaggeration factor
// multiplies every structural WIDTH, and nothing else. Span and length are the
// true dimensions, so relative proportions stay honest: a widebody really is
// drawn five times the span of a light single.

/**
 * One half of a wing or tail surface, root at x = 0 and tip at x = side*semi.
 *
 * Each half is built separately so it can carry dihedral and hang an engine.
 * Sweep moves the tip section aft and dihedral moves it up; neither moves it
 * inboard or outboard, so the two halves together are exactly `2*semi` across
 * whatever those angles are. That is what keeps the drawn span equal to the
 * span the model carries.
 */
/**
 * The centre offset that a given LEADING-EDGE sweep implies.
 *
 * panelGeometry translates the whole tip SECTION aft by `sweep`, so `sweep` is
 * a centre-line offset, not the leading-edge sweep anybody quotes. Feeding it
 * a leading-edge figure over-sweeps the trailing edge by half the taper, and
 * that one mistake was three of the faults on the aircraft: a wing that read
 * as a paper dart, a fin whose root trailing edge sat 4.35 m forward of the
 * tail on an A320 against about 2.4 m real, and a tailplane swept almost twice
 * as far as the real one.
 *
 *   leading edge moves back by  leSweep
 *   trailing edge moves back by leSweep - (rootChord - tipChord)
 *   the centre, then, by        leSweep - (rootChord - tipChord) / 2
 */
function sweepFromLeadingEdge(leSweep, rootChord, tipChord) {
  return leSweep - (rootChord - tipChord) / 2;
}

function panelGeometry({ semi, rootChord, tipChord, sweep, dihedral = 0, thick, side = 1 }) {
  const v = [];
  const tris = [];
  // Each section is a thin four-point lens: leading edge, upper crest,
  // trailing edge, lower crest. Four points is enough for a wing seen from
  // hundreds of metres and keeps the whole aircraft under 900 triangles.
  const sec = (x, chord, z, y) => {
    const base = v.length / 3;
    v.push(x, y, z + chord * 0.5);
    v.push(x, y + thick * 0.5, z);
    v.push(x, y, z - chord * 0.5);
    v.push(x, y - thick * 0.5, z);
    return base;
  };
  const a = sec(0, rootChord, 0, 0);
  const b = sec(side * semi, tipChord, -sweep, dihedral);
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    tris.push([a + k, b + k, b + k2], [a + k, b + k2, a + k2]);
  }
  tris.push([b, b + 1, b + 2], [b, b + 2, b + 3]);   // close the tip
  // Mirroring the panel reverses its winding, which turns every face inside
  // out and makes the left wing light as if it were in shadow. Flip it back
  // rather than reaching for double-sided material, which hides the fault
  // instead of fixing it.
  const idx = [];
  for (const t of tris) idx.push(t[0], side < 0 ? t[2] : t[1], side < 0 ? t[1] : t[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A fuselage as one continuous surface: nose, constant-section barrel, tapered
 * tail cone. Built as a stack of rings laid along +Z.
 *
 * It was a lathe, which is a body of revolution, so the side view and the plan
 * view were the same shape and the whole thing read as a torpedo. Rings let
 * the section be taller than it is wide (`tallness`) and let the roof line run
 * on over the nose (`crown`), which is the windscreen. Those two, with a nose
 * that stops blunt instead of closing to a point, are what separate an
 * aeroplane from a dart at a glance.
 *
 * The rings run from the nose at +len/2 to the tail at -len/2 exactly, so the
 * fuselage alone sets the drawn length and no girth factor can change it, and
 * half-widths never exceed `radius`, so it cannot reach past the wing.
 */
function fuselageGeometry(len, radius, {
  nose = 'round', tailUp = 0, tallness = 1, crown = 0, tailStub = null,
} = {}) {
  const sharp = nose === 'sharp';
  const cowl = nose === 'cowl';
  // How much of the length each region takes, and how blunt each end is.
  //
  // tipR is the half-width the nose still has at its very front, as a
  // fraction of the body. It used to be zero, and a nose that closes to a
  // point is the loudest thing that says dart rather than aeroplane: a 737
  // radome is roughly a fifth of the fuselage diameter across where it meets
  // the windscreen, and a propeller aircraft is blunter still because the
  // engine cowl is nearly full width right up to the spinner.
  const noseFrac = sharp ? 0.30 : cowl ? 0.13 : 0.17;
  const tailFrac = sharp ? 0.24 : cowl ? 0.40 : 0.33;
  // A pusher propeller needs something to bolt to at the BACK, for the same
  // reason a tractor one does at the front, so its tail stops at a stub
  // instead of tapering away.
  const tailR = tailStub !== null ? tailStub : sharp ? 0.40 : cowl ? 0.15 : 0.13;
  const tipR = sharp ? 0.07 : cowl ? 0.66 : 0.21;
  const N = 40;
  const SEG = 16;
  const rings = [];
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;                       // 0 at the nose, 1 at the tail
    let r;
    if (t < noseFrac) {
      const u = t / noseFrac;
      // An ellipse blunted at the tip, so r runs tipR to 1 and still meets the
      // barrel with a horizontal tangent: no crease at the join, no point at
      // the front. A power curve instead gives a fast jet its long nose.
      r = sharp
        ? tipR + (1 - tipR) * u ** 0.75
        : Math.sqrt(Math.max(0, 1 - (1 - u) ** 2 * (1 - tipR * tipR)));
    } else if (t < 1 - tailFrac) {
      r = 1;
    } else {
      const u = (t - (1 - tailFrac)) / tailFrac;
      r = 1 - (1 - tailR) * u ** 1.6;
    }
    const w = Math.max(radius * 0.03, r * radius);
    // The roof carries straight on over the cockpit while the nose narrows
    // away below it. That step is the windscreen, and it is most of what
    // makes a side view read as an aeroplane rather than a torpedo. It is
    // full by the end of the nose and eases off along the tail cone.
    const roof = 1 + crown
      * Math.min(1, t / Math.max(1e-3, noseFrac * 0.85))
      * (1 - Math.min(1, Math.max(0, (t - 0.55) / 0.45)) * 0.55);
    const hTop = w * tallness * roof;
    const hBot = w * tallness;
    // Transports sweep the rear fuselage upwards. This is a Y offset only, so
    // the drawn length and width are untouched.
    const up = t > 1 - tailFrac
      ? tailUp * radius * ((t - (1 - tailFrac)) / tailFrac) ** 2
      : 0;
    const z = (0.5 - t) * len;
    const ring = [];
    for (let s2 = 0; s2 < SEG; s2 += 1) {
      const a = (s2 / SEG) * Math.PI * 2;
      const sa = Math.sin(a);
      ring.push(new THREE.Vector3(
        Math.cos(a) * w, up + sa * (sa >= 0 ? hTop : hBot), z));
    }
    rings.push(ring);
  }
  return loftRings(rings);
}

/** A nacelle: a barrel with an inlet lip at the front and a tapered exhaust. */
function engineNacelleGeometry(podR, podLen) {
  const g = new THREE.BufferGeometry();
  const rings = [];
  const prof = [[0.0, 0.88], [0.08, 1.0], [0.55, 0.98], [1.0, 0.62]];
  for (const [t, k] of prof) {
    const ring = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ring.push(new THREE.Vector3(Math.cos(a) * podR * k, Math.sin(a) * podR * k,
        podLen * (0.5 - t)));
    }
    rings.push(ring);
  }
  return loftRings(rings);
}

/**
 * An aircraft built from its own dimensions.
 *
 * spanM and lengthM are the real figures from the target model. `girth` is the
 * shared width exaggeration; it never touches span or length, so the footprint
 * the aircraft covers is true.
 *
 * `wing` is 'straight', 'swept' or 'delta', carried on the target preset. It
 * decides sweep, taper and where the wing sits on the body, which is most of
 * what makes a light single read as a light single and not as a small airliner.
 *
 * Returns a THREE.Group whose local +Z is the direction of flight.
 */
export function aircraftGeometry(spanM, lengthM, {
  planform = 'wing', wing = 'straight', girth = 1, engines = 0, enginesOn = 'none',
  tailLayout = null,
} = {}) {
  const span = Math.max(0.3, spanM);
  const len = Math.max(0.3, lengthM);
  const g = new THREE.Group();
  const nz = len / 2;
  const semi = span / 2;
  const delta = wing === 'delta';
  const swept = wing === 'swept';
  // Fuselage radius from the real thing. Measured against actual aircraft, the
  // diameter is close to a tenth of the length across the whole range: a 737
  // is 3.76 m on 37.6 m, a 777 is 6.2 m on 63.7 m, a Cessna 172 is about 1.0 m
  // on 8.3 m. Light aircraft are relatively fatter, fast jets slimmer.
  const bodyFrac = delta ? 0.045 : swept ? 0.050 : 0.058;
  const bodyR = Math.min(len * bodyFrac * girth, semi * 0.16);

  if (planform === 'rotor') {
    // A helicopter: cabin, tail boom, fin, tail rotor, and a main rotor drawn
    // as separate blades. The disc it sweeps used to be drawn as a solid
    // cylinder, which read as a flying saucer from every angle.
    const cabinLen = len * 0.52;
    const cabin = new THREE.Mesh(fuselageGeometry(cabinLen, bodyR * 1.35, {
      nose: 'round', tallness: 1.15, crown: 0.22,
    }), null);
    cabin.position.z = nz - cabinLen / 2;
    cabin.userData.part = 'fuselage';
    g.add(cabin);

    const boomLen = len - cabinLen * 0.75;
    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyR * 0.34, bodyR * 0.2, boomLen, 8), null);
    boom.rotation.x = Math.PI / 2;
    boom.position.z = -nz + boomLen / 2;
    boom.userData.part = 'boom';
    g.add(boom);

    const finH = len * 0.13;
    const fin = new THREE.Mesh(panelGeometry({
      semi: finH, rootChord: len * 0.12, tipChord: len * 0.06,
      sweep: finH * 0.5, thick: bodyR * 0.2, side: 1,
    }), null);
    fin.rotation.z = Math.PI / 2;
    fin.position.set(0, bodyR * 0.2, -nz + len * 0.07);
    fin.userData.part = 'fin';
    g.add(fin);

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyR * 0.16, bodyR * 0.22, bodyR * 0.9, 8), null);
    mast.position.set(0, bodyR * 1.6, nz - cabinLen * 0.55);
    mast.userData.part = 'mast';
    g.add(mast);

    const hubY = bodyR * 2.0;
    const hubZ = nz - cabinLen * 0.55;
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI * 2;
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(semi, Math.max(0.03, bodyR * 0.07), span * 0.05), null);
      blade.position.set(Math.cos(a) * semi * 0.5, hubY, hubZ + Math.sin(a) * semi * 0.5);
      blade.rotation.y = -a;
      blade.userData.part = 'rotor';
      g.add(blade);
    }
    const tr = span * 0.17;
    for (let b = 0; b < 2; b++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.03, bodyR * 0.06), tr, span * 0.035), null);
      blade.position.set(bodyR * 0.3, bodyR * 0.2 + (b ? tr : -tr) * 0.5, -nz + len * 0.05);
      blade.userData.part = 'tail-rotor';
      g.add(blade);
    }
    g.userData.spanM = span;
    g.userData.lengthM = len;
    return g;
  }

  // A propeller at the nose or the tail is part of the aircraft's length, so
  // the body is shortened to make room for it rather than the disc being hung
  // off the end where it would make the aircraft longer than the model says.
  let propRadiusM = 0;
  const propAtNose = engines > 0 && enginesOn === 'nose';
  const propAtTail = engines > 0 && enginesOn === 'tail';
  const propLen = (propAtNose || propAtTail) ? len * 0.06 : 0;
  const bodyLen = len - propLen;
  const bodyZ = propAtNose ? -propLen / 2 : propAtTail ? propLen / 2 : 0;

  // A propeller aircraft gets a blunt engine cowl, because that is what is in
  // front of the cabin and it is what the spinner has to meet. With a tapered
  // nose the propeller floated in space ahead of a point.
  const fus = new THREE.Mesh(fuselageGeometry(bodyLen, bodyR, {
    nose: delta ? 'sharp' : propAtNose ? 'cowl' : 'round',
    tailUp: delta ? 0 : propAtTail ? 0.2 : 0.5,
    tailStub: propAtTail ? 0.62 : null,
    // A cabin is taller than it is wide on everything but a fast jet, and most
    // so on a light aircraft, where the occupants sit upright.
    tallness: delta ? 0.90 : swept ? 1.06 : 1.20,
    crown: delta ? 0.08 : swept ? 0.15 : 0.26,
  }), null);
  fus.position.z = bodyZ;
  fus.userData.part = 'fuselage';
  g.add(fus);

  // Wing. The numbers are chords and sweeps taken from the class, not
  // fractions invented to fill the space: a swept transport wing is about a
  // sixth of the length at the root and a quarter of that at the tip, and
  // sweeps back about half a semi-span, which is 27 degrees.
  // `le` is the LEADING-EDGE sweep as a fraction of the semi-span, which is
  // the tangent of the angle everybody quotes: 0.51 is the 27 degrees of an
  // A320, 1.33 the 53 degrees of a Typhoon, 0.06 the couple of degrees of a
  // Cessna. The centre offset panelGeometry actually wants is derived from it.
  //
  // y: a low-wing transport carries its wing box at the BOTTOM of the
  // fuselage. It was at -0.45 body radii, which on an A320 put the wing centre
  // 0.22 m below a centreline in a body 4.28 m deep, so it looked mid-mounted.
  const wingSpec = delta
    ? { root: len * 0.50, taper: 0.10, le: 1.33, dihedral: 0, y: 0, z: -len * 0.06 }
    : swept
      ? { root: len * 0.17, taper: 0.26, le: 0.51, dihedral: semi * 0.07,
        y: -bodyR * 0.80, z: -len * 0.02 }
      : { root: len * 0.165, taper: 0.68, le: 0.06, dihedral: semi * 0.05,
        y: bodyR * 0.35, z: len * 0.08 };
  wingSpec.sweep = sweepFromLeadingEdge(
    semi * wingSpec.le, wingSpec.root, wingSpec.root * wingSpec.taper);
  // Same overhang rule as the tail surfaces, and for the same reason: sweep
  // moves the whole tip section aft, so a big enough sweep carries the tip
  // trailing edge past the tail. On a delta the sweep is a full semi-span, and
  // on the widest-span delta in the table that put the wing 0.28 m behind the
  // tail. It only showed up once the harness checked every preset rather than
  // the eight it draws.
  const tipChord = wingSpec.root * wingSpec.taper;
  wingSpec.sweep = Math.min(wingSpec.sweep,
    Math.max(0, wingSpec.z + nz - tipChord / 2));
  const wingThick = Math.max(len * 0.004, wingSpec.root * 0.09 * Math.min(girth, 3));
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(panelGeometry({
      semi, rootChord: wingSpec.root, tipChord,
      sweep: wingSpec.sweep, dihedral: wingSpec.dihedral, thick: wingThick, side,
    }), null);
    panel.position.set(0, wingSpec.y, wingSpec.z);
    panel.userData.part = 'wing';
    g.add(panel);
  }

  // Fin, sized so its TIP reaches the height a real one does above the
  // fuselage centreline: about a quarter of the length on an airliner, less on
  // a light aircraft. Sizing the panel itself rather than the tip was the
  // second half of the missing-tail problem: with a fat body the panel was
  // shorter than the fuselage radius and sat entirely inside it.
  const finTipFrac = delta ? 0.22 : swept ? 0.24 : 0.20;
  const finH = Math.max(len * 0.07, len * finTipFrac - bodyR * 0.35);
  // The root chord is about the fin's own height on a real aeroplane, which is
  // what gives the leading edge room to sweep while the trailing edge stays
  // near vertical.
  const finRoot = finH * (swept ? 0.85 : 0.75);
  const finTip = finRoot * (swept ? 0.40 : 0.35);
  const finThick = Math.max(len * 0.004, finRoot * 0.07 * Math.min(girth, 3));
  // Leading-edge sweep, as a fraction of the fin's own height: 0.82 is the
  // 39 degrees of a transport fin, 0.47 the 25 degrees of a light aircraft.
  const finSweep = sweepFromLeadingEdge(
    finH * (delta ? 1.10 : swept ? 0.82 : 0.47), finRoot, finTip);
  // Sweep moves the WHOLE tip section aft in this panel model, so an
  // unplaced panel carries its tip trailing edge past the tail: the fast jet
  // came out 17.4 m long against a 15.6 m model and the verifier caught it.
  // The first fix capped the sweep at half the taper, which stopped the
  // overhang but held an airliner fin to 14 degrees, so it read as a blade
  // stuck on the spine. Placing the panel by whichever of its root and tip is
  // actually rearmost fixes the overhang without touching the sweep.
  const finZ = -nz + Math.max(finRoot / 2, finSweep + finTip / 2);
  const fin = new THREE.Mesh(panelGeometry({
    semi: finH, rootChord: finRoot, tipChord: finTip,
    sweep: finSweep, dihedral: 0, thick: finThick, side: 1,
  }), null);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, bodyR * 0.35, finZ);
  fin.userData.part = 'fin';
  g.add(fin);

  // Dorsal fillet: the fairing that runs forward along the spine from the base
  // of the fin. Every transport and most light aircraft have one, and without
  // it the fin looks like a blade pushed into the body as an afterthought,
  // which is exactly how it looked. It is a small triangle and it is one of
  // the cheapest things that reads as aircraft.
  if (!delta) {
    const filletLen = Math.min(len * 0.15, (bodyLen * 0.5) - finRoot);
    if (filletLen > len * 0.02) {
      const fillet = new THREE.Mesh(panelGeometry({
        semi: finH * 0.30,
        rootChord: filletLen,
        tipChord: filletLen * 0.22,
        // Enough sweep to put the tip back at the fin's leading edge, so the
        // two meet instead of leaving a notch.
        sweep: filletLen * 0.40,
        dihedral: 0,
        thick: finThick * 0.9,
        side: 1,
      }), null);
      fillet.rotation.z = Math.PI / 2;
      // Its root TRAILING edge sits at the fin's root leading edge.
      fillet.position.set(0, bodyR * 0.35, finZ + finRoot / 2 + filletLen / 2);
      fillet.userData.part = 'fillet';
      g.add(fillet);
    }
  }

  // Tailplane. On an aircraft with rear-fuselage engines it goes on top of the
  // fin, because that is where it goes and a T-tail is the clearest way to
  // tell a business jet from an airliner at a glance.
  // Tail layout is a property of the AIRFRAME, not of where its engines are.
  // Inferring a T-tail from rear-mounted engines drew the ATR 72 and the A400M
  // with their tailplanes on the tail cone at 0.4 m when both are T-tails with
  // the fin tip at 5.4 m. A delta gets foreplanes ahead of the wing instead:
  // the Typhoon was drawn with a 3.3 m tailplane it does not have.
  const tail = tailLayout || (enginesOn === 'rear' ? 't' : delta ? 'canard' : 'low');
  const tTail = tail === 't';
  const canard = tail === 'canard';
  // Span, against the real thing: an A320 tailplane is 12.4 m on a 35.8 m
  // wing, a Cessna 3.4 m on 11.0 m. It was 0.40 of the span, which is both.
  const tailSemi = semi * (canard ? 0.45 : 0.34);
  const tailRoot = wingSpec.root * (canard ? 0.38 : 0.58);
  const tailTip = tailRoot * 0.5;
  const tailSweep = sweepFromLeadingEdge(
    tailSemi * (swept || canard ? 0.55 : 0.09), tailRoot, tailTip);
  const tailThick = Math.max(len * 0.004, tailRoot * 0.09 * Math.min(girth, 3));
  // Same placement rule as the fin. A T-tail rides the fin tip, but never far
  // enough aft to overhang the fuselage.
  const tailAft = Math.max(tailRoot / 2, tailSweep + tailTip / 2);
  const tailZ = canard
    // Ahead of the wing leading edge, where a foreplane goes.
    ? Math.min(nz - tailRoot * 0.6, wingSpec.z + wingSpec.root / 2 + tailRoot * 0.9)
    : tTail
      ? Math.max(finZ - finSweep, -nz + tailAft)
      : -nz + tailAft;
  const tailY = tTail ? bodyR * 0.35 + finH : canard ? bodyR * 0.55 : bodyR * 0.3;
  for (const side of [-1, 1]) {
    const tp = new THREE.Mesh(panelGeometry({
      semi: tailSemi, rootChord: tailRoot, tipChord: tailTip,
      sweep: tailSweep, dihedral: 0, thick: tailThick, side,
    }), null);
    tp.position.set(0, tailY, tailZ);
    tp.userData.part = 'tailplane';
    g.add(tp);
  }

  // Engines. Nacelles are the strongest cue that something is an airliner
  // rather than a dart, which is the whole reason for drawing them. Every one
  // sits INSIDE the span and length the model carries.
  const podR = Math.min(len * 0.030, semi * 0.10) * Math.min(Math.max(1, girth * 0.6), 2.5);
  const podLen = len * 0.105;
  // A turboprop hangs its engines off the wing like a jet does, but what is on
  // the front is a propeller, and drawing it with a jet nacelle was why an
  // ATR read as a small airliner. 'wing-prop' is the same placement with a
  // spinner and blades in front and the nacelle set INTO the wing rather than
  // slung under it, which is where a turboprop nacelle actually sits.
  const wingProp = enginesOn === 'wing-prop';
  if (engines > 0 && (enginesOn === 'wing' || wingProp)) {
    const pairs = Math.max(1, Math.round(engines / 2));
    // Propeller radius from the real thing: an ATR 72 turns a 3.9 m disc on a
    // 27.2 m airframe, an A400M a 5.3 m disc on 45.1 m.
    const propR = wingProp ? Math.min(len * 0.065, semi * 0.28) : 0;
    if (wingProp) propRadiusM = propR;
    for (let e = 0; e < pairs; e++) {
      const frac = pairs === 1 ? 0.34 : 0.28 + e * 0.29;
      // Furthest out an engine may sit and still be inside the wingtip, with
      // the propeller disc counted when there is one.
      const clear = Math.max(podR * 1.1, propR);
      const x = Math.min(semi * frac, Math.max(0, semi - clear));
      const k = x / semi;
      const chord = wingSpec.root * (1 + (wingSpec.taper - 1) * k);
      const leZ = wingSpec.z - wingSpec.sweep * k + chord * 0.5;
      const y = wingProp
        ? wingSpec.y + wingSpec.dihedral * k
        : wingSpec.y + wingSpec.dihedral * k - wingThick * 0.5 - podR * 0.95;
      for (const side of [-1, 1]) {
        // A turboprop nacelle is long and straddles the wing, because the
        // main gear folds into the back of it. Sitting it wholly ahead of the
        // leading edge made the pair read as horns.
        const nacLen = wingProp ? podLen * 1.45 : podLen;
        const pod = new THREE.Mesh(engineNacelleGeometry(podR, nacLen), null);
        pod.position.set(side * x, y, leZ + podLen * (wingProp ? 0.20 : 0.16));
        pod.userData.part = 'engine';
        g.add(pod);
        if (!wingProp) {
          const pylon = new THREE.Mesh(new THREE.BoxGeometry(
            Math.max(0.02, podR * 0.22), podR * 1.1, podLen * 0.5), null);
          pylon.position.set(side * x, y + podR * 0.8, leZ - podLen * 0.06);
          pylon.userData.part = 'pylon';
          g.add(pylon);
          continue;
        }
        const hubZ = leZ + podLen * 0.20 + nacLen * 0.5;
        const spinner = new THREE.Mesh(
          new THREE.ConeGeometry(podR * 0.55, podLen * 0.45, 10), null);
        spinner.rotation.x = Math.PI / 2;
        spinner.position.set(side * x, y, hubZ + podLen * 0.22);
        spinner.userData.part = 'spinner';
        g.add(spinner);
        // Four blades: what a modern turboprop of this size turns, and enough
        // to read as a disc rather than a pair of sticks.
        for (let b = 0; b < 4; b += 1) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(
            propR * 2, Math.max(0.03, podR * 0.20), Math.max(0.03, podLen * 0.14)), null);
          blade.position.set(side * x, y, hubZ);
          blade.rotation.z = (b / 4) * Math.PI + Math.PI / 8;
          blade.userData.part = 'propeller';
          g.add(blade);
        }
      }
    }
  } else if (engines > 0 && enginesOn === 'rear') {
    for (const side of [-1, 1]) {
      const x = Math.min(bodyR + podR * 0.95, Math.max(0, semi - podR * 1.1));
      const pod = new THREE.Mesh(engineNacelleGeometry(podR, podLen), null);
      pod.position.set(side * x, bodyR * 0.3, -len * 0.24);
      pod.userData.part = 'engine';
      g.add(pod);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(
        podR * 1.2, Math.max(0.02, podR * 0.3), podLen * 0.45), null);
      pylon.position.set(side * x * 0.55, bodyR * 0.3, -len * 0.24);
      pylon.userData.part = 'pylon';
      g.add(pylon);
    }
  } else if (engines > 0 && enginesOn === 'buried') {
    // A fast jet has no pods. Wing-root intakes and an exhaust at the tail are
    // what there is to draw.
    for (const side of [-1, 1]) {
      const intake = new THREE.Mesh(
        new THREE.BoxGeometry(bodyR * 0.55, bodyR * 0.9, len * 0.2), null);
      intake.position.set(side * bodyR * 1.05, -bodyR * 0.15, -len * 0.02);
      intake.userData.part = 'intake';
      g.add(intake);
    }
    const jet = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyR * 0.5, bodyR * 0.42, len * 0.06, 10), null);
    jet.rotation.x = Math.PI / 2;
    jet.position.z = -nz + len * 0.03;
    jet.userData.part = 'exhaust';
    g.add(jet);
  }

  // A propeller, drawn as blades and a spinner rather than a solid disc. The
  // disc version looked like a lollipop stuck on the nose at close range.
  //
  // The spinner has to sit ON the cowl. It used to be a thin cone of 0.42 body
  // radii centred half a spinner-length ahead of a nose that tapered almost to
  // a point, so on a light single there was visible daylight between the
  // aircraft and its propeller and the blades read as a detached dart.
  if (propAtNose || propAtTail) {
    const dir = propAtNose ? 1 : -1;
    const propR = Math.min(len * 0.115, semi * 0.75);
    propRadiusM = propR;
    // Where the body actually ends on this side, so the spinner starts there.
    const faceZ = nz - propLen;
    const spinner = new THREE.Mesh(
      new THREE.ConeGeometry(bodyR * 0.62, propLen, 12), null);
    spinner.rotation.x = dir * Math.PI / 2;
    spinner.position.z = dir * (faceZ + propLen * 0.5);
    spinner.userData.part = 'spinner';
    g.add(spinner);
    // Blades at the spinner's base, which is the plane a real propeller turns
    // in, not halfway up its nose cone.
    const hubZ = dir * (faceZ + propLen * 0.18);
    const blades = engines >= 2 ? 3 : 2;
    for (let b = 0; b < blades; b += 1) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(
        propR * 2, Math.max(0.03, bodyR * 0.12), Math.max(0.03, propLen * 0.30)), null);
      blade.position.z = hubZ;
      // Offset zero, so a two-blade propeller lies along X and the drawn disc
      // is its true diameter. At 30 degrees the pair measured cos 30 of the
      // radius: 1.68 m across on a Cessna whose propeller is 1.91 m.
      blade.rotation.z = (b / blades) * Math.PI;
      blade.userData.part = 'propeller';
      g.add(blade);
    }
  }

  g.userData.spanM = span;
  g.userData.lengthM = len;
  // What the surfaces were actually built from, so a check can test the
  // PARAMETERS and not only the bounding boxes they happen to produce. A
  // bounding box cannot tell a correct centre-line offset from a leading-edge
  // figure used in its place, which is the mistake that made every lifting
  // surface on every class read as a dart.
  g.userData.surfaces = {
    wing: { semi, root: wingSpec.root, tip: tipChord,
      le: semi * wingSpec.le, sweep: wingSpec.sweep },
    fin: { semi: finH, root: finRoot, tip: finTip,
      le: finH * (delta ? 1.10 : swept ? 0.82 : 0.47), sweep: finSweep },
    tail: { semi: tailSemi, root: tailRoot, tip: tailTip,
      le: tailSemi * (swept || canard ? 0.55 : 0.09), sweep: tailSweep },
  };
  g.userData.tailLayout = tail;
  g.userData.propRadiusM = propRadiusM;
  return g;
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
// Tilt and prebend, the two shape features every machine of this class has and
// the drawing had neither. Both are DRAWING ONLY: the analysis takes hub
// height, rotor radius, chord and rpm from the model and never reads the mesh,
// so changing these moves no result.
const SHAFT_TILT_DEG = 5;
const BLADE_PREBEND_F = 0.035;

const BLADE_STATIONS = [0.00, 0.04, 0.10, 0.18, 0.30, 0.45, 0.62, 0.78, 0.90, 0.97, 1.00];
const BLADE_CHORD_F  = [0.66, 0.70, 0.96, 1.00, 0.84, 0.66, 0.50, 0.36, 0.25, 0.13, 0.04];
const BLADE_TWIST_D  = [16.0, 15.2, 13.0, 10.0, 6.2, 3.4, 1.8, 0.8, 0.3, 0.05, 0.0];
const BLADE_TC       = [1.00, 0.95, 0.50, 0.36, 0.27, 0.22, 0.19, 0.17, 0.155, 0.15, 0.15];

export function bladeGeometry(spanM, maxChordM, { prebendM = 0 } = {}) {
  const rings = BLADE_STATIONS.map((st, i) => {
    const ring = aerofoilRing(
      st * spanM,
      Math.max(maxChordM * BLADE_CHORD_F[i], maxChordM * 0.03),
      BLADE_TC[i],
      BLADE_TWIST_D[i] * DEG,
    );
    // Prebend: a modern blade is built curved UPWIND so the tip still clears
    // the tower once it flexes downwind under load. It is specified as a tip
    // offset and is very close to quadratic in span. The blade was drawn dead
    // flat, which is a shape no machine of this size is built in.
    if (prebendM) {
      const dz = prebendM * st * st;
      for (const v of ring) v.z += dz;
    }
    return ring;
  });
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


/**
 * One turbine at TRUE dimensions: tower, nacelle, spinner and blades, with
 * every part named in userData.part. The caller assigns materials, scales the
 * finished group and hangs the pick proxy off it.
 *
 * This is shared with the harness on purpose. While the assembly lived inline
 * in the scene, a harness could only re-implement it, and a harness that
 * builds the object differently from the application measures a different
 * object: exactly how a preset's tail layout reached the screen unchecked on
 * the aircraft.
 *
 * `girth` multiplies structural WIDTHS only, never a span: not the tower
 * height, not the nacelle length, not the blade length.
 */
export function turbineGeometry(t, { girth = 1, geo = (k, f) => f() } = {}) {
  const g = new THREE.Group();
  const hubY = t.hubHeightM;
  const baseR = (t.towerBaseDiameterM ?? 5) / 2 * girth;
  const topR = (t.towerTopDiameterM ?? 3) / 2 * girth;

  const tower = new THREE.Mesh(geo(`tw:${baseR.toFixed(1)}:${topR.toFixed(1)}:${hubY.toFixed(0)}`,
    () => new THREE.CylinderGeometry(topR, baseR, hubY, 20, 1)), null);
  tower.userData.part = 'tower';
  tower.position.y = hubY / 2;
  g.add(tower);

  const rotor = new THREE.Group();
  rotor.position.y = hubY;
  rotor.rotation.y = (180 - (t.yawDeg ?? 0)) * DEG;
  g.add(rotor);

  // Nacelle length is a span along the rotor axis, so it is NOT widened; its
  // width and height are girths, so they are.
  const nacL = t.nacelleLengthM;
  const nacW = t.nacelleWidthM * girth;
  const nacH = t.nacelleHeightM * girth;
  const nacelle = new THREE.Mesh(geo(`nc:${nacL.toFixed(1)}:${nacW.toFixed(1)}:${nacH.toFixed(1)}`,
    () => nacelleGeometry(nacL, nacW, nacH)), null);
  nacelle.userData.part = 'nacelle';
  rotor.add(nacelle);

  const spinner = new THREE.Group();
  spinner.position.z = nacL * 0.52;
  // Shaft tilt: the rotor axis of a modern machine is tilted up about 5
  // degrees, again for tower clearance. It was drawn exactly horizontal, with
  // the nacelle symmetric about the hub height to the centimetre. The nacelle
  // itself stays level, which is how it looks on the machine.
  spinner.rotation.x = -SHAFT_TILT_DEG * DEG;
  rotor.add(spinner);

  const spinR = t.hubDiameterM / 2 * girth;
  const spinL = t.hubDiameterM * 0.95;   // a span, so left alone
  const nose = new THREE.Mesh(
    geo(`sp:${spinR.toFixed(1)}:${spinL.toFixed(1)}`, () => spinnerGeometry(spinR, spinL)), null);
  nose.userData.part = 'spinner';
  spinner.add(nose);

  const bladeLen = t.rotorRadiusM ?? (t.rotorDiameterM / 2);
  const chord = (t.bladeChordM ?? 3) * girth;
  // Prebend of about 3.5% of the blade length at the tip, which is the order
  // quoted for machines of this class.
  const prebend = bladeLen * BLADE_PREBEND_F;
  const bladeGeo = geo(`bl:${bladeLen.toFixed(0)}:${chord.toFixed(1)}:${prebend.toFixed(1)}`,
    () => bladeGeometry(bladeLen, chord, { prebendM: prebend }));
  for (let b = 0; b < t.bladeCount; b += 1) {
    const blade = new THREE.Mesh(bladeGeo, null);
    blade.userData.part = 'blade';
    blade.position.y = spinR * 0.5;
    const arm = new THREE.Group();
    arm.rotation.z = (b / t.bladeCount) * Math.PI * 2;
    arm.add(blade);
    spinner.add(arm);
  }

  g.userData.spinner = spinner;
  g.userData.hubHeightM = hubY;
  g.userData.rotorRadiusM = bladeLen;
  g.userData.bladeChordM = chord;
  g.userData.shaftTiltDeg = SHAFT_TILT_DEG;
  g.userData.prebendM = prebend;
  return g;
}


/**
 * The antenna aperture a radar's own numbers imply.
 *
 * This is not a recalled dimension, it is the standard aperture-beamwidth
 * relation: a uniformly illuminated aperture W wide gives a half-power
 * beamwidth of about 51*lambda/W degrees, and a real tapered illumination
 * widens that to roughly 65 to 70. Taking 70 and inverting it:
 *
 *   W = 70 * lambda / azimuth beamwidth
 *   H = 70 * lambda / elevation beamwidth
 *
 * For the en-route L-band preset, 1.3 GHz and 1.3 degrees azimuth, that is a
 * 12.4 m wide reflector, which is the size an L-band en-route PSR antenna
 * actually is. The drawing used to take its width from the SCENE extent
 * instead, so the same radar came out a different size in a 10 km view and a
 * 40 km view, and neither was a real size.
 */
export function antennaApertureM(radar, taper = 70) {
  const lambda = 299792458 / Math.max(1, radar.freqHz || 3e9);
  const w = taper * lambda / Math.max(0.05, radar.azBeamwidthDeg || 1.5);
  let h = taper * lambda / Math.max(0.05, radar.elBeamwidthDeg || 5);
  // A cosecant-squared antenna is PHYSICALLY TALLER than its half-power
  // elevation beamwidth implies, because the shaped part of the aperture
  // forms the high-angle fill and contributes almost nothing to the main
  // lobe. Inverting the beamwidth alone gave 1.56 m for the S-band terminal
  // preset, against about 2.7 to 3 m for the real antenna.
  //
  // The 1.8 is EMPIRICAL, not derived: it is the ratio that puts the S-band
  // terminal and L-band en-route cases on their real heights, and it is
  // applied only where the model says the radar is shaped at all. A pencil
  // beam, like the weather preset, keeps the beamwidth figure.
  const shaped = (radar.cscMaxDeg || 0) > Math.max(4, (radar.elBeamwidthDeg || 5));
  if (shaped) h *= 1.8;
  return { widthM: w, heightM: h, lambdaM: lambda, cscShaped: shaped };
}

/**
 * A parabolic reflector: a curved sheet, not a flat plate, with a feed at the
 * focus and a back strut. Width and height are the real aperture; the dish is
 * a section of a paraboloid whose focal length is 0.4 of the width, which is
 * a normal f/D for a surveillance antenna.
 */
export function reflectorGeometry(widthM, heightM, { cols = 14, rows = 8 } = {}) {
  const f = widthM * 0.4;
  const rings = [];
  // One "ring" per column, running bottom to top, so loftRings sews a sheet.
  for (let c = 0; c <= cols; c += 1) {
    const x = (c / cols - 0.5) * widthM;
    const ring = [];
    for (let rI = 0; rI <= rows; rI += 1) {
      const y = (rI / rows - 0.5) * heightM;
      // Depth of a paraboloid at (x, y), measured back from the rim plane.
      const z = -(x * x + y * y) / (4 * f);
      ring.push(new THREE.Vector3(x, y, z));
    }
    rings.push(ring);
  }
  const verts = [];
  for (const ring of rings) for (const p of ring) verts.push(p.x, p.y, p.z);
  const n = rows + 1;
  const idx = [];
  for (let c = 0; c < cols; c += 1) {
    for (let rI = 0; rI < rows; rI += 1) {
      const a = c * n + rI;
      const b = (c + 1) * n + rI;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * One radar installation at TRUE dimensions: structure, mast and antenna, with
 * every part named in userData.part. The caller assigns materials and scales.
 *
 * Shared with the harness for the same reason turbineGeometry is: a harness
 * that builds the object differently from the application measures a different
 * object.
 *
 * `girth` multiplies structural WIDTHS only. Heights come from the model and
 * nothing here changes the antenna height, which is the whole of what the
 * propagation maths takes from the mounting.
 */
export function radarGeometry(radar, { girth = 1, vExag = 1 } = {}) {
  const g = new THREE.Group();
  const mount = radar.mount || {};
  const ap = antennaApertureM(radar);
  // heightAgl is the ANTENNA height, which is where the phase centre sits and
  // is the only thing the propagation maths takes from the mounting. So the
  // steelwork has to stop half an aperture BELOW it. It used to run the full
  // height, so the mast came out through the middle of the dish: on the
  // terminal preset the mast top was at 12.00 m inside a reflector spanning
  // 11.16 to 12.78 m.
  const hAnt = radar.heightAgl * vExag;
  // Tower and mast widths scale off the ANTENNA, which is the one real
  // dimension the installation has: a mast is a little narrower than the dish
  // it carries. They used to come from the scene extent.
  const towerR = ap.widthM * 0.10 * girth;

  // Build the reflector FIRST and measure it, because how far below the
  // antenna the steelwork has to stop depends on the dish's tilt and its
  // curvature, not just on the nominal aperture height. Half the aperture is
  // not enough: a tilted dish drops its lower rim by the depth times the sine
  // of the tilt, and on the marine preset that 2 cm was the difference between
  // a clean mast and one poking through the array.
  const w = ap.widthM * girth;
  const h = ap.heightM * girth;
  const dish = new THREE.Mesh(reflectorGeometry(w, h), null);
  // `?? 3`, not `|| 3`. A radar with a genuine zero elevation peak, like the
  // marine preset, was being tilted 3 degrees by a falsy-zero default.
  dish.rotation.x = -(radar.elPeakDeg ?? 3) * DEG;
  dish.userData.part = 'reflector';
  dish.updateMatrixWorld(true);
  const dishBox = new THREE.Box3().setFromObject(dish);
  const hTower = Math.max(0, hAnt + dishBox.min.y - h * 0.08);

  if (mount.lattice) {
    const hStruct = Math.max(0, mount.structureHeightM || 0) * vExag;
    const hMast = Math.max(hTower - hStruct, 0);
    const tw = latticeTowerGeometry(hStruct, towerR * 2.6, towerR * 1.5);
    tw.traverse((m) => { if (m.isMesh) m.userData.part = 'structure'; });
    g.add(tw);
    if (hMast > 0) {
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(towerR * 0.55, towerR * 0.75, hMast, 8), null);
      pedestal.position.y = hStruct + hMast / 2;
      pedestal.userData.part = 'mast';
      g.add(pedestal);
    }
  } else {
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(towerR * 0.7, towerR, hTower, 10), null);
    tower.position.y = hTower / 2;
    tower.userData.part = 'mast';
    g.add(tower);
    if (mount.type === 'building' && mount.structureHeightM > 0) {
      // A building is not a mast. Drawing it as one hid the fact that most of
      // the antenna height on a rooftop site is the building.
      const hB = mount.structureHeightM * vExag;
      const bw = ap.widthM * 2.6;
      const bld = new THREE.Mesh(new THREE.BoxGeometry(bw, hB, bw * 0.75), null);
      bld.position.y = hB / 2;
      bld.userData.part = 'building';
      g.add(bld);
    }
  }

  // The rotating head.
  const ant = new THREE.Group();
  ant.position.y = hAnt;
  // A surveillance reflector is tilted back so the beam points up a few
  // degrees. It was drawn bolt upright, and flat.
  ant.add(dish);

  // The feed, at the focus, on a strut. Without it the dish reads as a plate.
  const feed = new THREE.Mesh(new THREE.ConeGeometry(w * 0.05, w * 0.11, 10), null);
  feed.rotation.x = -Math.PI / 2;
  feed.position.set(0, 0, w * 0.40);
  feed.userData.part = 'feed';
  ant.add(feed);
  const strut = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.02, w * 0.02, w * 0.40), null);
  strut.position.set(0, 0, w * 0.20);
  strut.userData.part = 'strut';
  ant.add(strut);

  g.userData.antenna = ant;
  g.userData.apertureM = ap;
  g.userData.towerRadiusM = towerR;
  g.add(ant);
  return g;
}

/**
 * A steel lattice tower: four battered legs, horizontal belts, diagonal
 * bracing between the belts, a platform at the top and a caged ladder up one
 * face. Every member is a thin box, so a whole tower is about 300 triangles.
 *
 * `baseW` and `topW` are the widths across the legs at the ground and at the
 * platform. Real towers batter inwards at roughly one in twelve, so the top is
 * narrower than the base; the caller sets both.
 *
 * This changes only what is drawn. The antenna height above ground is the
 * whole of what the propagation maths takes from the mounting, and it is the
 * same number whether the structure under it is an open lattice or a tube.
 */
export function latticeTowerGeometry(height, baseW, topW, { bays = 0, memberW = 0 } = {}) {
  const g = new THREE.Group();
  const h = Math.max(1, height);
  const nBays = bays || Math.max(3, Math.min(12, Math.round(h / (baseW * 1.15))));
  const mW = memberW || Math.max(baseW * 0.05, h * 0.004);
  const bayH = h / nBays;
  const halfAt = (y) => (baseW + (topW - baseW) * (y / h)) / 2;
  const corner = (i, y) => {
    const hw = halfAt(y);
    return new THREE.Vector3(i & 1 ? hw : -hw, y, i & 2 ? hw : -hw);
  };
  // A member drawn as a thin box stretched between two points.
  const member = (a, b, w) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, w, d.length()), null);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.lookAt(b);
    m.userData.part = 'member';
    g.add(m);
    return m;
  };

  for (let i = 0; i < 4; i++) {
    // Legs, one straight run each so the batter is a single clean line.
    member(corner(i, 0), corner(i, h), mW);
  }
  for (let b = 1; b <= nBays; b++) {
    const y = b * bayH;
    const y0 = (b - 1) * bayH;
    for (let i = 0; i < 4; i++) {
      // Belt round the tower at the top of each bay.
      const j = [1, 3, 2, 0][i];
      member(corner(i, y), corner(j, y), mW * 0.8);
      // One diagonal per face per bay, alternating direction up the tower so
      // the bracing zig-zags the way a real tower's does.
      const up = (b % 2) === 0;
      member(corner(up ? i : j, y0), corner(up ? j : i, y), mW * 0.7);
    }
  }

  // Platform at the top: a thin deck and a handrail.
  const topHalf = halfAt(h);
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(topHalf * 2.5, mW * 1.2, topHalf * 2.5), null);
  deck.position.y = h;
  deck.userData.part = 'platform';
  g.add(deck);
  const railH = Math.max(bayH * 0.25, h * 0.02);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(
      dx ? mW * 0.7 : topHalf * 2.5, mW * 0.7, dz ? mW * 0.7 : topHalf * 2.5), null);
    rail.position.set(dx * topHalf * 1.25, h + railH, dz * topHalf * 1.25);
    rail.userData.part = 'handrail';
    g.add(rail);
  }
  for (let i = 0; i < 4; i++) {
    const p = corner(i, h);
    const post = new THREE.Mesh(new THREE.BoxGeometry(mW * 0.7, railH, mW * 0.7), null);
    post.position.set(p.x * 1.25, h + railH / 2, p.z * 1.25);
    post.userData.part = 'handrail';
    g.add(post);
  }

  // Caged ladder up one face, outboard of the legs as it is on a real tower.
  // Drawn as two stringers and a few rungs rather than one slab: a solid panel
  // up the front closed the tower in and lost the open lattice that is the
  // whole point of drawing it differently from a tube.
  const ladZ = (baseW + topW) / 4 + mW * 1.5;
  const ladW = Math.min(baseW * 0.12, mW * 3);
  for (const sx of [-1, 1]) {
    const stringer = new THREE.Mesh(
      new THREE.BoxGeometry(mW * 0.6, h, mW * 0.6), null);
    stringer.position.set(sx * ladW / 2, h / 2, ladZ);
    stringer.userData.part = 'ladder';
    g.add(stringer);
  }
  const rungs = Math.max(4, Math.min(30, Math.round(h / (mW * 9))));
  for (let i = 1; i < rungs; i++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(ladW, mW * 0.4, mW * 0.4), null);
    rung.position.set(0, (i / rungs) * h, ladZ);
    rung.userData.part = 'ladder';
    g.add(rung);
  }

  g.userData.heightM = h;
  return g;
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
    // Deliberately NOT the clear colour. Fogging distant ground to the same
    // near-black as the sky erases the horizon; a slightly lifted blue-grey
    // leaves a haze band where the ground ends, which is what gives the view
    // its sense of distance.
    this.scene.fog = new THREE.Fog(0x0b131a, 30000, 140000);

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

    this.scene.add(new THREE.HemisphereLight(0x8ea6ba, 0x1d241d, 1.05));
    // Pulled back from 1.35: the terrain now carries its own baked hillshade,
    // and two shading terms multiplied together blew out the lit slopes.
    const sun = new THREE.DirectionalLight(0xfff0dc, 0.95);
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

    // Normals are recomputed whenever the mesh is rebuilt, so they already
    // carry the vertical exaggeration the view is drawn at. That is what we
    // want: the relief you see shaded is the relief you see in silhouette.
    const nrm = geo.attributes.normal;
    const [sx, sy, sz] = SHADE_SUN;
    const relief = mode !== 'coverage' && mode !== 'delta';

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
      if (relief) {
        const lambert = nrm.getX(i) * sx + nrm.getY(i) * sy + nrm.getZ(i) * sz;
        c.multiplyScalar(Math.min(1, SHADE_FLOOR + SHADE_GAIN * Math.max(lambert, 0)));
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

    const steel = new THREE.MeshStandardMaterial({
      color: 0xa9b6c0, roughness: 0.6, metalness: 0.3,
    });
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8ec, roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide,
    });
    const bldMat = new THREE.MeshStandardMaterial({ color: 0x8b95a0, roughness: 0.85 });
    // The structure follows the same girth exaggeration as the turbines. At a
    // 40 km scene the whole installation is about fourteen pixels across, so
    // at girth x1 it is correct and invisible; the slider is what makes it
    // readable. Widths only: heights go through the vertical exaggeration and
    // nothing here changes the antenna height.
    const installation = radarGeometry(r.radar, {
      girth: Math.min(this.girthExag || 1, 6),
      vExag: this.vExag,
    });
    installation.traverse((m) => {
      if (!m.isMesh) return;
      const part = m.userData.part;
      m.material = part === 'reflector' ? dishMat : part === 'building' ? bldMat : steel;
    });
    for (const child of [...installation.children]) g.add(child);
    const ant = installation.userData.antenna;
    const w = installation.userData.apertureM.widthM
      * Math.min(this.girthExag || 1, 6);
    const towerR = installation.userData.towerRadiusM;
    // The rotation marker, which is what makes the sweep readable at a glance.
    ant.add(new THREE.Mesh(
      new THREE.SphereGeometry(w * 0.05, 8, 6),
      new THREE.MeshStandardMaterial({ color: COLORS.rf, emissive: COLORS.rf, emissiveIntensity: 0.6 }),
    ));
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

      // THE WHOLE MACHINE IS SCALED, NOT ITS HEIGHT ALONE.
      //
      // Two earlier attempts were both wrong. Scaling only the height made the
      // rotor an ellipse and the three identical blades look different lengths.
      // Drawing the rotor true while the tower stayed exaggerated made the
      // blades look far too short, which is just as misleading: a 4.5 MW
      // machine has a rotor WIDER than its hub height, so a correct turbine is
      // mostly rotor.
      //
      // So the turbine is built at true dimensions and the whole group is
      // scaled uniformly at the end. The silhouette is then correct, the rotor
      // is circular, and the spacing BETWEEN machines is untouched, because
      // positions are not scaled. Each machine is drawn larger than life; the
      // farm layout is true.
      const hubY = t.hubHeightM;
      // Girth is a factor on the finished picture, so divide out the group
      // scale the whole turbine is about to get. A girth of 5 then means
      // structural widths are 5 times true on screen, which is what it says.
      const tGirth = girth / this.vExag;
      const towerMat = new THREE.MeshStandardMaterial({
        color: COLORS.tower, roughness: 0.55, metalness: 0.15,
        emissive: colour, emissiveIntensity: 0.22,
      });
      const nacelleMat = new THREE.MeshStandardMaterial({
        color: 0xe6ebee, roughness: 0.5, metalness: 0.2,
      });
      const spinnerMat = new THREE.MeshStandardMaterial({
        color: 0xeef2f5, roughness: 0.45, metalness: 0.1,
      });
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0xf2f5f7, roughness: 0.4, metalness: 0.05,
        emissive: colour, emissiveIntensity: 0.3,
      });

      // THE ROTOR IS NOT EXAGGERATED, AND MUST NOT BE.
      //
      // It used to carry spinner.scale.y = vExag, so that the drawn tip height
      // lined up with the exaggerated tower. The cost was that a blade pointing
      // straight up was drawn four times longer than one pointing sideways: the
      // rotor became a tall ellipse and the three identical blades looked like
      // three different blades. It also made the on-screen claim that geometry
      // is preserved untrue, and it misrepresented the swept area, which is the
      // thing being assessed.
      //
      // So the tower height is exaggerated and the rotor is drawn true. The
      // readout says both, because a viewer cannot infer it from the picture.
      const machine = turbineGeometry(t, { girth: tGirth, geo: geoCache });
      machine.traverse((m) => {
        if (!m.isMesh) return;
        const part = m.userData.part;
        m.material = part === 'tower' ? towerMat
          : part === 'nacelle' ? nacelleMat
            : part === 'spinner' ? spinnerMat : bladeMat;
      });
      for (const child of [...machine.children]) g.add(child);
      const spinner = machine.userData.spinner;
      const bladeLen = machine.userData.rotorRadiusM;

      spinner.userData.rpm = tr.rpm;
      spinner.userData.phase = t.phase;
      g.userData.spinner = spinner;

      // Invisible pick proxy, sized generously so hovering is not fiddly.
      const proxyR = Math.max(bladeLen * 0.55, shaftR * 3);
      const proxyH = hubY + bladeLen;   // true dimensions; the group scale handles the rest
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

      // One uniform scale for the finished machine. Position is untouched.
      g.scale.setScalar(this.vExag);
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

    // The aircraft is drawn at its real span and length, then scaled up as a
    // whole so it is visible across a 40 km scene. The scale is uniform, so
    // proportions are true: a widebody is drawn five times the span of a light
    // single because it is five times the span.
    const t = r.scenario.target;
    const span = Number.isFinite(t.spanM) ? t.spanM : 30;
    const length = Number.isFinite(t.lengthM) ? t.lengthM : 32;
    // Drawn well above life size so it can be read at all. A 36 m airliner is
    // a fraction of a pixel across a 40 km scene, and the aircraft is a POINT
    // target in the physics, so enlarging it distorts no result. The factor is
    // stated on screen next to the other exaggerations.
    this.aircraftScale = clamp((this.extent * 0.022) / Math.max(span, 1), 1, 200);
    this.aircraft = aircraftGeometry(span, length, {
      planform: t.planform || 'wing',
      wing: t.wing || 'straight',
      engines: t.engines || 0,
      enginesOn: t.enginesOn || 'none',
      tailLayout: t.tail || null,
      // NO girth exaggeration. The turbines need it because they are drawn at
      // true size and a 5.5 m tower is a quarter of a pixel across a 40 km
      // scene. The aircraft is already scaled up bodily by aircraftScale, so
      // applying girth on top was double-counting: at the factor the tool
      // picks by default, about five, an airliner fuselage came out 15 m
      // across instead of 3.8, four times too fat, and the fin was so far
      // inside it that only 0.6 m of it showed. That is why it had no tail.
    });
    this.aircraft.scale.setScalar(this.aircraftScale);
    const acMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35,
    });
    this.aircraftMaterial = acMat;
    this.aircraft.traverse((m) => { if (m.isMesh) m.material = acMat; });
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
      // The turbine group already carries the vertical exaggeration, so the
      // hover highlight scales relative to that rather than resetting it to 1.
      g.scale.setScalar(this.vExag * (on ? 1.35 : 1));
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
          // aircraftGeometry points along +Z, which is what lookAt aligns, so
          // the extra rotateX the old cone needed is gone.
          this.aircraft.lookAt(pb);
          const st = b.tracked ? b.status : 'lost';
          const hex = b.blanked ? COLORS.info : statusColor(st);
          this.aircraftMaterial.color.setHex(hex);
          this.aircraftMaterial.emissive.setHex(hex);
          this.currentPoint = b;
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
