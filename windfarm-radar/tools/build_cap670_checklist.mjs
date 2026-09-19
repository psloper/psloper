// Build the CAP 670 verification record.
//
// This was a blank checklist while the document was unavailable: one row per
// figure, with somewhere to write the real value. The document has now been
// read, so it is a RECORD instead: every figure with its verdict, what the
// document says, and where to look if you want to check the check.
//
// Values are pulled from js/cap670.js rather than retyped, so the spreadsheet
// cannot drift away from what the tool actually uses.
//
// Run from the windfarm-radar directory: node tools/build_cap670_checklist.mjs

import { writeFileSync } from 'node:fs';
import { buildXlsx } from '../js/officewriter.js';
import {
  PROVENANCE, CORRECTIONS, TABLE_1, ZONES, CLASS_ORDER, ANGLE_BASIS, TABLE_3,
  TABLE_3_CONTRADICTION, SCOPE, CI_THRESHOLDS, METHOD_2_BASELINE, RCS_DBSM,
  RCS_SCALING, TABLE_4_5_INCONSISTENCY, GEN01, GEN02_VHF_UHF_FRAME, SUR13,
  FLOWCHART_DISCREPANCY,
} from '../js/cap670.js';

const CONFIRMED = 'Confirmed';
const CORRECTED = 'CORRECTED';
const OPEN = 'STILL OPEN';

const H = ['#', 'What was checked', 'Value in the tool', 'What CAP 670 says',
  'Verdict', 'Where to look', 'Notes'];

const rows = [H];
let n = 0;
const section = (t) => rows.push(['', t, '', '', '', '', '']);
const add = (what, inTool, saysDoc, verdict, where, notes = '') =>
  rows.push([++n, what, inTool, saysDoc, verdict, where, notes]);

section(`EDITION: ${PROVENANCE.edition}. Read from ${PROVENANCE.evidence}.`);

// ------------------------------------------------------------------ Table 1
section('A. TURBINE CLASSES (Table 1)');
for (const key of ['small', 'medium', 'large', 'large-industrial']) {
  const b = TABLE_1.bands[key];
  const fmt = (r) => `${r[0]} to ${r[1]} m`;
  add(`${b.label}: hub height band`, fmt(b.hubM), fmt(b.hubM), CONFIRMED, 'Appendix A, Table 1');
  add(`${b.label}: rotor diameter band`, fmt(b.rotorM), fmt(b.rotorM), CONFIRMED, 'Appendix A, Table 1');
  add(`${b.label}: tip height band`, fmt(b.tipM), fmt(b.tipM), CONFIRMED, 'Appendix A, Table 1');
}
add('Reference class', `hub ${TABLE_1.reference.hubM} m, rotor ${TABLE_1.reference.rotorM} m, `
  + `tip ${TABLE_1.reference.tipM} m`, 'the same', CONFIRMED, 'Appendix A, Table 1',
  TABLE_1.reference.note);
add('Was Table 1 implemented before the document was read?', 'no, a rotor-only band was inferred',
  'three dimensions, largest class wins', CORRECTED, 'Appendix A, Table 1 and its worked example',
  CORRECTIONS.find((c) => /Table 1/.test(c.item)).detail);

// ------------------------------------------------------------------ Table 2
section('B. ZONAL THRESHOLDS (Table 2)');
for (const key of [...CLASS_ORDER].reverse()) {
  const z = ZONES[key];
  add(`${z.label}: Red distance`, `${z.redKm} km`, `${z.redKm} km`, CONFIRMED, 'Appendix A, Table 2');
  if (z.greenKm === null) {
    add(`${z.label}: Green distance`, 'not published', 'the cell is EMPTY', CORRECTED,
      'Appendix A, Table 2',
      'The tool used to print a figure here that is not in CAP 670. A distance can now only be '
      + 'Red or Amber for this class, however far away the turbine is.');
  } else {
    add(`${z.label}: Green distance`, `${z.greenKm} km`, `${z.greenKm} km`, CONFIRMED,
      'Appendix A, Table 2', 'The only class for which a Green distance is published.');
  }
  add(`${z.label}: Red angle`, `${z.redDeg} deg`, `${z.redDeg} deg`, CONFIRMED, 'Appendix A, Table 2');
  add(`${z.label}: Green angle`, `${z.greenDeg} deg`, `${z.greenDeg} deg`, CONFIRMED, 'Appendix A, Table 2');
}

// ------------------------------------------------------------- what the angle is
section('C. WHAT THE ANGLE COLUMN MEANS  (this was the biggest unknown)');
add('What is the angle measured as?', ANGLE_BASIS.interpretation,
  `"${ANGLE_BASIS.quote}"`, CORRECTED, 'Appendix A, Method 1 - Zonal Assessment',
  CORRECTIONS.find((c) => /angle column/.test(c.item)).detail);
add('Is the distance a flat-earth separation?', 'yes', `"${ANGLE_BASIS.flatEarthQuote}"`,
  CONFIRMED, 'Appendix A, Method 1 - Zonal Assessment');

// ------------------------------------------------------------------ Table 3
section('D. COMBINING DISTANCE AND ANGLE (Table 3)');
for (const [k, cell] of Object.entries(TABLE_3.cells)) {
  const [d, a] = k.split('|');
  add(`Distance ${d.toUpperCase()}, angle ${a.toUpperCase()}`,
    cell.overall.toUpperCase(), `${cell.overall.toUpperCase()} - ${cell.rationale}`,
    CONFIRMED, 'Appendix A, Table 3');
}
add('Were these inferred before?', 'one cell known, eight inferred by taking the worse',
  'all nine published', CORRECTED, 'Appendix A, Table 3',
  CORRECTIONS.find((c) => c.item === 'Table 3').detail);
add('Does Table 3 contradict the Red zone definition?', 'yes, applied as printed with a warning',
  TABLE_3_CONTRADICTION.tableSays, OPEN, 'Appendix A, Table 3 and the RED zone definition',
  `The definition says: "${TABLE_3_CONTRADICTION.redDefinition}" Both are in the document. `
  + TABLE_3_CONTRADICTION.status);

// ------------------------------------------------------------------- routing
section('E. SCOPE AND ROUTING');
add('Method 1 turbine count limit', `${SCOPE.methodOneMaxTurbines}`, `"${SCOPE.methodOneQuote}"`,
  CONFIRMED, 'Appendix A, Method 1');
add('Tip height that forces the C/I method', `${SCOPE.ciTipHeightM} m AGL`, `"${SCOPE.ciQuote}"`,
  CONFIRMED, 'Appendix A, Out of Scope Proposals');
add('Not visible from the site', 'acceptable regardless of distance or size',
  `"${SCOPE.notVisibleQuote}"`, CONFIRMED, 'Appendix A, Out of Scope Proposals',
  'Implemented, and it was not implemented before.');
add('Single turbine with its hub below the site base level', 'red zone separation is enough',
  `"${SCOPE.hubBelowSiteQuote}"`, CONFIRMED, 'Appendix A, Out of Scope Proposals',
  'Implemented, and it was not implemented before.');
add('Last decision box of the process flow chart', FLOWCHART_DISCREPANCY.implemented,
  'NOT READ - the flow chart is an image', OPEN, 'Appendix A, process flow chart',
  FLOWCHART_DISCREPANCY.status);

// ------------------------------------------------------------------ Method 2
section('F. CARRIER TO INTERFERENCE (Method 2)');
add('Single turbine threshold', `${CI_THRESHOLDS.singleTurbineDb} dB`,
  '> 20dB C/I ratio in the volume of interest', CONFIRMED, 'Appendix A, Method 2, Coverage Plots');
add('Worst of several turbines', `${CI_THRESHOLDS.worstOfSeveralDb} dB`,
  '> 23dB C/I ratio in the volume of interest', CONFIRMED, 'Appendix A, Method 2, Coverage Plots');
add('All turbines combined', `${CI_THRESHOLDS.aggregateDb} dB`,
  '> 14dB C/I ratio in the volume of interest', CONFIRMED, 'Appendix A, Method 2, Coverage Plots');
add('VHF coverage plot field strength', `${CI_THRESHOLDS.fieldStrengthVhfDbuVm} dBuV/m`,
  'field strength limit of 26 dBuV/m', CONFIRMED, 'Appendix A, Method 2, Coverage Plots');
add('UHF coverage plot field strength', `${CI_THRESHOLDS.fieldStrengthUhfDbuVm} dBuV/m`,
  'field strength limit of 35 dBuV/m', CONFIRMED, 'Appendix A, Method 2, Coverage Plots');
add('Propagation model', CI_THRESHOLDS.propagationModel,
  'ITU-R 525/526/Delta Bullington and a k factor of 4/3', CONFIRMED, 'Appendix A, Method 2');
const st = METHOD_2_BASELINE.radioStation;
add('Radio station baseline', `antenna ${st.antennaHeightM} m, gain ${st.aerialGainDbi} dBi, `
  + `losses ${st.aerialSystemLossDb} dB, ${st.txPowerVhfW} W VHF / ${st.txPowerUhfW} W UHF, `
  + '127 and 368 MHz, omnidirectional', 'the same', CONFIRMED, 'Appendix A, Method 2, Radio Station',
  'Recorded so a C/I run done elsewhere can be checked against the stated assumptions.');
add('Must the C/I work be done by a consultancy?', 'stated on every C/I output',
  'undertaken by a suitably qualified consultancy practice or organisation', CONFIRMED,
  'Appendix A, Method 2', 'The tool computes no C/I ratio.');

// ------------------------------------------------------------- Tables 4 and 5
section('G. RADAR CROSS SECTION (Tables 4 and 5)');
for (const key of [...CLASS_ORDER].reverse()) {
  add(`${ZONES[key].label}: VHF monostatic / bistatic`,
    `${RCS_DBSM.vhf.monostatic[key]} / ${RCS_DBSM.vhf.bistatic[key]} dBsm`,
    'the same', CONFIRMED, 'Appendix A, Table 4');
  add(`${ZONES[key].label}: UHF monostatic / bistatic`,
    `${RCS_DBSM.uhf.monostatic[key]} / ${RCS_DBSM.uhf.bistatic[key]} dBsm`,
    'the same', CONFIRMED, 'Appendix A, Table 5');
}
add('Bistatic above monostatic', `${RCS_DBSM.bistaticOverMonostaticDb} dB, every class, both bands`,
  'Peak Bistatic RCS value is 10dB higher', CONFIRMED, 'Appendix A, below Table 5',
  'Checked arithmetically against all ten published pairs.');
add('RCS scaling formula', RCS_SCALING.formula, 'the same', CONFIRMED, 'Appendix A, below Table 5');
add('Does the formula reproduce the tables?',
  'yes for Small, Medium, Reference and Large Industrial',
  'they scale from the top of each Table 1 rotor band', CONFIRMED, 'Appendix A, Tables 1, 4 and 5',
  'Checked by running the formula and comparing to within 0.06 dB.');
add('Does the formula reproduce the LARGE class?', 'no',
  `published ${TABLE_4_5_INCONSISTENCY.publishedMonostaticVhfDbsm} dBsm implies a `
  + `${TABLE_4_5_INCONSISTENCY.impliedRotorM} m rotor, not the `
  + `${TABLE_4_5_INCONSISTENCY.table1RotorTopM} m band top`, OPEN,
  'Appendix A, Tables 1, 4 and 5',
  `Gap of ${TABLE_4_5_INCONSISTENCY.gapDb} dB, identical in both bands, so it is one wrong input `
  + `diameter rather than rounding. Direction is ${TABLE_4_5_INCONSISTENCY.direction}. `
  + TABLE_4_5_INCONSISTENCY.status);

// ------------------------------------------------------------------- GEN 01
section('H. GEN 01 AND GEN 02 FRAMES');
add('Consultation radius', `${GEN01.consultationRadiusKm} km`,
  'within a minimum radius of 20 km from their Aerodrome or Radio Site', CONFIRMED, 'GEN 01.4');
add('ILS approach radius', `${GEN01.ilsApproachRadiusKm} km`,
  'may extend to 34 km for ILS approaches', CONFIRMED, 'GEN 01.5');
add('Visual horizon observer height', `${GEN01.observerHeightM} m above the site`,
  `"${GEN01.quote}"`, CONFIRMED, 'Note to GEN 01.13',
  '"May be acceptable" is the source wording. It is not a pass, and the tool says so.');
add('VHF/UHF radio site example frame',
  `${GEN02_VHF_UHF_FRAME.groundCircleRadiusM} m circle, then a 1:50 slope from `
  + `${GEN02_VHF_UHF_FRAME.slopeFromElevationM} m out to ${GEN02_VHF_UHF_FRAME.slopeToRadiusM} m`,
  `"${GEN02_VHF_UHF_FRAME.quote}"`, CONFIRMED, 'GEN 02.25');

// ------------------------------------------------------------------- SUR 13
section('I. SUR 13, THE RADAR REQUIREMENT');
add('Does SUR 13 give radar thresholds a tool can check?', 'no, and nothing is gated on it',
  'duties on the service provider, no acceptance criteria', CONFIRMED, 'SUR 13 Part 2');
add('Line of sight analysis', 'the tool computes the geometry, not a verdict',
  `"${SUR13.lineOfSightDuty}"`, CONFIRMED, 'SUR 13.5',
  'SUR 13 sets no pass or fail criterion for the analysis.');

// -------------------------------------------------------------------- totals
const body = rows.slice(1).filter((r) => r[0] !== '');
const count = (v) => body.filter((r) => r[4] === v).length;
section(`TOTAL: ${body.length} checks. ${count(CONFIRMED)} confirmed, `
  + `${count(CORRECTED)} corrected, ${count(OPEN)} still open.`);

const xlsx = await buildXlsx([{ name: 'CAP 670 verification', rows }]);
writeFileSync('docs/CAP670-verification-checklist.xlsx', Buffer.from(xlsx));
console.log(`${body.length} checks: ${count(CONFIRMED)} confirmed, `
  + `${count(CORRECTED)} corrected, ${count(OPEN)} still open`);
