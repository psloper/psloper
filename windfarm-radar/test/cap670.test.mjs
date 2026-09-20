// CAP 670 was read from a copy of the document. These tests check the figures
// in js/cap670.js against the stored text of that document, so a number cannot
// be edited into the module unless CAP 670 actually contains it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  PROVENANCE, CORRECTIONS, TABLE_1, CLASS_ORDER, ZONES, ANGLE_BASIS, TABLE_3,
  TABLE_3_CONTRADICTION, SCOPE, CI_THRESHOLDS, METHOD_2_BASELINE, RCS_DBSM,
  RCS_SCALING, TABLE_4_5_INCONSISTENCY, GEN01, GEN02_VHF_UHF_FRAME, SUR13,
  NOT_IMPLEMENTED, FLOWCHART_DISCREPANCY, SUR13_MITIGATION, OUT_OF_REACH,
  classifyTurbine, hubElevationDeg, zonalCheck, outOfScopeCheck, routeToCI,
  checkCarrierToInterference, gen01Check, operationalImpactOutcome,
  scaledMonostaticRcsDbsm, rotorFromRcsM,
} from '../js/cap670.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The document uses typographic dashes and quotes; normalise both sides so a
// quote can be written in plain ASCII and still be checked verbatim.
const squash = (s) => s.replace(/\s+/g, ' ').replace(/[\u2019\u2018]/g, "'")
  .replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').trim();
const doc = squash(readFileSync(resolve(root, PROVENANCE.evidence), 'utf8'));
const sur = squash(readFileSync(resolve(root, SUR13.evidence), 'utf8'));

const inDoc = (text) => doc.includes(squash(text));

// --------------------------------------------------------------- the source

test('the stored extract is the edition the module claims', () => {
  assert.match(doc, /CAP 670/);
  assert.match(doc, /Amendment 1\/2019/);
  assert.equal(PROVENANCE.read, true);
  assert.match(PROVENANCE.edition, /Third Issue, Amendment 1\/2019/);
  assert.ok(doc.includes('GEN 01: Wind Turbines'));
  assert.ok(doc.includes('Appendix A to GEN 02'));
});

test('every quote the module carries is verbatim in the document', () => {
  const quotes = [
    ANGLE_BASIS.quote,
    ANGLE_BASIS.flatEarthQuote,
    SCOPE.methodOneQuote,
    SCOPE.ciQuote,
    SCOPE.notVisibleQuote,
    SCOPE.hubBelowSiteQuote,
    GEN01.quote,
    GEN02_VHF_UHF_FRAME.quote,
    TABLE_3_CONTRADICTION.redDefinition,
    RCS_SCALING.formula,
  ].filter(Boolean);
  for (const q of quotes) {
    assert.ok(inDoc(q), `not verbatim in CAP 670: "${q.slice(0, 80)}..."`);
  }
  assert.ok(inDoc(SUR13.lineOfSightDuty) || sur.includes(squash(SUR13.lineOfSightDuty)),
    'the SUR 13 line-of-sight duty is not verbatim in the SUR 13 extract');
});

// ------------------------------------------------------------------ Table 1

test('Table 1 bands match the document', () => {
  // Quoted rows, as the table prints them.
  assert.ok(inDoc('Small | < 20 metres | < 15 metres | < 27.5 metres'));
  assert.ok(inDoc('Medium | 20 - 40 metres | 15 - 35 metres | 27.5 - 57.5 metres'));
  assert.ok(inDoc('Large | 40 - 60 metres | 35 - 60 metres | 57.5 - 90 metres'));
  assert.ok(inDoc('Large Industrial | 60 - 95 metres | 60 - 126 metres | 90 - 158 metres'));
  assert.ok(inDoc('Reference | 80 metres | 90 metres | 125 metres'));

  const b = TABLE_1.bands;
  assert.deepEqual(b.small.hubM, [0, 20]);
  assert.deepEqual(b.small.rotorM, [0, 15]);
  assert.deepEqual(b.small.tipM, [0, 27.5]);
  assert.deepEqual(b.medium.rotorM, [15, 35]);
  assert.deepEqual(b.large.rotorM, [35, 60]);
  assert.deepEqual(b['large-industrial'].rotorM, [60, 126]);
  assert.deepEqual(b['large-industrial'].tipM, [90, 158]);
  assert.equal(TABLE_1.reference.rotorM, 90);
});

test('the worked example in the document classifies the way the document says', () => {
  // "A turbine with hub height 20 metres, rotor diameter 18 metres, tip height
  // 29 metres is classified as Medium Class due to the rotor diameter
  // exceeding 15 metres."
  const r = classifyTurbine({ hubHeightM: 20, rotorDiameterM: 18, tipHeightM: 29 });
  assert.equal(r.key, 'medium');
  assert.ok(r.drivers.includes('rotorDiameterM'));
  assert.ok(inDoc('is classified as Medium Class due to the rotor diameter exceeding 15 metres'));
});

test('the largest class any one dimension implies is the one used', () => {
  // A short tower carrying a very large rotor is not a Small machine.
  const r = classifyTurbine({ hubHeightM: 18, rotorDiameterM: 70, tipHeightM: 53 });
  assert.equal(r.key, 'large-industrial');
  assert.deepEqual(r.drivers, ['rotorDiameterM']);
  assert.equal(r.perDimension.hubHeightM, 'small');
});

test('a machine bigger than Table 1 says so rather than pretending to fit', () => {
  const r = classifyTurbine({ hubHeightM: 120, rotorDiameterM: 170, tipHeightM: 205 });
  assert.equal(r.key, 'large-industrial');
  assert.equal(r.beyondTable, true);
  assert.match(r.note, /above the top of Table 1/);
});

test('classification needs at least one dimension', () => {
  assert.throws(() => classifyTurbine({}), /at least one of/);
});

// ------------------------------------------------------------------ Table 2

test('Table 2 values match the document, empty cells included', () => {
  assert.ok(inDoc('Large Industrial | 2.1 | 17.2 | 2.6° | 0.4°'));
  assert.ok(inDoc('Reference | 1.3 |  | 3.5° | 0.5°'));
  assert.ok(inDoc('Small | 0.25 |  | 4.6° | 0.7°'));

  assert.equal(ZONES['large-industrial'].greenKm, 17.2);
  for (const k of ['reference', 'large', 'medium', 'small']) {
    assert.equal(ZONES[k].greenKm, null,
      `${k} has a Green distance, but Table 2 leaves that cell empty`);
  }
  assert.deepEqual(CLASS_ORDER.map((k) => ZONES[k].redKm), [0.25, 0.5, 0.8, 1.3, 2.1]);
  assert.deepEqual(CLASS_ORDER.map((k) => ZONES[k].redDeg), [4.6, 4.6, 3.6, 3.5, 2.6]);
  assert.deepEqual(CLASS_ORDER.map((k) => ZONES[k].greenDeg), [0.7, 0.7, 0.6, 0.5, 0.4]);
});

test('a class with no published Green distance can never be green on distance', () => {
  // 500 km away, which is off the island, and it is still Amber on distance.
  const r = zonalCheck({ classKey: 'medium', distanceM: 500_000, angleDeg: 2 });
  assert.equal(r.byDistance, 'amber');
  assert.ok(r.warnings.some((w) => /publishes no Green distance/.test(w)));
});

// ----------------------------------------------------------- what the angle is

test('the angle is a hub elevation angle, not a subtense', () => {
  assert.equal(ANGLE_BASIS.verified, true);
  assert.match(ANGLE_BASIS.interpretation, /elevation angle of the turbine hub/);

  // 80 m hub, site base at 0, 2 km away: atan(80/2000) = 2.29 degrees.
  assert.ok(Math.abs(hubElevationDeg(80, 0, 2000) - 2.2906) < 1e-3);
  // A hub below the site reads negative, which is what "sloping downwards" means.
  assert.ok(hubElevationDeg(10, 60, 2000) < 0);
  // Moving further away shrinks the angle. A subtense would do the same, but a
  // subtense would not care about height, and this one does.
  assert.ok(hubElevationDeg(80, 0, 4000) < hubElevationDeg(80, 0, 2000));
  assert.ok(hubElevationDeg(120, 0, 2000) > hubElevationDeg(80, 0, 2000));
});

// ------------------------------------------------------------------ Table 3

test('all nine Table 3 cells match the document', () => {
  const rows = [
    ['red', 'red', 'red', 'Excessive impact'],
    ['red', 'amber', 'amber', 'Terrain sloping downwards'],
    ['red', 'green', 'green', 'Terrain sloping downwards'],
    ['amber', 'red', 'red', 'Excessive impact'],
    ['amber', 'amber', 'amber', 'Indeterminate impact'],
    ['amber', 'green', 'green', 'Terrain sloping downwards'],
    ['green', 'red', 'amber', 'Terrain sloping upwards'],
    ['green', 'amber', 'green', 'Marginal impact'],
    ['green', 'green', 'green', 'Acceptable impact'],
  ];
  assert.equal(Object.keys(TABLE_3.cells).length, 9);
  for (const [d, a, overall, rationale] of rows) {
    const cell = TABLE_3.cells[`${d}|${a}`];
    assert.ok(cell, `Table 3 has no cell for ${d} distance and ${a} angle`);
    assert.equal(cell.overall, overall, `${d}|${a} should be ${overall}`);
    assert.equal(cell.rationale, rationale);
    // and the row is in the document, in its printed order and wording
    const printed = `${d.toUpperCase()} | ${a.toUpperCase()} | ${overall.toUpperCase()} | ${rationale}`;
    assert.ok(inDoc(printed), `Table 3 row not found in the document: ${printed}`);
  }
  assert.equal(TABLE_3.implemented, true);
});

test('the four cells the old inference got wrong now follow the table', () => {
  // Each of these was harsher than CAP 670 before the document was read.
  const cases = [
    { d: 'red', a: 'amber', was: 'red', now: 'amber' },
    { d: 'amber', a: 'green', was: 'amber', now: 'green' },
    { d: 'green', a: 'red', was: 'red', now: 'amber' },
    { d: 'green', a: 'amber', was: 'amber', now: 'green' },
  ];
  for (const c of cases) {
    assert.equal(TABLE_3.cells[`${c.d}|${c.a}`].overall, c.now);
    assert.notEqual(c.was, c.now);
  }
});

test('the Red-distance-Green-angle contradiction is applied as printed and reported', () => {
  // Large Industrial: inside 2.1 km is Red on distance. A hub at or below the
  // site base gives a zero or negative angle, which is Green.
  const r = zonalCheck({ classKey: 'large-industrial', distanceM: 1500, angleDeg: 0.1 });
  assert.equal(r.byDistance, 'red');
  assert.equal(r.byAngle, 'green');
  assert.equal(r.zone, 'green');
  assert.ok(r.warnings.some((w) => /automatic rejection/.test(w)));
  assert.ok(inDoc(TABLE_3_CONTRADICTION.redDefinition));
});

test('a zonal check can be driven from heights instead of an angle', () => {
  const byAngle = zonalCheck({ classKey: 'large', distanceM: 3000, angleDeg: hubElevationDeg(100, 20, 3000) });
  const byHeights = zonalCheck({ classKey: 'large', distanceM: 3000, hubAmslM: 100, siteBaseAmslM: 20 });
  assert.equal(byHeights.zone, byAngle.zone);
  assert.ok(Math.abs(byHeights.angleDeg - byAngle.angleDeg) < 1e-9);
  assert.throws(() => zonalCheck({ classKey: 'large', distanceM: 3000 }), /needs angleDeg/);
});

// ------------------------------------------------------------------- scope

test('the out-of-scope clauses match the document', () => {
  const hidden = outOfScopeCheck({ visibleFromSite: false, turbineCount: 40 });
  assert.equal(hidden.acceptable, true);

  // Single turbine, hub below the radio station base level, clear of the red zone.
  const below = outOfScopeCheck({
    visibleFromSite: true, turbineCount: 1, hubAmslM: 40, siteBaseAmslM: 120,
    distanceM: 2000, classKey: 'large',
  });
  assert.equal(below.acceptable, true);

  // Same but inside the red zone separation.
  const tooClose = outOfScopeCheck({
    visibleFromSite: true, turbineCount: 1, hubAmslM: 40, siteBaseAmslM: 120,
    distanceM: 500, classKey: 'large',
  });
  assert.equal(tooClose.acceptable, false);

  // Nothing applies.
  const none = outOfScopeCheck({ visibleFromSite: true, turbineCount: 5, hubAmslM: 90, siteBaseAmslM: 10 });
  assert.equal(none.acceptable, null);
});

test('the C/I routing triggers are the ones the document gives', () => {
  assert.equal(SCOPE.ciTipHeightM, 110);
  assert.equal(SCOPE.methodOneMaxTurbines, 10);
  assert.equal(routeToCI({ zone: 'green', tipHeightM: 111, turbineCount: 3 }).required, true);
  assert.equal(routeToCI({ zone: 'green', tipHeightM: 90, turbineCount: 11 }).required, true);
  assert.equal(routeToCI({ zone: 'amber', tipHeightM: 90, turbineCount: 3 }).required, true);
  assert.equal(routeToCI({ zone: 'green', tipHeightM: 90, turbineCount: 3 }).outcome, 'no objection');
  assert.equal(routeToCI({ zone: 'red', tipHeightM: 90, turbineCount: 3 }).outcome, 'objection');
});

// ----------------------------------------------------------------- Method 2

test('the carrier-to-interference thresholds match the document', () => {
  assert.equal(CI_THRESHOLDS.singleTurbineDb, 20);
  assert.equal(CI_THRESHOLDS.worstOfSeveralDb, 23);
  assert.equal(CI_THRESHOLDS.aggregateDb, 14);
  assert.equal(CI_THRESHOLDS.fieldStrengthVhfDbuVm, 26);
  assert.equal(CI_THRESHOLDS.fieldStrengthUhfDbuVm, 35);
  assert.ok(inDoc('Acceptance criteria = > 20dB C/I ratio in the volume of interest'));
  assert.ok(inDoc('Acceptance criteria = > 23dB C/I ratio in the volume of interest'));
  assert.ok(inDoc('Acceptance criteria = > 14dB C/I ratio in the volume of interest'));
  assert.ok(inDoc('field strength limit of 26 dBuV/m'));
  assert.ok(inDoc('field strength limit of 35 dBuV/m'));
  assert.match(CI_THRESHOLDS.caution, /suitably qualified consultancy/);
  assert.ok(inDoc('undertaken by a suitably qualified consultancy practice or organisation'));
});

test('the Method 2 baseline matches the document', () => {
  const s = METHOD_2_BASELINE.radioStation;
  assert.equal(s.antennaHeightM, 10);
  assert.equal(s.aerialGainDbi, 2.1);
  assert.equal(s.aerialSystemLossDb, 3);
  assert.equal(s.txPowerVhfW, 50);
  assert.equal(s.txPowerUhfW, 100);
  assert.equal(s.vhfHz, 127e6);
  assert.equal(s.uhfHz, 368e6);
  assert.ok(inDoc('Antenna height - 10 metres'));
  assert.ok(inDoc('Aerial Gain : 2.1 dBi'));
  assert.ok(inDoc('Aerial system losses : 3dB'));
  assert.equal(METHOD_2_BASELINE.turbine.aerialGainDbi, 0);
});

test('the C/I check compares against the right threshold for one or several turbines', () => {
  assert.equal(checkCarrierToInterference([21]).pass, true);
  assert.equal(checkCarrierToInterference([19]).pass, false);
  assert.equal(checkCarrierToInterference([24, 30]).pass, true);
  assert.equal(checkCarrierToInterference([22, 30]).pass, false);
  assert.equal(checkCarrierToInterference([24, 30], { aggregateDb: 13 }).pass, false);
  assert.equal(checkCarrierToInterference([]), null);
});

// ------------------------------------------------------------- Tables 4 and 5

test('the RCS tables match the document', () => {
  assert.ok(inDoc('Large Industrial | 51.0 |  | 41.0 |'));
  assert.ok(inDoc('Small | 32.5 | 1782 | 22.5 | 178'));
  assert.ok(inDoc('Large Industrial | 55.6 | 364254 | 45.6 | 36425'));
  assert.equal(RCS_DBSM.vhf.monostatic.reference, 38.1);
  assert.equal(RCS_DBSM.uhf.bistatic.small, 37.1);
  assert.equal(RCS_DBSM.vhf.frequencyHz, 127e6);
  assert.equal(RCS_DBSM.uhf.frequencyHz, 368e6);
});

test('bistatic is exactly 10 dB above monostatic in both tables, as the document states', () => {
  assert.ok(inDoc('Peak Bistatic RCS value is 10dB higher'));
  for (const band of ['vhf', 'uhf']) {
    for (const k of CLASS_ORDER) {
      const gap = RCS_DBSM[band].bistatic[k] - RCS_DBSM[band].monostatic[k];
      assert.ok(Math.abs(gap - 10) < 1e-9, `${band} ${k}: bistatic is ${gap.toFixed(2)} dB above monostatic`);
    }
  }
});

test("the document's own scaling formula reproduces four of its five classes", () => {
  // Small, Medium and Large Industrial scale from the TOP of their Table 1
  // rotor band. Reference scales from its stated 90 m.
  const fromTop = { small: 15, medium: 35, 'large-industrial': 126, reference: 90 };
  for (const [k, d] of Object.entries(fromTop)) {
    for (const [band, f] of [['vhf', 127], ['uhf', 368]]) {
      const calc = scaledMonostaticRcsDbsm(d, f);
      const published = RCS_DBSM[band].monostatic[k];
      assert.ok(Math.abs(calc - published) < 0.06,
        `${band} ${k}: formula gives ${calc.toFixed(2)}, table says ${published}`);
    }
  }
});

test('the Large class does NOT reproduce, and the gap is recorded rather than silently fixed', () => {
  const t = TABLE_4_5_INCONSISTENCY;
  const fromTopVhf = scaledMonostaticRcsDbsm(60, 127);
  assert.ok(Math.abs(fromTopVhf - t.scaledFromTopOfBandDbsm) < 0.02);
  assert.ok(Math.abs((fromTopVhf - RCS_DBSM.vhf.monostatic.large) - t.gapDb) < 0.02);

  // Inverting the formula on the published value gives the diameter it was
  // built from, and it is the same in both bands.
  const dv = rotorFromRcsM(RCS_DBSM.vhf.monostatic.large, 127);
  const du = rotorFromRcsM(RCS_DBSM.uhf.monostatic.large, 368);
  assert.ok(Math.abs(dv - t.impliedRotorM) < 0.2, `VHF implies ${dv.toFixed(1)} m`);
  assert.ok(Math.abs(du - t.impliedRotorM) < 0.3, `UHF implies ${du.toFixed(1)} m`);
  assert.ok(Math.abs(dv - du) < 0.3, 'the two bands imply different diameters, so it is not one error');

  // The published figure stays published.
  assert.equal(RCS_DBSM.vhf.monostatic.large, t.publishedMonostaticVhfDbsm);
  assert.match(t.implemented, /used as printed/);
});

// ------------------------------------------------------------------- GEN 01

test('GEN 01 figures match the document', () => {
  assert.equal(GEN01.consultationRadiusKm, 20);
  assert.equal(GEN01.ilsApproachRadiusKm, 34);
  assert.equal(GEN01.observerHeightM, 25);
  assert.ok(inDoc('within a minimum radius of 20 km from their Aerodrome or Radio Site'));
  assert.ok(inDoc('may extend to 34 km for ILS approaches'));
  assert.ok(inDoc(GEN01.quote));
  assert.match(GEN01.horizonRule, /"May be" is the source wording/);
});

test('GEN 02.25 example frame for a VHF or UHF radio site matches the document', () => {
  assert.equal(GEN02_VHF_UHF_FRAME.groundCircleRadiusM, 91);
  assert.equal(GEN02_VHF_UHF_FRAME.slopeFromElevationM, 9);
  assert.equal(GEN02_VHF_UHF_FRAME.slopeToRadiusM, 610);
  assert.ok(inDoc(GEN02_VHF_UHF_FRAME.quote));
});

test('the visual horizon check behaves geometrically', () => {
  const near = gen01Check({ distanceM: 5000, tipHeightAmslM: 150, siteAmslM: 50 });
  assert.equal(near.withinConsultation, true);
  assert.equal(near.belowVisualHorizon, false);

  const far = gen01Check({ distanceM: 90_000, tipHeightAmslM: 60, siteAmslM: 50 });
  assert.equal(far.withinConsultation, false);
  assert.equal(far.belowVisualHorizon, true);
  assert.match(far.note, /may be acceptable/);

  assert.equal(gen01Check({ distanceM: 30_000, tipHeightAmslM: 200, siteAmslM: 0, ilsApproach: true })
    .withinConsultation, true);
});

// -------------------------------------------------------- what is still open

test('the flow chart is still marked unread, because it is a picture', () => {
  assert.match(FLOWCHART_DISCREPANCY.status, /STILL UNRESOLVED/);
  assert.ok(PROVENANCE.unreadParts.some((p) => /flow chart/i.test(p)));
  assert.ok(PROVENANCE.unreadParts.some((p) => /Figure 3/.test(p)));
  // The conservative reading is the one implemented.
  assert.equal(operationalImpactOutcome(true).outcome, 'objection');
  assert.equal(operationalImpactOutcome(false).outcome, 'no objection');
});

test('SUR 13 is read and deliberately not turned into a pass or fail', () => {
  assert.equal(SUR13.read, true);
  assert.equal(SUR13.computableThresholds, false);
  assert.ok(sur.includes(squash(SUR13.lineOfSightDuty)));
  assert.ok(NOT_IMPLEMENTED.some((n) => /SUR 13/.test(n.item)));
});

test('every correction names what the module used to print and what the document says', () => {
  assert.ok(CORRECTIONS.length >= 4);
  for (const c of CORRECTIONS) {
    assert.ok(c.item && c.was && c.now && c.detail, `incomplete correction: ${JSON.stringify(c)}`);
    assert.notEqual(c.was, c.now);
    assert.ok(c.detail.length > 80, `${c.item}: the detail does not explain the change`);
  }
});

test('nothing still claims to be inferred that the document settles', () => {
  const src = readFileSync(resolve(root, 'js/cap670.js'), 'utf8');
  // The old module described Table 1 and Table 3 as not implemented.
  assert.equal(TABLE_1.implemented, true);
  assert.equal(TABLE_3.implemented, true);
  assert.ok(!/impliedWidthFromGreenM/.test(src), 'the subtense inference is still in the source');
  assert.ok(!/classifyByRotor/.test(src), 'the inferred rotor classifier is still in the source');
});

// ------------------------------------- what SUR 13 says about the mitigations

test('the SUR 13 conditions on mitigations are quoted verbatim from the document', () => {
  const m = SUR13_MITIGATION;
  for (const q of [m.sectorBlanking.quote, m.sectorBlanking.alsoRequires,
    m.amplitudeThreshold.quote, m.notEndorsed.quote, m.ssrProximityKm.quote]) {
    assert.ok(sur.includes(squash(q)), `not verbatim in SUR 13: "${q.slice(0, 70)}..."`);
  }
});

test('the only target size CAP 670 names is 1 square metre', () => {
  assert.equal(SUR13_MITIGATION.amplitudeThreshold.referenceTargetRcsM2, 1);
  assert.equal(SUR13_MITIGATION.amplitudeThreshold.referenceTargetRcsDbsm, 0);
  assert.ok(sur.includes('a 1m2 target likely to fly within the area of interest'));
});

test('the 10 km SSR figure is corroborated by a document that was actually read', () => {
  assert.equal(SUR13_MITIGATION.ssrProximityKm.value, 10);
  assert.match(SUR13_MITIGATION.ssrProximityKm.ref, /SUR 13A\.75/);
  assert.ok(sur.includes('i.e less than 10 km'));
});

test('figures CAP 670 cannot adjudicate are listed, with the reason', () => {
  assert.ok(OUT_OF_REACH.length >= 5);
  for (const f of OUT_OF_REACH) {
    assert.ok(f.figure && f.usedIn && f.why, `incomplete entry: ${JSON.stringify(f)}`);
    assert.ok(f.why.length > 60, `${f.figure}: the reason does not explain anything`);
  }
  // The 30 km guide is the clearest case: the string is not in the document.
  assert.ok(!doc.includes('30 km') && !sur.includes('30 km'),
    'CAP 670 does contain "30 km" after all, so that entry is wrong');
  assert.ok(OUT_OF_REACH.some((f) => /30 km/.test(f.figure)));
  // Nor does it mention curtailment anywhere.
  assert.ok(!/curtail/i.test(doc) && !/curtail/i.test(sur));
  assert.ok(OUT_OF_REACH.some((f) => /curtailment/i.test(f.figure)));
  // RAM is described but never quantified.
  assert.ok(sur.includes('radar absorbing materials (RAM)'));
  assert.ok(OUT_OF_REACH.some((f) => /absorbent/i.test(f.figure)));
});
