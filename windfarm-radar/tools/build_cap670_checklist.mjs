// Build the CAP 670 verification checklist.
//
// Every figure in js/cap670.js came from a written summary, not from the
// document. This turns that into something checkable: one row per figure, with
// where to look for it, and a column to write the real value in.
//
// Run from the windfarm-radar directory: node tools/build_cap670_checklist.mjs

import { buildXlsx } from '../js/officewriter.js';
import { writeFileSync } from 'node:fs';

const H = ['#', 'What to check', 'Value in the tool', 'Where to look in CAP 670',
  'Confirmed? (Y/N)', 'Actual value if different', 'Notes'];

const zones = [
  ['Large Industrial', 2.1, 17.2, 2.6, 0.4],
  ['Reference', 1.3, 10.5, 3.5, 0.5],
  ['Large', 0.8, 5.8, 3.6, 0.6],
  ['Medium', 0.5, 3.5, 4.6, 0.7],
  ['Small', 0.25, 1.8, 4.6, 0.7],
];

const rows = [H];
let n = 0;
const add = (what, value, where, notes = '') => rows.push([++n, what, value, where, '', '', notes]);

rows.push(['', 'A. ZONAL THRESHOLDS  (Tables 2 and 3)', '', '', '', '', '']);
for (const [label, rk, gk, rd, gd] of zones) {
  add(`${label}: Red distance`, `${rk} km`, 'Appendix A to GEN 02, Table 2');
  add(`${label}: Green distance`, `${gk} km`, 'Appendix A to GEN 02, Table 2');
  add(`${label}: Red angle`, `${rd} deg`, 'Appendix A to GEN 02, Table 2 or 3');
  add(`${label}: Green angle`, `${gd} deg`, 'Appendix A to GEN 02, Table 2 or 3');
}

rows.push(['', 'B. WHAT THE ANGLE COLUMN ACTUALLY MEANS', '', '', '', '', '']);
add('Is the angle the angular SUBTENSE of the turbine seen from the site?',
  'assumed yes', 'Appendix A to GEN 02, text around Tables 2 and 3',
  'THIS IS AN INFERENCE. If it is an elevation angle, a bearing offset or a beamwidth '
  + 'fraction instead, every angle result in the tool is wrong. Highest-value single check.');
add('If it is a subtense, is it measured across the rotor or the whole structure?',
  'rotor diameter', 'same',
  'The tool uses rotor diameter. Tower width or swept height would change the answer.');

rows.push(['', 'C. TABLE 1, CLASSIFICATION  (NOT IMPLEMENTED)', '', '', '', '', '']);
add('Hub height band for each of the 5 classes', 'NOT IMPLEMENTED', 'Appendix A to GEN 02, Table 1',
  'Never supplied. The tool infers class from rotor diameter instead and says so.');
add('Rotor diameter band for each class', 'NOT IMPLEMENTED', 'Appendix A to GEN 02, Table 1',
  'Inferred bands currently used: 120, 92, 61, 43 m and below. Replace with the real ones.');
add('Tip height band for each class', 'NOT IMPLEMENTED', 'Appendix A to GEN 02, Table 1', '');
add('Is it hub OR rotor OR tip, or all three together?', 'unknown', 'Appendix A to GEN 02, Table 1',
  'Changes how a machine that straddles bands is classified.');
add('"Borderline takes the larger class" - is that the actual wording?', 'assumed yes',
  'Appendix A to GEN 02, text near Table 1', 'The tool applies it within 10% of a boundary.');

rows.push(['', 'D. TABLE 3, HOW DISTANCE AND ANGLE COMBINE  (ONLY 1 OF 9 CELLS KNOWN)', '', '', '', '', '']);
const cells = [['Red', 'Red'], ['Red', 'Amber'], ['Red', 'Green'], ['Amber', 'Red'],
  ['Amber', 'Amber'], ['Amber', 'Green'], ['Green', 'Red'], ['Green', 'Amber'], ['Green', 'Green']];
for (const [d, a] of cells) {
  const known = d === 'Red' && a === 'Green';
  const same = d === a;
  add(`Distance ${d} + Angle ${a} = ?`,
    known ? 'Green (SUPPLIED)' : same ? `${d} (assumed)` : 'more favourable of the two (ASSUMED)',
    'Appendix A to GEN 02, Table 3',
    known ? 'The one cell that was supplied.'
      : same ? 'Assumed: agreement decides.' : 'ASSUMED, not supplied. Please fill in.');
}
add('Does a Red distance really override to an objection regardless of angle?',
  'no, per Table 3 as supplied', 'Appendix A to GEN 02, Red definition vs Table 3',
  'CONTRADICTION. The Red definition says automatic objection; Table 3 as supplied says Green. '
  + 'The tool follows Table 3 and raises a warning.');

rows.push(['', 'E. ROUTING TO THE C/I METHOD  (flowchart)', '', '', '', '', '']);
add('Tip height trigger', 'over 110 m', 'Appendix A to GEN 02, flowchart',
  'Tool treats exactly 110 m as NOT triggering. Check whether it should be "110 or more".');
add('Turbine count trigger', 'more than 10', 'Appendix A to GEN 02, flowchart',
  'Tool treats exactly 10 as NOT triggering. Same question.');
add('Amber zone triggers C/I', 'yes', 'Appendix A to GEN 02, flowchart');
add('Red = objection, Green = no objection', 'yes', 'Appendix A to GEN 02, flowchart');
add('Last box: "Operational impact identified?" YES leads to...',
  'objection (tool takes the text reading)', 'Appendix A to GEN 02, flowchart, final decision',
  'REPORTED AS INVERTED in the printed flowchart. The tool takes the conservative reading. '
  + 'Worth a query to CAP670editor@caa.co.uk either way.');

rows.push(['', 'F. METHOD 2 THRESHOLDS', '', '', '', '', '']);
add('Single turbine C/I', 'above 20 dB', 'Appendix A to GEN 02, Method 2');
add('Worst of several C/I', 'above 23 dB', 'Appendix A to GEN 02, Method 2');
add('All turbines combined C/I', 'above 14 dB', 'Appendix A to GEN 02, Method 2');
add('VHF field strength limit', '26 dBuV/m', 'Appendix A to GEN 02, Method 2');
add('UHF field strength limit', '35 dBuV/m', 'Appendix A to GEN 02, Method 2');
add('Is "above" strict, or "at or above"?', 'strict (tool uses >)', 'Appendix A to GEN 02, Method 2',
  'Matters only on an exact boundary, but it is a one-word check.');

rows.push(['', 'G. GEN 01', '', '', '', '', '']);
add('Consultation radius', '20 km', 'GEN 01.4 / .5');
add('ILS approach radius', '34 km', 'GEN 01.4 / .5');
add('Observer height for the visual horizon', '25 m above the site', 'GEN 01.13');
add('Is the horizon rule "may be acceptable" or stronger?', '"may be acceptable"', 'GEN 01.13',
  'The tool keeps the weak wording deliberately. Check it is not in fact a pass.');

rows.push(['', 'H. THINGS THAT WOULD INVALIDATE ALL OF THE ABOVE', '', '', '', '', '']);
add('Edition and amendment state of your PDF', 'unknown', 'Cover page and amendment record',
  'Record the edition and date here. Nothing above was checked against any edition.');
add('Has a Supplementary Amendment changed GEN 02?', 'not checked', 'CAA amendment list', '');
add('Does SUR 13 (radar) say something different?', 'not read', 'Part B Section 4, SUR 13',
  'SUR 13 is the RADAR requirement. The rest of this tool models radar. Neither of us has read it. '
  + 'This is arguably more important than everything above.');

const notes = [
  ['How to use this sheet'],
  [''],
  ['Open CAP 670 beside it and work down column D. Put Y or N in column E.'],
  ['Where the value differs, write the real one in column F and send me the sheet back.'],
  [''],
  ['Status of the data currently in the tool'],
  [''],
  ['The document was NEVER READ. Every figure came from a written summary.'],
  ['caa.co.uk is blocked from the environment the tool was built in, so the'],
  ['transcription could not be checked against the source. That is why this'],
  ['sheet exists.'],
  [''],
  ['What the tool COULD check, and did'],
  [''],
  ['Reading the angle as an angular subtense, distance and angle together imply'],
  ['a width. The GREEN pairs imply 120, 92, 61, 43 and 22 m, which are'],
  ['recognisable rotor diameters. The RED pairs imply 95, 79, 50, 40 and 20 m,'],
  ['which is 79 to 94 per cent of those. So the subtense reading is supported'],
  ['but not exact, and the two columns do not agree with each other.'],
  [''],
  ['On the Large class specifically: the green pair implies 61 m, supporting'],
  ['60 m. The red pair implies 50 m. That is consistent with something being'],
  ['wrong in that row, but does not settle it at 55 m.'],
  [''],
  ['All four threshold columns order correctly with class size, which is a'],
  ['weak but real check that the transcription is not scrambled.'],
  [''],
  ['Priority if you only have ten minutes'],
  [''],
  ['1. Section B: what the angle column actually means. If that is wrong,'],
  ['   every angle result in the tool is wrong.'],
  ['2. Section C: Table 1. It is not implemented at all.'],
  ['3. Section D: the eight unknown cells of Table 3.'],
  ['4. Section H: SUR 13, because that is the radar one.'],
];

writeFileSync('docs/CAP670-verification-checklist.xlsx',
  await buildXlsx([{ name: 'Checklist', rows }, { name: 'How to use', rows: notes }]));
console.log(`checklist: ${rows.length} rows, ${n} numbered checks`);
