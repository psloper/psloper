// Sea surface effects: wave height, sea clutter and surface multipath.
//
// These matter twice over for an offshore wind farm. The sea is a large
// distributed clutter source competing with the aircraft you want to see, and
// it is also a good specular reflector, so it sets up a two-path interference
// pattern that puts deep nulls in low-elevation coverage. Wave height drives
// both, in opposite directions: a rougher sea raises clutter and suppresses
// the lobing, a calm sea does the reverse.
//
// PROVENANCE. The multipath formulation below is standard textbook material
// and is stated as such. The sea clutter reflectivity relation is PARAMETRIC:
// its constants are exposed as inputs precisely because this tool is not in a
// position to assert them. A real assessment takes sigma-zero from a validated
// model (GIT, TSC) or from the Nathanson tables at the relevant band,
// polarisation, grazing angle and sea state. None of those was retrievable
// from the environment this tool was written in, so none is reproduced here.

import { clamp } from './geo.js';
import { linToDb, dbToLin } from './rf.js';

// ------------------------------------------------------------- wave height
//
// Fully developed sea: significant wave height rises with the square of wind
// speed. Hs ~= 0.0248 * U^2 is the commonly used Pierson-Moskowitz form for a
// fully developed sea at 10 m reference height. NOT verified against the
// primary source here; a real assessment uses measured or hindcast wave data,
// and a fetch-limited or swell-dominated sea will not follow this at all.

export function fullyDevelopedWaveHeight(windMs) {
  return 0.0248 * Math.max(windMs, 0) ** 2;
}

// WMO sea state code, by significant wave height band. Widely reproduced;
// stated here from the standard reference form.
const SEA_STATE_BANDS = [
  [0.0, 0, 'Calm (glassy)'],
  [0.1, 1, 'Calm (rippled)'],
  [0.5, 2, 'Smooth'],
  [1.25, 3, 'Slight'],
  [2.5, 4, 'Moderate'],
  [4.0, 5, 'Rough'],
  [6.0, 6, 'Very rough'],
  [9.0, 7, 'High'],
  [14.0, 8, 'Very high'],
  [Infinity, 9, 'Phenomenal'],
];

export function seaState(significantWaveHeightM) {
  const h = Math.max(significantWaveHeightM, 0);
  for (const [top, code, label] of SEA_STATE_BANDS) {
    if (h <= top) return { code, label, heightM: h };
  }
  return { code: 9, label: 'Phenomenal', heightM: h };
}

// RMS surface height from significant wave height. Hs is conventionally four
// times the RMS surface elevation.
export function rmsWaveHeight(significantWaveHeightM) {
  return Math.max(significantWaveHeightM, 0) / 4;
}

// ---------------------------------------------------------------- multipath
//
// Two-path propagation over a reflecting surface. The direct and
// surface-reflected rays combine, giving a propagation factor
//
//   F = | 1 + rho_s * Gamma * D * exp(-j * dphi) |
//
// with a two-way effect of F^4 on received power. For a horizontally polarised
// radar at low grazing angles over sea water the Fresnel reflection
// coefficient Gamma is close to -1, so the surface-reflected ray arrives
// phase-reversed and the pattern has a null on the horizon.
//
//   dphi = 4 * pi * h_r * h_t / (lambda * R)     (flat-earth, small angles)
//
// Surface roughness scatters energy out of the specular direction. The Ament
// roughness factor
//
//   rho_s = exp( -2 * (2 * pi * sigma_h * sin(psi) / lambda)^2 )
//
// collapses toward zero as the sea gets rough, which removes the lobing. This
// is why a calm sea is the harder case for low-level coverage: the nulls are
// deepest when the surface is a good mirror.

export function amentRoughness(rmsHeightM, grazingRad, lambdaM) {
  const x = 2 * Math.PI * rmsHeightM * Math.sin(Math.max(grazingRad, 0)) / lambdaM;
  return Math.exp(-2 * x * x);
}

export function pathDifferencePhase(antennaHeightM, targetHeightM, rangeM, lambdaM) {
  return 4 * Math.PI * antennaHeightM * targetHeightM / (lambdaM * Math.max(rangeM, 1));
}

/**
 * Two-way propagation factor in dB, relative to free space.
 *
 * @param {object} p
 * @param {number} p.antennaHeightM  radar height above the reflecting surface
 * @param {number} p.targetHeightM   target height above the reflecting surface
 * @param {number} p.rangeM
 * @param {number} p.lambdaM
 * @param {number} p.rmsHeightM      RMS surface roughness (Hs/4 for sea)
 * @param {number} p.reflectionMag   |Gamma|, 1.0 for a perfect reflector
 * @param {number} [p.divergence]    divergence factor, 1 for short ranges
 */
export function grazingAngle(antennaHeightM, targetHeightM, rangeM) {
  // At the specular reflection point the incidence and reflection angles are
  // equal, which for the flat-earth small-angle case puts the grazing angle at
  // (h_r + h_t) / R. Using the antenna height alone understates it badly and
  // makes surface roughness look irrelevant.
  return Math.atan2(antennaHeightM + targetHeightM, Math.max(rangeM, 1));
}

export function multipathFactorDb(p) {
  const R = Math.max(p.rangeM, 1);
  const grazing = grazingAngle(p.antennaHeightM, p.targetHeightM, R);
  const rho = amentRoughness(p.rmsHeightM, grazing, p.lambdaM)
    * clamp(p.reflectionMag ?? 1, 0, 1)
    * clamp(p.divergence ?? 1, 0, 1);
  const dphi = pathDifferencePhase(p.antennaHeightM, p.targetHeightM, R, p.lambdaM);
  // The divergence factor, which shallows the lobing once earth curvature
  // spreads the reflected ray, is left at 1 unless the caller supplies it.
  // That makes the modelled lobing a worst case rather than an optimistic one.
  // Gamma ~= -1, so the reflected ray subtracts. f2 is F^2, the one-way power
  // factor; the two-way effect is F^4, which is 40*log10(F) = 20*log10(F^2).
  const f2 = 1 + rho * rho - 2 * rho * Math.cos(dphi);
  return Math.max(20 * Math.log10(Math.max(f2, 1e-9)), -60);
}

// --------------------------------------------------------------- sea clutter
//
// Normalised clutter reflectivity, sigma-zero, in dB relative to 1 m^2/m^2.
//
// PARAMETRIC. Every constant is an input. The defaults put a sea state 3,
// S-band, low-grazing case near the -50 dB region that open sources commonly
// quote, so the tool starts somewhere plausible, but they are not authority
// and the tool says so wherever the figure is used.
//
//   sigma0 = ref + n * 10*log10(sin psi / sin psi_ref)
//                + k_ss * (seaState - refState)
//                + k_f * log10(f / f_ref)
export function sigmaZeroDb(grazingRad, seaStateCode, freqHz, cfg) {
  const psi = Math.max(grazingRad, 1e-4);
  const psiRef = (cfg.refGrazingDeg ?? 1) * Math.PI / 180;
  const grazTerm = (cfg.grazingExponent ?? 1.5) * 10
    * Math.log10(Math.sin(psi) / Math.sin(psiRef));
  const ssTerm = (cfg.perSeaStateDb ?? 3) * (seaStateCode - (cfg.refSeaState ?? 3));
  const fTerm = (cfg.frequencySlopeDb ?? 10)
    * Math.log10(freqHz / ((cfg.refFreqGHz ?? 3) * 1e9));
  return (cfg.sigmaZeroRefDb ?? -50) + grazTerm + ssTerm + fTerm;
}

/**
 * Illuminated sea surface area in one pulse-limited resolution cell.
 *
 *   A_c = R * theta_az * (c*tau/2) * sec(psi)
 *
 * Standard low-grazing-angle form: the cell is bounded in azimuth by the beam
 * and in range by the pulse, and the secant accounts for the surface being
 * viewed obliquely.
 */
export function clutterCellArea(rangeM, azBeamwidthDeg, rangeResolutionM, grazingRad) {
  const az = azBeamwidthDeg * Math.PI / 180;
  const sec = 1 / Math.max(Math.cos(Math.min(grazingRad, 1.5)), 0.05);
  return Math.max(rangeM, 1) * az * rangeResolutionM * sec;
}

/**
 * Effective sea clutter RCS competing with a target in the same cell, after
 * the clutter filter.
 *
 * Sea clutter is not stationary: wave motion gives it a Doppler spread that
 * grows with wind speed, so a zero-velocity notch does not remove all of it.
 * The spread is taken as proportional to wind speed, with the coefficient
 * exposed as an input for the same reason as sigma-zero.
 */
export function seaClutterRcsDbsm(p) {
  const s0 = sigmaZeroDb(p.grazingRad, p.seaStateCode, p.freqHz, p.cfg);
  const area = clutterCellArea(p.rangeM, p.azBeamwidthDeg, p.rangeResolutionM, p.grazingRad);
  const rawDbsm = s0 + linToDb(area);

  // Fraction of the clutter spectrum outside the notch, taking the spread as
  // Gaussian with standard deviation sigma_v.
  const sigmaV = Math.max((p.spreadPerWindMs ?? 0.1) * Math.max(p.windMs, 0), 0.05);
  const notch = Math.max(p.notchHalfWidthMs, 0.01);
  const passed = erfc(notch / (Math.SQRT2 * sigmaV));   // both tails
  const rejectionDb = linToDb(Math.max(passed, 1e-9));
  const limitedDb = Math.max(rejectionDb, -Math.abs(p.maxRejectionDb ?? 45));

  return {
    sigmaZeroDb: s0,
    cellAreaM2: area,
    rawDbsm,
    spreadMs: sigmaV,
    passFraction: Math.max(passed, 1e-9),
    effectiveDbsm: rawDbsm + limitedDb,
  };
}

// Complementary error function, Abramowitz and Stegun 7.1.26 form. Accurate to
// about 1.5e-7, which is far finer than anything else in this model.
export function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const y = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196
    + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398
    + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? y : 2 - y;
}
