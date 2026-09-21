// CAP 670 Part B, Section 4, GEN 01 and GEN 02 Appendix A:
// the wind turbine check for ATC RADIO sites.
//
// ---------------------------------------------------------------------------
// PROVENANCE.
//
// THE DOCUMENT HAS NOW BEEN READ. A .docx copy of CAP 670, Third Issue,
// Amendment 1/2019, effective 1 August 2019, was supplied on 2026-09-19. The
// relevant sections are stored verbatim at
//   docs/evidence/cap670-partB-s4-gen01-gen02-2019.txt   (GEN 01, GEN 02, App A)
//   docs/evidence/cap670-partC-s3-sur13-2019.txt         (SUR 13, the radar one)
// and every figure below is checked against that text by test/cap670.test.mjs.
//
// This file previously carried figures transcribed from a third-party summary.
// Reading the document corrected four of them, listed in CORRECTIONS below.
//
// WHAT IS STILL NOT VERIFIED. Figure 3 (the RAG diagram) and the process flow
// chart at the end of Appendix A are IMAGES. Text extraction cannot read them,
// so the flowchart discrepancy recorded below is still open.
//
// WHAT THIS IS NOT. GEN 02 covers ATC RADIO sites: communications and
// navigation aids. It is NOT the radar case. The radar requirement is SUR 13,
// which has now been read and is summarised at the bottom of this file. SUR 13
// sets duties on an air navigation service provider; it contains no thresholds
// a tool can compute against, so nothing here gates on it.
// ---------------------------------------------------------------------------

export const PROVENANCE = {
  document: 'CAP 670, Part B, Section 4 (GEN 01, GEN 02 and Appendix A to GEN 02)',
  publisher: 'UK Civil Aviation Authority',
  edition: 'Third Issue, Amendment 1/2019, 1 June 2019, effective 1 August 2019',
  read: true,
  basis: 'read in full from a .docx copy supplied by the user on 2026-09-19',
  evidence: 'docs/evidence/cap670-partB-s4-gen01-gen02-2019.txt',
  covers: 'ATC radio sites (communications and navigation aids)',
  doesNotCover: 'radar detection performance; SUR 13 is the radar requirement and sets '
    + 'duties rather than computable thresholds',
  unreadParts: ['Figure 3, the RAG diagram', 'the Appendix A process flow chart'],
  unreadReason: 'both are images, and only the text layer was extracted',
  note: 'Appendix A paragraphs are unnumbered in the source, so references here are to '
    + 'its tables. GEN 01 and GEN 02 paragraphs are numbered and are cited as such.',
};

// What reading the document changed. Each entry is a figure this tool used to
// print that the source does not support.
export const CORRECTIONS = [
  {
    item: 'Green distance thresholds for Small, Medium, Large and Reference',
    was: '1.8, 3.5, 5.8 and 10.5 km',
    now: 'not published',
    detail: 'Table 2 gives a Green (km) figure for Large Industrial only, 17.2 km. The '
      + 'other four cells are EMPTY in the document, and not merged with anything. The four '
      + 'numbers this tool printed came from the third-party summary and are not in CAP 670. '
      + 'A distance can therefore only be Red or Amber for those four classes.',
  },
  {
    item: 'What the angle column measures',
    was: 'inferred to be the angular subtense of the turbine seen from the site',
    now: 'the elevation angle of the turbine HUB above the radio site BASE level',
    detail: 'Appendix A states the two zonal parameters plainly: "Minimum separation between '
      + 'turbine and infrastructure site assuming a flat earth" and "Angular displacement of '
      + 'turbine hub with respect to infrastructure site base level." A subtense grows as the '
      + 'turbine gets closer and is blind to height; an elevation angle is the opposite. This '
      + 'was the largest unknown in the module and it is now settled.',
  },
  {
    item: 'Table 3',
    was: 'one cell known, the other eight inferred by taking the worse of the two',
    now: 'all nine cells read from the document',
    detail: 'The inference was wrong in four of the eight: Red distance with an Amber angle '
      + 'is AMBER not Red, Amber distance with a Green angle is GREEN not Amber, Green '
      + 'distance with a Red angle is AMBER not Red, and Green distance with an Amber angle '
      + 'is GREEN not Amber. The tool was systematically harsher than the document.',
  },
  {
    item: 'Table 1',
    was: 'not implemented; a rotor-only band inferred from arithmetic',
    now: 'read, with hub height, rotor diameter and tip height bands for all five classes',
    detail: 'Classification uses all three dimensions and takes the largest class any one of '
      + 'them implies, which is what the worked example in the document does.',
  },
];

// ---------------------------------------------------------------------------
// Table 1: turbine classes.
//
// Quoted from the document:
//   Small             < 20 m hub    < 15 m rotor    < 27.5 m tip
//   Medium         20 - 40 m hub   15 - 35 m rotor  27.5 - 57.5 m tip
//   Large          40 - 60 m hub   35 - 60 m rotor  57.5 - 90 m tip
//   Reference           80 m hub       90 m rotor        125 m tip
//   Large Industrial 60 - 95 m hub  60 - 126 m rotor   90 - 158 m tip
//
// "Where a chosen turbine type is a borderline match for two classes and the
// appropriate classification may be ambiguous, then the larger turbine
// classification should be utilised for impact assessment."
//
// The worked example in the document: hub 20 m, rotor 18 m, tip 29 m is Medium,
// "due to the rotor diameter exceeding 15 metres". So each dimension is scored
// on its own and the largest class wins.
//
// Reference is a single machine, not a band, so it is not a bucket anything
// falls into by measurement. It sits between Large and Large Industrial in
// severity and is selected explicitly.
// ---------------------------------------------------------------------------

export const TABLE_1 = {
  implemented: true,
  rule: 'Each dimension is classified on its own and the LARGEST resulting class is used.',
  ref: 'CAP 670 GEN 02 Appendix A, Table 1',
  bands: {
    small: { label: 'Small', hubM: [0, 20], rotorM: [0, 15], tipM: [0, 27.5] },
    medium: { label: 'Medium', hubM: [20, 40], rotorM: [15, 35], tipM: [27.5, 57.5] },
    large: { label: 'Large', hubM: [40, 60], rotorM: [35, 60], tipM: [57.5, 90] },
    'large-industrial': { label: 'Large Industrial', hubM: [60, 95], rotorM: [60, 126], tipM: [90, 158] },
  },
  reference: { label: 'Reference', hubM: 80, rotorM: 90, tipM: 125,
    note: 'A single reference machine, not a band. Selected explicitly, never by measurement.' },
};

export const CLASS_ORDER = ['small', 'medium', 'large', 'reference', 'large-industrial'];

// The order a measured dimension can land in. Reference is skipped because it
// is one machine rather than a range.
const MEASURED_ORDER = ['small', 'medium', 'large', 'large-industrial'];

function classFromDimension(value, field) {
  if (!Number.isFinite(value) || value <= 0) return null;
  let key = MEASURED_ORDER[0];
  for (const k of MEASURED_ORDER) {
    const [, top] = TABLE_1.bands[k][field];
    key = k;
    if (value < top) break;
  }
  return key;
}

/**
 * Table 1 classification from the dimensions of a machine.
 *
 * Give whichever of hub height, rotor diameter and tip height you have, in
 * metres. Each is classified on its own; the largest class wins, which is the
 * document's own rule and what its worked example does.
 */
export function classifyTurbine({ hubHeightM, rotorDiameterM, tipHeightM } = {}) {
  const per = {
    hubHeightM: classFromDimension(hubHeightM, 'hubM'),
    rotorDiameterM: classFromDimension(rotorDiameterM, 'rotorM'),
    tipHeightM: classFromDimension(tipHeightM, 'tipM'),
  };
  const given = Object.entries(per).filter(([, v]) => v);
  if (!given.length) {
    throw new Error('classifyTurbine needs at least one of hubHeightM, rotorDiameterM, tipHeightM');
  }

  let key = MEASURED_ORDER[0];
  for (const [, k] of given) {
    if (MEASURED_ORDER.indexOf(k) > MEASURED_ORDER.indexOf(key)) key = k;
  }
  // Several dimensions can reach the winning class at once. All of them are
  // reported, rather than picking one and calling it the reason.
  const drivers = given.filter(([, k]) => k === key).map(([field]) => field);

  // Above the top of the Large Industrial bands the document simply stops. It
  // is said. Nothing is extrapolated.
  const top = TABLE_1.bands['large-industrial'];
  const beyondTable = (Number.isFinite(hubHeightM) && hubHeightM > top.hubM[1])
    || (Number.isFinite(rotorDiameterM) && rotorDiameterM > top.rotorM[1])
    || (Number.isFinite(tipHeightM) && tipHeightM > top.tipM[1]);

  return {
    key,
    label: TABLE_1.bands[key].label,
    perDimension: per,
    drivers,
    beyondTable,
    note: beyondTable
      ? 'At least one dimension is above the top of Table 1, which stops at 95 m hub, '
        + '126 m rotor and 158 m tip. Large Industrial is used because there is nothing '
        + 'larger in the table, NOT because the machine fits it.'
      : `Classified ${TABLE_1.bands[key].label} on ${drivers.join(' and ')}, the largest `
        + 'class any single dimension implies.',
    ref: TABLE_1.ref,
  };
}

// ---------------------------------------------------------------------------
// Table 2: RAG zonal thresholds.
//
// Verbatim from the document, including the four empty cells:
//
//                    Distance             Angle
//                    Red (km)  Green (km) Degrees Red  Degrees Green
//   Large Industrial   2.1       17.2        2.6°         0.4°
//   Reference          1.3       (empty)     3.5°         0.5°
//   Large              0.8       (empty)     3.6°         0.6°
//   Medium             0.5       (empty)     4.6°         0.7°
//   Small              0.25      (empty)     4.6°         0.7°
//
// greenKm is null where the document leaves the cell empty. It is not filled
// in, because there is nothing to fill it in from.
// ---------------------------------------------------------------------------

export const ZONES = {
  'large-industrial': { label: 'Large Industrial', redKm: 2.1, greenKm: 17.2, redDeg: 2.6, greenDeg: 0.4 },
  reference: { label: 'Reference', redKm: 1.3, greenKm: null, redDeg: 3.5, greenDeg: 0.5 },
  large: { label: 'Large', redKm: 0.8, greenKm: null, redDeg: 3.6, greenDeg: 0.6 },
  medium: { label: 'Medium', redKm: 0.5, greenKm: null, redDeg: 4.6, greenDeg: 0.7 },
  small: { label: 'Small', redKm: 0.25, greenKm: null, redDeg: 4.6, greenDeg: 0.7 },
};

// The two zonal parameters, quoted:
//   "Minimum separation between turbine and infrastructure site assuming a
//    flat earth"
//   "Angular displacement of turbine hub with respect to infrastructure site
//    base level"
export const ANGLE_BASIS = {
  interpretation: 'elevation angle of the turbine hub above the radio site base level',
  verified: true,
  quote: 'Angular displacement of turbine hub with respect to infrastructure site base level',
  flatEarth: true,
  flatEarthQuote: 'Minimum separation between turbine and infrastructure site assuming a flat earth',
  ref: 'CAP 670 GEN 02 Appendix A, Method 1 - Zonal Assessment',
};

/**
 * Elevation angle in degrees of a hub above the radio site base level, on a
 * flat earth, which is what Appendix A specifies.
 *
 * hubAmslM   height of the turbine hub above mean sea level
 * siteBaseAmslM  ground level at the radio site, NOT the aerial height
 * distanceM  horizontal separation
 */
export function hubElevationDeg(hubAmslM, siteBaseAmslM, distanceM) {
  if (!(distanceM > 0)) return 90;
  return Math.atan((hubAmslM - siteBaseAmslM) / distanceM) * 180 / Math.PI;
}

// ---------------------------------------------------------------------------
// Table 3: combining the distance verdict with the angle verdict.
//
// All nine rows, verbatim. Columns are DISTANCE, ANGLE, OVERALL, RATIONALE.
//
//   RED    RED    RED    Excessive impact
//   RED    AMBER  AMBER  Terrain sloping downwards
//   RED    GREEN  GREEN  Terrain sloping downwards
//   AMBER  RED    RED    Excessive impact
//   AMBER  AMBER  AMBER  Indeterminate impact
//   AMBER  GREEN  GREEN  Terrain sloping downwards
//   GREEN  RED    AMBER  Terrain sloping upwards
//   GREEN  AMBER  GREEN  Marginal impact
//   GREEN  GREEN  GREEN  Acceptable impact
//
// Read as a rule: the ANGLE decides, except that a Green distance softens a Red
// angle to Amber. Nothing here is inferred.
// ---------------------------------------------------------------------------

export const TABLE_3 = {
  implemented: true,
  ref: 'CAP 670 GEN 02 Appendix A, Table 3',
  cells: {
    'red|red': { overall: 'red', rationale: 'Excessive impact' },
    'red|amber': { overall: 'amber', rationale: 'Terrain sloping downwards' },
    'red|green': { overall: 'green', rationale: 'Terrain sloping downwards' },
    'amber|red': { overall: 'red', rationale: 'Excessive impact' },
    'amber|amber': { overall: 'amber', rationale: 'Indeterminate impact' },
    'amber|green': { overall: 'green', rationale: 'Terrain sloping downwards' },
    'green|red': { overall: 'amber', rationale: 'Terrain sloping upwards' },
    'green|amber': { overall: 'green', rationale: 'Marginal impact' },
    'green|green': { overall: 'green', rationale: 'Acceptable impact' },
  },
};

// A contradiction that is genuinely in the document, not an artefact of reading
// it. The Red zone is defined as "Violation of this parameter will result in
// automatic rejection of the development proposal", yet Table 3 turns a Red
// distance with a Green angle into an overall GREEN. Both are printed. The
// table is applied as printed and the contradiction is reported, because
// resolving it either way would be this tool deciding what the regulator meant.
export const TABLE_3_CONTRADICTION = {
  redDefinition: 'Violation of this parameter will result in automatic rejection of the '
    + 'development proposal.',
  tableSays: 'A Red distance with a Green angle gives an overall GREEN.',
  implemented: 'the table as printed, with a warning on any result that hits it',
  status: 'unresolved in the source; a question for the CAA, not for this tool',
};

/**
 * Zonal result for one turbine. Method 1.
 *
 * Give the class, the horizontal separation, and the hub elevation angle in
 * degrees. If you pass hubAmslM and siteBaseAmslM instead, the angle is worked
 * out for you on a flat earth, as Appendix A specifies.
 */
export function zonalCheck({ classKey, distanceM, angleDeg, hubAmslM, siteBaseAmslM }) {
  const z = ZONES[classKey];
  if (!z) throw new Error(`unknown turbine class: ${classKey}`);
  const km = distanceM / 1000;
  const warnings = [];

  let angle = angleDeg;
  if (!Number.isFinite(angle)) {
    if (!Number.isFinite(hubAmslM) || !Number.isFinite(siteBaseAmslM)) {
      throw new Error('zonalCheck needs angleDeg, or hubAmslM and siteBaseAmslM to derive it');
    }
    angle = hubElevationDeg(hubAmslM, siteBaseAmslM, distanceM);
  }

  // Distance. With no published green threshold, a distance cannot be green.
  let byDistance;
  if (km <= z.redKm) byDistance = 'red';
  else if (z.greenKm !== null && km >= z.greenKm) byDistance = 'green';
  else byDistance = 'amber';

  if (z.greenKm === null) {
    warnings.push(`Table 2 publishes no Green distance for the ${z.label} class, so this `
      + 'distance can only be Red or Amber however far away it is. That is what the document '
      + 'says, not a limitation of this tool.');
  }

  const byAngle = angle >= z.redDeg ? 'red' : angle <= z.greenDeg ? 'green' : 'amber';

  const cell = TABLE_3.cells[`${byDistance}|${byAngle}`];
  const zone = cell.overall;

  if (byDistance === 'red' && byAngle === 'green') {
    warnings.push('Table 3 makes this GREEN because the angle is green, while the Red zone '
      + 'definition says a Red distance is an automatic rejection. Both are printed in CAP 670. '
      + 'The table has been applied as printed.');
  }

  return {
    zone, byDistance, byAngle,
    rationale: cell.rationale,
    distanceKm: km, angleDeg: angle,
    thresholds: z,
    warnings,
    ref: 'CAP 670 GEN 02 Appendix A, Tables 2 and 3',
  };
}

// ---------------------------------------------------------------------------
// When Method 1 does not apply at all, and when a proposal is out of scope.
// ---------------------------------------------------------------------------

export const SCOPE = {
  methodOneMaxTurbines: 10,
  methodOneQuote: 'This method has been developed to enable rapid and non technical GO/NOGO '
    + 'assessments to be made for simple development proposals only - i.e. between 1 and 10 turbines.',
  ciTipHeightM: 110,
  ciQuote: 'Large developments i.e. turbine tip height greater than 110 metres AGL , and / or  '
    + 'more than 10 turbines will require detailed assessment using the C/I prediction method',
  notVisibleQuote: 'If no part of a turbine installation is visible to the radio site, then '
    + 'regardless of physical separation or size / quantity of turbine(s), that development '
    + 'proposal will be acceptable.',
  hubBelowSiteQuote: 'For single turbine developments, if the hub height falls below radio '
    + 'station base height (AMSL) then the red zone physical separation criteria can be used '
    + 'without any further analysis.',
  ref: 'CAP 670 GEN 02 Appendix A, Out of Scope Proposals',
};

/**
 * The two get-out clauses Appendix A gives before any zonal work is needed.
 */
export function outOfScopeCheck({ visibleFromSite, turbineCount, hubAmslM, siteBaseAmslM, distanceM, classKey }) {
  if (visibleFromSite === false) {
    return {
      acceptable: true,
      reason: 'No part of the installation is visible from the radio site.',
      quote: SCOPE.notVisibleQuote,
      ref: SCOPE.ref,
    };
  }
  const single = turbineCount === 1;
  const hubBelowSite = Number.isFinite(hubAmslM) && Number.isFinite(siteBaseAmslM)
    && hubAmslM < siteBaseAmslM;
  if (single && hubBelowSite) {
    const z = ZONES[classKey];
    const clears = z ? distanceM / 1000 > z.redKm : null;
    return {
      acceptable: clears === true,
      reason: clears === true
        ? 'Single turbine with its hub below the radio station base level, clear of the red '
          + 'zone separation, so no further analysis is required.'
        : 'Single turbine with its hub below the radio station base level, but it does not '
          + 'clear the red zone separation.',
      quote: SCOPE.hubBelowSiteQuote,
      ref: SCOPE.ref,
    };
  }
  return { acceptable: null, reason: 'No out-of-scope clause applies.', ref: SCOPE.ref };
}

/**
 * Does this go to the full carrier-to-interference method?
 */
export function routeToCI({ zone, tipHeightM, turbineCount }) {
  const reasons = [];
  if (tipHeightM > SCOPE.ciTipHeightM) {
    reasons.push(`tip height ${tipHeightM.toFixed(0)} m is above ${SCOPE.ciTipHeightM} m AGL`);
  }
  if (turbineCount > SCOPE.methodOneMaxTurbines) {
    reasons.push(`${turbineCount} turbines is more than ${SCOPE.methodOneMaxTurbines}`);
  }
  if (zone === 'amber') reasons.push('the zonal result is Amber');

  const required = reasons.length > 0;
  let outcome;
  if (required) outcome = 'carrier-to-interference assessment required';
  else if (zone === 'red') outcome = 'objection';
  else outcome = 'no objection';

  return { required, outcome, reasons, ref: SCOPE.ref };
}

// The last decision box of the Appendix A process flow chart is reported to
// read "Operational impact identified?" with YES giving no objection, which is
// inverted against the surrounding text. The chart is an IMAGE, so extracting
// the document's text did not settle it. This tool takes the text reading,
// because that is the conservative one.
export const FLOWCHART_DISCREPANCY = {
  printed: 'Operational impact identified? YES -> no objection',
  textSays: 'operational impact decides, so YES -> objection',
  implemented: 'the text reading, because it is the conservative one',
  status: 'STILL UNRESOLVED. The flow chart is an image and was not read even though the '
    + 'rest of the document was. Confirm with CAP670editor@caa.co.uk or read the chart.',
};

export function operationalImpactOutcome(impactIdentified) {
  return {
    outcome: impactIdentified ? 'objection' : 'no objection',
    warning: 'The flow chart is reported to read the other way round, and it is an image so '
      + 'reading the document did not settle it. ' + FLOWCHART_DISCREPANCY.status,
    ref: 'CAP 670 GEN 02 Appendix A process flow chart (disputed, not read)',
  };
}

// ---------------------------------------------------------------------------
// Method 2: carrier-to-interference prediction.
// ---------------------------------------------------------------------------

export const CI_THRESHOLDS = {
  singleTurbineDb: 20,
  worstOfSeveralDb: 23,
  aggregateDb: 14,
  fieldStrengthVhfDbuVm: 26,
  fieldStrengthUhfDbuVm: 35,
  altitudes: ['1000 ft AGL', '2000 ft AGL', '5000 ft ASL', '10000 ft ASL', '20000 ft ASL'],
  propagationModel: 'ITU-R 525/526/Delta Bullington, k factor 4/3',
  ref: 'CAP 670 GEN 02 Appendix A, Method 2',
  caution: 'The source states that C/I prediction "must be performed by following the defined '
    + 'methodology and undertaken by a suitably qualified consultancy practice or '
    + 'organisation". Any C/I number this tool prints is INDICATIVE ONLY and is not that work.',
};

// Baseline data Appendix A specifies for the prediction. Recorded so a C/I run
// done elsewhere can be checked against the assumptions the document sets.
export const METHOD_2_BASELINE = {
  radioStation: {
    coordinateAccuracyM: 10,
    antennaHeightM: 10,
    vhfHz: 127e6,
    uhfHz: 368e6,
    aerialPattern: 'omnidirectional',
    aerialGainDbi: 2.1,
    aerialSystemLossDb: 3,
    txPowerVhfW: 50,
    txPowerUhfW: 100,
  },
  turbine: {
    coordinateAccuracyM: 10,
    aerialHeight: 'hub height AGL',
    aerialGainDbi: 0,
    aerialSystemLossDb: 0,
    txPower: 'calculated per turbine from the RCS and the received field at the hub',
  },
  ref: 'CAP 670 GEN 02 Appendix A, Method 2, Radio Station and Turbine(s)',
};

// Tables 4 and 5: radar cross section per class, in dBsm.
// Bistatic is the forward scatter region, monostatic the general scatter
// region, and the document states the bistatic peak is 10 dB above monostatic.
export const RCS_DBSM = {
  vhf: {
    frequencyHz: 127e6,
    monostatic: { 'large-industrial': 41.0, reference: 38.1, large: 33.8, medium: 29.9, small: 22.5 },
    bistatic: { 'large-industrial': 51.0, reference: 48.1, large: 43.8, medium: 39.9, small: 32.5 },
    ref: 'CAP 670 GEN 02 Appendix A, Table 4',
  },
  uhf: {
    frequencyHz: 368e6,
    monostatic: { 'large-industrial': 45.6, reference: 42.7, large: 38.4, medium: 34.5, small: 27.1 },
    bistatic: { 'large-industrial': 55.6, reference: 52.7, large: 48.4, medium: 44.5, small: 37.1 },
    ref: 'CAP 670 GEN 02 Appendix A, Table 5',
  },
  bistaticOverMonostaticDb: 10,
};

export const RCS_SCALING = {
  formula: 'Monostatic RCS value = 10 Log (23281 * (Rotor Diameter / 90)2 * Frequency / 461)  in dBm2',
  referenceRcsM2: 23281,
  referenceRotorM: 90,
  referenceFrequencyMHz: 461,
  ref: 'CAP 670 GEN 02 Appendix A, below Table 5',
};

/** Monostatic RCS in dBsm from the document's own scaling formula. */
export function scaledMonostaticRcsDbsm(rotorDiameterM, frequencyMHz) {
  const r = RCS_SCALING;
  return 10 * Math.log10(r.referenceRcsM2
    * (rotorDiameterM / r.referenceRotorM) ** 2
    * frequencyMHz / r.referenceFrequencyMHz);
}

/** Rotor diameter implied by a published RCS figure, by inverting the formula. */
export function rotorFromRcsM(dbsm, frequencyMHz) {
  const r = RCS_SCALING;
  return r.referenceRotorM * Math.sqrt(
    10 ** (dbsm / 10) / (r.referenceRcsM2 * frequencyMHz / r.referenceFrequencyMHz));
}

// A real internal inconsistency in the document, found by running its own
// scaling formula back against its own tables.
//
// Four of the five classes scale exactly from the TOP of their Table 1 rotor
// band: Small from 15 m, Medium from 35 m, Large Industrial from 126 m, and
// Reference from its stated 90 m. The Large class does not. Its published
// figures correspond to a 55 m rotor, while Table 1 gives the Large band as
// 35 to 60 m. The gap is 0.75 dB in VHF and 0.77 dB in UHF, the same in both
// bands, so it is one wrong input diameter rather than rounding.
//
// Consequence: using the published Large RCS understates a 60 m Large-class
// machine by about three quarters of a decibel. That is small, and it is in the
// permissive direction, so it is recorded rather than corrected. Correcting it
// would mean this tool printing a number CAP 670 does not contain.
export const TABLE_4_5_INCONSISTENCY = {
  affects: 'the Large class only',
  publishedMonostaticVhfDbsm: 33.8,
  impliedRotorM: 55.0,
  table1RotorTopM: 60,
  scaledFromTopOfBandDbsm: 34.55,
  gapDb: 0.75,
  sameInBothBands: true,
  direction: 'permissive: the published value is the lower one',
  implemented: 'the published table values are used as printed; nothing is corrected',
  status: 'confirm with the CAA. This is arithmetic on the document, not a reading of it.',
};

/**
 * Compare computed carrier-to-interference ratios against the thresholds.
 * Nothing here computes a C/I ratio: this tool has no validated propagation
 * model for an ATC radio site, and the source says the work must be done by a
 * qualified consultancy.
 */
export function checkCarrierToInterference(ratiosDb, { aggregateDb } = {}) {
  if (!Array.isArray(ratiosDb) || !ratiosDb.length) return null;
  const worst = Math.min(...ratiosDb);
  const t = CI_THRESHOLDS;
  const single = ratiosDb.length === 1;
  const limit = single ? t.singleTurbineDb : t.worstOfSeveralDb;
  const checks = [
    { name: single ? 'Single turbine' : 'Worst of several', value: worst, limit,
      pass: worst > limit },
  ];
  if (Number.isFinite(aggregateDb)) {
    checks.push({ name: 'All turbines combined', value: aggregateDb, limit: t.aggregateDb,
      pass: aggregateDb > t.aggregateDb });
  }
  return { checks, pass: checks.every((c) => c.pass), ref: t.ref, caution: t.caution };
}

// ---------------------------------------------------------------------------
// GEN 01: consultation and the visual horizon.
// ---------------------------------------------------------------------------

export const GEN01 = {
  consultationRadiusKm: 20,
  ilsApproachRadiusKm: 34,
  observerHeightM: 25,
  ref: 'CAP 670 GEN 01.4, GEN 01.5 and the note to GEN 01.13',
  horizonRule: 'Blade tips below the visual horizon, seen from 25 m above the site, "may be '
    + 'acceptable to an ANSP". "May be" is the source wording: it is not a pass.',
  quote: 'A wind farm whose blade tips, at their maximum height, are below the visual horizon '
    + 'when viewed from a point situated 25 m above an aeronautical radio station site may be '
    + 'acceptable to an ANSP.',
};

// GEN 02 also gives an example safeguarding frame for the VHF and UHF radio
// sites this appendix is about. Recorded because it is the physical frame the
// zonal check sits alongside.
export const GEN02_VHF_UHF_FRAME = {
  groundCircleRadiusM: 91,
  slopeFromElevationM: 9,
  slopeGradient: 0.02,
  slopeToRadiusM: 610,
  ref: 'CAP 670 GEN 02.25',
  quote: 'Ground level safeguarding of circle radius 91 m centred on the base of the main '
    + 'aerial tower (or equivalent structure). Additionally, from an elevation of 9 m on this '
    + 'circle a 2% (1:50) slope out to a radius of 610 m.',
};

/**
 * Is the site inside the consultation radius, and does the visual horizon rule
 * apply? The horizon is the geometric one at 4/3 earth radius, which is the
 * convention the rest of this tool uses.
 */
export function gen01Check({ distanceM, tipHeightAmslM, siteAmslM, ilsApproach = false }) {
  const radiusKm = ilsApproach ? GEN01.ilsApproachRadiusKm : GEN01.consultationRadiusKm;
  const withinConsultation = distanceM / 1000 <= radiusKm;

  const ae = (4 / 3) * 6371008.8;
  const eye = siteAmslM + GEN01.observerHeightM;
  const dHorizon = Math.sqrt(2 * ae * Math.max(eye, 0.1));
  const beyond = distanceM - dHorizon;
  const hiddenBelowM = beyond > 0 ? siteAmslM + (beyond * beyond) / (2 * ae) : null;
  const belowHorizon = hiddenBelowM !== null && tipHeightAmslM < hiddenBelowM;

  return {
    withinConsultation, radiusKm, ilsApproach,
    horizonDistanceM: dHorizon,
    tipHiddenBelowAmslM: hiddenBelowM,
    belowVisualHorizon: belowHorizon,
    ref: GEN01.ref,
    note: belowHorizon ? GEN01.horizonRule : null,
  };
}

// ---------------------------------------------------------------------------
// SUR 13: the radar requirement. Read, and deliberately not implemented.
// ---------------------------------------------------------------------------

// SUR 13 is "Requirements for Implementation of Wind Turbine Interference
// Mitigation Techniques". It has now been read in full and is stored at
// docs/evidence/cap670-partC-s3-sur13-2019.txt.
//
// It sets duties on an air navigation service provider: notify the CAA
// inspector, carry out a line of sight analysis where there is reasonable
// doubt, justify the mitigation by local safety assessment, comply with the
// listed interoperability and ICAO provisions. It contains no radar
// performance thresholds, no RCS figures and no acceptance criteria that a
// tool can compute against. So nothing in this module gates on it, and the
// radar modelling elsewhere in this tool remains physics rather than a CAP 670
// compliance check.
export const SUR13 = {
  read: true,
  evidence: 'docs/evidence/cap670-partC-s3-sur13-2019.txt',
  title: 'Requirements for Implementation of Wind Turbine Interference Mitigation Techniques',
  computableThresholds: false,
  lineOfSightDuty: 'Where an ANSP has reasonable doubt that wind turbine interference is '
    + 'likely to affect their radars from existing or planned wind farm installations, a Line '
    + 'Of Sight Analysis shall be conducted.',
  lineOfSightRef: 'CAP 670 SUR 13.5',
  note: 'The line of sight analysis this tool performs is the kind SUR 13.5 requires, but '
    + 'SUR 13 sets no pass or fail criterion for it, so the tool reports geometry rather than '
    + 'compliance.',
};

// SUR 13 does place a small number of checkable conditions on the mitigations
// this tool offers. They are conditions, not thresholds, so they are recorded
// and surfaced rather than computed.
export const SUR13_MITIGATION = {
  sectorBlanking: {
    ref: 'CAP 670 SUR 13.40 and SUR 13.41',
    quote: 'PSR sector blanking for the purposes of mitigating wind turbine effects on a '
      + 'controller\u2019s display shall only be permitted where the ANSP provides a robust safety '
      + 'argument that total loss of all surveillance data on the blanked areas would cause no '
      + 'safety related impact.',
    alsoRequires: 'Where air traffic services are provided in the areas masked on the '
      + 'controller\u2019s display, the strategy for managing traffic shall be specified and justified.',
  },
  amplitudeThreshold: {
    ref: 'CAP 670 SUR 13.43 and SUR 13.44',
    referenceTargetRcsM2: 1,
    referenceTargetRcsDbsm: 0,
    quote: 'The threshold set shall take in to account the RCS of the largest wind turbine in '
      + 'the area affected, the largest fixed clutter (other than turbine), and a 1m2 target '
      + 'likely to fly within the area of interest.',
    note: 'The only numeric target size CAP 670 names anywhere in the wind turbine material. '
      + 'A 1 m2 target is 0 dBsm, which is a light single piston aircraft or a tactical UAS in '
      + 'this tool\u2019s target list.',
  },
  notEndorsed: {
    ref: 'CAP 670 SUR 13A.107',
    quote: 'ANSPs are also reminded that the mitigation mechanisms listed here are guidance '
      + 'only and must not be regarded as mitigations that are recommended or endorsed by the CAA.',
  },
  ssrProximityKm: {
    value: 10,
    ref: 'CAP 670 SUR 13A.75',
    quote: 'These effects are only a consideration when the turbines are located very close to '
      + 'the SSR, i.e less than 10 km.',
    note: 'Independently corroborates the 10 km figure this tool previously carried on a CAP 764 '
      + 'search summary alone. The two sources agree and CAP 670 has been read.',
  },
};

// ---------------------------------------------------------------------------
// SUR 02 and SUR 12: the target CAP 670 names for proving detection.
// ---------------------------------------------------------------------------
//
// The question this answers is whether there is a defined aircraft used for
// testing radar detection. There is not. CAP 670 specifies a RADAR CROSS
// SECTION, not an airframe: a target of 1 square metre. No type, no
// manufacturer, no dimensions, no Swerling fluctuation model. Anything with a
// 1 m2 RCS satisfies the clause, and in practice that is a light single or a
// small twin flown as a calibration sortie.
//
// Quoted verbatim from docs/evidence/cap670-partC-s3-sur02-sur12-2019.txt and
// checked against it by test/cap670.test.mjs, so a quote cannot drift from the
// document.
export const TEST_TARGET = {
  read: true,
  evidence: 'docs/evidence/cap670-partC-s3-sur02-sur12-2019.txt',
  rcsM2: 1,
  rcsDbsm: 0,
  ref: 'CAP 670 SUR 12.35',
  quote: 'Detection at the edge of coverage shall be confirmed with a target of 1 m2 RCS.',
  // The same size appears again in the wind turbine material, which is what
  // makes it the right target for a screening tool to default to.
  corroboration: {
    ref: 'CAP 670 SUR 13.44',
    quote: 'The threshold set shall take in to account the RCS of the largest wind turbine in '
      + 'the area affected, the largest fixed clutter (other than turbine), and a 1m2 target '
      + 'likely to fly within the area of interest.',
  },
  // What the document does NOT say. Listed so the absence is on the record
  // rather than filled in from somewhere else.
  notSpecified: [
    'No aircraft type, model or manufacturer.',
    'No airframe dimensions: span, length and shape are left open.',
    'No Swerling case or other fluctuation model for the 1 m2 target.',
    'No polarisation, aspect angle or frequency band at which the 1 m2 applies. '
      + 'RCS varies strongly with all three, so "1 m2" is a nominal figure.',
    'No separate figure for en-route as against terminal radars.',
  ],
};

// The altitudes CAP 670 recommends for the coverage test. A recommendation,
// not a requirement, and the document says so with the word "should".
export const TEST_ALTITUDES = {
  ref: 'CAP 670 SUR 12.37',
  status: 'Recommendation',
  quote: 'Recommendation: The test should include slices at 1,000, 2,000, 4,000, 6,000, '
    + '10,000, and 20,000 ft above the aerodrome reference point and as appropriate to the OR (811).',
  datum: 'above the aerodrome reference point',
  feet: [1000, 2000, 4000, 6000, 10000, 20000],
};

// What CAP 670 says about how good detection has to be. SUR02.37 puts the
// number on the operator, not on the document, so a tool cannot assert a
// required probability of detection for a site it knows nothing about.
export const PD_REQUIREMENT = {
  ref: 'CAP 670 SUR 02.37 and SUR 02.40',
  defined_by_operator: {
    ref: 'CAP 670 SUR 02.37',
    quote: 'Probability of detection shall be defined for the intended application. The '
      + 'probability of detection shall meet the operational requirement throughout the '
      + 'required coverage volume, i.e. up to the maximum range and at all operational altitudes.',
  },
  recommended: {
    ref: 'CAP 670 SUR 02.40',
    status: 'Recommendation',
    conventionalPd: 0.90,
    cooperativePd: 0.97,
    quote: 'Recommendation: Probability of detection should be at least 90% for conventional '
      + 'radars and exceed 97% for Monopulse and Mode S radars and other co-operative techniques.',
  },
  note: 'The 0.9 this tool uses by default matches the SUR 02.40 recommendation for a '
    + 'conventional radar. It is a recommendation in the document, and the operational '
    + 'requirement for a given site may be higher.',
};

// Checked and found absent, so that "ICAO must specify it" does not get
// assumed. CAP 670 cites ICAO Annex 10 Volume IV repeatedly, and every citation
// is about SSR, Mode S, extended squitter or multilateration. None of them
// carries a primary radar target size.
export const NO_ICAO_PSR_TARGET = {
  checked: 'Every "Annex 10" reference in the CAP 670 text supplied.',
  finding: 'CAP 670 cites ICAO Annex 10 Volume IV for SSR Mode A/C, Mode S, Mode S extended '
    + 'squitter and multilateration. It cites no ICAO provision for a primary radar test '
    + 'target size.',
  unverified: 'Whether ICAO Annex 10 Volume IV itself defines a primary radar reference target '
    + 'has NOT been checked against Annex 10. That document was not available here.',
};

// Figures the tool uses that CAP 670 CANNOT adjudicate, and why. Recorded so
// that reading the document is not mistaken for having verified everything.
export const OUT_OF_REACH = [
  {
    figure: 'The 30 km primary radar assessment guide',
    usedIn: 'the cap764-30km finding',
    why: 'The string "30 km" does not appear anywhere in CAP 670. The figure is CAP 764\u2019s '
      + 'and CAP 764 has still only been seen as a search summary.',
  },
  {
    figure: 'Radar absorbent material, 10 dB default reduction',
    usedIn: 'the ram mitigation',
    why: 'SUR 13A.105 describes RAM qualitatively, as ferrite paints or polymer layers '
      + 'incorporating crystalline graphite, and gives NO figure for the reduction achieved. '
      + 'The 10 dB default is this tool\u2019s, not the regulator\u2019s.',
  },
  {
    figure: 'Enhanced Doppler processing, 15 dB default extra rejection',
    usedIn: 'the enhancedDoppler mitigation',
    why: 'CAP 670 sets conditions on amplitude, CFAR and clutter map processing but publishes '
      + 'no rejection figure for any of them.',
  },
  {
    figure: 'Turbine curtailment',
    usedIn: 'the curtail mitigation',
    why: 'Curtailment is not mentioned in CAP 670 at all. It is in the tool as a theoretical '
      + 'best case, not as a recognised mitigation.',
  },
  {
    figure: 'Turbine RCS defaults at microwave frequencies',
    usedIn: 'TURBINE_PRESETS in js/model.js',
    why: 'CAP 670 Tables 4 and 5 are calculated at 127 MHz and 368 MHz. This tool models L, S, '
      + 'C and X band, between 1.25 and 9.4 GHz. The published scaling formula is linear in '
      + 'frequency and would extrapolate, but a factor of seven beyond the highest frequency the '
      + 'document states is outside what it supports, and turbine RCS does not scale that simply '
      + 'once the wavelength is short against the blade chord. Nothing is extrapolated.',
  },
];

// ---------------------------------------------------------------------------
// What this module still does NOT do.
// ---------------------------------------------------------------------------

export const NOT_IMPLEMENTED = [
  { item: 'The Appendix A process flow chart, and Figure 3',
    why: 'Both are images. The document text was extracted and read; the pictures were not. '
      + 'The flow chart discrepancy over the last decision box is therefore still open.' },
  { item: 'A Green distance verdict for Small, Medium, Large and Reference',
    why: 'Table 2 leaves those four cells empty. There is no threshold to apply.' },
  { item: 'Computing a carrier-to-interference ratio',
    why: 'This tool has no validated propagation model for an ATC radio site, and the source '
      + 'requires the work be done by a suitably qualified consultancy. Thresholds and the '
      + 'baseline assumptions are provided so a prediction from elsewhere can be checked.' },
  { item: 'SUR 13 as a compliance check',
    why: 'Read in full. It sets duties, not computable thresholds. See SUR13 above.' },
  { item: 'Whether a Supplementary Amendment has superseded this edition',
    why: 'The copy read is Third Issue, Amendment 1/2019, effective 1 August 2019. Whether '
      + 'anything later exists was not checked; the CAA is unreachable from this environment.' },
];
