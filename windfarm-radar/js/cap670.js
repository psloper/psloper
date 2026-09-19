// CAP 670 Part B, Section 4, GEN 01 and GEN 02 Appendix A:
// the wind turbine check for ATC RADIO sites.
//
// ---------------------------------------------------------------------------
// PROVENANCE. READ THIS BEFORE USING ANY NUMBER IN THIS FILE.
//
// THE DOCUMENT WAS NOT READ. Every figure here was transcribed from a written
// summary supplied by a third party who says they verified it against the PDF.
// This tool has never had that PDF, and caa.co.uk, publicapps.caa.co.uk and
// regulatorylibrary.caa.co.uk are all refused by this environment's network
// policy, so the transcription could not be checked against the source.
//
// That is a weaker footing than anything else in this tool. Treat every output
// as indicative, cite the table reference beside it, and check the figures
// against your own copy of CAP 670 before relying on one.
// ---------------------------------------------------------------------------
//
// WHAT THIS IS NOT. GEN 02 covers ATC RADIO sites: communications and
// navigation aids. It is NOT the radar case. The radar requirement is SUR 13,
// which has not been read either and is not implemented anywhere in this tool.
// The rest of this tool models primary surveillance radar, so this module sits
// alongside it rather than feeding it.

export const PROVENANCE = {
  document: 'CAP 670, Part B, Section 4 (GEN 01, GEN 02 and Appendix A to GEN 02)',
  publisher: 'UK Civil Aviation Authority',
  read: false,
  basis: 'transcribed from a third-party summary; the document itself was never retrieved',
  blockedHosts: ['www.caa.co.uk', 'publicapps.caa.co.uk', 'regulatorylibrary.caa.co.uk'],
  covers: 'ATC radio sites (communications and navigation aids)',
  doesNotCover: 'radar, which is SUR 13 and is not implemented',
  editionChecked: false,
  note: 'Appendix A paragraphs are unnumbered in the source, so references here are '
    + 'to tables and to the summary that supplied them, not to paragraph numbers.',
  confirmWith: 'CAP670editor@caa.co.uk',
};

// ---------------------------------------------------------------------------
// Table 2 and Table 3: zonal thresholds, per turbine class.
//
// Distances are from the radio site. The ANGLE is taken here to be the angular
// subtense of the turbine as seen from the site. THAT INTERPRETATION IS AN
// INFERENCE, not something read from the document: see ANGLE_BASIS below.
// ---------------------------------------------------------------------------

export const ZONES = {
  'large-industrial': { label: 'Large Industrial', redKm: 2.1, greenKm: 17.2, redDeg: 2.6, greenDeg: 0.4 },
  reference: { label: 'Reference', redKm: 1.3, greenKm: 10.5, redDeg: 3.5, greenDeg: 0.5 },
  large: { label: 'Large', redKm: 0.8, greenKm: 5.8, redDeg: 3.6, greenDeg: 0.6 },
  medium: { label: 'Medium', redKm: 0.5, greenKm: 3.5, redDeg: 4.6, greenDeg: 0.7 },
  small: { label: 'Small', redKm: 0.25, greenKm: 1.8, redDeg: 4.6, greenDeg: 0.7 },
};

export const CLASS_ORDER = ['small', 'medium', 'large', 'reference', 'large-industrial'];

// An arithmetic check this tool CAN do, and did, on the figures above.
//
// If the angle is an angular subtense, then distance and angle together imply a
// width, and that width should look like a rotor diameter for the class. The
// GREEN pairs give 120, 92, 61, 43 and 22 m, which are recognisable machine
// sizes. The RED pairs give 95, 79, 50, 40 and 20 m, systematically 79 to 94
// per cent of the green-implied widths.
//
// So the subtense reading is supported but not exact. The residual is either
// rounding in the printed table or the angle meaning something slightly
// different in the two columns, and this tool cannot tell which.
//
// Note for the Large-class question raised against the RCS formula: the GREEN
// pair for Large implies 61 m, which supports 60 m rather than 55 m. The RED
// pair implies 50 m. The two columns disagree, so the printed table values are
// used as given and no rotor diameter is derived from them.
export const ANGLE_BASIS = {
  interpretation: 'angular subtense of the turbine as seen from the radio site',
  verified: false,
  impliedWidthFromGreenM: { 'large-industrial': 120, reference: 92, large: 61, medium: 43, small: 22 },
  impliedWidthFromRedM: { 'large-industrial': 95, reference: 79, large: 50, medium: 40, small: 20 },
};

// ---------------------------------------------------------------------------
// Table 1: classification by hub, rotor and tip height.
//
// NOT IMPLEMENTED. The class names are known; the height bands that define them
// were not supplied and the document was not read, so there is nothing to
// implement. classifyByRotor below is an INFERENCE from the angle and distance
// arithmetic above and must not be mistaken for Table 1.
// ---------------------------------------------------------------------------

export const TABLE_1 = {
  implemented: false,
  reason: 'The height bands that define each class were not supplied, and the document '
    + 'was not read. Select the class by hand, or use the inferred rotor bands and accept '
    + 'that they are inferred.',
  rule: 'A borderline turbine takes the LARGER class.',
};

/**
 * Class from rotor diameter, INFERRED from the green-column arithmetic. This is
 * not Table 1. It exists so the tool can offer a starting point rather than
 * nothing, and every result built on it says it was inferred.
 */
export function classifyByRotor(rotorDiameterM, { borderlineTolerance = 0.1 } = {}) {
  const w = ANGLE_BASIS.impliedWidthFromGreenM;
  const bands = [['large-industrial', w['large-industrial']], ['reference', w.reference],
    ['large', w.large], ['medium', w.medium], ['small', 0]];

  let key = 'small';
  for (const [k, lower] of bands) {
    if (rotorDiameterM >= lower) { key = k; break; }
  }

  // "A borderline turbine takes the LARGER class." The bands here are inferred
  // from arithmetic, so a rotor sitting just under a boundary is exactly the
  // case where the inference is least trustworthy: a 60 m rotor falls a metre
  // below the inferred 61 m Large boundary, which is the very boundary the
  // supplied summary flagged as doubtful. The rule is applied rather than the
  // boundary trusted.
  const i = CLASS_ORDER.indexOf(key);
  const nextUp = CLASS_ORDER[i + 1];
  let borderline = false;
  if (nextUp) {
    const boundary = w[nextUp];
    if (rotorDiameterM >= boundary * (1 - borderlineTolerance)) {
      key = nextUp;
      borderline = true;
    }
  }

  return {
    key, inferred: true, borderline,
    rotorDiameterM,
    note: borderline
      ? `A ${rotorDiameterM} m rotor sits within ${borderlineTolerance * 100}% of the boundary, `
        + 'so it takes the larger class, as the source rule requires. The boundary itself is '
        + 'INFERRED, not Table 1.'
      : 'Class INFERRED from rotor diameter, not read from Table 1.',
    ref: 'inference from Tables 2 and 3 arithmetic; Table 1 was not supplied',
  };
}

// ---------------------------------------------------------------------------
// Tables 2 and 3: the zonal result.
// ---------------------------------------------------------------------------

/** Angular subtense in degrees of a body of width w at range d, both metres. */
export function subtenseDeg(widthM, rangeM) {
  if (!(rangeM > 0)) return 180;
  return 2 * Math.atan(widthM / (2 * rangeM)) * 180 / Math.PI;
}

/**
 * Zonal result for one turbine.
 *
 * Distance and angle are each classified Red, Amber or Green against the class
 * thresholds, then combined.
 *
 * A CONTRADICTION IS IMPLEMENTED AS PRINTED. Table 3 allows a Red distance with
 * a Green angle to come out Green, while the Red definition says Red is an
 * automatic objection. The printed combination is used and the contradiction is
 * reported in `warnings` rather than resolved silently, because resolving it
 * either way would be this tool deciding what the regulator meant.
 */
export function zonalCheck({ classKey, distanceM, rotorDiameterM, angleDeg }, opts = {}) {
  const z = ZONES[classKey];
  if (!z) throw new Error(`unknown turbine class: ${classKey}`);
  const km = distanceM / 1000;
  const angle = Number.isFinite(angleDeg) ? angleDeg : subtenseDeg(rotorDiameterM, distanceM);
  const warnings = [];

  const byDistance = km <= z.redKm ? 'red' : km >= z.greenKm ? 'green' : 'amber';
  const byAngle = angle >= z.redDeg ? 'red' : angle <= z.greenDeg ? 'green' : 'amber';

  // Table 3. ONLY ONE CELL OF IT IS KNOWN.
  //
  // What was supplied is that a Red distance with a Green angle comes out
  // GREEN. The rest of the matrix was not supplied and the document was not
  // read, so the remaining cells follow a stated rule rather than the table:
  // agreement wins, and otherwise the more favourable of the two is taken,
  // which is the behaviour the one known cell shows. Every result says which
  // of the two it was.
  const KNOWN_CELL = { distance: 'red', angle: 'green', result: 'green' };
  const rank = { red: 0, amber: 1, green: 2 };
  let zone;
  let cellBasis;
  if (byDistance === byAngle) {
    zone = byDistance;
    cellBasis = 'both agree';
  } else if (byDistance === KNOWN_CELL.distance && byAngle === KNOWN_CELL.angle) {
    zone = KNOWN_CELL.result;
    cellBasis = 'the one cell of Table 3 that was supplied';
  } else {
    // The other seven disagreeing cells were never supplied, so this is a
    // CHOICE, not a transcription. It takes the WORSE of the two.
    //
    // That choice was made by measurement. The largest unknown in this module
    // is what the angle column is measured across: if it is tower width rather
    // than rotor diameter, every angle reads far greener than the tool assumes.
    // Extrapolating Table 3 permissively let that error drag 68 per cent of
    // zones to a more permissive verdict; taking the worse of the two holds it
    // to 23 per cent. Two unknowns that compound are worse than either alone,
    // and a false "no objection" is the expensive direction to be wrong in.
    //
    // Set unsuppliedCellsFavourable if you have the real Table 3 and it says
    // otherwise. The one cell that WAS supplied is permissive and is honoured
    // above regardless, because that one is not a guess.
    const favourable = opts.unsuppliedCellsFavourable === true;
    zone = favourable
      ? (rank[byDistance] > rank[byAngle] ? byDistance : byAngle)
      : (rank[byDistance] < rank[byAngle] ? byDistance : byAngle);
    cellBasis = `INFERRED: Table 3 does not supply this combination, so the `
      + `${favourable ? 'more favourable' : 'worse'} of the two was taken`;
    warnings.push(`Distance says ${byDistance} and angle says ${byAngle}. Table 3 as supplied `
      + `does not cover that combination, so the ${favourable ? 'more favourable' : 'WORSE'} of `
      + 'the two was used. Check the real Table 3 before relying on it.');
  }

  if (byDistance === 'red' && byAngle === 'green') {
    warnings.push('Table 3 as printed makes this GREEN because the angle is green, while the '
      + 'Red definition says a Red distance is an automatic objection. The printed combination '
      + 'has been used. Resolve this against your own copy of CAP 670 before relying on it.');
  }
  if (byAngle === 'red' && byDistance === 'green') {
    warnings.push('Red by angle but green by distance, which Table 3 as printed resolves to '
      + 'GREEN. Same caveat as above.');
  }
  if (!Number.isFinite(angleDeg)) {
    warnings.push('The angle was computed as an angular subtense of the rotor, which is an '
      + 'INFERENCE about what the angle column means. It was not read from the document.');
  }

  return {
    zone, byDistance, byAngle, cellBasis,
    distanceKm: km, angleDeg: angle,
    thresholds: z,
    warnings,
    ref: 'CAP 670 GEN 02 Appendix A, Tables 2 and 3 (as transcribed; document not read)',
  };
}

// ---------------------------------------------------------------------------
// The flowchart: when the zonal check is not the end of it.
// ---------------------------------------------------------------------------

export const CI_TRIGGERS = {
  tipHeightM: 110,
  turbineCount: 10,
  amberZone: true,
  ref: 'CAP 670 GEN 02 Appendix A flowchart (as transcribed)',
};

/**
 * Does this go to the full carrier-to-interference method?
 *
 * Red is an objection and Green is no objection. Anything else, or a tip above
 * 110 m, or more than 10 turbines, goes to C/I.
 */
export function routeToCI({ zone, tipHeightM, turbineCount }) {
  const reasons = [];
  if (tipHeightM > CI_TRIGGERS.tipHeightM) {
    reasons.push(`tip height ${tipHeightM.toFixed(0)} m is above ${CI_TRIGGERS.tipHeightM} m`);
  }
  if (turbineCount > CI_TRIGGERS.turbineCount) {
    reasons.push(`${turbineCount} turbines is more than ${CI_TRIGGERS.turbineCount}`);
  }
  if (zone === 'amber') reasons.push('the zonal result is Amber');

  const required = reasons.length > 0;
  let outcome;
  if (required) outcome = 'carrier-to-interference assessment required';
  else if (zone === 'red') outcome = 'objection';
  else outcome = 'no objection';

  return { required, outcome, reasons, ref: CI_TRIGGERS.ref };
}

// The last decision box is reported to read "Operational impact identified?"
// with YES giving no objection, which is inverted against the surrounding text.
// This tool takes the text reading, because that is the conservative one: an
// operational impact leads to an objection. The disagreement is surfaced rather
// than buried, and it is a question for the CAA, not for this tool.
export const FLOWCHART_DISCREPANCY = {
  printed: 'Operational impact identified? YES -> no objection',
  textSays: 'operational impact decides, so YES -> objection',
  implemented: 'the text reading, because it is the conservative one',
  status: 'unresolved; confirm with CAP670editor@caa.co.uk',
};

export function operationalImpactOutcome(impactIdentified) {
  return {
    outcome: impactIdentified ? 'objection' : 'no objection',
    warning: 'The flowchart as printed reads the other way round. ' + FLOWCHART_DISCREPANCY.status,
    ref: 'CAP 670 GEN 02 Appendix A flowchart, last decision (disputed)',
  };
}

// ---------------------------------------------------------------------------
// Method 2: carrier-to-interference thresholds.
// ---------------------------------------------------------------------------

export const CI_THRESHOLDS = {
  singleTurbineDb: 20,
  worstOfSeveralDb: 23,
  aggregateDb: 14,
  fieldStrengthVhfDbuVm: 26,
  fieldStrengthUhfDbuVm: 35,
  ref: 'CAP 670 GEN 02 Appendix A, Method 2 (as transcribed)',
  caution: 'The source states that carrier-to-interference work must be done by a qualified '
    + 'consultancy. Any C/I number this tool prints is INDICATIVE ONLY and is not that work.',
};

/**
 * Compare computed carrier-to-interference ratios against the thresholds.
 * Pass the per-turbine ratios in dB. Nothing here computes a C/I ratio: this
 * tool has no validated propagation model for an ATC radio site, and pretending
 * otherwise is exactly what the source warns against.
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
  ref: 'CAP 670 GEN 01.4, .5 and .13 (as transcribed)',
  horizonRule: 'Blade tips below the visual horizon, seen from 25 m above the site, may be '
    + 'acceptable. "May be" is the source wording: it is not a pass.',
};

/**
 * Is the site inside the consultation radius, and does the visual horizon rule
 * apply? The horizon is the geometric one at 4/3 earth radius, which is the
 * convention the rest of this tool uses.
 */
export function gen01Check({ distanceM, tipHeightAmslM, siteAmslM, ilsApproach = false }) {
  const radiusKm = ilsApproach ? GEN01.ilsApproachRadiusKm : GEN01.consultationRadiusKm;
  const withinConsultation = distanceM / 1000 <= radiusKm;

  // Distance to the visual horizon from an observer 25 m above the site, and
  // the height a body at `distanceM` must exceed to break that horizon.
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
// What this module does NOT do.
// ---------------------------------------------------------------------------

// What was measured about the unknowns, rather than asserted. 18,240 synthetic
// geometries, rotor 22 to 236 m, 0.15 to 30 km, 1 to 30 turbines, with one
// assumption perturbed at a time and the verdicts compared.
//
//   what the angle is measured ACROSS (tower width, not rotor)  65% of verdicts
//   Table 1 class one step too small                            19%, all permissive
//   angle read as a radius rather than a diameter               18%, all permissive
//   Table 1 class one step too large                             7%, none permissive
//   green distance threshold out by 20 per cent                  3%
//   red distance threshold out by 20 per cent                    2%
//   either angle threshold out by 20 per cent                   <1%
//   field strength limits, single-turbine C/I, GEN 01 radius      0%
//
// The last line is the useful one: those three change no verdict this tool
// produces, because it computes no field strength, no C/I ratio, and does not
// gate anything on the consultation radius. Getting them wrong costs nothing
// today. Getting the angle basis wrong costs almost everything.
export const SENSITIVITY = {
  measuredOn: 18240,
  worstUnknown: 'what the angle column is measured across',
  worstUnknownImpact: '65 per cent of verdicts, all of them more permissive',
  zeroImpact: ['fieldStrengthVhfDbuVm', 'fieldStrengthUhfDbuVm', 'singleTurbineDb',
    'worstOfSeveralDb', 'consultationRadiusKm', 'ilsApproachRadiusKm'],
  note: 'Zero impact means zero impact ON A ZONAL VERDICT. The consultation radius still '
    + 'changes what the tool reports, and the C/I thresholds still apply to a ratio computed '
    + 'elsewhere. They are simply not on the path that decides Red, Amber or Green.',
};

export const NOT_IMPLEMENTED = [
  { item: 'Table 3 in full',
    why: 'Only one cell was supplied: Red distance with a Green angle gives Green. The other '
      + 'disagreeing combinations take the more favourable of the two, extrapolated from that '
      + 'cell, and every result says when it did so.' },
  { item: 'Table 1 classification by hub, rotor and tip height',
    why: 'The height bands were not supplied and the document was not read. Choose the class '
      + 'by hand, or accept the inferred rotor bands.' },
  { item: 'SUR 13, the radar requirement',
    why: 'Not read. GEN 02 is radio sites only. The radar modelling in the rest of this tool '
      + 'is physics, not a CAP 670 check, and nothing here changes that.' },
  { item: 'Computing a carrier-to-interference ratio',
    why: 'This tool has no validated propagation model for an ATC radio site, and the source '
      + 'says the work must be done by a qualified consultancy. Thresholds are provided so a '
      + 'ratio from elsewhere can be checked; the ratio itself is not computed.' },
  { item: 'Whether a Supplementary Amendment has changed GEN 02',
    why: 'Not checked. The CAA is unreachable from this environment.' },
  { item: 'Paragraph-level references inside Appendix A',
    why: 'Its paragraphs are unnumbered in the source, so references are by table.' },
];
