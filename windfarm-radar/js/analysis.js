// The assessment engine.
//
// SCOPE AND LIMITS - read before trusting an output.
//
// This is a FIRST-ORDER SCREENING MODEL. It composes published closed-form
// results (radar range equation, ITU-R P.526 knife-edge diffraction,
// Albersheim's detection approximation, equivalent-earth curvature) with a
// small number of engineering approximations that are called out explicitly in
// the comments and reproduced in the exported report's "method and limits"
// section.
//
// What it does NOT do: solve Maxwell's equations, model multipath or ground
// reflection lobing, model the real time-domain blade-flash signature, model a
// specific radar's actual signal processing chain, or use real terrain data.
// A formal assessment needs the radar operator's own model and real terrain.

import {
  effectiveEarthRadius, createTerrain, rasteriseTerrain, profileObstruction,
  viewGeometry, angleDelta, hypot2, clamp, lerp, horizonDistance,
  offsetByBearing, DEG, RAD, M_PER_FT,
} from './geo.js';

import {
  wavelength, receivedPowerW, noisePowerW, linToDb, dbToLin,
  albersheimSnrDb, albersheimInRange, knifeEdgeLossDb, fresnelParameter,
  fresnelRadius, azimuthGainDb, elevationGainDb, tipSpeed, dopplerHz,
  blindSpeed, foldVelocity, mtiResponseDb, rotorBlockageLossDb,
  matchedBandwidth, rangeResolution, unambiguousRange, pulsesPerScan,
  farFieldDistance, apertureFromBeamwidth,
} from './rf.js';

import {
  buildTurbines, buildTrack, towerDiameterAt, normaliseScenario,
  BLADE_CONSTRUCTIONS, TOWER_MATERIALS, DRIVETRAINS,
} from './model.js';
import { seaState, rmsWaveHeight, multipathFactorDb, seaClutterRcsDbsm } from './sea.js';
import { rotorRpm, roseSummary, sectorForDirection, operatingFractions } from './wind.js';
import { deriveFindings } from './findings.js';

const COAST_SCANS = 3;       // how long a tracker holds a target through a gap
const INIT_HITS = 2;         // plots needed to start a new track
const MASK_LOSS_DB = 25;     // two-way diffraction loss treated as fully masked

// --------------------------------------------------------------- radar setup

export function deriveRadar(r, terrain, ae) {
  const lambdaM = wavelength(r.freqHz);
  const bandwidthHz = matchedBandwidth(r.pulseWidthS, r.compressedBandwidthHz);
  const n = pulsesPerScan(r.prfHz, r.azBeamwidthDeg, r.rpm);
  const requiredSnrDb = albersheimSnrDb(r.pd, r.pfa, n) + (r.fluctuationMarginDb || 0);
  const groundM = terrain.heightAt(r.east, r.north);
  const apertureM = apertureFromBeamwidth(r.azBeamwidthDeg, lambdaM);

  return {
    ...r,
    lambdaM,
    bandwidthHz,
    g0Lin: dbToLin(r.gainDbi),
    noiseW: noisePowerW(bandwidthHz, r.noiseFigureDb),
    lossLin: dbToLin(r.systemLossDb),
    pulsesPerScan: n,
    requiredSnrDb,
    albersheimValid: albersheimInRange(r.pd, r.pfa),
    rangeResolutionM: rangeResolution(r.pulseWidthS, r.compressedBandwidthHz),
    unambiguousRangeM: unambiguousRange(r.prfHz),
    firstBlindSpeedMs: blindSpeed(r.prfHz, lambdaM, 1),
    groundM,
    amslM: groundM + r.heightAgl,
    site: { east: r.east, north: r.north, height: groundM + r.heightAgl },
    horizonM: horizonDistance(r.heightAgl, ae),
    apertureM,
    farFieldM: farFieldDistance(apertureM, lambdaM),
    scanPeriodS: 60 / Math.max(r.rpm, 0.01),
    atmosphericLossDbPerKm: r.atmosphericLossDbPerKm || 0,
  };
}

// Two-way atmospheric loss over a slant path. Gaseous absorption and rain are
// taken together as a single dB/km figure the user supplies, because this tool
// is not in a position to assert ITU-R P.676 or P.838 coefficients it has not
// read.
function atmosphericLossDb(radar, rangeM) {
  return 2 * (radar.atmosphericLossDbPerKm || 0) * (rangeM / 1000);
}

function twoWayGain(radar, elDeg, azOffsetDeg) {
  const el = elevationGainDb(elDeg, radar);
  const az = azimuthGainDb(azOffsetDeg, radar.azBeamwidthDeg, radar.rangeSidelobeDb > -60 ? -35 : -45);
  return radar.g0Lin * dbToLin(el + az);
}

// Time-sidelobe skirt of a strong return, expressed as the level at which it
// contaminates a range cell dR away. Parametric, not derived from a specific
// compression waveform.
function rangeSidelobeDb(dR, resolutionM, peakDb) {
  const cells = Math.abs(dR) / Math.max(resolutionM, 1);
  if (cells <= 1) return 0;
  return Math.max(peakDb - 20 * Math.log10(cells), -90);
}

// ------------------------------------------------------------- turbine model

// Angle between the radar line of sight and the rotor axis. The rotor axis
// points into the wind, so this is set by wind direction, and it is what
// decides how much blade Doppler the radar actually sees.
function rotorAspectDeg(turbine, bearingToRadar) {
  const axis = turbine.yawDeg;                 // rotor faces upwind
  const d = Math.abs(angleDelta(bearingToRadar, axis));
  return Math.min(d, 180 - d);                 // 0 = face-on, 90 = edge-on
}

// Fraction of blade-return power that survives the clutter filter. The blade
// spans radial velocities from 0 at the hub to v_max at the tip, so a
// zero-Doppler notch only removes the slow part of that spectrum - and any
// part that folds back into the notch at a blind speed.
//
// Approximation: blade power is taken as uniformly distributed in radial
// velocity across [0, v_max]. The real distribution is weighted by the RCS and
// chord distribution along the span. Screening-level assumption.
function clutterPassFraction(vMaxMs, mtiCfg, samples = 128) {
  if (vMaxMs <= 0.01) return dbToLin(mtiResponseDb(0, mtiCfg));
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = vMaxMs * (i + 0.5) / samples;
    sum += dbToLin(mtiResponseDb(v, mtiCfg));
  }
  return sum / samples;
}

export function assessTurbine(turbine, radar, terrain, ae, mit) {
  const lambdaM = radar.lambdaM;
  const site = radar.site;

  const hub = viewGeometry(site, { east: turbine.east, north: turbine.north, height: turbine.hubAmslM }, ae);
  const tip = viewGeometry(site, { east: turbine.east, north: turbine.north, height: turbine.tipAmslM }, ae);

  const losHub = profileObstruction(site, { east: turbine.east, north: turbine.north, height: turbine.hubAmslM }, terrain, ae, 96);
  const losTip = profileObstruction(site, { east: turbine.east, north: turbine.north, height: turbine.tipAmslM }, terrain, ae, 96);

  const vHub = fresnelParameter(losHub.clearance, losHub.d1, losHub.d2, lambdaM);
  const vTip = fresnelParameter(losTip.clearance, losTip.d1, losTip.d2, lambdaM);
  const terrainLossHubDb = 2 * knifeEdgeLossDb(vHub);
  const terrainLossTipDb = 2 * knifeEdgeLossDb(vTip);

  let visibility;
  if (terrainLossTipDb >= MASK_LOSS_DB) visibility = 'masked';
  else if (terrainLossHubDb >= MASK_LOSS_DB) visibility = 'tip-only';
  else if (terrainLossHubDb > 1) visibility = 'partial';
  else visibility = 'clear';

  // Rotor kinematics as the radar sees them.
  const bearingToRadar = (hub.bearing + 180) % 360;
  const aspectDeg = rotorAspectDeg(turbine, bearingToRadar);
  // The fleet model has already decided this machine's speed from the inflow
  // it sees and whether it is running at all. Curtailment stops everything.
  const rpm = mit.curtail.enabled ? 0 : turbine.rpm;
  const vTipMs = tipSpeed(turbine.rotorRadiusM, rpm);
  const vRadMaxMs = vTipMs * Math.sin(aspectDeg * DEG);
  const fdMaxHz = dopplerHz(vRadMaxMs, radar.freqHz);
  const foldedMs = foldVelocity(vRadMaxMs, radar.prfHz, lambdaM);

  const mtiCfg = {
    prfHz: radar.prfHz, lambdaM,
    notchHalfWidthMs: radar.mtiNotchMs,
    rejectionDb: radar.mtiRejectionDb,
  };

  const ramDb = mit.ram.enabled ? mit.ram.reductionDb : 0;
  const dopplerGainDb = (radar.dopplerSpreadGainDb || 0)
    + (mit.enhancedDoppler.enabled ? mit.enhancedDoppler.gainDb : 0);

  const passFraction = clutterPassFraction(vRadMaxMs, mtiCfg);
  const staticRejectionDb = mtiResponseDb(0, mtiCfg);   // negative

  // Blade RCS changes with the aspect the wind has yawed the rotor to. Rather
  // than invent a curve, the tool interpolates between the face-on and edge-on
  // values the user supplies, weighted by sin^2 of the aspect angle. Leaving
  // both equal reproduces an aspect-independent RCS.
  const sin2 = Math.pow(Math.sin(aspectDeg * DEG), 2);
  // What returns the signal inside a largely transparent glass shell is the
  // conductive structure: carbon spar caps and the lightning protection system.
  const construction = BLADE_CONSTRUCTIONS[turbine.construction] || null;
  const constructionDeltaDb = construction ? construction.bladeDeltaDb : 0;
  const bladeAspectDbsm = turbine.bladeRcsDbsm + constructionDeltaDb
    + ((turbine.bladeRcsEdgeOnDbsm ?? turbine.bladeRcsDbsm) - turbine.bladeRcsDbsm) * sin2;

  const towerMat = TOWER_MATERIALS[turbine.towerMaterial] || null;
  const towerDeltaDb = towerMat ? towerMat.towerDeltaDb : 0;

  // The nacelle and its drivetrain are stationary, so a clutter filter treats
  // them as it treats the tower. Their specular lobe is broadside to the rotor
  // axis, which is the same aspect that maximises blade Doppler.
  const drivetrain = DRIVETRAINS[turbine.drivetrain] || null;
  const nacelleDeltaDb = drivetrain ? drivetrain.nacelleDeltaDb : 0;
  const nacelleAspectDbsm = turbine.nacelleRcsHeadOnDbsm
    + (turbine.nacelleRcsDbsm - turbine.nacelleRcsHeadOnDbsm) * sin2
    + nacelleDeltaDb;

  const structureDbsm = linToDb(
    dbToLin(turbine.towerRcsDbsm + towerDeltaDb) + dbToLin(nacelleAspectDbsm));
  const towerEffDbsm = structureDbsm - ramDb + staticRejectionDb;
  const bladeEffDbsm = bladeAspectDbsm - ramDb + linToDb(Math.max(passFraction, 1e-9)) - dopplerGainDb;
  const effectiveRcsDbsm = linToDb(dbToLin(towerEffDbsm) + dbToLin(bladeEffDbsm));
  const rawRcsDbsm = linToDb(dbToLin(structureDbsm) + dbToLin(bladeAspectDbsm)) - ramDb;

  // Return strength when the beam is pointed straight at the turbine.
  const gain = twoWayGain(radar, hub.elevationDeg, 0);
  const lossLin = radar.lossLin * dbToLin(terrainLossHubDb + atmosphericLossDb(radar, hub.slant));
  const prEff = receivedPowerW({
    ptW: radar.peakPowerW, gTx: gain, gRx: gain, lambdaM,
    sigmaM2: dbToLin(effectiveRcsDbsm), rangeM: hub.slant, lossLin,
  });
  const prRaw = receivedPowerW({
    ptW: radar.peakPowerW, gTx: gain, gRx: gain, lambdaM,
    sigmaM2: dbToLin(rawRcsDbsm), rangeM: hub.slant, lossLin,
  });

  const snrEffDb = linToDb(prEff / radar.noiseW);
  const snrRawDb = linToDb(prRaw / radar.noiseW);

  // A turbine return above the detection threshold, after clutter filtering,
  // is a plot the radar cannot tell from an aircraft.
  const falsePlot = visibility !== 'masked' && snrEffDb >= radar.requiredSnrDb;

  // Where the folded blade velocity lands decides whether the false plot looks
  // like a slow-moving aircraft to the tracker.
  const apparentSpeedKt = Math.abs(foldedMs) / 0.514444;

  return {
    turbine,
    hub, tip,
    losHub, losTip,
    visibility,
    terrainLossHubDb, terrainLossTipDb,
    aspectDeg,
    bladeAspectDbsm,
    constructionDeltaDb,
    towerDeltaDb,
    nacelleAspectDbsm,
    nacelleDeltaDb,
    structureDbsm,
    rpm,
    vTipMs,
    vRadMaxMs,
    fdMaxHz,
    foldedMs,
    apparentSpeedKt,
    passFraction,
    towerEffDbsm, bladeEffDbsm, effectiveRcsDbsm, rawRcsDbsm,
    snrEffDb, snrRawDb,
    falsePlot,
    saturating: snrRawDb > radar.dynamicRangeDb,
    beyondHorizon: losTip.blocked && terrainLossTipDb >= MASK_LOSS_DB && hub.ground > radar.horizonM,
    secondTimeAround: hub.slant > radar.unambiguousRangeM,
    apparentRangeM: hub.slant % radar.unambiguousRangeM,
  };
}

// ----------------------------------------------------- shadowing by turbines
//
// A turbine standing near the radar-to-target path costs the path some signal.
// Two contributions are modelled:
//
//   tower  - a solid knife edge, but only as wide as the tower, so the
//            classical (infinitely wide) knife-edge loss is scaled by the
//            fraction of the first Fresnel zone the tower actually spans.
//   rotor  - a partially filling screen: the blades occupy only the rotor
//            solidity fraction of the swept disc.
//
// The Fresnel-fraction scaling of the tower term is an engineering
// approximation made for this tool. It is not a published model. It has the
// right limits: close behind the tower the Fresnel zone is small and the full
// knife-edge loss applies; far away the zone is large and the tower is a minor
// obstruction.

export function turbineShadowLossDb(turbines, radar, a, b, ae) {
  const dEast = b.east - a.east;
  const dNorth = b.north - a.north;
  const D = hypot2(dEast, dNorth);
  if (D < 1) return { totalDb: 0, contributors: [] };

  const ux = dEast / D;
  const uz = dNorth / D;
  const lambdaM = radar.lambdaM;
  const contributors = [];
  let totalDb = 0;

  for (const t of turbines) {
    const px = t.east - a.east;
    const pz = t.north - a.north;
    const d1 = px * ux + pz * uz;
    if (d1 <= 50 || d1 >= D - 1) continue;
    const d2 = D - d1;
    const lateral = Math.abs(-px * uz + pz * ux);
    if (lateral > t.rotorRadiusM + 400) continue;

    const f1 = Math.max(fresnelRadius(d1, d2, lambdaM), 0.1);

    // Height of the ray above datum at the turbine, with curvature applied the
    // same way the rest of the model applies it.
    const bEff = b.height - (D * D) / (2 * ae);
    const rayH = lerp(a.height, bEff, d1 / D);
    const drop = (d1 * d1) / (2 * ae);

    // --- tower / nacelle: solid, narrow, and tapered, so the width that
    //     matters is the diameter at the height the ray passes.
    const towerTopEff = (t.groundM + t.hubHeightM) - drop;
    const towerClearance = towerTopEff - rayH;
    const rayHeightAboveBase = rayH - (t.groundM - drop);
    const towerWidth = towerDiameterAt(t, rayHeightAboveBase);
    const towerLateralHit = lateral < (towerWidth / 2 + f1);
    let towerDb = 0;
    if (towerLateralHit && towerClearance > -f1) {
      const full = knifeEdgeLossDb(fresnelParameter(towerClearance, d1, d2, lambdaM));
      const fresnelFraction = clamp(towerWidth / (2 * f1), 0, 1);
      towerDb = full * fresnelFraction;
    }

    // --- rotor disc: wide, mostly empty
    let rotorDb = 0;
    const hubEff = (t.groundM + t.hubHeightM) - drop;
    const dv = Math.abs(rayH - hubEff);
    const insideDisc = dv < t.rotorRadiusM && lateral < t.rotorRadiusM;
    if (insideDisc) {
      // Fraction of the disc radius at which the ray passes, used to taper the
      // blade density the ray actually sees (blades are thinner near the hub).
      const rFrac = Math.sqrt(dv * dv + lateral * lateral) / t.rotorRadiusM;
      const localSolidity = t.solidity * (0.4 + 0.6 * rFrac);
      rotorDb = rotorBlockageLossDb(localSolidity);
    }

    const oneWay = towerDb + rotorDb;
    if (oneWay > 0.01) {
      const twoWay = 2 * oneWay;
      totalDb += twoWay;
      contributors.push({
        id: t.id, d1, d2, lateral, f1,
        towerClearance, towerDb, rotorDb, twoWayDb: twoWay,
      });
    }
  }

  return { totalDb, contributors };
}

// --------------------------------------------------------- clutter at a cell

export function clutterPowerW(turbineResults, radar, targetGeom) {
  let pc = 0;
  const contributors = [];
  for (const tr of turbineResults) {
    if (tr.visibility === 'masked') continue;
    const dAz = angleDelta(tr.hub.bearing, targetGeom.bearing);
    const dR = tr.hub.slant - targetGeom.slant;
    const slDb = rangeSidelobeDb(dR, radar.rangeResolutionM, radar.rangeSidelobeDb);
    if (slDb <= -89) continue;
    const gain = twoWayGain(radar, tr.hub.elevationDeg, dAz);
    const p = receivedPowerW({
      ptW: radar.peakPowerW, gTx: gain, gRx: gain, lambdaM: radar.lambdaM,
      sigmaM2: dbToLin(tr.effectiveRcsDbsm), rangeM: tr.hub.slant,
      lossLin: radar.lossLin * dbToLin(tr.terrainLossHubDb),
    }) * dbToLin(slDb);
    if (p > 0) {
      pc += p;
      contributors.push({ id: tr.turbine.id, powerW: p, dAz, dR, slDb });
    }
  }
  contributors.sort((a, b) => b.powerW - a.powerW);
  return { powerW: pc, contributors: contributors.slice(0, 5) };
}

// ----------------------------------------------------------- surface effects

// Everything about the surface between the radar and the target that the
// point-level assessment needs.
export function buildSurface(scenario) {
  const site = scenario.site;
  const offshore = site.environment === 'offshore';
  const hs = site.significantWaveHeightM;
  const state = seaState(hs);
  return {
    offshore,
    surfaceAmslM: offshore ? site.seaLevelM : null,
    significantWaveHeightM: hs,
    seaState: state,
    rmsHeightM: offshore ? rmsWaveHeight(hs) : 0.5,
    windMs: scenario.wind.speedMs,
    seaClutter: site.seaClutter,
    multipath: {
      enabled: !!site.multipath.enabled,
      reflectionMag: offshore ? site.multipath.reflectionMag : site.multipath.landReflectionMag,
    },
  };
}

// Sea clutter competing with a target in the same resolution cell. Distributed
// clutter, so its RCS is sigma-zero times the illuminated cell area, and it is
// not stationary: wave motion spreads it in Doppler so a zero-velocity notch
// does not remove all of it.
function seaClutterAt(radar, geom, surface) {
  if (!surface.offshore || !surface.seaClutter.enabled) return null;
  const grazing = Math.atan2(Math.max(radar.heightAgl, 1), Math.max(geom.ground, 1));
  const c = seaClutterRcsDbsm({
    grazingRad: grazing,
    seaStateCode: surface.seaState.code,
    freqHz: radar.freqHz,
    rangeM: geom.slant,
    azBeamwidthDeg: radar.azBeamwidthDeg,
    rangeResolutionM: radar.rangeResolutionM,
    windMs: surface.windMs,
    notchHalfWidthMs: radar.mtiNotchMs,
    maxRejectionDb: surface.seaClutter.maxRejectionDb,
    spreadPerWindMs: surface.seaClutter.spreadPerWindMs,
    cfg: surface.seaClutter,
  });
  const gain = twoWayGain(radar, 0, 0);          // clutter sits on the surface
  const powerW = receivedPowerW({
    ptW: radar.peakPowerW, gTx: gain, gRx: gain, lambdaM: radar.lambdaM,
    sigmaM2: dbToLin(c.effectiveDbsm), rangeM: geom.slant, lossLin: radar.lossLin,
  });
  return { ...c, powerW, grazingDeg: grazing * RAD };
}

// Surface multipath. Heights are measured above the reflecting surface, which
// is sea level offshore and the local ground elevation over land.
function multipathAt(radar, geom, point, surface, ae) {
  if (!surface.multipath.enabled) return 0;
  const base = surface.offshore ? surface.surfaceAmslM : point.groundM;
  const hr = Math.max(radar.amslM - base, 1);
  const ht = Math.max(point.amsl - base, 1);
  return multipathFactorDb({
    antennaHeightM: hr, targetHeightM: ht, rangeM: geom.slant,
    lambdaM: radar.lambdaM, rmsHeightM: surface.rmsHeightM,
    reflectionMag: surface.multipath.reflectionMag,
  });
}

// -------------------------------------------------------------- track points

export function assessPoint(point, radar, turbineResults, turbines, terrain, ae, target, surface) {
  const p = { east: point.east, north: point.north, height: point.amsl };
  const geom = viewGeometry(radar.site, p, ae);

  const outOfRange = geom.ground > radar.instrumentedRangeM;

  const losTerrain = profileObstruction(radar.site, p, terrain, ae, 72);
  const vTerr = fresnelParameter(losTerrain.clearance, losTerrain.d1, losTerrain.d2, radar.lambdaM);
  const terrainLossDb = 2 * knifeEdgeLossDb(vTerr);

  const shadow = turbineShadowLossDb(turbines, radar, radar.site, p, ae);

  const gain = twoWayGain(radar, geom.elevationDeg, 0);
  const atmosDb = atmosphericLossDb(radar, geom.slant);
  const multipathDb = surface ? multipathAt(radar, geom, point, surface, ae) : 0;
  const lossLin = radar.lossLin * dbToLin(terrainLossDb + shadow.totalDb + atmosDb - multipathDb);
  const ps = receivedPowerW({
    ptW: radar.peakPowerW, gTx: gain, gRx: gain, lambdaM: radar.lambdaM,
    sigmaM2: dbToLin(target.rcsDbsm), rangeM: geom.slant, lossLin,
  });

  const clutter = clutterPowerW(turbineResults, radar, geom);
  const sea = surface ? seaClutterAt(radar, geom, surface) : null;
  const totalClutterW = clutter.powerW + (sea ? sea.powerW : 0);

  const snrDb = linToDb(ps / radar.noiseW);
  const sinrDb = linToDb(ps / (radar.noiseW + totalClutterW));
  const scrDb = totalClutterW > 0 ? linToDb(ps / totalClutterW) : Infinity;
  const marginDb = sinrDb - radar.requiredSnrDb;
  // Attribute the cost to its cause. The turbine cost is what the wind farm
  // alone takes; the sea cost is what adding the sea surface takes on top of
  // that. Reporting the total against the wind farm would blame it for clutter
  // it did not produce.
  const withTurbinesOnlyDb = linToDb(ps / (radar.noiseW + clutter.powerW));
  const turbineClutterCostDb = snrDb - withTurbinesOnlyDb;
  const seaClutterCostDb = sea ? withTurbinesOnlyDb - sinrDb : 0;
  const clutterCostDb = snrDb - sinrDb;

  // Target's own radial velocity decides whether it survives the clutter notch.
  const courseToRadar = (geom.bearing + 180) % 360;
  const radialMs = -point.speedMs * Math.cos((point.headingDeg - courseToRadar) * DEG);
  const targetMtiDb = mtiResponseDb(radialMs, {
    prfHz: radar.prfHz, lambdaM: radar.lambdaM,
    notchHalfWidthMs: radar.mtiNotchMs, rejectionDb: radar.mtiRejectionDb,
  });
  const tangential = Math.abs(targetMtiDb) > 3;
  const effectiveMarginDb = marginDb + targetMtiDb;

  let status;
  if (outOfRange) status = 'no-cover';
  else if (terrainLossDb >= MASK_LOSS_DB) status = 'terrain-masked';
  else if (effectiveMarginDb >= 3) status = 'detected';
  else if (effectiveMarginDb >= 0) status = 'marginal';
  else status = 'lost';

  return {
    ...point,
    geom, outOfRange,
    terrainLossDb, shadowLossDb: shadow.totalDb, shadowContributors: shadow.contributors,
    atmosphericLossDb: atmosDb, multipathDb,
    snrDb, sinrDb, scrDb, marginDb, effectiveMarginDb,
    clutterCostDb, turbineClutterCostDb, seaClutterCostDb,
    clutterW: clutter.powerW, clutterContributors: clutter.contributors,
    seaClutter: sea,
    radialMs, targetMtiDb, tangential,
    status,
  };
}

// ----------------------------------------------------------- mitigation zones

function fitBlanking(turbineResults, mit) {
  const visible = turbineResults.filter((t) => t.visibility !== 'masked');
  if (!visible.length) return null;
  let rMin = Infinity, rMax = -Infinity;
  let azRef = visible[0].hub.bearing;
  let azMin = 0, azMax = 0;
  for (const t of visible) {
    rMin = Math.min(rMin, t.hub.slant);
    rMax = Math.max(rMax, t.hub.slant);
    const d = angleDelta(t.hub.bearing, azRef);
    azMin = Math.min(azMin, d);
    azMax = Math.max(azMax, d);
  }
  return {
    rangeMinM: Math.max(0, rMin - mit.blanking.marginM),
    rangeMaxM: rMax + mit.blanking.marginM,
    azMinDeg: (azRef + azMin - mit.blanking.marginDeg + 360) % 360,
    azMaxDeg: (azRef + azMax + mit.blanking.marginDeg + 360) % 360,
    centreDeg: (azRef + (azMin + azMax) / 2 + 360) % 360,
    halfWidthDeg: (azMax - azMin) / 2 + mit.blanking.marginDeg,
  };
}

function insideZone(geom, zone) {
  if (!zone) return false;
  if (geom.slant < zone.rangeMinM || geom.slant > zone.rangeMaxM) return false;
  return Math.abs(angleDelta(geom.bearing, zone.centreDeg)) <= zone.halfWidthDeg;
}

function zoneAreaKm2(zone) {
  if (!zone) return 0;
  const frac = (2 * zone.halfWidthDeg) / 360;
  const a = Math.PI * (zone.rangeMaxM ** 2 - zone.rangeMinM ** 2) * frac;
  return a / 1e6;
}

// ------------------------------------------------------------------ analysis

export function analyse(scenario, opts = {}) {
  normaliseScenario(scenario);
  const ae = effectiveEarthRadius(scenario.environment.kFactor);
  const tcfg = scenario.environment.terrain;

  const ridgePos = offsetByBearing(tcfg.ridge.distanceM, tcfg.ridge.bearingFromRadarDeg);
  const terrainSource = createTerrain({
    relief: tcfg.relief,
    featureSize: tcfg.featureSize,
    seed: tcfg.seed,
    baseHeight: tcfg.baseHeight,
    ridge: {
      enabled: tcfg.ridge.enabled,
      east: scenario.radar.east + ridgePos.east,
      north: scenario.radar.north + ridgePos.north,
      bearingDeg: tcfg.ridge.orientationDeg,
      height: tcfg.ridge.height,
      halfWidth: tcfg.ridge.halfWidth,
      length: tcfg.ridge.length,
    },
  });

  const extent = opts.extentM || Math.max(
    scenario.farm.centreRangeM * 1.9,
    scenario.target.startRangeM * 1.35,
    scenario.target.endRangeM * 1.35,
    scenario.target.approachStartRangeM * 1.25,
    14000,
  );
  // Imported elevation data, where the user has supplied it, replaces the
  // synthetic surface entirely. It is passed in at call time rather than held
  // in the scenario, because a raster does not belong in a saved settings blob.
  const terrain = (opts.importedTerrain && tcfg.source === 'imported')
    ? opts.importedTerrain
    : rasteriseTerrain(terrainSource, { halfExtent: extent, size: 512 });

  const surface = buildSurface(scenario);
  const radar = deriveRadar(scenario.radar, terrain, ae);
  const turbines = buildTurbines(scenario, terrain);
  const track = buildTrack(scenario, terrain);
  const mit = scenario.mitigation;

  const turbineResults = turbines.map((t) => assessTurbine(t, radar, terrain, ae, mit));

  // Optional in-fill radar, sited to see the airspace the primary cannot.
  let infill = null;
  let infillTurbines = null;
  if (mit.infill.enabled) {
    const pos = offsetByBearing(mit.infill.rangeM, mit.infill.bearingDeg);
    infill = deriveRadar({
      ...scenario.radar,
      east: scenario.radar.east + pos.east,
      north: scenario.radar.north + pos.north,
      heightAgl: mit.infill.heightAgl,
      gainDbi: mit.infill.gainDbi,
      peakPowerW: mit.infill.peakPowerW,
      instrumentedRangeM: mit.infill.instrumentedRangeM,
    }, terrain, ae);
    infillTurbines = turbines.map((t) => assessTurbine(t, infill, terrain, ae, mit));
  }

  const blankZone = mit.blanking.enabled
    ? (mit.blanking.autoFit ? fitBlanking(turbineResults, mit) : {
        rangeMinM: mit.blanking.rangeMinM, rangeMaxM: mit.blanking.rangeMaxM,
        centreDeg: (mit.blanking.azMinDeg + mit.blanking.azMaxDeg) / 2,
        halfWidthDeg: Math.abs(angleDelta(mit.blanking.azMaxDeg, mit.blanking.azMinDeg)) / 2,
      })
    : null;

  // A turbine return can be above the detection threshold and still never
  // reach the display, because blanking removes the whole cell. Both numbers
  // matter: the first says what the receiver sees, the second what a
  // controller sees.
  for (const tr of turbineResults) {
    tr.blanked = !!(blankZone && insideZone(tr.hub, blankZone));
    tr.plotted = tr.falsePlot && !tr.blanked;
  }

  const naizZone = mit.naiz.enabled
    ? fitBlanking(turbineResults, { blanking: { marginM: mit.naiz.marginM, marginDeg: mit.naiz.marginDeg } })
    : null;

  // --- per-point assessment plus a simple tracker
  const points = [];
  let established = false;
  let hits = 0;
  let misses = 0;

  for (const p of track) {
    const r = assessPoint(p, radar, turbineResults, turbines, terrain, ae, scenario.target, surface);
    r.blanked = insideZone(r.geom, blankZone);
    r.inNaiz = insideZone(r.geom, naizZone);

    let plot = !r.blanked && (r.status === 'detected' || r.status === 'marginal');

    if (infill) {
      const ri = assessPoint(p, infill, infillTurbines, turbines, terrain, ae, scenario.target, surface);
      r.infill = {
        status: ri.status, marginDb: ri.effectiveMarginDb,
        slantM: ri.geom.slant, bearingDeg: ri.geom.bearing,
      };
      const infillPlot = ri.status === 'detected' || ri.status === 'marginal';
      if (infillPlot && !plot) r.recoveredByInfill = true;
      plot = plot || infillPlot;
    }

    r.plot = plot;

    if (plot) {
      if (established) {
        misses = 0;
      } else if (r.inNaiz) {
        hits = 0;          // track initiation inhibited inside the zone
        r.initiationBlocked = true;
      } else {
        hits += 1;
        if (hits >= INIT_HITS) established = true;
      }
    } else {
      hits = 0;
      if (established) {
        misses += 1;
        if (misses > COAST_SCANS) established = false;
        else r.coasting = true;
      }
    }
    r.tracked = established;
    points.push(r);
  }

  // The first sample or two of any flight are the tracker establishing itself,
  // not a coverage problem. Mark them so they are not reported as a gap.
  const firstTracked = points.findIndex((p) => p.tracked);
  if (firstTracked > 0) {
    for (let i = 0; i < firstTracked; i++) {
      if (points[i].plot) points[i].warmup = true;
    }
  }

  const coverage = opts.skipCoverage ? null
    : computeCoverage(scenario, radar, infill, turbineResults, infillTurbines, turbines, terrain, ae, extent, blankZone, surface);

  const summary = summarise(scenario, radar, turbineResults, points, blankZone, naizZone);
  const findings = deriveFindings(scenario, radar, turbineResults, points, summary, blankZone, naizZone, infill, surface);

  return {
    scenario, ae, terrain, terrainSource, extent, surface,
    radar, infill, turbines, turbineResults, points, coverage,
    blankZone, naizZone, summary, findings,
  };
}

// ------------------------------------------------------------ wind rose sweep
//
// The single-condition view answers "what happens in this wind". The sweep
// answers the question an assessment actually has to answer: how often does
// this happen across the site's wind climate, and which direction is worst.
//
// Each sector is assessed at rated rotor speed, which is the worst case while
// the machine is generating, and the exposure is weighted by how often that
// direction occurs and how much of that time the turbine is actually turning.

export function analyseWindRose(scenario, opts = {}) {
  const base = JSON.parse(JSON.stringify(scenario));
  const control = {
    cutInMs: base.wind.cutInMs, ratedMs: base.wind.ratedMs,
    cutOutMs: base.wind.cutOutMs, ratedRpm: base.farm.rpm,
    idleFraction: base.wind.idleFraction,
  };
  const climate = roseSummary(base.wind.rose, base.wind.weibullK, control);

  const sectors = climate.sectors.map((sector) => {
    const s = JSON.parse(JSON.stringify(base));
    s.wind.directionDeg = sector.directionDeg;
    // Rated speed: the worst case for blade Doppler while generating.
    s.wind.speedMs = Math.max(s.wind.ratedMs, sector.meanSpeedMs);
    s.site.waveFromWind = base.site.waveFromWind;
    const r = analyse(s, { ...opts, skipCoverage: true });
    const exposure = sector.frequency * sector.generating;
    return {
      directionDeg: sector.directionDeg,
      frequency: sector.frequency,
      meanSpeedMs: sector.meanSpeedMs,
      generating: sector.generating,
      belowCutIn: sector.belowCutIn,
      aboveCutOut: sector.aboveCutOut,
      exposure,
      plots: r.summary.displayedPlotCount,
      returnsAboveThreshold: r.summary.falsePlotCount,
      maxDopplerHz: r.summary.maxDopplerHz,
      maxTurbineSnrDb: r.summary.maxTurbineSnrDb,
      untracked: r.summary.untrackedCount,
      trackPoints: r.summary.trackPoints,
      untrackedFraction: r.summary.untrackedFraction,
      worstMarginDb: r.summary.worstPoint ? r.summary.worstPoint.effectiveMarginDb : NaN,
      maxAspectDeg: Math.max(...r.turbineResults.map((t) => t.aspectDeg)),
    };
  });

  const withPlots = sectors.filter((x) => x.plots > 0);
  const worstPlots = sectors.reduce((a, x) => (x.plots > a.plots ? x : a), sectors[0]);
  const worstTrack = sectors.reduce(
    (a, x) => (x.untrackedFraction > a.untrackedFraction ? x : a), sectors[0]);
  const worstDoppler = sectors.reduce(
    (a, x) => (x.maxDopplerHz > a.maxDopplerHz ? x : a), sectors[0]);
  const quietest = sectors.reduce(
    (a, x) => (x.maxDopplerHz < a.maxDopplerHz ? x : a), sectors[0]);

  const assessedSector = sectorForDirection(base.wind.rose, scenario.wind.directionDeg);
  const assessed = sectors.reduce((a, x) => (
    Math.abs(angleDelta(x.directionDeg, scenario.wind.directionDeg))
      < Math.abs(angleDelta(a.directionDeg, scenario.wind.directionDeg)) ? x : a), sectors[0]);

  return {
    sectors,
    climate,
    control,
    // Fraction of the year with at least one turbine plot on the display.
    exposureWithPlots: withPlots.reduce((a, x) => a + x.exposure, 0),
    exposureUntracked: sectors.reduce((a, x) => a + x.exposure * x.untrackedFraction, 0),
    generatingFraction: climate.generatingFraction,
    worstPlots,
    worstTrack,
    worstDoppler,
    quietest,
    assessedDirectionDeg: scenario.wind.directionDeg,
    assessed,
    assessedFrequency: assessedSector ? assessedSector.frequency : 0,
  };
}

// --------------------------------------------------------------- coverage map

function computeCoverage(scenario, radar, infill, turbineResults, infillTurbines, turbines, terrain, ae, extent, blankZone, surface) {
  const size = 96;
  const step = (2 * extent) / (size - 1);
  const amsl = scenario.target.altitudeFt * M_PER_FT;
  const margin = new Float32Array(size * size);
  const clean = new Float32Array(size * size);
  const flags = new Uint8Array(size * size);

  const probe = { speedMs: 0, headingDeg: 0 };

  for (let j = 0; j < size; j++) {
    const north = -extent + j * step;
    for (let i = 0; i < size; i++) {
      const east = -extent + i * step;
      const idx = j * size + i;
      const p = { east, north, height: Math.max(amsl, terrain.heightAt(east, north) + 30) };
      const geom = viewGeometry(radar.site, p, ae);

      if (geom.ground > radar.instrumentedRangeM) {
        margin[idx] = NaN; clean[idx] = NaN; flags[idx] = 4;
        continue;
      }

      const los = profileObstruction(radar.site, p, terrain, ae, 40);
      const terrainLossDb = 2 * knifeEdgeLossDb(
        fresnelParameter(los.clearance, los.d1, los.d2, radar.lambdaM));
      const shadow = turbineShadowLossDb(turbines, radar, radar.site, p, ae);
      const gain = twoWayGain(radar, geom.elevationDeg, 0);

      const atmosDb = atmosphericLossDb(radar, geom.slant);
      const mp = surface
        ? multipathAt(radar, geom, { amsl: p.height, groundM: terrain.heightAt(east, north) }, surface, ae)
        : 0;
      const psClean = receivedPowerW({
        ptW: radar.peakPowerW, gTx: gain, gRx: gain, lambdaM: radar.lambdaM,
        sigmaM2: dbToLin(scenario.target.rcsDbsm), rangeM: geom.slant,
        lossLin: radar.lossLin * dbToLin(terrainLossDb + atmosDb - mp),
      });
      const ps = psClean * dbToLin(-shadow.totalDb);
      const clutter = clutterPowerW(turbineResults, radar, geom);
      const sea = surface ? seaClutterAt(radar, geom, surface) : null;
      const totalClutterW = clutter.powerW + (sea ? sea.powerW : 0);

      clean[idx] = linToDb(psClean / radar.noiseW) - radar.requiredSnrDb;
      let m = linToDb(ps / (radar.noiseW + totalClutterW)) - radar.requiredSnrDb;

      if (infill) {
        const gi = viewGeometry(infill.site, p, ae);
        if (gi.ground <= infill.instrumentedRangeM) {
          const losI = profileObstruction(infill.site, p, terrain, ae, 32);
          const lossI = 2 * knifeEdgeLossDb(
            fresnelParameter(losI.clearance, losI.d1, losI.d2, infill.lambdaM));
          const gainI = twoWayGain(infill, gi.elevationDeg, 0);
          const psI = receivedPowerW({
            ptW: infill.peakPowerW, gTx: gainI, gRx: gainI, lambdaM: infill.lambdaM,
            sigmaM2: dbToLin(scenario.target.rcsDbsm), rangeM: gi.slant,
            lossLin: infill.lossLin * dbToLin(lossI),
          });
          const cI = clutterPowerW(infillTurbines, infill, gi);
          const mI = linToDb(psI / (infill.noiseW + cI.powerW)) - infill.requiredSnrDb;
          if (mI > m) { m = mI; flags[idx] |= 2; }
        }
      }

      if (blankZone && insideZone(geom, blankZone)) {
        flags[idx] |= 1;
        m = -60;
      }
      margin[idx] = m;
    }
  }
  return { size, step, extent, amsl, margin, clean, flags };
}

// ----------------------------------------------------------------- summary

function summarise(scenario, radar, turbineResults, points, blankZone, naizZone) {
  const visible = turbineResults.filter((t) => t.visibility !== 'masked');
  const falsePlots = turbineResults.filter((t) => t.falsePlot);
  const displayedPlots = turbineResults.filter((t) => t.plotted);
  const suppressedPlots = turbineResults.filter((t) => t.falsePlot && t.blanked);
  const saturating = turbineResults.filter((t) => t.saturating);
  const ranges = turbineResults.map((t) => t.hub.ground);

  const inCover = points.filter((p) => !p.outOfRange);
  const lost = inCover.filter((p) => p.status === 'lost' || p.status === 'terrain-masked');
  const marginal = inCover.filter((p) => p.status === 'marginal');
  const blanked = inCover.filter((p) => p.blanked);
  const untracked = inCover.filter((p) => !p.tracked && !p.warmup);
  const recovered = inCover.filter((p) => p.recoveredByInfill);

  let worstPoint = null;
  for (const p of inCover) {
    if (!worstPoint || p.effectiveMarginDb < worstPoint.effectiveMarginDb) worstPoint = p;
  }
  let worstClutter = null;
  for (const p of inCover) {
    if (!worstClutter || p.turbineClutterCostDb > worstClutter.turbineClutterCostDb) worstClutter = p;
  }
  let worstSeaClutter = null;
  for (const p of inCover) {
    if (!worstSeaClutter || (p.seaClutterCostDb || 0) > (worstSeaClutter.seaClutterCostDb || 0)) {
      worstSeaClutter = p;
    }
  }
  let worstShadow = null;
  for (const p of inCover) {
    if (!worstShadow || p.shadowLossDb > worstShadow.shadowLossDb) worstShadow = p;
  }

  // Longest continuous run of untracked points, in seconds and metres.
  let gapPts = 0, bestGap = 0, gapStart = null, bestGapStart = null, bestGapEnd = null;
  let run = null;
  for (const p of inCover) {
    if (!p.tracked && !p.warmup) {
      if (!run) run = { start: p, end: p, n: 0 };
      run.end = p; run.n += 1;
    } else if (run) {
      if (run.n > bestGap) { bestGap = run.n; bestGapStart = run.start; bestGapEnd = run.end; }
      run = null;
    }
  }
  if (run && run.n > bestGap) { bestGap = run.n; bestGapStart = run.start; bestGapEnd = run.end; }

  const gapSeconds = bestGapStart && bestGapEnd ? Math.abs(bestGapEnd.timeS - bestGapStart.timeS) : 0;
  const gapMetres = bestGapStart && bestGapEnd ? Math.abs(bestGapEnd.alongM - bestGapStart.alongM) : 0;

  return {
    turbineCount: turbineResults.length,
    visibleCount: visible.length,
    maskedCount: turbineResults.length - visible.length,
    falsePlotCount: falsePlots.length,
    displayedPlotCount: displayedPlots.length,
    suppressedPlotCount: suppressedPlots.length,
    saturatingCount: saturating.length,
    nearestTurbineM: ranges.length ? Math.min(...ranges) : NaN,
    farthestTurbineM: ranges.length ? Math.max(...ranges) : NaN,
    maxTurbineSnrDb: turbineResults.reduce((a, t) => Math.max(a, t.snrEffDb), -Infinity),
    maxDopplerHz: turbineResults.reduce((a, t) => Math.max(a, t.fdMaxHz), 0),
    maxApparentSpeedKt: turbineResults.reduce((a, t) => Math.max(a, t.apparentSpeedKt), 0),
    trackPoints: inCover.length,
    lostCount: lost.length,
    marginalCount: marginal.length,
    blankedCount: blanked.length,
    untrackedCount: untracked.length,
    recoveredCount: recovered.length,
    lostFraction: inCover.length ? lost.length / inCover.length : 0,
    untrackedFraction: inCover.length ? untracked.length / inCover.length : 0,
    worstPoint, worstClutter, worstSeaClutter, worstShadow,
    longestGapPoints: bestGap,
    longestGapSeconds: gapSeconds,
    longestGapMetres: gapMetres,
    gapStart: bestGapStart, gapEnd: bestGapEnd,
    blankedAreaKm2: zoneAreaKm2(blankZone),
    naizAreaKm2: zoneAreaKm2(naizZone),
  };
}

