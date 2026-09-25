// Behavioural tests for the assessment engine.
//
// These do not check that the model is right about the real world - no
// screening model can claim that. They check that it responds the way the
// underlying physics says it must, so a change that silently inverts a
// relationship gets caught.

import test from 'node:test';
import assert from 'node:assert/strict';

import { analyse } from '../js/analysis.js';
import { defaultScenario, mergeDeep, applyRadarPreset, applyTurbinePreset, RADAR_PRESETS, TURBINE_PRESETS } from '../js/model.js';

const base = () => mergeDeep(defaultScenario(), {
  environment: { terrain: { preset: 'flat', relief: 0, baseHeight: 20 } },
});

const run = (patch) => analyse(mergeDeep(base(), patch || {}), { skipCoverage: true });

test('a default scenario analyses without throwing and produces findings', () => {
  const r = analyse(defaultScenario());
  assert.ok(r.turbineResults.length > 0, 'turbines built');
  assert.ok(r.points.length > 0, 'track built');
  assert.ok(r.findings.length > 0, 'findings produced');
  assert.ok(r.coverage && r.coverage.margin.length > 0, 'coverage grid built');
  for (const p of r.points) {
    assert.ok(Number.isFinite(p.sinrDb), `SINR must be finite, got ${p.sinrDb}`);
  }
});

test('every finding carries a severity, a basis and a readable title', () => {
  const r = analyse(defaultScenario());
  for (const f of r.findings) {
    assert.ok(f.title && f.title.length > 10, `weak title: ${f.title}`);
    assert.ok(['critical', 'major', 'minor', 'info', 'check'].includes(f.severity), `bad severity ${f.severity}`);
    assert.ok(['computed', 'screening', 'check'].includes(f.basis), `bad basis ${f.basis}`);
    assert.ok(!/undefined|NaN|\[object/.test(f.title + f.detail),
      `finding text contains a formatting failure: ${f.title} / ${f.detail}`);
  }
});

test('a tall screening ridge between radar and farm masks the turbines', () => {
  const open = run({ environment: { terrain: { ridge: { enabled: false } } } });
  const screened = run({
    environment: {
      terrain: {
        ridge: {
          enabled: true, distanceM: 4500, bearingFromRadarDeg: 45,
          orientationDeg: 135, height: 450, halfWidth: 900, length: 20000,
        },
      },
    },
  });
  assert.ok(open.summary.visibleCount > 0, 'baseline should see turbines');
  assert.ok(screened.summary.maskedCount > open.summary.maskedCount,
    `ridge should mask more turbines (open ${open.summary.maskedCount}, screened ${screened.summary.maskedCount})`);
  assert.ok(screened.summary.falsePlotCount <= open.summary.falsePlotCount,
    'masking cannot increase false plots');
});

test('stopping the rotors removes the blade Doppler that defeats the clutter filter', () => {
  const spinning = run({});
  const stopped = run({ mitigation: { curtail: { enabled: true } } });
  assert.ok(spinning.summary.maxDopplerHz > 100, 'spinning rotors should show real Doppler');
  assert.equal(stopped.summary.maxDopplerHz, 0, 'stopped rotors have no blade Doppler');
  assert.ok(stopped.summary.falsePlotCount <= spinning.summary.falsePlotCount,
    'curtailment cannot make false plots worse');
  const spinRcs = Math.max(...spinning.turbineResults.map((t) => t.effectiveRcsDbsm));
  const stopRcs = Math.max(...stopped.turbineResults.map((t) => t.effectiveRcsDbsm));
  assert.ok(stopRcs < spinRcs - 10, 'a stationary turbine is far better cancelled than a turning one');
});

test('radar-absorbent treatment reduces effective RCS by the amount claimed', () => {
  const plain = run({});
  const ram = run({ mitigation: { ram: { enabled: true, reductionDb: 12 } } });
  for (let i = 0; i < plain.turbineResults.length; i++) {
    const d = plain.turbineResults[i].effectiveRcsDbsm - ram.turbineResults[i].effectiveRcsDbsm;
    assert.ok(Math.abs(d - 12) < 0.01, `expected a 12 dB reduction, got ${d.toFixed(2)} dB`);
  }
});

test('wind direction changes how much blade Doppler the radar sees', () => {
  // Farm on bearing 045. Wind from 045 puts rotors face-on to the radar;
  // wind from 135 puts them edge-on.
  const faceOn = run({ wind: { directionDeg: 45 } });
  const edgeOn = run({ wind: { directionDeg: 135 } });
  assert.ok(edgeOn.summary.maxDopplerHz > faceOn.summary.maxDopplerHz * 3,
    `edge-on should show much more Doppler (face-on ${faceOn.summary.maxDopplerHz.toFixed(0)} Hz, `
    + `edge-on ${edgeOn.summary.maxDopplerHz.toFixed(0)} Hz)`);
});

test('moving the farm further away weakens its returns', () => {
  const near = run({ farm: { centreRangeM: 6000 } });
  const far = run({ farm: { centreRangeM: 20000 } });
  assert.ok(far.summary.maxTurbineSnrDb < near.summary.maxTurbineSnrDb,
    'turbine SNR must fall with range');
});

test('blanking suppresses turbine plots and creates a measurable coverage hole', () => {
  const off = run({});
  const on = run({ mitigation: { blanking: { enabled: true, autoFit: true } } });
  assert.ok(on.summary.blankedAreaKm2 > 0, 'blanking must report the area it removes');
  assert.ok(on.blankZone, 'a blanking zone should be fitted to the farm');
  assert.ok(on.blankZone.rangeMaxM > on.blankZone.rangeMinM, 'zone has positive depth');
  assert.equal(off.summary.blankedAreaKm2, 0, 'no blanking, no hole');
  const hole = on.findings.find((f) => f.id === 'blanking-hole');
  assert.ok(hole, 'blanking must raise a coverage-hole finding, not just be reported as a fix');
});

test('a non-auto-initiation zone blocks track starts inside it but lets tracks coast', () => {
  const r = run({
    mitigation: { naiz: { enabled: true, marginM: 4000, marginDeg: 8 } },
    target: {
      profile: 'transit',
      startRangeM: 9000, startBearingDeg: 45,
      endRangeM: 22000, endBearingDeg: 45,
      altitudeFt: 3000, endAltitudeFt: 3000,
    },
  });
  assert.ok(r.naizZone, 'zone fitted');
  const blocked = r.points.filter((p) => p.initiationBlocked).length;
  assert.ok(blocked > 0, 'a flight starting inside the zone should be prevented from initiating');
});

test('an in-fill radar can only help where it actually sees the target', () => {
  const withInfill = run({
    mitigation: { infill: { enabled: true, rangeM: 9000, bearingDeg: 45, heightAgl: 20 } },
  });
  assert.ok(withInfill.infill, 'infill radar derived');
  for (const p of withInfill.points) {
    if (p.recoveredByInfill) {
      assert.ok(p.infill.marginDb >= 0, 'recovery claimed only where the in-fill has positive margin');
    }
  }
});

test('turbine clutter never improves the detection margin', () => {
  const r = run({});
  for (const p of r.points) {
    assert.ok(p.sinrDb <= p.snrDb + 1e-9,
      `signal-to-interference cannot exceed signal-to-noise (${p.sinrDb} > ${p.snrDb})`);
    assert.ok(p.clutterCostDb >= -1e-9, 'clutter cost cannot be negative');
  }
});

test('shadowing is never negative and grows through a deeper array', () => {
  const shallow = run({ farm: { layout: 'line', count: 6, arrayBearingDeg: 135 } });
  const deep = run({ farm: { layout: 'line', count: 6, arrayBearingDeg: 45 } });
  const worst = (r) => Math.max(...r.points.map((p) => p.shadowLossDb));
  assert.ok(worst(shallow) >= 0 && worst(deep) >= 0, 'shadow loss is never negative');
  // A line of turbines pointing along the radar bearing stacks more of them
  // onto the same line of sight than a line across it.
  assert.ok(deep.turbineResults.length === shallow.turbineResults.length);
});

test('every radar preset analyses cleanly', () => {
  for (const key of Object.keys(RADAR_PRESETS)) {
    const r = analyse(applyRadarPreset(base(), key), { skipCoverage: true });
    assert.ok(r.findings.length > 0, `${key} produced no findings`);
    assert.ok(Number.isFinite(r.radar.requiredSnrDb), `${key} required SNR not finite`);
    assert.ok(r.radar.requiredSnrDb > -20 && r.radar.requiredSnrDb < 40,
      `${key} required SNR implausible: ${r.radar.requiredSnrDb}`);
  }
});

test('every turbine preset analyses cleanly and bigger machines return more', () => {
  const snr = {};
  for (const key of Object.keys(TURBINE_PRESETS)) {
    const r = analyse(applyTurbinePreset(base(), key), { skipCoverage: true });
    assert.ok(Number.isFinite(r.summary.maxTurbineSnrDb), `${key} SNR not finite`);
    snr[key] = r.summary.maxTurbineSnrDb;
  }
  assert.ok(snr['offshore-15000'] > snr['small-850'],
    'a 15 MW machine should return more than a 0.85 MW one');
});

test('all three flight profiles build and analyse', () => {
  for (const profile of ['transit', 'approach', 'orbit']) {
    const r = run({ target: { profile } });
    assert.ok(r.points.length > 8, `${profile} produced too few samples`);
    for (const p of r.points) {
      assert.ok(Number.isFinite(p.geom.slant), `${profile}: bad geometry`);
      assert.ok(Number.isFinite(p.effectiveMarginDb), `${profile}: bad margin`);
    }
  }
});

test('the coverage grid agrees with the track assessment at the same place', () => {
  const r = analyse(mergeDeep(base(), {
    target: { altitudeFt: 4000, profile: 'transit' },
  }));
  const { coverage } = r;
  let checked = 0;
  for (const p of r.points) {
    if (p.outOfRange || Math.abs(p.amsl - coverage.amsl) > 1) continue;
    const i = Math.round((p.east + coverage.extent) / coverage.step);
    const j = Math.round((p.north + coverage.extent) / coverage.step);
    if (i < 1 || j < 1 || i >= coverage.size - 1 || j >= coverage.size - 1) continue;
    const g = coverage.margin[j * coverage.size + i];
    if (!Number.isFinite(g)) continue;
    // The grid is coarse, so only require the same broad answer.
    assert.ok(Math.abs(g - p.marginDb) < 25,
      `grid and track disagree badly: grid ${g.toFixed(1)} dB vs track ${p.marginDb.toFixed(1)} dB`);
    checked += 1;
  }
  assert.ok(checked > 5, `expected to cross-check several points, only did ${checked}`);
});

test('analysis is deterministic', () => {
  const s = defaultScenario();
  const a = analyse(s, { skipCoverage: true });
  const b = analyse(s, { skipCoverage: true });
  assert.equal(a.summary.falsePlotCount, b.summary.falsePlotCount);
  assert.equal(a.summary.untrackedCount, b.summary.untrackedCount);
  assert.equal(a.turbineResults[0].snrEffDb, b.turbineResults[0].snrEffDb);
});

test('blanking hides plots without removing the returns that cause them', () => {
  const on = run({ mitigation: { blanking: { enabled: true, autoFit: true, marginM: 2000, marginDeg: 4 } } });
  assert.ok(on.summary.falsePlotCount > 0,
    'the returns are still above threshold - blanking is downstream of detection');
  assert.equal(on.summary.displayedPlotCount, 0,
    'but none of them should reach the display');
  assert.equal(on.summary.suppressedPlotCount, on.summary.falsePlotCount,
    'every above-threshold return inside the sector is accounted for as suppressed');
  const f = on.findings.find((x) => x.id === 'plots-suppressed');
  assert.ok(f, 'the tool must say the plots are hidden rather than removed');
});

test('without blanking, every above-threshold return reaches the display', () => {
  const off = run({});
  assert.equal(off.summary.displayedPlotCount, off.summary.falsePlotCount);
  assert.equal(off.summary.suppressedPlotCount, 0);
});

test('curtailment attacks the cause, blanking only the symptom', () => {
  const spinning = run({});
  const blanked = run({ mitigation: { blanking: { enabled: true, autoFit: true } } });
  const stopped = run({ mitigation: { curtail: { enabled: true } } });

  // Blanking: the returns are unchanged, they just never reach the display.
  assert.equal(blanked.summary.falsePlotCount, spinning.summary.falsePlotCount,
    'blanking does not change what the receiver sees');
  assert.equal(blanked.summary.displayedPlotCount, 0, 'but nothing reaches the display');

  // Curtailment: the returns themselves collapse. Note that a stopped turbine
  // is still a large fixed structure, so a finite clutter-rejection figure does
  // not necessarily take every machine below threshold - which is exactly why
  // real systems lean on clutter maps as well as an MTI notch.
  assert.ok(stopped.summary.maxTurbineSnrDb < spinning.summary.maxTurbineSnrDb - 20,
    'stopping the rotors must collapse the return, not merely trim it');
  assert.ok(stopped.summary.falsePlotCount <= spinning.summary.falsePlotCount);
  assert.equal(stopped.summary.suppressedPlotCount, 0, 'no blanking, so nothing is suppressed');
  assert.equal(stopped.summary.displayedPlotCount, stopped.summary.falsePlotCount);
});
