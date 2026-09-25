// Radar and propagation maths.
//
// PROVENANCE OF EACH FORMULA IS MARKED IN THE COMMENTS. This tool is a
// screening model: it is built from published closed-form approximations, not
// from a full electromagnetic solver, and it is not a substitute for a formal
// technical and operational assessment by the affected radar's operator.

export const C = 299792458;          // m/s, exact by definition
export const BOLTZMANN = 1.380649e-23; // J/K, exact since the 2019 SI redefinition
export const T0 = 290;               // K, standard reference noise temperature

export const dbToLin = (db) => Math.pow(10, db / 10);
export const linToDb = (lin) => 10 * Math.log10(Math.max(lin, 1e-300));
export const dbToAmp = (db) => Math.pow(10, db / 20);

export function wavelength(freqHz) {
  return C / freqHz;
}

// ----------------------------------------------------------- radar equation
//
// Monostatic point-target form:
//   Pr = Pt * G^2 * lambda^2 * sigma / ((4*pi)^3 * R^4 * L)
// Standard textbook result (Skolnik, Introduction to Radar Systems). Gains are
// passed in linear units so that pattern weighting can be applied per-path.

export function receivedPowerW({ ptW, gTx, gRx, lambdaM, sigmaM2, rangeM, lossLin }) {
  const R = Math.max(rangeM, 1);
  const num = ptW * gTx * gRx * lambdaM * lambdaM * Math.max(sigmaM2, 1e-12);
  const den = Math.pow(4 * Math.PI, 3) * Math.pow(R, 4) * Math.max(lossLin, 1e-12);
  return num / den;
}

export function noisePowerW(bandwidthHz, noiseFigureDb) {
  return BOLTZMANN * T0 * dbToLin(noiseFigureDb) * Math.max(bandwidthHz, 1);
}

// Matched-filter bandwidth for an uncompressed pulse is ~1/tau. With pulse
// compression the receiver bandwidth follows the chirp, so the caller supplies
// the compressed bandwidth when one is configured.
export function matchedBandwidth(pulseWidthS, compressedBandwidthHz) {
  if (compressedBandwidthHz && compressedBandwidthHz > 0) return compressedBandwidthHz;
  return 1 / Math.max(pulseWidthS, 1e-9);
}

// Range resolution: c/(2B) compressed, or c*tau/2 uncompressed.
export function rangeResolution(pulseWidthS, compressedBandwidthHz) {
  return C / (2 * matchedBandwidth(pulseWidthS, compressedBandwidthHz));
}

// Unambiguous range from the PRF.
export function unambiguousRange(prfHz) {
  return C / (2 * Math.max(prfHz, 1));
}

// Number of pulses on target per scan for a rotating antenna.
export function pulsesPerScan(prfHz, azBeamwidthDeg, rpm) {
  const scansPerSec = Math.max(rpm, 0.01) / 60;
  const dwell = (azBeamwidthDeg / 360) / scansPerSec;
  return Math.max(1, prfHz * dwell);
}

// --------------------------------------------------------- detection thresh
//
// Albersheim's empirical approximation for the single-pulse SNR required to
// reach a given probability of detection at a given false-alarm probability,
// after non-coherent integration of n pulses, for a non-fluctuating target and
// a linear detector.
//
// Source: W. J. Albersheim, "A Closed-Form Approximation to Robertson's
// Detection Characteristics", Proc. IEEE vol. 69 no. 7, 1981; reproduced in
// standard radar texts. NOT verified against the primary paper in this
// environment - stated from standard reference form. Quoted validity:
// 0.1 <= Pd <= 0.9 and 1e-7 <= Pfa <= 1e-3; outside that the caller is warned.
export function albersheimSnrDb(pd, pfa, n) {
  const Pd = Math.min(Math.max(pd, 1e-4), 0.9999);
  const Pfa = Math.min(Math.max(pfa, 1e-12), 0.5);
  const N = Math.max(n, 1);
  const A = Math.log(0.62 / Pfa);
  const B = Math.log(Pd / (1 - Pd));
  return -5 * Math.log10(N) + (6.2 + 4.54 / Math.sqrt(N + 0.44)) * Math.log10(A + 0.12 * A * B + 1.7 * B);
}

export function albersheimInRange(pd, pfa) {
  return pd >= 0.1 && pd <= 0.9 && pfa >= 1e-7 && pfa <= 1e-3;
}

// A Swerling 1 (slow-fluctuating) target needs more SNR than the
// non-fluctuating case. The extra requirement is applied as a user-set margin
// rather than a second closed form, so the assumption stays visible.

// ------------------------------------------------------------ antenna model
//
// Two-way pattern weighting. Azimuth is a Gaussian main beam; elevation is a
// Gaussian below the beam peak and cosecant-squared above it, which is the
// classic air-surveillance coverage shape (constant received power from a
// target holding a constant altitude).
//
// The Gaussian form G_dB = -12*(theta/theta_3dB)^2 is the standard Gaussian
// beam approximation: it gives exactly -3 dB at theta = theta_3dB/2.

// The sidelobe region is a flat envelope at the peak (first) sidelobe level,
// not a lobe structure. That is deliberate, and it is an upper bound rather
// than a guess:
//
// For an aperture whose sidelobe peaks fall away monotonically, holding the
// pattern flat at the FIRST sidelobe level is at or above every later peak.
// Checked against a uniform rectangular aperture, whose pattern we can write
// down exactly: with the floor set to that aperture's own first sidelobe
// level, this model equals the first peak and sits 4.6 to 12.9 dB above the
// next five. The only place it falls below is 0.05 dB inside the main lobe,
// near the half-power point. test/physics.test.mjs asserts both.
//
// The direction matters. For clutter this over-states how much a turbine off
// boresight leaks into the beam, which flags more sites rather than fewer.
//
// UNIFORM_APERTURE_SIDELOBE_DB is derivable, not recalled: the first sidelobe
// of sin(u)/u sits at the first solution of tan(u) = u above pi, u = 4.493409,
// giving 20*log10(|sin u / u|) = -13.2615 dB. Any taper puts the real level
// below it, so it is the shallowest (most clutter) case an aperture can have
// and the conservative end of the slider.
export const UNIFORM_APERTURE_SIDELOBE_DB = -13.2615;

// Peak azimuth sidelobe level. An aperture-illumination property of the
// antenna, and NOT the same thing as a pulse-compression range sidelobe
// level, which is a waveform property. -30 dB is an assumption, labelled as
// one; no datasheet in this repository publishes a figure. It is the single
// most sensitive radar input in the tool, so it is a named parameter the user
// can set rather than something buried in a default.
export const DEFAULT_AZ_SIDELOBE_DB = -30;

export function azimuthGainDb(offsetDeg, beamwidthDeg, sidelobeFloorDb = DEFAULT_AZ_SIDELOBE_DB) {
  const bw = Math.max(beamwidthDeg, 0.05);
  const g = -12 * Math.pow(offsetDeg / bw, 2);
  return Math.max(g, sidelobeFloorDb);
}

export function elevationGainDb(elDeg, cfg) {
  const bw = Math.max(cfg.elBeamwidthDeg, 0.1);
  const peak = cfg.elPeakDeg;
  const cscMax = Math.max(cfg.cscMaxDeg, peak + 1);
  const floor = cfg.elSidelobeFloorDb ?? -40;

  if (elDeg <= peak) {
    return Math.max(-12 * Math.pow((elDeg - peak) / bw, 2), floor);
  }
  if (elDeg <= cscMax) {
    // csc^2 shaping: G/G0 = (sin(peak)/sin(el))^2
    const s = Math.sin(elDeg * Math.PI / 180);
    const sp = Math.sin(Math.max(peak, 0.2) * Math.PI / 180);
    return Math.max(20 * Math.log10(sp / Math.max(s, 1e-6)), floor);
  }
  // Above the shaped region, fall away from the csc^2 edge value.
  const sEdge = Math.sin(cscMax * Math.PI / 180);
  const sp = Math.sin(Math.max(peak, 0.2) * Math.PI / 180);
  const edgeDb = 20 * Math.log10(sp / sEdge);
  return Math.max(edgeDb - 12 * Math.pow((elDeg - cscMax) / bw, 2), floor);
}

// ---------------------------------------------------- knife-edge diffraction
//
// Single knife-edge obstruction.
//
//   v = h * sqrt( (2/lambda) * (1/d1 + 1/d2) )
//   J(v) = 6.9 + 20*log10( sqrt((v-0.1)^2 + 1) + v - 0.1 )   dB,  for v > -0.78
//   J(v) = 0                                                  otherwise
//
// This is the approximation given in Recommendation ITU-R P.526 (Propagation
// by diffraction). The ITU site could not be reached from this environment, so
// the constants are stated from the standard reference form rather than read
// off the document. Two independent checks are built into the unit tests:
// J(0) must be 6.02 dB (the textbook grazing-incidence value) and J(-0.78)
// must be exactly 0 dB (which is why -0.78 is the stated cut-off).

export function fresnelParameter(clearanceM, d1, d2, lambdaM) {
  if (d1 <= 0 || d2 <= 0) return -10;
  return clearanceM * Math.sqrt((2 / lambdaM) * (1 / d1 + 1 / d2));
}

export function knifeEdgeLossDb(v) {
  if (v <= -0.78) return 0;
  const t = v - 0.1;
  return 6.9 + 20 * Math.log10(Math.sqrt(t * t + 1) + t);
}

// Radius of the first Fresnel zone at the obstruction.
export function fresnelRadius(d1, d2, lambdaM) {
  const D = d1 + d2;
  if (D <= 0) return 0;
  return Math.sqrt(lambdaM * d1 * d2 / D);
}

// A wind turbine rotor is mostly empty air. Treating the whole swept disc as
// an opaque screen badly overstates blockage, so the rotor is handled as a
// partially filling screen: the blades occupy a small fraction of the disc
// (rotor solidity, typically a few per cent for a modern three-blade machine)
// and the one-way amplitude loss is taken as -20*log10(1 - fill). The tower
// and nacelle are handled separately as a solid knife edge.
//
// This split is an engineering approximation made for this tool, not a
// published model. It is flagged as such in the report.
export function rotorBlockageLossDb(fillFraction) {
  const f = Math.min(Math.max(fillFraction, 0), 0.95);
  return -20 * Math.log10(1 - f);
}

export function rotorSolidity({ bladeCount, bladeChordM, bladeLengthM, rotorRadiusM }) {
  const bladeArea = bladeCount * bladeChordM * bladeLengthM;
  const discArea = Math.PI * rotorRadiusM * rotorRadiusM;
  return discArea > 0 ? Math.min(bladeArea / discArea, 0.95) : 0;
}

// ------------------------------------------------------------------ Doppler
//
//   f_d = 2 * v_r * f / c        (monostatic two-way Doppler shift)
//
// For a rotor, the blade velocity is tangential and lies in the rotor plane.
// The largest radial component over a revolution is therefore
//
//   v_r,max = v_tip * sin(theta)
//
// where theta is the angle between the radar line of sight and the rotor axis.
// A turbine yawed to face the radar head-on (theta = 0) shows almost no blade
// Doppler; one presenting its rotor edge-on (theta = 90 deg) shows the full
// tip speed. This is why turbine yaw, and therefore wind direction, changes
// what the radar sees.

export function tipSpeed(rotorRadiusM, rpm) {
  return (2 * Math.PI * Math.max(rpm, 0) / 60) * rotorRadiusM;
}

export function dopplerHz(radialVelocityMs, freqHz) {
  return 2 * radialVelocityMs * freqHz / C;
}

export function dopplerToVelocity(fdHz, freqHz) {
  return fdHz * C / (2 * freqHz);
}

// Maximum unambiguous radial velocity for a given PRF (the first blind speed).
export function blindSpeed(prfHz, lambdaM, n = 1) {
  return n * prfHz * lambdaM / 2;
}

// Velocity as a pulse-Doppler processor reports it, folded into +/- v_blind/2.
export function foldVelocity(vMs, prfHz, lambdaM) {
  const span = blindSpeed(prfHz, lambdaM, 1);
  if (span <= 0) return vMs;
  let v = ((vMs + span / 2) % span + span) % span - span / 2;
  return v;
}

// Simple MTI/clutter-filter response: a notch centred on zero radial velocity
// (and repeating at every blind speed) with a configurable half-width and
// rejection depth. Returns the attenuation applied to a return at that radial
// velocity, in dB (negative = attenuated).
export function mtiResponseDb(radialVelocityMs, { prfHz, lambdaM, notchHalfWidthMs, rejectionDb }) {
  const folded = Math.abs(foldVelocity(radialVelocityMs, prfHz, lambdaM));
  const hw = Math.max(notchHalfWidthMs, 0.01);
  if (folded >= hw) return 0;
  // Cosine-shaped notch skirt so returns near the edge are only partly rejected.
  const depth = Math.pow(Math.cos((folded / hw) * Math.PI / 2), 2);
  return -Math.max(rejectionDb, 0) * depth;
}

// Monostatic RCS of a right circular cylinder at broadside (normal incidence
// to its axis), the standard physical-optics result:
//
//   sigma = 2 * pi * a * h^2 / lambda
//
// This is the SPECULAR MAXIMUM for a smooth, perfectly conducting cylinder
// viewed exactly broadside. A real turbine tower is tapered, is not viewed at
// normal incidence from a radar at low elevation, and is not a perfect
// reflector, so measured RCS sits far below this. It is useful as a ceiling:
// an assumed RCS above it is not physical.
export function cylinderRcsDbsm(radiusM, heightM, lambdaM) {
  const sigma = 2 * Math.PI * Math.max(radiusM, 1e-3) * Math.pow(Math.max(heightM, 1e-3), 2)
    / Math.max(lambdaM, 1e-6);
  return linToDb(sigma);
}

// --------------------------------------------------------- near-field check
// Far-field (Fraunhofer) distance for an aperture of width D.
export function farFieldDistance(apertureM, lambdaM) {
  return 2 * apertureM * apertureM / Math.max(lambdaM, 1e-6);
}

// Aperture width implied by a 3 dB beamwidth, using the standard
// theta_3dB ~= k * lambda / D relation with k = 70 (degrees).
export function apertureFromBeamwidth(beamwidthDeg, lambdaM) {
  return 70 * lambdaM / Math.max(beamwidthDeg, 0.05);
}
