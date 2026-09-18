// Wind climate, and what the wind does to a turbine.
//
// Two separate mechanisms, and they matter for different reasons:
//
//   DIRECTION sets rotor yaw. A turbine yaws to face into the wind, so wind
//   direction decides the angle between the radar line of sight and the rotor
//   axis, and the largest blade radial velocity the radar can see goes as
//   sin(that angle). A rotor pointed at the radar shows almost no blade
//   Doppler; one presenting its rotor plane edge-on shows the full tip speed.
//   That part is exact geometry, not a model.
//
//   SPEED sets rotor rpm. A modern variable-speed, pitch-regulated machine
//   holds close to a constant tip-speed ratio below rated wind speed (the
//   controller varies generator torque to track the optimum), then holds rotor
//   speed roughly constant from rated up to cut-out, where it shuts down and
//   feathers. Below cut-in it is not generating. So blade Doppler is not one
//   number: it scales with wind speed up to rated and then plateaus.
//
// Together these mean a single-direction, single-speed assessment can easily
// land on a benign case. The rose sweep exists to stop that happening.

import { clamp } from './geo.js';

export const SECTOR_COUNT = 12;                 // 30-degree sectors, the usual convention
export const SECTOR_WIDTH = 360 / SECTOR_COUNT;

export function sectorCentreDeg(i) {
  return (i * SECTOR_WIDTH) % 360;
}

// --------------------------------------------------------------- rotor speed

/**
 * Rotor speed for a given wind speed.
 *
 * Below cut-in and above cut-out the rotor is not generating. It is usually
 * idling rather than locked, and an idling rotor still produces Doppler, so an
 * idle fraction is applied rather than assuming zero. A genuinely parked rotor
 * is the curtailment mitigation, which sets rpm to zero outright.
 *
 * @param {number} windMs
 * @param {object} cfg {cutInMs, ratedMs, cutOutMs, ratedRpm, idleFraction}
 */
export function rotorRpm(windMs, cfg) {
  const v = Math.max(windMs, 0);
  const { cutInMs, ratedMs, cutOutMs, ratedRpm } = cfg;
  const idle = ratedRpm * clamp(cfg.idleFraction ?? 0.12, 0, 1);

  if (v < cutInMs) return idle * clamp(v / Math.max(cutInMs, 0.1), 0, 1);
  if (v >= cutOutMs) return idle;
  if (v >= ratedMs) return ratedRpm;

  // Below rated the controller tracks tip-speed ratio, BUT NOT DOWN TO ZERO.
  // A generating machine holds a minimum rotor speed, and measured SCADA shows
  // it sitting at roughly 60 per cent of rated as soon as it is running: a
  // 2.5 MW machine rated at 14.6 rpm sat at a median 8.8 rpm in 3 to 4 m/s
  // wind, where a bare proportional model predicts about 5. Without this floor
  // the model understates low-wind blade Doppler by something like 40 per cent,
  // which is exactly the regime where it would otherwise look harmless.
  const floor = ratedRpm * clamp(cfg.minRunningFraction ?? 0.6, 0, 1);
  return Math.max(ratedRpm * (v / Math.max(ratedMs, 0.1)), floor);
}

export function operatingState(windMs, cfg) {
  if (windMs < cfg.cutInMs) return 'below cut-in';
  if (windMs >= cfg.cutOutMs) return 'above cut-out';
  if (windMs >= cfg.ratedMs) return 'at rated';
  return 'below rated';
}

// Tip-speed ratio the machine runs at when at rated, which is the number that
// says whether the stated rated rpm and rated wind speed are consistent with
// each other. Modern three-blade machines sit around 7 to 9.
export function tipSpeedRatioAtRated(rotorRadiusM, ratedRpm, ratedMs) {
  const vTip = (2 * Math.PI * ratedRpm / 60) * rotorRadiusM;
  return vTip / Math.max(ratedMs, 0.1);
}

// ------------------------------------------------------------------ Weibull
//
// Wind speed within a direction sector is taken as Weibull distributed, which
// is the standard description used across the wind industry. Shape k near 2
// (the Rayleigh case) is typical for temperate sites. Scale c follows from the
// sector mean speed: U = c * gamma(1 + 1/k).

// Lanczos approximation to the gamma function. Checked in the tests against
// gamma(1) = 1, gamma(1.5) = sqrt(pi)/2 and gamma(5) = 24.
const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const x = z - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

export function weibullScale(meanMs, k) {
  return Math.max(meanMs, 0.01) / gamma(1 + 1 / Math.max(k, 0.2));
}

// P(v > x) for a Weibull distribution.
export function weibullExceedance(x, c, k) {
  if (x <= 0) return 1;
  return Math.exp(-Math.pow(x / Math.max(c, 0.01), Math.max(k, 0.2)));
}

/**
 * How a sector's hours split across the turbine's operating envelope.
 * Returns fractions that sum to 1, plus the mean wind speed conditional on
 * the machine actually generating.
 */
export function operatingFractions(meanMs, k, cfg, samples = 400) {
  const c = weibullScale(meanMs, k);
  const belowCutIn = 1 - weibullExceedance(cfg.cutInMs, c, k);
  const aboveCutOut = weibullExceedance(cfg.cutOutMs, c, k);
  const generating = Math.max(1 - belowCutIn - aboveCutOut, 0);
  const atRated = Math.max(
    weibullExceedance(cfg.ratedMs, c, k) - aboveCutOut, 0);

  // Mean speed while generating, by numerical integration of the pdf over the
  // operating band.
  let num = 0;
  let den = 0;
  const lo = cfg.cutInMs;
  const hi = cfg.cutOutMs;
  const step = (hi - lo) / samples;
  for (let i = 0; i < samples; i++) {
    const v = lo + (i + 0.5) * step;
    const kk = Math.max(k, 0.2);
    const pdf = (kk / c) * Math.pow(v / c, kk - 1) * Math.exp(-Math.pow(v / c, kk));
    num += v * pdf * step;
    den += pdf * step;
  }

  return {
    scaleC: c,
    belowCutIn,
    aboveCutOut,
    generating,
    atRated,
    belowRated: Math.max(generating - atRated, 0),
    meanGeneratingMs: den > 1e-9 ? num / den : cfg.ratedMs,
  };
}

// --------------------------------------------------------------- wind roses
//
// ILLUSTRATIVE SHAPES, NOT SITE DATA. A real assessment uses the measured wind
// rose for the site, from the developer's own met mast or reanalysis data.
// These exist so the sweep has something plausible to run against and so the
// shape of the problem is visible.

function normaliseRose(freqs, meanSpeeds) {
  const total = freqs.reduce((a, b) => a + b, 0) || 1;
  return freqs.map((f, i) => ({
    directionDeg: sectorCentreDeg(i),
    frequency: f / total,
    meanSpeedMs: meanSpeeds[i],
  }));
}

// Build a rose from a dominant direction, a concentration, and a mean speed
// that is higher in the dominant sector than in the quiet ones.
function shapedRose(dominantDeg, concentration, peakMs, floorMs) {
  const freqs = [];
  const speeds = [];
  for (let i = 0; i < SECTOR_COUNT; i++) {
    const d = sectorCentreDeg(i);
    let delta = Math.abs(((d - dominantDeg + 540) % 360) - 180);
    delta = 180 - delta;                         // 0 at the dominant direction
    const w = Math.exp(-Math.pow(delta / concentration, 2));
    freqs.push(0.25 + w);
    speeds.push(floorMs + (peakMs - floorMs) * w);
  }
  return normaliseRose(freqs, speeds);
}

export const WIND_ROSE_PRESETS = {
  'sw-temperate': {
    label: 'South-westerly dominated (illustrative)',
    note: 'A prevailing south-westerly pattern with the strongest winds in the dominant sector.',
    weibullK: 2.0,
    rose: shapedRose(225, 62, 9.5, 5.0),
  },
  'w-exposed': {
    label: 'Westerly, exposed site (illustrative)',
    note: 'Stronger and more concentrated, as at an exposed coastal or offshore site.',
    weibullK: 2.2,
    rose: shapedRose(270, 48, 11.5, 6.0),
  },
  'bimodal': {
    label: 'Bimodal, two prevailing directions (illustrative)',
    note: 'Two opposing prevailing directions, as in a valley or channelled site.',
    weibullK: 1.9,
    rose: (() => {
      const a = shapedRose(210, 45, 9.0, 4.5);
      const b = shapedRose(30, 55, 8.0, 4.5);
      return normaliseRose(
        a.map((s, i) => s.frequency + b[i].frequency),
        a.map((s, i) => Math.max(s.meanSpeedMs, b[i].meanSpeedMs)),
      );
    })(),
  },
  'uniform': {
    label: 'Uniform (all directions equally likely)',
    note: 'No prevailing direction. Useful as a neutral worst-case screen rather than as a climate.',
    weibullK: 2.0,
    rose: normaliseRose(
      new Array(SECTOR_COUNT).fill(1),
      new Array(SECTOR_COUNT).fill(8.0)),
  },
};

export function roseSummary(rose, k, cfg) {
  let generatingHours = 0;
  const sectors = rose.map((s) => {
    const f = operatingFractions(s.meanSpeedMs, k, cfg);
    generatingHours += s.frequency * f.generating;
    return { ...s, ...f };
  });
  const dominant = sectors.reduce((a, s) => (s.frequency > a.frequency ? s : a), sectors[0]);
  return {
    sectors,
    generatingFraction: generatingHours,
    dominant,
    meanSpeedMs: sectors.reduce((a, s) => a + s.frequency * s.meanSpeedMs, 0),
  };
}

// The sector a given wind direction falls in, so the single-direction view can
// report how common the direction being assessed actually is.
export function sectorForDirection(rose, directionDeg) {
  if (!rose || !rose.length) return null;
  let best = rose[0];
  let bestDelta = 999;
  for (const s of rose) {
    const d = Math.abs(((s.directionDeg - directionDeg + 540) % 360) - 180);
    if (d < bestDelta) { bestDelta = d; best = s; }
  }
  return best;
}

// ===========================================================================
// Fleet state: wakes, yaw scatter, and machines that are not running
// ===========================================================================
//
// A wind farm does not present one signature. Stand at a site and the turbines
// are not all pointing the same way, not all turning at the same speed, and
// some are not turning at all. Three separate causes:
//
//   WAKES. A turbine downstream of another sees slower air, so it runs slower
//   and produces less blade Doppler. Deficits of 10 to 25 per cent in wind
//   speed at three to five rotor diameters are ordinary.
//
//   YAW SCATTER. Yaw control uses a deadband: the machine only turns when the
//   error exceeds a trigger, then stops inside it. So turbines sit scattered
//   around the wind direction rather than on it, and they lag changes. Wake
//   steering deliberately misaligns upstream machines on top of that.
//
//   MACHINES NOT RUNNING. Availability is high but not total, and turbines are
//   also curtailed for noise, shadow flicker, bats, icing, grid constraints and
//   maintenance. A parked rotor produces no blade Doppler at all, which makes
//   it a fundamentally different radar target from a turning one.
//
// For radar this matters in both directions. Assuming every turbine is aligned
// and at rated overstates how coherent the array is. Assuming a benign fleet
// state understates the worst case. The point of modelling it is to see the
// spread rather than pick one end of it.

// Deterministic per-turbine pseudo-random value, so a fleet state is
// reproducible and a report can be regenerated identically.
function fleetRandom(index, seed, salt) {
  let h = Math.imul(index + 1, 374761393) ^ Math.imul(seed + 1, 668265263) ^ Math.imul(salt, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Jensen (Park) wake velocity deficit.
 *
 *   deficit = (1 - sqrt(1 - Ct)) / (1 + k*x/r0)^2
 *
 * The wake expands linearly at rate k downstream, and the deficit is taken as
 * uniform across it. Wake decay is conventionally around 0.075 onshore and
 * 0.04 offshore, the difference being surface roughness and therefore how fast
 * the wake mixes out.
 */
export function jensenDeficit(downstreamM, rotorRadiusM, thrustCoefficient, wakeDecay) {
  if (downstreamM <= 0) return 0;
  const a = 1 - Math.sqrt(Math.max(1 - thrustCoefficient, 0));
  const expansion = 1 + (wakeDecay * downstreamM) / Math.max(rotorRadiusM, 1);
  return a / (expansion * expansion);
}

export function wakeRadius(downstreamM, rotorRadiusM, wakeDecay) {
  return rotorRadiusM + wakeDecay * Math.max(downstreamM, 0);
}

/**
 * Overlap area between a downstream rotor disc and an upstream wake circle,
 * as a fraction of the rotor disc. Standard circle-circle intersection: a
 * turbine clipped by the edge of a wake is only partly affected.
 */
export function wakeOverlapFraction(lateralOffsetM, wakeR, rotorR) {
  const d = Math.abs(lateralOffsetM);
  if (d >= wakeR + rotorR) return 0;
  if (d <= Math.abs(wakeR - rotorR)) {
    // One circle sits inside the other.
    return wakeR >= rotorR ? 1 : (wakeR * wakeR) / (rotorR * rotorR);
  }
  const r1 = wakeR;
  const r2 = rotorR;
  const a1 = Math.acos(Math.min(Math.max((d * d + r1 * r1 - r2 * r2) / (2 * d * r1), -1), 1));
  const a2 = Math.acos(Math.min(Math.max((d * d + r2 * r2 - r1 * r1) / (2 * d * r2), -1), 1));
  const area = r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
  return Math.min(area / (Math.PI * r2 * r2), 1);
}

/**
 * Inflow wind speed at every turbine, given the free-stream wind.
 *
 * Deficits from several upstream machines are combined by root sum of squares,
 * which is the usual superposition for the Park model.
 *
 * @param {Array} turbines  [{east, north, rotorRadiusM}]
 * @param {object} cfg {windDirectionDeg, freeStreamMs, thrustCoefficient, wakeDecay}
 */
export function fleetInflow(turbines, cfg) {
  // Unit vector pointing DOWNWIND. Wind direction is the bearing it comes from.
  const b = (cfg.windDirectionDeg + 180) * Math.PI / 180;
  const ux = Math.sin(b);
  const uz = Math.cos(b);

  return turbines.map((t) => {
    let sumSq = 0;
    const sources = [];
    for (const up of turbines) {
      if (up === t) continue;
      const dx = t.east - up.east;
      const dz = t.north - up.north;
      const downstream = dx * ux + dz * uz;          // positive = t is downwind of up
      if (downstream <= 1) continue;
      const lateral = Math.abs(-dx * uz + dz * ux);
      const wr = wakeRadius(downstream, up.rotorRadiusM, cfg.wakeDecay);
      const overlap = wakeOverlapFraction(lateral, wr, t.rotorRadiusM);
      if (overlap <= 0) continue;
      const d = jensenDeficit(downstream, up.rotorRadiusM, cfg.thrustCoefficient, cfg.wakeDecay)
        * overlap;
      sumSq += d * d;
      sources.push({ from: up.id, downstreamM: downstream, lateralM: lateral, overlap, deficit: d });
    }
    const deficit = Math.min(Math.sqrt(sumSq), 0.95);
    return {
      inflowMs: cfg.freeStreamMs * (1 - deficit),
      deficit,
      waked: deficit > 0.01,
      wakeSources: sources.sort((a, x) => x.deficit - a.deficit).slice(0, 3),
    };
  });
}

/**
 * Per-turbine yaw offset from the nominal wind direction.
 *
 * Yaw control only acts when the error leaves a deadband, so at any moment the
 * fleet sits scattered inside it. Modelled as a deterministic spread across the
 * deadband rather than every machine sitting exactly on the wind.
 */
export function yawOffsetFor(index, seed, deadbandDeg, systematicSdDeg = 0) {
  if (deadbandDeg <= 0 && systematicSdDeg <= 0) return 0;

  // Measured SCADA says two things a uniform deadband model gets wrong.
  //
  // First, the moment-to-moment spread is PEAKED near zero, not uniform, and
  // it has a tail: across four well-behaved machines the pairwise difference
  // had a median of 7.3 degrees but a 99th percentile of 32. So this is drawn
  // from a normal distribution with an occasional large excursion, rather than
  // spread flatly across a deadband.
  //
  // Second, and more important for radar, machines carry PERSISTENT reference
  // offsets from each other. In the same data, median nacelle position differed
  // between machines by up to 35 degrees while all were generating in the same
  // wind, and one machine sat 61 degrees off the rest. So a fleet does not
  // share one rotor aspect even in perfectly steady wind.
  const sd = deadbandDeg > 0 ? deadbandDeg * 0.68 : 0;      // deadband ~ 1.5 sd
  const u1 = Math.max(fleetRandom(index, seed, 17), 1e-9);
  const u2 = fleetRandom(index, seed, 23);
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const excursion = fleetRandom(index, seed, 29) > 0.9 ? gauss * 2.5 : gauss;

  const systematic = systematicSdDeg > 0
    ? (fleetRandom(index, seed, 41) * 2 - 1) * systematicSdDeg
    : 0;

  return clamp(excursion * sd, -60, 60) + systematic;
}

/**
 * Which machines are not running.
 *
 * Availability and curtailment are given as fractions of the fleet. Selection
 * is deterministic for a given seed so a scenario is reproducible, and the
 * reason is carried through so the findings can say why a machine is stopped.
 */
export function fleetOperatingState(count, cfg) {
  // Stoppages are NOT independent between machines. Measured across five
  // turbines over three years, all five ran 61.3 per cent of the time against
  // 53.5 per cent if each stopped independently at the same rate, and all five
  // were stopped together 0.56 per cent of the time against essentially never
  // under independence. Site-wide causes do that: grid events, storm shutdown,
  // curtailment regimes, a shared access road closed for works.
  //
  // Modelled as a site-wide state that occasionally stops a large part of the
  // fleet at once, with independent per-machine stoppages on top.
  const base = clamp(1 - cfg.availability, 0, 1) + clamp(cfg.curtailed, 0, 1);
  const clustering = clamp(cfg.clustering ?? 0.45, 0, 1);
  const siteRoll = fleetRandom(0, cfg.seed, 97);
  const siteWide = siteRoll < base * clustering;

  const out = [];
  for (let i = 0; i < count; i++) {
    const r = fleetRandom(i, cfg.seed, 31);
    let running = true;
    let reason = null;
    if (siteWide && r < 0.8) {
      running = false;
      reason = 'site-wide';
    } else if (r < base * (1 - clustering)) {
      running = false;
      reason = r < clamp(1 - cfg.availability, 0, 1) * (1 - clustering)
        ? 'unavailable' : 'curtailed';
    }
    out.push({ running, reason });
  }
  return out;
}
