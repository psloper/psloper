// Parameter sweeps.
//
// The single-scenario view answers "is this a problem". A sweep answers the
// question that actually decides a scheme: how much would have to change for it
// to stop being a problem. Vary tip height against distance, or wind direction
// against rotor speed, and read the boundary off the map.
//
// Each cell is a complete re-analysis, so sweeps run on demand rather than
// live, with the track sub-sampled to keep a 14x14 grid inside a few seconds.

import { analyse } from './analysis.js';
import { mergeDeep } from './model.js';

const set = (s, path, v) => {
  const keys = path.split('.');
  const last = keys.pop();
  let o = s;
  for (const k of keys) o = o[k];
  o[last] = v;
};

/**
 * Each axis is one parameter, with the range it sweeps and how to apply it.
 * `apply` exists because some of these are not a single field: tip height, for
 * instance, is hub height plus rotor radius, and holding one while varying the
 * other is a different question from varying both.
 */
export const SWEEP_PARAMS = {
  tipHeight: {
    label: 'Tip height (rotor fixed)', unit: 'm', min: 50, max: 300, step: 5,
    read: (s) => s.farm.hubHeightM + s.farm.rotorDiameterM / 2,
    // Held to the same ground-clearance floor the control uses, so a sweep and
    // a slider cannot disagree about what is physically possible.
    apply: (s, v) => set(s, 'farm.hubHeightM',
      Math.max(v - s.farm.rotorDiameterM / 2, s.farm.rotorDiameterM / 2 + 5)),
  },
  hubHeight: {
    label: 'Hub height', unit: 'm', min: 20, max: 280, step: 5,
    read: (s) => s.farm.hubHeightM,
    apply: (s, v) => set(s, 'farm.hubHeightM', v),
  },
  rotorDiameter: {
    label: 'Rotor diameter', unit: 'm', min: 20, max: 300, step: 5,
    read: (s) => s.farm.rotorDiameterM,
    apply: (s, v) => set(s, 'farm.rotorDiameterM', v),
  },
  bladeChord: {
    label: 'Blade chord (width)', unit: 'm', min: 0.5, max: 8, step: 0.25,
    read: (s) => s.farm.bladeChordM,
    apply: (s, v) => set(s, 'farm.bladeChordM', v),
  },
  towerDiameter: {
    label: 'Tower base diameter', unit: 'm', min: 2, max: 14, step: 0.5,
    read: (s) => s.farm.towerBaseDiameterM,
    apply: (s, v) => {
      const taper = s.farm.towerTopDiameterM / Math.max(s.farm.towerBaseDiameterM, 0.1);
      set(s, 'farm.towerBaseDiameterM', v);
      set(s, 'farm.towerTopDiameterM', v * taper);
    },
  },
  bladeCount: {
    label: 'Blades per rotor', unit: '', min: 2, max: 5, step: 1,
    read: (s) => s.farm.bladeCount,
    apply: (s, v) => set(s, 'farm.bladeCount', Math.round(v)),
  },
  distance: {
    label: 'Distance from radar', unit: 'km', scale: 1000, min: 1, max: 40, step: 0.5,
    read: (s) => s.farm.centreRangeM / 1000,
    apply: (s, v) => set(s, 'farm.centreRangeM', v * 1000),
  },
  bearing: {
    label: 'Bearing from radar', unit: '°', min: 0, max: 350, step: 10,
    read: (s) => s.farm.centreBearingDeg,
    apply: (s, v) => set(s, 'farm.centreBearingDeg', v),
  },
  turbineCount: {
    label: 'Number of turbines', unit: '', min: 1, max: 40, step: 1,
    read: (s) => s.farm.count,
    apply: (s, v) => set(s, 'farm.count', Math.round(v)),
  },
  towerRcs: {
    label: 'Tower RCS', unit: 'dBsm', min: 10, max: 55, step: 1,
    read: (s) => s.farm.towerRcsDbsm,
    apply: (s, v) => set(s, 'farm.towerRcsDbsm', v),
  },
  bladeRcs: {
    label: 'Blade RCS', unit: 'dBsm', min: -5, max: 50, step: 1,
    read: (s) => s.farm.bladeRcsDbsm,
    apply: (s, v) => { set(s, 'farm.bladeRcsDbsm', v); set(s, 'farm.bladeRcsEdgeOnDbsm', v); },
  },
  windDirection: {
    label: 'Wind direction', unit: '°', min: 0, max: 350, step: 10,
    read: (s) => s.wind.directionDeg,
    apply: (s, v) => set(s, 'wind.directionDeg', v),
  },
  windSpeed: {
    label: 'Wind speed', unit: 'm/s', min: 0, max: 30, step: 1,
    read: (s) => s.wind.speedMs,
    apply: (s, v) => set(s, 'wind.speedMs', v),
  },
  waveHeight: {
    label: 'Significant wave height', unit: 'm', min: 0, max: 8, step: 0.25,
    read: (s) => s.site.significantWaveHeightM,
    apply: (s, v) => { set(s, 'site.waveFromWind', false); set(s, 'site.significantWaveHeightM', v); },
  },
  kFactor: {
    label: 'Refraction (k-factor)', unit: '', min: 0.7, max: 3.0, step: 0.05,
    read: (s) => s.environment.kFactor,
    apply: (s, v) => { set(s, 'weather.refractionPreset', 'custom'); set(s, 'environment.kFactor', v); },
  },
  radarHeight: {
    label: 'Radar antenna height', unit: 'm AGL', min: 3, max: 120, step: 2,
    read: (s) => s.radar.heightAgl,
    apply: (s, v) => set(s, 'radar.heightAgl', v),
  },
  beamPeak: {
    label: 'Beam peak elevation', unit: '°', min: 0, max: 12, step: 0.25,
    read: (s) => s.radar.elPeakDeg,
    apply: (s, v) => set(s, 'radar.elPeakDeg', v),
  },
  mtiNotch: {
    label: 'Clutter notch half-width', unit: 'm/s', min: 0.5, max: 25, step: 0.5,
    read: (s) => s.radar.mtiNotchMs,
    apply: (s, v) => set(s, 'radar.mtiNotchMs', v),
  },
  targetAltitude: {
    label: 'Target altitude', unit: 'ft', min: 200, max: 15000, step: 100,
    read: (s) => s.target.altitudeFt,
    apply: (s, v) => { set(s, 'target.altitudeFt', v); set(s, 'target.endAltitudeFt', v); },
  },
  targetRcs: {
    label: 'Target RCS', unit: 'dBsm', min: -20, max: 30, step: 1,
    read: (s) => s.target.rcsDbsm,
    apply: (s, v) => set(s, 'target.rcsDbsm', v),
  },
};

/**
 * `kind` picks the colour treatment, which is not decoration: a signed quantity
 * measured against a threshold is diverging about zero, an unsigned magnitude
 * is sequential. `worse` says which end of the scale is the bad one.
 */
export const SWEEP_METRICS = {
  plots: {
    label: 'Turbine plots per scan', unit: '', kind: 'sequential', worse: 'high',
    read: (r) => r.summary.displayedPlotCount,
    format: (v) => v.toFixed(0),
  },
  turbineReturn: {
    label: 'Strongest turbine return', unit: 'dB SNR', kind: 'sequential', worse: 'high',
    read: (r) => r.summary.maxTurbineSnrDb,
    format: (v) => v.toFixed(1),
  },
  doppler: {
    label: 'Peak blade Doppler', unit: 'Hz', kind: 'sequential', worse: 'high',
    read: (r) => r.summary.maxDopplerHz,
    format: (v) => v.toFixed(0),
  },
  visible: {
    label: 'Turbines in line of sight', unit: '', kind: 'sequential', worse: 'high',
    read: (r) => r.summary.visibleCount,
    format: (v) => v.toFixed(0),
  },
  untracked: {
    label: 'Track lost', unit: '%', kind: 'sequential', worse: 'high',
    read: (r) => 100 * r.summary.untrackedFraction,
    format: (v) => v.toFixed(0),
  },
  margin: {
    label: 'Worst detection margin', unit: 'dB', kind: 'diverging', worse: 'low', pivot: 0,
    read: (r) => (r.summary.worstPoint ? r.summary.worstPoint.effectiveMarginDb : NaN),
    format: (v) => (v >= 0 ? '+' : '') + v.toFixed(1),
  },
  clutterCost: {
    label: 'Detection margin lost to clutter', unit: 'dB', kind: 'sequential', worse: 'high',
    read: (r) => (r.summary.worstClutter ? r.summary.worstClutter.clutterCostDb : 0),
    format: (v) => v.toFixed(1),
  },
  shadow: {
    label: 'Worst two-way shadowing', unit: 'dB', kind: 'sequential', worse: 'high',
    read: (r) => (r.summary.worstShadow ? r.summary.worstShadow.shadowLossDb : 0),
    format: (v) => v.toFixed(2),
  },
};

function axisValues(param, steps, centre) {
  const p = SWEEP_PARAMS[param];
  const span = p.max - p.min;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const v = p.min + (span * i) / (steps - 1);
    out.push(p.step >= 1 ? Math.round(v / p.step) * p.step : Math.round(v / p.step) * p.step);
  }
  return out;
}

/**
 * Run a two-parameter sweep.
 *
 * @param {object} scenario
 * @param {object} opts {xParam, yParam, metric, steps, trackSamples, onProgress, signal}
 */
export async function runSweep(scenario, opts) {
  const steps = Math.max(4, Math.min(opts.steps || 14, 32));
  const xs = axisValues(opts.xParam, steps);
  const ys = axisValues(opts.yParam, steps);
  const metric = SWEEP_METRICS[opts.metric];
  const values = new Float64Array(steps * steps).fill(NaN);

  // The track is sub-sampled during a sweep: a hundred-odd samples per cell
  // buys nothing when the answer is a single summary number.
  const template = JSON.parse(JSON.stringify(scenario));
  template.target.samples = opts.trackSamples || 48;

  let done = 0;
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      if (opts.signal && opts.signal.aborted) return null;
      const s = JSON.parse(JSON.stringify(template));
      SWEEP_PARAMS[opts.xParam].apply(s, xs[i]);
      SWEEP_PARAMS[opts.yParam].apply(s, ys[j]);
      try {
        values[j * steps + i] = metric.read(analyse(s, { skipCoverage: true }));
      } catch (err) {
        values[j * steps + i] = NaN;
      }
      done += 1;
    }
    // Yield between rows so the page keeps painting and the progress bar moves.
    if (opts.onProgress) opts.onProgress(done / (steps * steps));
    await new Promise((r) => setTimeout(r, 0));
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) { min = 0; max = 1; }

  return {
    xParam: opts.xParam,
    yParam: opts.yParam,
    metricKey: opts.metric,
    metric,
    steps,
    xs,
    ys,
    values,
    min,
    max,
    // Where the current scenario sits on the map, so the reader can see which
    // cell is the case they were just looking at.
    marker: {
      x: SWEEP_PARAMS[opts.xParam].read(scenario),
      y: SWEEP_PARAMS[opts.yParam].read(scenario),
    },
    scenarioName: scenario.name,
    generated: new Date().toISOString(),
  };
}

export function sweepToCsv(sweep) {
  const px = SWEEP_PARAMS[sweep.xParam];
  const py = SWEEP_PARAMS[sweep.yParam];
  const head = [`${py.label}${py.unit ? ` (${py.unit})` : ''} \\ ${px.label}${px.unit ? ` (${px.unit})` : ''}`,
    ...sweep.xs.map((v) => String(v))];
  const rows = [head];
  for (let j = 0; j < sweep.steps; j++) {
    const row = [String(sweep.ys[j])];
    for (let i = 0; i < sweep.steps; i++) {
      const v = sweep.values[j * sweep.steps + i];
      row.push(Number.isFinite(v) ? v.toFixed(3) : '');
    }
    rows.push(row);
  }
  return rows.map((r) => r.join(',')).join('\n');
}
