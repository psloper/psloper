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

import { DEG, offsetByBearing, bearingOf, hypot2, clamp } from './geo.js';
import { wavelength, tipSpeed, rotorSolidity } from './rf.js';
import { rotorRpm, WIND_ROSE_PRESETS } from './wind.js';
import { fullyDevelopedWaveHeight } from './sea.js';

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
    towerBaseDiameterM: 3.0, towerTopDiameterM: 2.0,
    cutInMs: 4.0, ratedMs: 16, cutOutMs: 25,
    towerRcsDbsm: 26, bladeRcsDbsm: 18,
  },
  'mid-2300': {
    label: '2.3 MW (typical onshore)',
    hubHeightM: 80, rotorDiameterM: 93, rpm: 16, bladeCount: 3, bladeChordM: 2.2,
    towerBaseDiameterM: 4.2, towerTopDiameterM: 2.6,
    cutInMs: 3.5, ratedMs: 13, cutOutMs: 25,
    towerRcsDbsm: 33, bladeRcsDbsm: 24,
  },
  'large-4500': {
    label: '4.5 MW (modern onshore)',
    hubHeightM: 110, rotorDiameterM: 150, rpm: 11, bladeCount: 3, bladeChordM: 3.0,
    towerBaseDiameterM: 5.5, towerTopDiameterM: 3.2,
    cutInMs: 3.0, ratedMs: 12, cutOutMs: 25,
    towerRcsDbsm: 37, bladeRcsDbsm: 28,
  },
  'offshore-15000': {
    label: '15 MW (offshore)',
    hubHeightM: 150, rotorDiameterM: 236, rpm: 7.5, bladeCount: 3, bladeChordM: 4.5,
    towerBaseDiameterM: 10.0, towerTopDiameterM: 6.0,
    cutInMs: 3.0, ratedMs: 11, cutOutMs: 28,
    towerRcsDbsm: 42, bladeRcsDbsm: 33,
  },
};

// Blade construction, and what actually does the scattering.
//
// A glass-fibre blade shell is largely TRANSPARENT at microwave frequencies:
// radar illumination passes through the dielectric. What returns the signal is
// the conductive structure inside it, principally the carbon-fibre spar caps
// where they are used, and the lightning protection system, which is metallic
// by definition and runs the length of the blade to its receptors.
//
// This matters for mitigation. Treating the blades does not address the tower,
// which open work reports as the dominant scatterer at ALL aspect angles, and
// radar-absorbent treatment has to coexist with a lightning protection system
// whose whole job is to be the most conductive path available. Several patents
// exist specifically to reconcile the two, which tells you it is a real
// conflict rather than a detail.
//
// The deltas below are INDICATIVE and relative, not measurements. They are
// applied to the blade RCS you set, remain visible, and can be overridden.
export const BLADE_CONSTRUCTIONS = {
  'glass-basic': {
    label: 'All-glass, minimal lightning protection',
    bladeDeltaDb: -6,
    note: 'Glass-fibre shells and spar, with a down conductor and tip receptors only. The least '
      + 'conductive material inside an already largely transparent shell. Typical of older and '
      + 'smaller machines.',
  },
  'glass-lps': {
    label: 'All-glass, full lightning protection',
    bladeDeltaDb: -3,
    note: 'Glass structure, but with a full lightning protection system: multiple receptors, '
      + 'surface mesh or conductive strips down the blade. The protection system is the scatterer.',
  },
  'carbon-spar': {
    label: 'Carbon spar caps, full lightning protection',
    bladeDeltaDb: 0,
    note: 'The current mainstream build for large machines. Carbon-fibre spar caps are conductive and '
      + 'run most of the blade length, sitting inside a transparent shell alongside the lightning '
      + 'protection system. This is the reference case for the blade RCS you set.',
  },
  'carbon-full': {
    label: 'Extensive carbon, full lightning protection',
    bladeDeltaDb: 3,
    note: 'Carbon used beyond the spar caps, as on some very long offshore blades. More conductive '
      + 'structure, more return.',
  },
  'ram-treated': {
    label: 'Radar-absorbent treatment applied',
    bladeDeltaDb: -10,
    note: 'Indicative only. Absorbent treatment is narrowband and aspect-dependent, has to survive '
      + 'blade erosion and a 25-year life, and has to coexist with a lightning protection system '
      + 'designed to be the most conductive path available. Use the RAM mitigation on the Mitigation '
      + 'tab to model a claimed reduction properly, and treat any figure as unproven until the '
      + 'supplier demonstrates it at your frequency and aspect angles.',
  },
};

// Tower construction. Open work reports the tower as the DOMINANT scatterer at
// all aspect angles, which is why treating only the blades does not solve the
// problem. Steel is a conductor; concrete is a lossy dielectric and returns
// less at the same geometry, though the nacelle and any steel upper section
// still contribute. Deltas are indicative and editable, as everywhere else.
export const TOWER_MATERIALS = {
  steel: {
    label: 'Steel tube',
    towerDeltaDb: 0,
    note: 'The standard build and the reference case. A large conducting cylinder, and normally the '
      + 'strongest single scatterer on the machine at every aspect.',
  },
  hybrid: {
    label: 'Steel and concrete hybrid',
    towerDeltaDb: -2,
    note: 'Concrete lower section with a steel upper section, used to reach greater hub heights. The '
      + 'concrete part returns less than steel would, but the steel section and nacelle remain.',
  },
  concrete: {
    label: 'Concrete',
    towerDeltaDb: -4,
    note: 'A lossy dielectric rather than a conductor, so less return at the same geometry. Still a '
      + 'very large structure, and the nacelle is unchanged.',
  },
  'ram-coated': {
    label: 'Steel with sprayable absorbent coating',
    towerDeltaDb: -8,
    note: 'Indicative only. Absorbent coatings can be applied to static surfaces more readily than to '
      + 'blades, since a tower does not erode at 90 m/s, but the figure is narrowband and '
      + 'aspect-dependent and must be demonstrated at your frequency.',
  },
};

// Atmospheric refraction conditions, expressed as the effective earth radius
// factor they correspond to. A masking argument that holds under standard
// refraction can fail under super-refraction or in a duct, and ducting is
// common over the sea, so these exist to be swept rather than assumed.
export const REFRACTION_PRESETS = {
  sub:      { label: 'Sub-refractive', k: 0.8,  note: 'Beam bends less than standard. The radio horizon pulls in, but so does masking: a hill screens less than you assumed.' },
  standard: { label: 'Standard atmosphere', k: 4 / 3, note: 'The usual design assumption. Not the only condition the radar will ever see.' },
  super:    { label: 'Super-refractive', k: 2.0,  note: 'Beam bends more than standard. Turbines beyond the standard horizon come into view.' },
  duct:     { label: 'Surface duct', k: 5.0,  note: 'Trapping layer. Ranges extend far beyond the geometric horizon, and terrain screening arguments can fail outright. Common over the sea.' },
};

// Reference targets, grouped by class.
//
// RCS IS A CLASS FIGURE, NOT A PLATFORM FIGURE. Radar cross-section varies by
// tens of decibels with aspect, frequency and polarisation, and the real
// figures for specific military platforms are controlled information. What
// follows are representative order-of-magnitude values for broad classes,
// drawn from the ranges that open radar texts quote, so that the tool can show
// how target size interacts with turbine clutter. They are a starting point for
// exploring sensitivity, never an assertion about any particular aircraft.
//
// The classes matter here because turbine clutter does not affect all traffic
// equally: a widebody has 45 dB more return than a small uncrewed aircraft, so
// a wind farm that is invisible against one can hide the other completely.

export const TARGET_PRESETS = {
  // ---- uncrewed
  'uas-micro':      { label: 'Small multirotor UAS', group: 'Uncrewed', rcsDbsm: -20, speedKt: 35, altitudeFt: 300 },
  'uas-fixed':      { label: 'Fixed-wing small UAS', group: 'Uncrewed', rcsDbsm: -10, speedKt: 60, altitudeFt: 400 },
  'uas-tactical':   { label: 'Tactical UAS', group: 'Uncrewed', rcsDbsm: 0, speedKt: 90, altitudeFt: 5000 },
  'uas-male':       { label: 'Medium-altitude long-endurance UAS', group: 'Uncrewed', rcsDbsm: 5, speedKt: 150, altitudeFt: 15000 },

  // ---- general aviation and rotary
  'glider':         { label: 'Glider', group: 'General aviation', rcsDbsm: 2, speedKt: 60, altitudeFt: 3000 },
  'microlight':     { label: 'Microlight', group: 'General aviation', rcsDbsm: -3, speedKt: 55, altitudeFt: 1500 },
  'light-ga':       { label: 'Light single piston', group: 'General aviation', rcsDbsm: 0, speedKt: 110, altitudeFt: 2000 },
  'light-twin':     { label: 'Light twin', group: 'General aviation', rcsDbsm: 5, speedKt: 160, altitudeFt: 4000 },
  'helicopter':     { label: 'Light helicopter', group: 'General aviation', rcsDbsm: 3, speedKt: 110, altitudeFt: 1200 },
  'helicopter-med': { label: 'Medium helicopter', group: 'General aviation', rcsDbsm: 9, speedKt: 130, altitudeFt: 1500 },
  'sar-helicopter': { label: 'Search and rescue helicopter', group: 'General aviation', rcsDbsm: 10, speedKt: 120, altitudeFt: 500 },

  // ---- commercial
  'bizjet':         { label: 'Business jet', group: 'Commercial', rcsDbsm: 8, speedKt: 250, altitudeFt: 12000 },
  'turboprop':      { label: 'Regional turboprop', group: 'Commercial', rcsDbsm: 13, speedKt: 220, altitudeFt: 6000 },
  'regional-jet':   { label: 'Regional jet', group: 'Commercial', rcsDbsm: 16, speedKt: 260, altitudeFt: 9000 },
  'airliner':       { label: 'Narrowbody airliner', group: 'Commercial', rcsDbsm: 20, speedKt: 280, altitudeFt: 10000 },
  'widebody':       { label: 'Widebody airliner', group: 'Commercial', rcsDbsm: 25, speedKt: 300, altitudeFt: 15000 },

  // ---- military
  'mil-trainer':    { label: 'Military trainer', group: 'Military', rcsDbsm: 4, speedKt: 300, altitudeFt: 2000 },
  'fast-jet':       { label: 'Fast jet, conventional', group: 'Military', rcsDbsm: 6, speedKt: 450, altitudeFt: 1000 },
  'fast-jet-low':   { label: 'Fast jet at low level', group: 'Military', rcsDbsm: 6, speedKt: 480, altitudeFt: 250 },
  'fast-jet-head':  { label: 'Fast jet, head-on aspect', group: 'Military', rcsDbsm: -1, speedKt: 450, altitudeFt: 5000 },
  'low-observable': { label: 'Low-observable aircraft (generic)', group: 'Military', rcsDbsm: -15, speedKt: 420, altitudeFt: 20000 },
  'mil-rotary':     { label: 'Military helicopter', group: 'Military', rcsDbsm: 10, speedKt: 130, altitudeFt: 300 },
  'mil-transport':  { label: 'Military transport', group: 'Military', rcsDbsm: 24, speedKt: 260, altitudeFt: 8000 },
  'maritime-patrol':{ label: 'Maritime patrol aircraft', group: 'Military', rcsDbsm: 21, speedKt: 250, altitudeFt: 1000 },
  'aew':            { label: 'Airborne early warning', group: 'Military', rcsDbsm: 26, speedKt: 300, altitudeFt: 25000 },
};

export const TARGET_GROUPS = ['Uncrewed', 'General aviation', 'Commercial', 'Military'];

export function defaultScenario() {
  return {
    name: 'Untitled assessment',
    site: {
      // Where the farm and radar sit, and what the surface between them is.
      environment: 'onshore',          // 'onshore' | 'offshore'
      originLat: 55.94,                // used only to place lat/lon imports
      originLon: -3.20,
      radarEasting: 412000,            // grid coordinates of the radar, for imports
      radarNorthing: 318000,
      seaLevelM: 0,
      // Sea surface state. Wave height can follow the wind or be set directly.
      waveFromWind: true,
      significantWaveHeightM: 1.5,
      seaClutter: {
        enabled: true,
        sigmaZeroRefDb: -50,           // at refGrazingDeg, refSeaState, refFreqGHz
        refGrazingDeg: 1,
        refSeaState: 3,
        refFreqGHz: 3,
        grazingExponent: 1.5,
        perSeaStateDb: 3,
        frequencySlopeDb: 10,
        spreadPerWindMs: 0.1,
        // Rejection is capped well below the radar's improvement factor
        // against fixed clutter. The Doppler spread here is modelled as
        // Gaussian, and real sea clutter has far heavier tails and a spiky,
        // non-Gaussian component that a notch does not remove. Without this
        // cap the model would cancel sea clutter almost perfectly, which is
        // not what happens.
        maxRejectionDb: 25,
      },
      multipath: {
        enabled: false,                // on by default offshore, see normaliseScenario
        reflectionMag: 1.0,            // ~1 for horizontal polarisation over sea
        landReflectionMag: 0.3,
      },
    },
    wind: {
      // The operating condition being assessed.
      directionDeg: 315,               // wind FROM this bearing; turbines yaw into it
      speedMs: 12,
      // Turbine control envelope. Rotor speed tracks the wind below rated,
      // holds constant to cut-out, and idles outside that band.
      cutInMs: 3.0, ratedMs: 12, cutOutMs: 25, idleFraction: 0.12,
      yawMisalignDeg: 0,
      // The site's wind climate, for sweeping every direction rather than one.
      rosePreset: 'sw-temperate',
      weibullK: 2.0,
      rose: WIND_ROSE_PRESETS['sw-temperate'].rose,
    },
    weather: {
      refractionPreset: 'standard',
      atmosphericLossDbPerKm: 0,       // two-way gas plus rain; see the method notes
      rainRateMmH: 0,                  // recorded for the report, not modelled directly
    },
    environment: {
      kFactor: 4 / 3,
      terrain: {
        source: 'synthetic',           // 'synthetic' | 'imported'
        importMeta: null,
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
      bladeRcsEdgeOnDbsm: TURBINE_PRESETS['large-4500'].bladeRcsDbsm,
      construction: 'carbon-spar',
      towerMaterial: 'steel',
      layout: 'grid',
      count: 12,
      rows: 3,
      spacingM: 700,
      rowSpacingM: 900,
      centreRangeM: 9000,
      centreBearingDeg: 45,
      arrayBearingDeg: 135,
      windFromDeg: 315,       // legacy field, migrated into wind.directionDeg
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
  const wind = scenario.wind;
  if (f.manual && f.manual.length) {
    return f.manual.map((p, i) => makeTurbine(i, p.east, p.north, f, terrain, wind, p));
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
    f, terrain, wind,
  ));
}

function makeTurbine(index, east, north, f, terrain, wind, override = {}) {
  // An imported schedule usually carries its own ground levels, which are
  // survey data and beat anything the terrain model says.
  const groundM = Number.isFinite(override.groundLevelM)
    ? override.groundLevelM
    : terrain.heightAt(east, north);
  const rotorRadiusM = (override.rotorDiameterM ?? f.rotorDiameterM) / 2;
  const hubHeightM = override.hubHeightM ?? f.hubHeightM;
  const ratedRpm = override.rpm ?? f.rpm;

  // Rotor speed follows the wind through the machine's control curve, so the
  // blade Doppler the radar sees is a function of the conditions, not a fixed
  // property of the turbine.
  const rpm = rotorRpm(wind.speedMs, {
    cutInMs: wind.cutInMs, ratedMs: wind.ratedMs, cutOutMs: wind.cutOutMs,
    ratedRpm, idleFraction: wind.idleFraction,
  });

  const towerBaseDiameterM = override.towerBaseDiameterM ?? f.towerBaseDiameterM ?? 5;
  const towerTopDiameterM = override.towerTopDiameterM ?? f.towerTopDiameterM ?? 3;

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
    ratedRpm,
    towerBaseDiameterM,
    towerTopDiameterM,
    construction: override.construction ?? f.construction ?? 'carbon-spar',
    towerMaterial: override.towerMaterial ?? f.towerMaterial ?? 'steel',
    towerRcsDbsm: override.towerRcsDbsm ?? f.towerRcsDbsm,
    bladeRcsDbsm: override.bladeRcsDbsm ?? f.bladeRcsDbsm,
    bladeRcsEdgeOnDbsm: override.bladeRcsEdgeOnDbsm
      ?? f.bladeRcsEdgeOnDbsm ?? (override.bladeRcsDbsm ?? f.bladeRcsDbsm),
    hubAmslM: groundM + hubHeightM,
    tipAmslM: groundM + hubHeightM + rotorRadiusM,
    baseAmslM: groundM,
    // Turbines yaw to face into the wind: the rotor axis points upwind.
    yawDeg: ((wind.directionDeg ?? 315) + (wind.yawMisalignDeg ?? 0) + 360) % 360,
    tipSpeedMs: tipSpeed(rotorRadiusM, rpm),
    ratedTipSpeedMs: tipSpeed(rotorRadiusM, ratedRpm),
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

// Blades must clear the ground. This is the hard physical floor; real machines
// sit far above it, and the findings flag anything unusually tight.
export const MIN_GROUND_CLEARANCE_M = 5;

// Tip height is what aviation safeguarding, obstacle lighting and charting all
// work in, so the tool treats it as a primary dimension rather than something
// that falls out of hub height and rotor diameter.
export function tipHeightOf(farm) {
  return farm.hubHeightM + farm.rotorDiameterM / 2;
}

export function groundClearanceOf(farm) {
  return farm.hubHeightM - farm.rotorDiameterM / 2;
}

/**
 * Set tip height by moving the hub, holding the rotor.
 *
 * A tip height lower than the rotor can physically reach is refused rather than
 * silently accepted: the hub is clamped so the blades still clear the ground,
 * and the achieved tip height is returned so the caller can show what actually
 * happened instead of what was asked for.
 */
export function setTipHeight(farm, tipM) {
  const radius = farm.rotorDiameterM / 2;
  const minHub = radius + MIN_GROUND_CLEARANCE_M;
  farm.hubHeightM = Math.max(tipM - radius, minHub);
  return tipHeightOf(farm);
}

// Tower diameter at a height above its base. Towers taper, so the width that
// blocks a ray depends on where that ray passes.
export function towerDiameterAt(turbine, heightAboveBaseM) {
  const h = clamp(heightAboveBaseM / Math.max(turbine.hubHeightM, 1), 0, 1);
  return turbine.towerBaseDiameterM
    + (turbine.towerTopDiameterM - turbine.towerBaseDiameterM) * h;
}

// --------------------------------------------------------------------- setup
//
// Fields that are derived from other fields, or migrated from older saved
// scenarios, are settled here so every consumer sees one consistent object.
export function normaliseScenario(scenario) {
  const s = scenario;

  // Older saved scenarios carried wind direction on the farm.
  if (s.farm && s.farm.windFromDeg !== undefined && s.wind
      && s.wind.directionDeg === undefined) {
    s.wind.directionDeg = s.farm.windFromDeg;
  }
  if (s.farm) s.farm.windFromDeg = s.wind.directionDeg;

  // Refraction condition drives the effective earth radius factor.
  const refraction = REFRACTION_PRESETS[s.weather.refractionPreset];
  if (refraction && s.weather.refractionPreset !== 'custom') {
    s.environment.kFactor = refraction.k;
  }

  // Sea state follows the wind unless it has been set by hand.
  if (s.site.waveFromWind) {
    s.site.significantWaveHeightM = fullyDevelopedWaveHeight(s.wind.speedMs);
  }

  // Over the sea there is no terrain to mask anything and the surface is a
  // good reflector, so surface multipath is on by default there and off over
  // land, where the two-ray model does not describe a real rough surface well.
  if (s.site.multipath.autoByEnvironment !== false) {
    s.site.multipath.enabled = s.site.environment === 'offshore';
  }

  // The rotor's rated speed and rated wind speed must belong to the same
  // machine; the tip-speed ratio check in the findings uses both.
  if (s.wind.ratedMs <= 0) s.wind.ratedMs = 12;
  return s;
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
    return migrateScenario(JSON.parse(raw));
  } catch (err) {
    return null;
  }
}

/**
 * Bring a scenario saved by an older build up to the current shape, then merge
 * it onto the defaults. Migration has to happen BEFORE the merge: afterwards
 * the defaults have already supplied a wind block, and there is no longer any
 * way to tell a legacy save from a current one.
 */
export function migrateScenario(saved) {
  const patch = JSON.parse(JSON.stringify(saved ?? {}));

  // Wind direction used to live on the farm.
  if (!patch.wind && patch.farm && patch.farm.windFromDeg !== undefined) {
    patch.wind = { directionDeg: patch.farm.windFromDeg };
  }
  // Rotor speed used to be a fixed property rather than a function of wind, so
  // a legacy save's rpm is its rated rpm. Assess it at rated, which is what
  // the old build effectively did.
  if (patch.farm && patch.farm.rpm !== undefined && patch.wind
      && patch.wind.speedMs === undefined) {
    patch.wind.speedMs = patch.wind.ratedMs ?? 12;
  }
  return mergeDeep(defaultScenario(), patch);
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
