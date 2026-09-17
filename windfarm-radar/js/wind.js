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
  // Constant tip-speed ratio below rated: tip speed tracks wind speed.
  return ratedRpm * (v / Math.max(ratedMs, 0.1));
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
