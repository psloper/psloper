// Which radar parameters do you actually need to chase?
//
// A radar operator will give you some numbers and not others. This measures
// which ones move the answer, so the ones worth arguing for are known before
// the conversation rather than after.
//
// Perturbs one parameter at a time across farms at 5, 9, 20 and 40 km and
// reports the worst shift in detection margin and the change in turbine plots.
//
// Run from the windfarm-radar directory: node tools/radar_sensitivity.mjs

// Which radar parameters actually move the answer?
// Perturb one at a time across several site geometries and measure the shift
// in the outputs a user acts on.
import { defaultScenario } from '../js/model.js';
import { analyse } from '../js/analysis.js';

const geometries = [
  { label: 'farm at 5 km', range: 5000 },
  { label: 'farm at 9 km', range: 9000 },
  { label: 'farm at 20 km', range: 20000 },
  { label: 'farm at 40 km', range: 40000 },
];

function outputs(patch = {}) {
  const res = [];
  for (const g of geometries) {
    const sc = defaultScenario();
    sc.farm.centreRangeM = g.range;
    Object.assign(sc.radar, patch);
    const r = analyse(sc, { skipCoverage: true });
    res.push({
      margin: r.summary.worstPoint ? r.summary.worstPoint.marginDb : NaN,
      above: r.summary.falsePlotCount,
      inSight: r.summary.visibleCount,
      plots: r.summary.displayedPlotCount,
    });
  }
  return res;
}

const base = outputs();
const rows = [];
const perturbations = [
  ['peakPowerW', 'halved (25 kW -> 12.5 kW)', { peakPowerW: 12500 }],
  ['gainDbi', 'out by 3 dB (34 -> 31)', { gainDbi: 31 }],
  ['freqHz', 'S-band -> L-band (2.8 -> 1.3 GHz)', { freqHz: 1.3e9 }],
  ['heightAgl', 'out by 10 m (12 -> 22)', { heightAgl: 22 }],
  ['noiseFigureDb', 'out by 2 dB (3.5 -> 5.5)', { noiseFigureDb: 5.5 }],
  ['systemLossDb', 'out by 3 dB (6 -> 9)', { systemLossDb: 9 }],
  ['mtiRejectionDb', 'out by 10 dB (45 -> 35)', { mtiRejectionDb: 35 }],
  ['mtiNotchMs', 'out by 2 m/s (4 -> 6)', { mtiNotchMs: 6 }],
  ['prfHz', 'out by 30% (1100 -> 1430)', { prfHz: 1430 }],
  ['elPeakDeg', 'beam tilt out by 2 deg (4 -> 6)', { elPeakDeg: 6 }],
  ['elBeamwidthDeg', 'out by 1 deg (4.8 -> 3.8)', { elBeamwidthDeg: 3.8 }],
  ['azBeamwidthDeg', 'out by 0.4 deg (1.4 -> 1.8)', { azBeamwidthDeg: 1.8 }],
  ['pulseWidthS', 'out by 2x (60 -> 30 us)', { pulseWidthS: 30e-6 }],
  ['compressedBandwidthHz', 'out by 2x (1.2 -> 0.6 MHz)', { compressedBandwidthHz: 0.6e6 }],
  ['rpm', 'out by 5 rpm (15 -> 10)', { rpm: 10 }],
  ['rangeSidelobeDb', 'out by 10 dB (-35 -> -25)', { rangeSidelobeDb: -25 }],
  ['dynamicRangeDb', 'out by 20 dB (70 -> 50)', { dynamicRangeDb: 50 }],
  ['cscMaxDeg', 'out by 10 deg (30 -> 20)', { cscMaxDeg: 20 }],
  ['dopplerSpreadGainDb', 'out by 6 dB (0 -> 6)', { dopplerSpreadGainDb: 6 }],
  ['instrumentedRangeM', 'out by 2x (110 -> 220 km)', { instrumentedRangeM: 220000 }],
  ['pd', '0.8 -> 0.9', { pd: 0.9 }],
  ['fluctuationMarginDb', 'out by 5 dB (5 -> 10)', { fluctuationMarginDb: 10 }],
];

for (const [name, label, patch] of perturbations) {
  const out = outputs(patch);
  let maxMargin = 0, plotChange = 0, sightChange = 0;
  out.forEach((o, i) => {
    maxMargin = Math.max(maxMargin, Math.abs(o.margin - base[i].margin));
    plotChange += Math.abs(o.plots - base[i].plots);
    sightChange += Math.abs(o.inSight - base[i].inSight);
  });
  rows.push({ name, label, maxMargin, plotChange, sightChange });
}
rows.sort((a, b) => b.maxMargin - a.maxMargin || b.plotChange - a.plotChange);
console.log('Effect on the outputs a user acts on, across farms at 5, 9, 20 and 40 km.\n');
console.log('parameter'.padEnd(24) + 'perturbation'.padEnd(36) + 'worst margin shift'.padStart(20) + 'turbine plots'.padStart(15));
for (const r of rows) {
  console.log(r.name.padEnd(24) + r.label.padEnd(36)
    + `${r.maxMargin.toFixed(1)} dB`.padStart(20)
    + `${r.plotChange > 0 ? '+/-' + r.plotChange : '-'}`.padStart(15));
}

// ---------------------------------------------------------------------------
// A ranking on its own is misleading here, because one parameter's importance
// depends entirely on the case being assessed.
// ---------------------------------------------------------------------------
console.log('\nMTI rejection depth, against rotor state:\n');
console.log('wind     peak Doppler      turbine SNR at 45 dB    at 25 dB     difference');
for (const wind of [0, 2, 3.5, 6, 12]) {
  const at = (mti) => {
    const sc = defaultScenario();
    sc.farm.centreRangeM = 9000;
    sc.wind.speedMs = wind;
    sc.radar.mtiRejectionDb = mti;
    const r = analyse(sc, { skipCoverage: true });
    return { snr: r.summary.maxTurbineSnrDb, dop: r.summary.maxDopplerHz };
  };
  const a = at(45); const b = at(25);
  console.log(`${String(wind).padStart(4)} m/s ${(a.dop.toFixed(0) + ' Hz').padStart(14)}`
    + `${(a.snr.toFixed(1) + ' dB').padStart(24)}${(b.snr.toFixed(1) + ' dB').padStart(13)}`
    + `${((b.snr - a.snr).toFixed(1) + ' dB').padStart(15)}`);
}
console.log('\nA TURNING rotor puts the blade Doppler far outside the notch, so the');
console.log('rejection figure never applies and getting it wrong costs 0.2 dB. A STOPPED');
console.log('rotor sits in the notch, where the same error costs 20 dB. Ask for the MTI');
console.log('figures only if parked machines are part of what you are assessing.');
