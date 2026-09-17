// Scenario model: defaults, presets, derived quantities and persistence.
//
// IMPORTANT ON THE NUMBERS BELOW.
// The radar presets are REPRESENTATIVE parameter sets chosen to be plausible
// for each class of radar. They are not taken from any manufacturer datasheet
// and must not be used as if they were. Replace them with the real parameters
// for the radar you are assessing before drawing any conclusion.
//
// The same applies to radar cross-section. CAP 764 states plainly that,
// given the number of factors affecting turbine RCS, no 'standard' RCS can be
// identified for micro, medium or large wind turbines. The defaults here sit
// inside the range reported in the open literature (roughly 20 to 45 dBsm at
// microwave frequencies) and exist so the tool starts somewhere sensible, not
// because they are authoritative.

import { DEG, RAD, offsetByBearing, bearingOf, hypot2, clamp } from './geo.js';
import { wavelength, tipSpeed, rotorSolidity } from './rf.js';

export const STORAGE_KEY = 'windfarm-radar-scenario-v1';

export const RADAR_PRESETS = {
  'psr-terminal': {
    label: 'Terminal PSR (S-band)',
    note: 'Airport approach primary radar, solid-state with pulse compression.',
    freqHz: 2.8e9, peakPowerW: 25000, gainDbi: 34,
    azBeamwidthDeg: 1.4, elBeamwidthDeg: 4.8, elPeakDeg: 4.0, cscMaxDeg: 30,
    pulseWidthS: 60e-6, compressedBandwidthHz: 1.2e6, prfHz: 1100, rpm: 15,
    noiseFigureDb: 3.5, systemLossDb: 6, mtiRejectionDb: 45, mtiNotchMs: 4,
    dopplerSpreadGainDb: 0, rangeSidelobeDb: -35, dynamicRangeDb: 70,
    heightAgl: 12, instrumentedRangeM: 110000,
  },
  'psr-enroute': {
    label: 'En-route PSR (L-band)',
    note: 'Long-range area surveillance primary radar.',
    freqHz: 1.3e9, peakPowerW: 60000, gainDbi: 34,
    azBeamwidthDeg: 1.3, elBeamwidthDeg: 4.0, elPeakDeg: 3.5, cscMaxDeg: 40,
    pulseWidthS: 100e-6, compressedBandwidthHz: 1.0e6, prfHz: 750, rpm: 6,
    noiseFigureDb: 3.0, systemLossDb: 6, mtiRejectionDb: 48, mtiNotchMs: 5,
    dopplerSpreadGainDb: 0, rangeSidelobeDb: -38, dynamicRangeDb: 75,
    heightAgl: 20, instrumentedRangeM: 260000,
  },
  'ad-long': {
    label: 'Air defence surveillance (L-band, 3D)',
    note: 'Long-range 3D radar; elevation discrimination is better than a 2D PSR.',
    freqHz: 1.25e9, peakPowerW: 150000, gainDbi: 38,
    azBeamwidthDeg: 1.2, elBeamwidthDeg: 2.0, elPeakDeg: 2.5, cscMaxDeg: 20,
    pulseWidthS: 150e-6, compressedBandwidthHz: 1.5e6, prfHz: 500, rpm: 6,
    noiseFigureDb: 2.5, systemLossDb: 5, mtiRejectionDb: 52, mtiNotchMs: 6,
    dopplerSpreadGainDb: 6, rangeSidelobeDb: -42, dynamicRangeDb: 80,
    heightAgl: 25, instrumentedRangeM: 400000,
  },
  'weather-c': {
    label: 'Weather radar (C-band)',
    note: 'Turbine clutter here corrupts reflectivity and radial-velocity products.',
    freqHz: 5.6e9, peakPowerW: 250000, gainDbi: 44,
    azBeamwidthDeg: 1.0, elBeamwidthDeg: 1.0, elPeakDeg: 0.5, cscMaxDeg: 2,
    pulseWidthS: 2e-6, compressedBandwidthHz: 0, prfHz: 900, rpm: 3,
    noiseFigureDb: 3.0, systemLossDb: 4, mtiRejectionDb: 50, mtiNotchMs: 1.5,
    dopplerSpreadGainDb: 0, rangeSidelobeDb: -45, dynamicRangeDb: 90,
    heightAgl: 30, instrumentedRangeM: 250000,
  },
  'marine-x': {
    label: 'Marine / VTS radar (X-band)',
    note: 'Short range and high resolution; offshore arrays dominate the picture.',
    freqHz: 9.41e9, peakPowerW: 25000, gainDbi: 30,
    azBeamwidthDeg: 0.9, elBeamwidthDeg: 20, elPeakDeg: 0, cscMaxDeg: 1,
    pulseWidthS: 1e-6, compressedBandwidthHz: 0, prfHz: 1800, rpm: 24,
    noiseFigureDb: 4.5, systemLossDb: 5, mtiRejectionDb: 35, mtiNotchMs: 2,
    dopplerSpreadGainDb: 0, rangeSidelobeDb: -30, dynamicRangeDb: 60,
    heightAgl: 40, instrumentedRangeM: 45000,
  },
};

export const TURBINE_PRESETS = {
  'small-850': {
    label: '0.85 MW (legacy onshore)',
    hubHeightM: 50, rotorDiameterM: 52, rpm: 28, bladeCount: 3, bladeChordM: 1.4,
    towerRcsDbsm: 26, bladeRcsDbsm: 18,
  },
  'mid-2300': {
    label: '2.3 MW (typical onshore)',
    hubHeightM: 80, rotorDiameterM: 93, rpm: 16, bladeCount: 3, bladeChordM: 2.2,
    towerRcsDbsm: 33, bladeRcsDbsm: 24,
  },
  'large-4500': {
    label: '4.5 MW (modern onshore)',
    hubHeightM: 110, rotorDiameterM: 150, rpm: 11, bladeCount: 3, bladeChordM: 3.0,
    towerRcsDbsm: 37, bladeRcsDbsm: 28,
  },
  'offshore-15000': {
    label: '15 MW (offshore)',
    hubHeightM: 150, rotorDiameterM: 236, rpm: 7.5, bladeCount: 3, bladeChordM: 4.5,
    towerRcsDbsm: 42, bladeRcsDbsm: 33,
  },
};

export const TARGET_PRESETS = {
  'light-ga': { label: 'Light GA aircraft', rcsDbsm: 0, speedKt: 110, altitudeFt: 2000 },
  'turboprop': { label: 'Regional turboprop', rcsDbsm: 13, speedKt: 220, altitudeFt: 6000 },
  'airliner': { label: 'Narrowbody airliner', rcsDbsm: 20, speedKt: 280, altitudeFt: 10000 },
  'helicopter': { label: 'Helicopter', rcsDbsm: 6, speedKt: 120, altitudeFt: 1500 },
  'small-uas': { label: 'Small uncrewed aircraft', rcsDbsm: -10, speedKt: 60, altitudeFt: 400 },
};

export function defaultScenario() {
  return {
    name: 'Untitled assessment',
    environment: {
      kFactor: 4 / 3,
      terrain: {
        preset: 'rolling',
        relief: 180,
        featureSize: 5200,
        seed: 20260917,
        baseHeight: 30,
        ridge: {
          enabled: false, distanceM: 6000, bearingFromRadarDeg: 45,
          orientationDeg: 135, height: 220, halfWidth: 700, length: 14000,
        },
      },
    },
    radar: {
      preset: 'psr-terminal',
      ...RADAR_PRESETS['psr-terminal'],
      east: 0, north: 0,
      // Detection criterion
      pd: 0.8, pfa: 1e-6, fluctuationMarginDb: 5,
      integrationEfficiency: 1.0,
    },
    farm: {
      preset: 'large-4500',
      ...TURBINE_PRESETS['large-4500'],
      layout: 'grid',
      count: 12,
      rows: 3,
      spacingM: 700,
      rowSpacingM: 900,
      centreRangeM: 9000,
      centreBearingDeg: 45,
      arrayBearingDeg: 135,
      windFromDeg: 315,       // turbines yaw to face into this wind
      jitterM: 60,
      manual: null,            // array of {east, north} once a turbine is moved
    },
    target: {
      preset: 'turboprop',
      ...TARGET_PRESETS['turboprop'],
      profile: 'approach',
      // transit leg, expressed relative to the radar
      startRangeM: 22000, startBearingDeg: 10,
      endRangeM: 22000, endBearingDeg: 85,
      altitudeFt: 4000,
      endAltitudeFt: 4000,
      samples: 120,
      // approach profile
      thresholdRangeM: 2500, thresholdBearingDeg: 225, glideslopeDeg: 3,
      approachStartRangeM: 24000,
    },
    mitigation: {
      ram: { enabled: false, reductionDb: 10 },
      curtail: { enabled: false },
      enhancedDoppler: { enabled: false, gainDb: 15 },
      blanking: {
        enabled: false, autoFit: true, marginM: 1500, marginDeg: 2,
        rangeMinM: 6000, rangeMaxM: 13000, azMinDeg: 30, azMaxDeg: 60,
      },
      naiz: { enabled: false, marginM: 2500, marginDeg: 4 },
      infill: {
        enabled: false, rangeM: 14000, bearingDeg: 100, heightAgl: 12,
        gainDbi: 32, peakPowerW: 20000, instrumentedRangeM: 45000,
      },
    },
    display: {
      showBeam: true, showShadows: true, showLos: true, showTrack: true,
      showPpi: true, showCurvature: true, animate: true, verticalExaggeration: 1,
    },
  };
}

export const TERRAIN_PRESETS = {
  flat: { label: 'Flat / coastal plain', relief: 0, featureSize: 6000 },
  gentle: { label: 'Gently undulating', relief: 70, featureSize: 6000 },
  rolling: { label: 'Rolling hills', relief: 180, featureSize: 5200 },
  upland: { label: 'Upland / moorland', relief: 420, featureSize: 4200 },
  mountain: { label: 'Mountainous', relief: 900, featureSize: 3600 },
};

// ------------------------------------------------------------ derived model

export function turbineTipHeight(farm) {
  return farm.hubHeightM + farm.rotorDiameterM / 2;
}

export function buildTurbines(scenario, terrain) {
  const f = scenario.farm;
  if (f.manual && f.manual.length) {
    return f.manual.map((p, i) => makeTurbine(i, p.east, p.north, f, terrain, p));
  }

  const centre = offsetByBearing(f.centreRangeM, f.centreBearingDeg);
  const out = [];
  const count = Math.max(1, Math.round(f.count));

  // Deterministic jitter so a layout is reproducible between runs.
  let seed = 991;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };

  const ab = f.arrayBearingDeg * DEG;
  const ux = Math.sin(ab), uz = Math.cos(ab);            // along the array
  const vx = Math.sin(ab + Math.PI / 2), vz = Math.cos(ab + Math.PI / 2);

  if (f.layout === 'line') {
    for (let i = 0; i < count; i++) {
      const s = (i - (count - 1) / 2) * f.spacingM;
      out.push({ east: centre.east + s * ux, north: centre.north + s * uz });
    }
  } else if (f.layout === 'cluster') {
    const radius = f.spacingM * Math.sqrt(count) / 2;
    for (let i = 0; i < count; i++) {
      // Sunflower packing keeps spacing even without overlaps.
      const k = (i + 0.5) / count;
      const r = radius * Math.sqrt(k);
      const a = i * 2.399963;
      out.push({ east: centre.east + r * Math.sin(a), north: centre.north + r * Math.cos(a) });
    }
  } else if (f.layout === 'arc') {
    const radius = Math.max(f.spacingM * count / Math.PI, f.spacingM);
    for (let i = 0; i < count; i++) {
      const a = ab + (i - (count - 1) / 2) * (f.spacingM / radius);
      out.push({ east: centre.east + radius * Math.sin(a), north: centre.north + radius * Math.cos(a) });
    }
  } else { // grid
    const rows = clamp(Math.round(f.rows), 1, count);
    const cols = Math.ceil(count / rows);
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const s = (c - (cols - 1) / 2) * f.spacingM;
      const t = (r - (rows - 1) / 2) * f.rowSpacingM;
      out.push({
        east: centre.east + s * ux + t * vx,
        north: centre.north + s * uz + t * vz,
      });
    }
  }

  return out.map((p, i) => makeTurbine(
    i,
    p.east + rnd() * 2 * f.jitterM,
    p.north + rnd() * 2 * f.jitterM,
    f, terrain,
  ));
}

function makeTurbine(index, east, north, f, terrain, override = {}) {
  const groundM = terrain.heightAt(east, north);
  const rotorRadiusM = (override.rotorDiameterM ?? f.rotorDiameterM) / 2;
  const hubHeightM = override.hubHeightM ?? f.hubHeightM;
  const rpm = override.rpm ?? f.rpm;
  return {
    id: `WTG${String(index + 1).padStart(2, '0')}`,
    index,
    east, north, groundM,
    hubHeightM,
    rotorRadiusM,
    rotorDiameterM: rotorRadiusM * 2,
    bladeCount: override.bladeCount ?? f.bladeCount,
    bladeChordM: override.bladeChordM ?? f.bladeChordM,
    rpm,
    towerRcsDbsm: override.towerRcsDbsm ?? f.towerRcsDbsm,
    bladeRcsDbsm: override.bladeRcsDbsm ?? f.bladeRcsDbsm,
    hubAmslM: groundM + hubHeightM,
    tipAmslM: groundM + hubHeightM + rotorRadiusM,
    baseAmslM: groundM,
    // Turbines yaw to face into the wind: the rotor axis points upwind.
    yawDeg: (f.windFromDeg ?? 225) % 360,
    tipSpeedMs: tipSpeed(rotorRadiusM, rpm),
    solidity: rotorSolidity({
      bladeCount: override.bladeCount ?? f.bladeCount,
      bladeChordM: override.bladeChordM ?? f.bladeChordM,
      bladeLengthM: rotorRadiusM * 0.95,
      rotorRadiusM,
    }),
    // Phase offset so the farm does not animate in lockstep.
    phase: (index * 2.399963) % (Math.PI * 2),
  };
}

// --------------------------------------------------------------- flight path

export function buildTrack(scenario, terrain) {
  const t = scenario.target;
  const n = clamp(Math.round(t.samples), 8, 600);
  const pts = [];
  const speedMs = t.speedKt * 0.514444;

  if (t.profile === 'approach') {
    const thr = offsetByBearing(t.thresholdRangeM, t.thresholdBearingDeg);
    const thrGround = terrain.heightAt(thr.east, thr.north);
    // Fly the final approach track inbound along the threshold bearing.
    const inboundBearing = (t.thresholdBearingDeg + 180) % 360;
    const slope = Math.tan(t.glideslopeDeg * DEG);
    for (let i = 0; i < n; i++) {
      const d = t.approachStartRangeM * (1 - i / (n - 1));
      const p = offsetByBearing(d, inboundBearing);
      const east = thr.east + p.east;
      const north = thr.north + p.north;
      pts.push({ east, north, amsl: thrGround + 15 + d * slope });
    }
  } else if (t.profile === 'orbit') {
    const c = offsetByBearing(t.startRangeM, t.startBearingDeg);
    const radius = Math.max(1500, Math.abs(t.endRangeM - t.startRangeM) || 6000);
    const amsl = t.altitudeFt * 0.3048;
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1)) * Math.PI * 2;
      pts.push({ east: c.east + radius * Math.sin(a), north: c.north + radius * Math.cos(a), amsl });
    }
  } else {
    const a = offsetByBearing(t.startRangeM, t.startBearingDeg);
    const b = offsetByBearing(t.endRangeM, t.endBearingDeg);
    const h0 = t.altitudeFt * 0.3048;
    const h1 = (t.endAltitudeFt ?? t.altitudeFt) * 0.3048;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      pts.push({
        east: a.east + (b.east - a.east) * k,
        north: a.north + (b.north - a.north) * k,
        amsl: h0 + (h1 - h0) * k,
      });
    }
  }

  // Attach along-track distance, time and heading.
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) dist += hypot2(pts[i].east - pts[i - 1].east, pts[i].north - pts[i - 1].north);
    pts[i].alongM = dist;
    pts[i].timeS = speedMs > 0 ? dist / speedMs : 0;
    const j = Math.min(i + 1, pts.length - 1);
    const k = Math.max(i - 1, 0);
    pts[i].headingDeg = bearingOf(pts[j].east - pts[k].east, pts[j].north - pts[k].north);
    pts[i].speedMs = speedMs;
    pts[i].groundM = terrain.heightAt(pts[i].east, pts[i].north);
  }
  return pts;
}

// ------------------------------------------------------------- persistence

export function saveScenario(scenario) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadScenario() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return mergeDeep(defaultScenario(), JSON.parse(raw));
  } catch (err) {
    return null;
  }
}

export function mergeDeep(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch) || typeof patch !== 'object') return patch;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object')
      ? mergeDeep(base[k], v)
      : v;
  }
  return out;
}

export function applyRadarPreset(scenario, key) {
  const p = RADAR_PRESETS[key];
  if (!p) return scenario;
  return mergeDeep(scenario, { radar: { preset: key, ...p } });
}

export function applyTurbinePreset(scenario, key) {
  const p = TURBINE_PRESETS[key];
  if (!p) return scenario;
  return mergeDeep(scenario, { farm: { preset: key, ...p, manual: null } });
}

export function applyTargetPreset(scenario, key) {
  const p = TARGET_PRESETS[key];
  if (!p) return scenario;
  return mergeDeep(scenario, { target: { preset: key, ...p } });
}

export function applyTerrainPreset(scenario, key) {
  const p = TERRAIN_PRESETS[key];
  if (!p) return scenario;
  return mergeDeep(scenario, { environment: { terrain: { preset: key, relief: p.relief, featureSize: p.featureSize } } });
}

export function radarLambda(radar) {
  return wavelength(radar.freqHz);
}
