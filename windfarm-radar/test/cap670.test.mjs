// CAP 670 GEN 02 Appendix A: the ATC radio site wind turbine check.
//
// EVERY NUMBER HERE CAME FROM A SUMMARY, NOT FROM THE DOCUMENT. These tests
// hold the transcription and the stated handling of its known contradictions.
// They do NOT establish that the figures are right, and no test in this file
// should ever be read as doing so.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVENANCE, ZONES, CLASS_ORDER, TABLE_1, ANGLE_BASIS, NOT_IMPLEMENTED, SENSITIVITY,
  CI_THRESHOLDS, CI_TRIGGERS, GEN01, FLOWCHART_DISCREPANCY,
  classifyByRotor, subtenseDeg, zonalCheck, routeToCI, checkCarrierToInterference,
  gen01Check, operationalImpactOutcome,
} from '../js/cap670.js';

test('the module states that the document was never read', () => {
  assert.equal(PROVENANCE.read, false);
  assert.match(PROVENANCE.basis, /transcribed|never retrieved/i);
  assert.ok(PROVENANCE.blockedHosts.includes('www.caa.co.uk'));
  // And that it is radio sites, not radar, which is the commonest way this
  // would be misread given what the rest of the tool does.
  assert.match(PROVENANCE.covers, /radio/i);
  assert.match(PROVENANCE.doesNotCover, /radar|SUR 13/i);
});

test('the transcribed thresholds are exactly as supplied', () => {
  const expected = {
    'large-industrial': [2.1, 17.2, 2.6, 0.4],
    reference: [1.3, 10.5, 3.5, 0.5],
    large: [0.8, 5.8, 3.6, 0.6],
    medium: [0.5, 3.5, 4.6, 0.7],
    small: [0.25, 1.8, 4.6, 0.7],
  };
  for (const [k, [redKm, greenKm, redDeg, greenDeg]] of Object.entries(expected)) {
    assert.equal(ZONES[k].redKm, redKm, `${k} red km`);
    assert.equal(ZONES[k].greenKm, greenKm, `${k} green km`);
    assert.equal(ZONES[k].redDeg, redDeg, `${k} red deg`);
    assert.equal(ZONES[k].greenDeg, greenDeg, `${k} green deg`);
  }
  assert.equal(CI_THRESHOLDS.singleTurbineDb, 20);
  assert.equal(CI_THRESHOLDS.worstOfSeveralDb, 23);
  assert.equal(CI_THRESHOLDS.aggregateDb, 14);
  assert.equal(CI_THRESHOLDS.fieldStrengthVhfDbuVm, 26);
  assert.equal(CI_THRESHOLDS.fieldStrengthUhfDbuVm, 35);
  assert.equal(GEN01.consultationRadiusKm, 20);
  assert.equal(GEN01.ilsApproachRadiusKm, 34);
  assert.equal(GEN01.observerHeightM, 25);
  assert.equal(CI_TRIGGERS.tipHeightM, 110);
  assert.equal(CI_TRIGGERS.turbineCount, 10);
});

test('the thresholds get more restrictive as the class gets larger', () => {
  // A sanity check on the transcription itself: a bigger machine must be
  // flagged further out and at a smaller subtended angle.
  for (let i = 1; i < CLASS_ORDER.length; i += 1) {
    const small = ZONES[CLASS_ORDER[i - 1]];
    const big = ZONES[CLASS_ORDER[i]];
    assert.ok(big.redKm >= small.redKm, `${big.label} red distance`);
    assert.ok(big.greenKm >= small.greenKm, `${big.label} green distance`);
    assert.ok(big.redDeg <= small.redDeg, `${big.label} red angle`);
    assert.ok(big.greenDeg <= small.greenDeg, `${big.label} green angle`);
  }
});

test('Table 1 is declared not implemented, with the reason', () => {
  assert.equal(TABLE_1.implemented, false);
  assert.match(TABLE_1.reason, /not supplied|not read/i);
  assert.match(TABLE_1.rule, /larger class/i);
  assert.ok(NOT_IMPLEMENTED.some((n) => /Table 1/.test(n.item)));
  assert.ok(NOT_IMPLEMENTED.some((n) => /SUR 13/.test(n.item)));
  assert.ok(NOT_IMPLEMENTED.some((n) => /Table 3/.test(n.item)));
});

test('every class the classifier can return is inferred, and says so', () => {
  for (const d of [10, 22, 43, 61, 92, 120, 236]) {
    const c = classifyByRotor(d);
    assert.equal(c.inferred, true, `${d} m must be flagged inferred`);
    assert.ok(CLASS_ORDER.includes(c.key));
    assert.match(c.note, /INFERRED/);
  }
});

test('a borderline turbine takes the LARGER class, as the rule requires', () => {
  // 60 m sits one metre under the inferred 61 m Large boundary, which is the
  // very boundary the supplied summary flagged as doubtful.
  const sixty = classifyByRotor(60);
  assert.equal(sixty.key, 'large');
  assert.equal(sixty.borderline, true);
  // Well inside a band, it is not borderline.
  assert.equal(classifyByRotor(80).borderline, false);
  assert.equal(classifyByRotor(80).key, 'large');
});

test('angular subtense is geometry, and is the stated inference', () => {
  // A 100 m rotor at 1 km subtends 2 atan(50/1000).
  const expected = 2 * Math.atan(50 / 1000) * 180 / Math.PI;
  assert.ok(Math.abs(subtenseDeg(100, 1000) - expected) < 1e-9);
  assert.equal(subtenseDeg(100, 0), 180, 'zero range must not produce a NaN');
  assert.equal(ANGLE_BASIS.verified, false);
  assert.match(ANGLE_BASIS.interpretation, /subtense/i);
});

test('agreement between distance and angle decides, and says so', () => {
  const near = zonalCheck({ classKey: 'large-industrial', distanceM: 500, rotorDiameterM: 120 });
  assert.equal(near.zone, 'red');
  assert.equal(near.cellBasis, 'both agree');
  const far = zonalCheck({ classKey: 'large-industrial', distanceM: 20000, rotorDiameterM: 120 });
  assert.equal(far.zone, 'green');
  assert.equal(far.cellBasis, 'both agree');
});

test('THE KNOWN CONTRADICTION: a red distance with a green angle comes out green, and warns', () => {
  // Forced by passing the angle directly, which is the only way to get this
  // pairing: at a red distance a real rotor subtends a red angle.
  const r = zonalCheck({ classKey: 'large', distanceM: 500, rotorDiameterM: 60, angleDeg: 0.3 });
  assert.equal(r.byDistance, 'red');
  assert.equal(r.byAngle, 'green');
  assert.equal(r.zone, 'green', 'Table 3 as printed must be implemented as printed');
  assert.equal(r.cellBasis, 'the one cell of Table 3 that was supplied');
  assert.ok(r.warnings.some((w) => /automatic objection/i.test(w)),
    'the contradiction with the Red definition must be reported, not resolved silently');
});

test('combinations that were NOT supplied take the WORSE of the two, and say so', () => {
  // Amber distance with a red angle is not a cell anyone gave us. The default
  // is the conservative reading: it was chosen by measuring that a permissive
  // extrapolation triples the damage from the angle-basis unknown.
  const r = zonalCheck({ classKey: 'medium', distanceM: 700, rotorDiameterM: 60 });
  assert.equal(r.byDistance, 'amber');
  assert.equal(r.byAngle, 'red');
  assert.equal(r.zone, 'red', 'the worse of amber and red is red');
  assert.match(r.cellBasis, /INFERRED/);
  assert.ok(r.warnings.some((w) => /WORSE/.test(w)));

  // The permissive reading is available for anyone who has the real table.
  const loose = zonalCheck({ classKey: 'medium', distanceM: 700, rotorDiameterM: 60 },
    { unsuppliedCellsFavourable: true });
  assert.equal(loose.zone, 'amber');
  assert.match(loose.cellBasis, /more favourable/);
});

test('the one SUPPLIED cell stays permissive whichever extrapolation is chosen', () => {
  // Red distance with a green angle is not a guess, so the conservative
  // default must not override it.
  for (const opts of [{}, { unsuppliedCellsFavourable: true }]) {
    const r = zonalCheck({ classKey: 'large', distanceM: 500, rotorDiameterM: 60, angleDeg: 0.3 }, opts);
    assert.equal(r.zone, 'green');
    assert.equal(r.cellBasis, 'the one cell of Table 3 that was supplied');
  }
});

test('an unknown class is refused rather than guessed', () => {
  assert.throws(() => zonalCheck({ classKey: 'enormous', distanceM: 1000, rotorDiameterM: 60 }),
    /unknown turbine class/);
});

test('routing to the C/I method fires on tip height, count or amber', () => {
  assert.equal(routeToCI({ zone: 'green', tipHeightM: 90, turbineCount: 3 }).outcome, 'no objection');
  assert.equal(routeToCI({ zone: 'red', tipHeightM: 90, turbineCount: 3 }).outcome, 'objection');
  const tall = routeToCI({ zone: 'green', tipHeightM: 111, turbineCount: 3 });
  assert.equal(tall.required, true);
  assert.match(tall.reasons[0], /111 m is above 110 m/);
  const many = routeToCI({ zone: 'green', tipHeightM: 90, turbineCount: 11 });
  assert.equal(many.required, true);
  const amber = routeToCI({ zone: 'amber', tipHeightM: 90, turbineCount: 3 });
  assert.equal(amber.required, true);
  // Exactly at a trigger is NOT over it.
  assert.equal(routeToCI({ zone: 'green', tipHeightM: 110, turbineCount: 10 }).required, false);
});

test('the disputed flowchart box takes the conservative reading and says so', () => {
  const hit = operationalImpactOutcome(true);
  assert.equal(hit.outcome, 'objection');
  assert.match(hit.warning, /prints the other way round|other way/i);
  assert.equal(operationalImpactOutcome(false).outcome, 'no objection');
  assert.match(FLOWCHART_DISCREPANCY.status, /unresolved/i);
  assert.match(FLOWCHART_DISCREPANCY.implemented, /conservative/i);
});

test('C/I ratios are checked against the thresholds but never computed', () => {
  assert.equal(checkCarrierToInterference([]), null);
  const single = checkCarrierToInterference([21]);
  assert.equal(single.pass, true);
  assert.equal(single.checks[0].limit, 20);
  assert.equal(checkCarrierToInterference([19]).pass, false);
  const several = checkCarrierToInterference([30, 24, 26], { aggregateDb: 15 });
  assert.equal(several.checks[0].limit, 23, 'several turbines take the 23 dB limit');
  assert.equal(several.checks[0].value, 24, 'the WORST ratio is the one tested');
  assert.equal(several.pass, true);
  assert.equal(checkCarrierToInterference([30, 24], { aggregateDb: 13 }).pass, false);
  assert.match(several.caution, /INDICATIVE ONLY/);
  assert.match(several.caution, /qualified consultancy/i);
});

test('GEN 01 consultation radius, and 34 km for an ILS approach', () => {
  const a = gen01Check({ distanceM: 25000, tipHeightAmslM: 200, siteAmslM: 50 });
  assert.equal(a.withinConsultation, false);
  assert.equal(a.radiusKm, 20);
  const b = gen01Check({ distanceM: 25000, tipHeightAmslM: 200, siteAmslM: 50, ilsApproach: true });
  assert.equal(b.withinConsultation, true);
  assert.equal(b.radiusKm, 34);
});

test('the visual horizon rule is geometry, and "may be acceptable" is kept as the wording', () => {
  // An observer 25 m up sees about 20.6 km at 4/3 earth radius.
  const near = gen01Check({ distanceM: 5000, tipHeightAmslM: 150, siteAmslM: 0 });
  assert.ok(near.horizonDistanceM > 20000 && near.horizonDistanceM < 21500,
    `horizon ${near.horizonDistanceM.toFixed(0)} m`);
  assert.equal(near.belowVisualHorizon, false, 'inside the horizon nothing is hidden');
  // Beyond the horizon there is a height a body must exceed to be seen. Test
  // that threshold rather than a lucky pair of numbers: at 60 km it is about
  // 91 m, so a 100 m tip is still VISIBLE and only something lower is hidden.
  const probe = gen01Check({ distanceM: 60000, tipHeightAmslM: 0, siteAmslM: 0 });
  const cut = probe.tipHiddenBelowAmslM;
  assert.ok(cut > 80 && cut < 105, `threshold ${cut.toFixed(0)} m at 60 km`);
  assert.equal(gen01Check({ distanceM: 60000, tipHeightAmslM: cut + 1, siteAmslM: 0 })
    .belowVisualHorizon, false, 'a tip above the threshold is visible');
  const far = gen01Check({ distanceM: 60000, tipHeightAmslM: cut - 1, siteAmslM: 0 });
  assert.equal(far.belowVisualHorizon, true, 'a tip below the threshold is hidden');
  assert.match(far.note, /may be/i, 'the source wording is "may be", not a pass');
});

test('the sensitivity measurement is recorded, including what costs nothing', () => {
  assert.ok(SENSITIVITY.measuredOn > 10000);
  assert.match(SENSITIVITY.worstUnknown, /angle/i);
  // These are on no verdict path. If that ever stops being true, this must fail.
  for (const k of ['fieldStrengthVhfDbuVm', 'singleTurbineDb', 'consultationRadiusKm']) {
    assert.ok(SENSITIVITY.zeroImpact.includes(k), `${k} should be recorded as zero-impact`);
  }
  assert.match(SENSITIVITY.note, /zonal verdict/i);
});
