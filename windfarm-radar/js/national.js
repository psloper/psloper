// The national screen: which radars can see which wind farms.
//
// This is line of sight and range only. It answers one question, geometrically:
// standing at the radar antenna, with the earth curving away at the modelled
// refraction, is the top of a turbine at that farm above the intervening
// ground? It says nothing about whether the return would be strong enough to
// cross a detection threshold, whether the clutter filter would remove it, or
// whether a controller would ever notice. Those need the per-site assessment,
// which is what clicking a radar opens.
//
// The choice is deliberate. A national map coloured by detection margin would
// have to invent radar parameters for 55 sites whose real numbers nobody here
// has, and would look far more authoritative than it could possibly be.
// Geometry needs no such invention: it needs positions, heights and ground.

import { effectiveEarthRadius, horizonDistance, profileObstruction } from './geo.js';
import { createRealTerrain } from './terrain.js';

/** Statuses that count as a farm existing or about to. */
export const ACTIVE_STATUSES = ['Operational', 'Under Construction'];

/** Every status the planning database uses, grouped for the layer switches. */
export const STATUS_GROUPS = {
  active: { label: 'Operational and under construction', match: ACTIVE_STATUSES },
  pipeline: {
    label: 'Consented or in planning',
    match: ['Awaiting Construction', 'Application Submitted', 'Revised'],
  },
  dead: {
    label: 'Refused, withdrawn or abandoned',
    match: ['Application Refused', 'Application Withdrawn', 'Appeal Refused',
      'Appeal Withdrawn', 'Abandoned', 'Planning Permission Expired', 'Decommissioned',
      'No Application Required'],
  },
};

/**
 * Assumptions the screen has to make, gathered here so they are one list
 * rather than scattered constants. Every one of them is a place where the
 * answer could be wrong, and the map prints this list.
 */
export const ASSUMPTIONS = {
  tipHeightM: 150,
  tipHeightNote: 'The planning database gives no turbine height, so the screen assumes a '
    + '150 m tip. That is a modern onshore machine. A 100 m tip sees less; a 200 m tip sees '
    + 'more. This is the single biggest lever on the result.',
  antennaHeightM: 20,
  antennaHeightNote: 'No mounting is published for most of these sites. 20 m above ground is '
    + 'a typical aerodrome arrangement and is a guess for every site here. A lattice tower at '
    + '30 m reaches noticeably further.',
  kFactor: 4 / 3,
  kFactorNote: 'Standard refraction. Under a surface duct the radar sees further, so a farm '
    + 'this screen calls hidden may not be.',
  maxRangeM: 100000,
  maxRangeNote: 'Pairings beyond 100 km are not tested. Some en-route radars instrument '
    + 'further than that.',
  samples: 48,
  samplesNote: 'The terrain profile is sampled 48 times between radar and farm. The per-site '
    + 'assessment uses 128 and real elevation blocks at 100 or 200 m; this uses the 500 m '
    + 'national grid, so a narrow ridge can be missed here and caught there.',
  positionNote: 'Farm positions are planning-database centroids, out by about 1,100 m in the '
    + 'median case. A centroid is not a turbine, and at the margin of visibility that error '
    + 'decides the answer.',
};

const M_PER_DEG_LAT = 111132.92;

/** Metres per degree of longitude at a latitude. */
function mPerDegLon(lat) {
  const DEG = Math.PI / 180;
  return 111412.84 * Math.cos(lat * DEG) - 93.5 * Math.cos(3 * lat * DEG);
}

/** Great-circle-ish distance, good to a metre or so at these ranges. */
export function distanceM(aLat, aLon, bLat, bLon) {
  const mLat = (aLat + bLat) / 2;
  const dN = (bLat - aLat) * M_PER_DEG_LAT;
  const dE = (bLon - aLon) * mPerDegLon(mLat);
  return Math.hypot(dE, dN);
}

/**
 * Run the screen.
 *
 * `coarse` is a decoded terrain block covering the whole country; if it is
 * null the screen still runs but every pairing is treated as flat sea level,
 * which is stated in the result rather than hidden.
 *
 * Returns per-radar and per-farm counts plus the visible pairings, so the map
 * can colour either side and the caller can list them.
 */
export function nationalScreen({ radars, farms, coarse = null, assumptions = {} } = {}) {
  const a = { ...ASSUMPTIONS, ...assumptions };
  const ae = effectiveEarthRadius(a.kFactor);
  // Furthest a turbine tip could be seen over a smooth earth: the radar's own
  // horizon plus the turbine's. Anything past this cannot be visible whatever
  // the terrain does, so it is not worth sampling a profile for.
  const reach = Math.min(
    a.maxRangeM,
    horizonDistance(a.antennaHeightM, ae) + horizonDistance(a.tipHeightM, ae),
  );

  const byRadar = radars.map((r) => ({
    radar: r, visible: 0, hidden: 0, beyond: 0, nearestVisibleM: Infinity,
  }));
  const byFarm = farms.map((f) => ({
    farm: f, seenBy: 0, hiddenFrom: 0, nearestRadarM: Infinity, nearestRadar: null,
  }));
  const pairings = [];
  let profiles = 0;
  let skipped = 0;   // pairings with an unusable coordinate

  for (let ri = 0; ri < radars.length; ri++) {
    const r = radars[ri];
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) {
      skipped += farms.length;
      continue;
    }
    // One terrain anchored on this radar, so east and north below are metres
    // from it and profileObstruction can be reused exactly as the per-site
    // assessment uses it.
    const terrain = coarse
      ? createRealTerrain({ anchorLat: r.lat, anchorLon: r.lon, coarse, blocks: [] })
      : { heightAt: () => 0, real: false };
    const groundR = terrain.heightAt(0, 0);
    const site = { east: 0, north: 0, height: groundR + a.antennaHeightM };
    const mLon = mPerDegLon(r.lat);

    for (let fi = 0; fi < farms.length; fi++) {
      const f = farms[fi];
      const dN = (f.lat - r.lat) * M_PER_DEG_LAT;
      const dE = (f.lon - r.lon) * mLon;
      const D = Math.hypot(dE, dN);
      // Guard the NaN case explicitly. A row with no usable coordinate gives
      // NaN, and `NaN > reach` is false, so without this every such pairing
      // fell through the range test and was counted visible. That is exactly
      // what happened the first time the map was wired to the compact site
      // arrays and read the wrong field: 136,895 pairings, every one of them.
      if (!Number.isFinite(D)) { skipped += 1; continue; }
      if (D > reach) { byRadar[ri].beyond += 1; continue; }

      const groundF = terrain.heightAt(dE, dN);
      const point = { east: dE, north: dN, height: groundF + a.tipHeightM };
      const obs = profileObstruction(site, point, terrain, ae, a.samples);
      profiles += 1;

      if (obs.blocked) {
        byRadar[ri].hidden += 1;
        byFarm[fi].hiddenFrom += 1;
      } else {
        byRadar[ri].visible += 1;
        byFarm[fi].seenBy += 1;
        byRadar[ri].nearestVisibleM = Math.min(byRadar[ri].nearestVisibleM, D);
        pairings.push({ ri, fi, D, clearance: obs.clearance });
      }
      if (D < byFarm[fi].nearestRadarM) {
        byFarm[fi].nearestRadarM = D;
        byFarm[fi].nearestRadar = ri;
      }
    }
  }

  return {
    byRadar,
    byFarm,
    pairings,
    profiles,
    skipped,
    reachM: reach,
    assumptions: a,
    terrainUsed: coarse ? 'the 500 m national grid' : 'NONE: every pairing treated as flat sea level',
    summary: {
      radars: radars.length,
      farms: farms.length,
      visiblePairings: pairings.length,
      farmsSeenByAtLeastOne: byFarm.filter((x) => x.seenBy > 0).length,
      farmsSeenByThreeOrMore: byFarm.filter((x) => x.seenBy >= 3).length,
      radarsSeeingSomething: byRadar.filter((x) => x.visible > 0).length,
    },
  };
}

/**
 * A heat field over the map, accumulated at the FARMS rather than smeared
 * along the sightlines.
 *
 * A farm contributes in proportion to how many radars can see it, so a turbine
 * visible to four radars weighs four times one visible to a single radar. The
 * field is what is drawn; it is not a probability of anything, and the legend
 * says so.
 */
export function heatField(screen, { project, width, height, radiusPx = 26 } = {}) {
  const field = new Float32Array(width * height);
  const r2 = radiusPx * radiusPx;
  for (const fb of screen.byFarm) {
    if (fb.seenBy <= 0) continue;
    const p = project(fb.farm.lat, fb.farm.lon);
    if (!p) continue;
    const cx = Math.round(p.x), cy = Math.round(p.y);
    const w = fb.seenBy;
    for (let y = Math.max(0, cy - radiusPx); y < Math.min(height, cy + radiusPx); y++) {
      for (let x = Math.max(0, cx - radiusPx); x < Math.min(width, cx + radiusPx); x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 > r2) continue;
        // Smooth falloff, so overlapping farms build a plateau rather than
        // a ring of hard discs.
        const t = 1 - d2 / r2;
        field[y * width + x] += w * t * t;
      }
    }
  }
  let max = 0;
  for (let i = 0; i < field.length; i++) if (field[i] > max) max = field[i];
  return { field, max, width, height };
}
