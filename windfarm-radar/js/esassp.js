// The EUROCONTROL Specification for ATM Surveillance System Performance
// (ESASSP), EUROCONTROL-SPEC-0147, Edition 1.3, 21 March 2024, read from the
// published PDFs of both volumes.
//
// It was put to this tool that the ESASSP supersedes the 1997 Radar
// Surveillance Standard. The document was then supplied, so the claim could be
// checked rather than recorded. What it actually does is more useful than
// supersession, and different from it: it carries the 1997 primary radar
// requirements forward into Annex D and says so.
//
// Quotes are checked verbatim against
// docs/evidence/eurocontrol-esassp-spec-0147-ed1.3-2024.txt by
// test/esassp.test.mjs.

export const PROVENANCE = {
  read: true,
  title: 'EUROCONTROL Specification for ATM Surveillance System Performance',
  reference: 'EUROCONTROL-SPEC-0147',
  edition: 'Edition 1.3',
  date: '21/03/2024',
  status: 'Released Issue',
  volumes: 'Volumes 1 and 2 both read. Volume 2 Appendices and the archived SPEC-0147 '
    + 'editions in the same bundle were not.',
  evidence: 'docs/evidence/eurocontrol-esassp-spec-0147-ed1.3-2024.txt',
};

/**
 * What the ESASSP says about the 1997 Standard, which is not "superseded".
 *
 * The distinction matters for this tool. If the 1997 Standard were simply
 * withdrawn, its 90% primary radar figure would be a historical curiosity. It
 * is not: Annex D of the 2024 specification derives its non-cooperative
 * requirements from it, and the 90 survives.
 */
export const RELATION_TO_1997 = {
  usesTheWordSupersede: false,
  checked: 'The words "supersede", "supersedes", "replaces" and "withdraw" appear nowhere in '
    + 'either volume of Edition 1.3.',
  listedAs: 'A referenced document, [RD 2] in Annex B - 1.1.',
  lessonsRef: 'Volume 1, section 2, Document development context',
  lessonsQuote: 'This document takes into account the lessons learnt from the application of '
    + 'the EUROCONTROL Standard Document for Radar Surveillance in En-route Airspace and Major '
    + 'Terminal Areas [RD 2], which are:',
  lessons: [
    'Difficulties in practically assessing some specified requirements.',
    'Avoid technology specific requirements, for example only applicable to SSR and PSR '
      + 'whereas new surveillance technologies are now available (Mode S, WAM, ADS-B) and '
      + 'difficulties to transpose requirements to other technologies (e.g. MSPSR).',
    'Avoid design requirements, for example not imposing high level sensor-based '
      + 'implementation choices (2 SSR for en-route and one PSR + 2 SSR for major TMA) which '
      + 'were difficult to transpose into requirements for other architectures.',
    'Lack of traceability between supported air traffic services or functions (i.e. users '
      + 'needs) and technical requirements.',
  ],
  carriesItForwardRef: 'Volume 1, Annex D - 3',
  // Quoted as the PDF text layer renders it. The document breaks
  // "non-cooperative" across a line and the hyphen is lost in extraction, so
  // the stored text reads "noncooperative". Quoting it with the hyphen would
  // be quoting something the evidence file does not contain.
  carriesItForwardQuote: 'The performance requirements defined in this annex are provided to '
    + 'support legacy noncooperative surveillance system and are derived from PSR sensor '
    + 'requirements provided in [RD 2].',
  reading: 'It is the successor in substance: a 2024 specification written because the 1997 '
    + 'Standard proved hard to assess, technology specific and short on traceability. But it '
    + 'does not declare that Standard superseded, and its own primary radar requirements are '
    + 'derived from it. "Superseded" overstates what the document says. "Restructured and '
    + 'carried forward" is what it does.',
};

/**
 * The live primary radar requirements. ESASSP calls a primary radar a
 * non-cooperative surveillance system, and Annex D is the only part of the
 * specification that addresses one.
 *
 * Note what changed and what did not. The 90% survives from 1997, but the
 * quantity it measures is not the same: this is the probability that the
 * horizontal position is UPDATED within a stated measurement interval, not the
 * probability of detection on a given scan. Same number, different metric, and
 * the two must not be quoted as though they were interchangeable.
 */
export const NON_COOPERATIVE = {
  ref: 'Volume 1, Annex D - 4 (Table 9) and D - 5 (Table 10)',
  mandatoryConvention: {
    ref: 'Volume 1, Annex D - 3',
    quote: 'The 3rd column provides mandatory (in bold font).',
    note: 'Every requirement reproduced below is in the mandatory column.',
  },
  fiveNm: {
    table: 'Table 9: Non-cooperative surveillance system requirements for supporting 5 NM '
      + 'horizontal separation (5N_N)',
    requirements: [
      { id: '5N_N-R1', quality: 'Measurement interval for probability of update assessment (R2)',
        performance: 'Less than or equal to 8 seconds', seconds: 8 },
      { id: '5N_N-R2',
        quality: 'Probability of update of horizontal position in accordance with selected '
          + 'measurement interval',
        performance: 'Greater than 90 % global', fraction: 0.90 },
      { id: '5N_N-R3', quality: 'Horizontal position RMS error',
        performance: 'Less than or equal to 500 m global', metres: 500 },
    ],
  },
  threeNm: {
    table: 'Table 10: Non-cooperative surveillance system requirements for supporting 3 NM '
      + 'horizontal separation (3N_N)',
    requirements: [
      { id: '3N_N-R1', quality: 'Measurement interval for probability of update assessment (R2)',
        performance: 'Less than or equal to 5 seconds', seconds: 5 },
      { id: '3N_N-R2',
        quality: 'Probability of update of horizontal position in accordance with selected '
          + 'measurement interval',
        performance: 'Greater than 90 % global', fraction: 0.90 },
      { id: '3N_N-R3', quality: 'Horizontal position RMS error',
        performance: 'Less than or equal to 300 m global', metres: 300 },
    ],
  },
  // A limit worth stating, because the specification covers 2.5 NM elsewhere.
  noTwoPointFiveNm: 'Annex D covers 5 NM and 3 NM only. The 2.5 NM case in the specification '
    + 'is for succeeding aircraft established on the same final approach track and has no '
    + 'non-cooperative table, so ESASSP sets no primary radar requirement for it.',
};

// Where this leaves the one number the tool takes from a published document.
export const EFFECT_ON_THIS_TOOL = {
  claim: 'The tool’s default probability of detection of 0.9 now has three documents behind '
    + 'it rather than two: CAP 670 SUR 02.40, the 1997 EUROCONTROL Standard at 6.4.2.1, and '
    + 'this 2024 specification at 5N_N-R2 and 3N_N-R2. The 1997 figure being carried into a '
    + '2024 specification is the strongest of the three.',
  butAlso: 'The ESASSP metric is a probability of UPDATE within a measurement interval, '
    + 'assessed end to end at the system output. What this tool computes is a single-look '
    + 'detection probability from the radar range equation. They are not the same quantity '
    + 'and the agreement is in the number, not in the definition.',
  notImplemented: [
    'No calculation in this tool is gated on the ESASSP.',
    'The measurement interval requirements (8 s at 5 NM, 5 s at 3 NM) are end-to-end data '
      + 'delivery times for a whole surveillance chain. This tool models one radar and its '
      + 'scan period, not a chain, and does not compute a measurement interval.',
    'The horizontal position RMS error limits are acceptance criteria for a measured system. '
      + 'This tool does not model radar position error at all.',
  ],
};

// Corrections to what was reported to this tool before the document arrived.
export const CORRECTIONS = [
  {
    reported: 'The ESASSP explicitly states that it supersedes the 1997 Standard.',
    found: 'Neither volume of Edition 1.3 uses the word supersede, replace or withdraw. The '
      + '1997 Standard is a referenced document whose lessons learnt the ESASSP takes into '
      + 'account, and whose PSR requirements Annex D is derived from.',
  },
  {
    reported: 'The 1997 Standard specified a PSR probability of detection of 90% or 95%.',
    found: 'The 1997 Standard gives one PSR detection figure, "> 90 %" at 6.4.2.1. Its only '
      + '95% is at 6.5, the PSR/SSR data combining probability of association, which is a '
      + 'different quantity.',
  },
  {
    reported: 'ESASSP structures requirements around 5 NM, 3 NM and 2.5 NM separation.',
    found: 'True of the specification as a whole, but not of primary radar. Annex D, the only '
      + 'non-cooperative part, covers 5 NM and 3 NM. There is no 2.5 NM non-cooperative table.',
  },
  {
    reported: 'ESASSP was developed to support Commission Regulation (EU) No 1207/2011.',
    found: 'Confirmed, but the statement is in the Volume 2 abstract, not Volume 1. Volume 1 '
      + 'references Commission Implementing Regulation (EU) 2017/373 instead.',
  },
];
