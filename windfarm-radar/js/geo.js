// Geometry, Earth curvature, terrain and line-of-sight.
//
// Everything works in a local East/Up/North frame centred on the scenario
// origin, in metres. Three.js maps this to x = east, y = up, z = -north.
//
// Curvature is handled with the standard "effective earth radius" trick: real
// heights are lowered by d^2 / (2*a_e) relative to the reference point, after
// which a straight line in the transformed space is a genuine radio ray. The
// same transform is used for the 3D render, so a straight line you can see on
// screen is a straight line the maths agrees with.

export const EARTH_RADIUS_M = 6371008.8; // IUGG mean radius
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const M_PER_NM = 1852;
export const M_PER_FT = 0.3048;

export function effectiveEarthRadius(k) {
  return Math.max(k, 0.1) * EARTH_RADIUS_M;
}

// Height a point at ground distance d appears to drop, referenced to the
// observer's tangent plane.
export function curvatureDrop(d, ae) {
  return (d * d) / (2 * ae);
}

// Distance to the radio horizon for an antenna h metres above the surface.
// Equivalent to the familiar d_km = 4.12 * sqrt(h_m) when k = 4/3.
export function horizonDistance(h, ae) {
  return Math.sqrt(2 * ae * Math.max(h, 0));
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function hypot2(dx, dz) {
  return Math.sqrt(dx * dx + dz * dz);
}

// Bearing in degrees true (0 = north, 90 = east) from origin to a point.
export function bearingOf(east, north) {
  const b = Math.atan2(east, north) * RAD;
  return (b + 360) % 360;
}

export function offsetByBearing(rangeM, bearingDeg) {
  const b = bearingDeg * DEG;
  return { east: rangeM * Math.sin(b), north: rangeM * Math.cos(b) };
}

// Smallest signed difference between two bearings, in degrees (-180..180].
export function angleDelta(a, b) {
  let d = ((a - b + 540) % 360) - 180;
  return d;
}

// ------------------------------------------------------------------ terrain
//
// Deterministic value-noise heightfield. Seeded so a scenario always renders
// and analyses identically, which matters if you are going to export a report
// from it.

function hash2(ix, iz, seed) {
  let h = ix * 374761393 + iz * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

/**
 * Build a terrain sampler.
 *
 * @param {object} cfg
 * @param {number} cfg.relief      peak-to-trough relief in metres
 * @param {number} cfg.featureSize horizontal scale of the main landform, metres
 * @param {number} cfg.seed        integer seed
 * @param {number} cfg.baseHeight  height of the flat datum, metres AMSL
 * @param {object} [cfg.ridge]     optional screening ridge
 *        {enabled, east, north, bearingDeg, height, halfWidth, length}
 */
export function createTerrain(cfg) {
  const relief = Math.max(0, cfg.relief || 0);
  const scale = Math.max(200, cfg.featureSize || 4000);
  const seed = (cfg.seed | 0) || 1;
  const base = cfg.baseHeight || 0;
  const ridge = cfg.ridge && cfg.ridge.enabled ? cfg.ridge : null;

  function noiseHeight(east, north) {
    if (relief <= 0) return 0;
    const x = east / scale;
    const z = north / scale;
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let o = 0; o < 4; o++) {
      sum += amp * valueNoise(x * freq, z * freq, seed + o * 101);
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return (sum / norm - 0.45) * relief;
  }

  function ridgeHeight(east, north) {
    if (!ridge) return 0;
    // Distance from the ridge centreline, and along it.
    const b = (ridge.bearingDeg || 90) * DEG;
    const ux = Math.sin(b);
    const uz = Math.cos(b); // along-ridge unit vector (east, north)
    const dx = east - ridge.east;
    const dz = north - ridge.north;
    const along = dx * ux + dz * uz;
    const across = -dx * uz + dz * ux;
    const halfLen = Math.max(1, (ridge.length || 8000) / 2);
    if (Math.abs(along) > halfLen) return 0;
    const hw = Math.max(50, ridge.halfWidth || 600);
    if (Math.abs(across) > hw) return 0;
    // Raised-cosine cross-section, tapered at the ends so it does not end in a cliff.
    const cross = 0.5 * (1 + Math.cos((across / hw) * Math.PI));
    const taper = 0.5 * (1 + Math.cos(clamp((Math.abs(along) - halfLen * 0.7) / (halfLen * 0.3), 0, 1) * Math.PI));
    return (ridge.height || 0) * cross * taper;
  }

  function heightAt(east, north) {
    return base + noiseHeight(east, north) + ridgeHeight(east, north);
  }

  return { heightAt, config: cfg, base };
}

// --------------------------------------------------------- path obstruction
//
// Walk the great-circle-ish ground path between two points, apply the
// equivalent-earth transform, and report the worst obstruction relative to the
// straight ray. Returns the data a knife-edge diffraction model needs.

/**
 * @param {object} a  {east, north, height}  height is AMSL
 * @param {object} b  {east, north, height}
 * @param {object} terrain  from createTerrain
 * @param {number} ae  effective earth radius, metres
 * @param {number} [samples]
 */
export function profileObstruction(a, b, terrain, ae, samples = 128) {
  const dEast = b.east - a.east;
  const dNorth = b.north - a.north;
  const D = hypot2(dEast, dNorth);
  if (D < 1) {
    return { blocked: false, clearance: -Infinity, d1: 0, d2: 0, D, peakHeight: a.height, peakFrac: 0 };
  }

  // Effective (curvature-corrected) height of b as seen from a.
  const bEff = b.height - curvatureDrop(D, ae);

  let worstClearance = -Infinity;
  let worst = null;

  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const d1 = D * t;
    const east = a.east + dEast * t;
    const north = a.north + dNorth * t;
    const ground = terrain.heightAt(east, north);
    const groundEff = ground - curvatureDrop(d1, ae);
    const ray = lerp(a.height, bEff, t);
    const clearance = groundEff - ray;
    if (clearance > worstClearance) {
      worstClearance = clearance;
      worst = { d1, d2: D - d1, east, north, ground, peakFrac: t };
    }
  }

  return {
    blocked: worstClearance > 0,
    clearance: worstClearance,
    d1: worst ? worst.d1 : 0,
    d2: worst ? worst.d2 : D,
    D,
    east: worst ? worst.east : a.east,
    north: worst ? worst.north : a.north,
    peakHeight: worst ? worst.ground : a.height,
    peakFrac: worst ? worst.peakFrac : 0,
  };
}

/**
 * Geometry of one point as seen from a radar site.
 * Returns slant range, true bearing and apparent elevation angle with
 * curvature applied.
 */
export function viewGeometry(site, point, ae) {
  const dEast = point.east - site.east;
  const dNorth = point.north - site.north;
  const ground = hypot2(dEast, dNorth);
  const dh = (point.height - curvatureDrop(ground, ae)) - site.height;
  const slant = Math.sqrt(ground * ground + dh * dh);
  return {
    ground,
    slant: Math.max(slant, 1),
    bearing: bearingOf(dEast, dNorth),
    elevationDeg: Math.atan2(dh, Math.max(ground, 1)) * RAD,
    heightAboveSite: dh,
  };
}

// ------------------------------------------------------------ terrain raster
//
// Evaluating the noise function inside every line-of-sight walk is the single
// most expensive thing this tool does. Sampling the terrain once into a raster
// and interpolating it afterwards keeps a full re-analysis interactive, and it
// also gives the 3D view and the analysis exactly the same surface rather than
// two that nearly agree.

export function rasteriseTerrain(terrain, { halfExtent, size }) {
  const n = Math.max(16, size | 0);
  const step = (2 * halfExtent) / (n - 1);
  const data = new Float32Array(n * n);
  let min = Infinity;
  let max = -Infinity;

  for (let j = 0; j < n; j++) {
    const north = -halfExtent + j * step;
    for (let i = 0; i < n; i++) {
      const east = -halfExtent + i * step;
      const h = terrain.heightAt(east, north);
      data[j * n + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  function heightAt(east, north) {
    const fx = clamp((east + halfExtent) / step, 0, n - 1.0001);
    const fz = clamp((north + halfExtent) / step, 0, n - 1.0001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const a = data[j * n + i];
    const b = data[j * n + i + 1];
    const c = data[(j + 1) * n + i];
    const d = data[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  return { heightAt, data, size: n, step, halfExtent, min, max, source: terrain };
}
