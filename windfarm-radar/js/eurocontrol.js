// The EUROCONTROL Standard Document for Radar Surveillance in En-Route
// Airspace and Major Terminal Areas, SUR.ET1.ST01.1000-STD-01-01, Edition 1.0,
// March 1997, read from a copy of the document.
//
// It was named in this tool as the document most likely to carry a reference
// target figure different from CAP 670's 1 square metre. It carries no
// reference target at all, and it says why: performance is measured across the
// real aircraft population from opportunity traffic, explicitly irrespective of
// radar cross section. That is a stronger answer than silence would have been,
// and it is the reason this module exists rather than a note in a comment.
//
// Every quote below is checked verbatim against
// docs/evidence/eurocontrol-radar-surveillance-std-1997.txt by
// test/eurocontrol.test.mjs, so a quote cannot drift from the document.

export const PROVENANCE = {
  read: true,
  title: 'EUROCONTROL Standard Document for Radar Surveillance in En-Route Airspace '
    + 'and Major Terminal Areas',
  reference: 'SUR.ET1.ST01.1000-STD-01-01',
  edition: 'Edition 1.0, March 1997, Released Issue',
  evidence: 'docs/evidence/eurocontrol-radar-surveillance-std-1997.txt',
  // Said plainly because it matters: this edition is old enough that it has
  // probably been replaced, and this tool has not read the replacement.
  currency: 'Edition 1.0 dates from March 1997 and is very likely superseded. See SUPERSEDED '
    + 'below. Treat the figures here as the 1997 Standard’s, not as current EUROCONTROL '
    + 'policy, and do not quote them at anyone as a live requirement.',
};

/**
 * The successor. It was reported to this tool, then supplied, then read.
 *
 * js/esassp.js holds what it actually says, quoted and tested. This entry
 * exists so a reader of THIS module is sent there rather than left with a
 * 1997 document and no idea whether it still stands.
 */
export const SUPERSEDED = {
  by: 'EUROCONTROL Specification for ATM Surveillance System Performance (ESASSP), '
    + 'EUROCONTROL-SPEC-0147, Edition 1.3, 21 March 2024',
  status: 'read',
  readByThisTool: true,
  module: 'js/esassp.js',
  evidence: 'docs/evidence/eurocontrol-esassp-spec-0147-ed1.3-2024.txt',

  // The word matters, and the document does not use it.
  precise: 'The ESASSP does not say it supersedes this Standard. Neither volume of Edition 1.3 '
    + 'uses the word supersede, replace or withdraw. This Standard is a referenced document '
    + 'there, [RD 2], whose lessons learnt the ESASSP took into account, and its Annex D '
    + 'derives the non-cooperative requirements from this Standard\u2019s PSR requirements. It is '
    + 'the successor in substance; it is not a withdrawal.',

  // The consequence for the one figure this tool cares about.
  effectOnThisTool: 'The 90% survives. The 2024 specification requires a probability of update '
    + 'of horizontal position greater than 90% for a non-cooperative system at both 5 NM and '
    + '3 NM separation, so the figure this Standard gave in 1997 is carried into a current '
    + 'document. The metric is not identical, and js/esassp.js says how it differs.',

  // A correction, because the figure was stated to this tool and the document
  // says otherwise.
  correction: 'This Standard\u2019s PSR detection figure is "> 90 %" at 6.4.2.1. There is no 95% '
    + 'PSR detection figure in it. The only 95% is at 6.5, "Overall probability of '
    + 'association : \u2021 95%", the PSR/SSR data combining function, which is a different '
    + 'quantity. Checked against the stored extract.',
};

// The answer to "is there a defined test target". There is not, and the reason
// is a design decision rather than an omission: the sample is the real traffic.
export const NO_REFERENCE_TARGET = {
  hasReferenceTarget: false,
  ref: 'Section 6.2.1.3',
  quote: 'The sample taken shall be representative of the whole population of aircraft to '
    + 'which air traffic services are provided, irrespective of radar cross sections and '
    + 'clutter environments for PSR sensors, and irrespective of  transponder deficiencies '
    + 'for SSR sensors.',
  note: 'The phrase "irrespective of radar cross sections" is the point. Where CAP 670 names '
    + 'a 1 m² target to confirm the edge of coverage, this Standard measures the radar '
    + 'against whatever is actually flying. Neither document defines a test aeroplane.',
  searched: 'The words "Swerling", "dBsm", "echoing area", "target size" and "reference '
    + 'target" do not appear anywhere in the document, and no radar cross section figure is '
    + 'given in any units.',
};

// Performance requirements. Both are Recommendations in the document's own
// terms, which is worth carrying: the headline figures are "should", not
// "shall".
export const PSR = {
  status: 'Recommendation',
  statusRef: 'Section 6.4.1',
  statusQuote: 'Recommendation    PSR sensors should satisfy the performance requirements '
    + 'detailed in 6.4.2 and 6.4.3 below.',
  detection: {
    ref: 'Section 6.4.2.1',
    quote: 'Overall probability of target position detection:\t > 90 %',
    pd: 0.90,
  },
  falseTargets: {
    ref: 'Section 6.4.2.2',
    quote: 'Average number of false target reports per antenna scan:\t < 20',
    perScan: 20,
  },
  // Acceptance figures a site can actually be measured against.
  accuracy: {
    ref: 'Section 6.4.3.1',
    systematic: { slantRangeBiasM: 100, azimuthBiasDeg: 0.1, rangeGainErrorMPerNm: 1,
      timeStampErrorMs: 100 },
    randomStdDev: { slantRangeM: 120, azimuthDeg: 0.15 },
  },
};

export const SSR = {
  status: 'Recommendation',
  statusRef: 'Section 6.3.1',
  detection: {
    ref: 'Section 6.3.2.1',
    quote: 'Overall probability of detection:\t> 97 %',
    pd: 0.97,
  },
};

// Two independent documents reaching the same pair of numbers is worth stating
// as a finding rather than leaving for a reader to notice.
export const AGREES_WITH_CAP670 = {
  claim: 'The 90% and 97% figures in this Standard match CAP 670 SUR 02.40, which recommends '
    + 'at least 90% for conventional radars and above 97% for Monopulse and Mode S. The two '
    + 'documents are independent of one another, so the default probability of detection this '
    + 'tool uses, 0.9, is corroborated rather than merely sourced.',
  cap670Ref: 'CAP 670 SUR 02.40',
  eurocontrolRefs: ['Section 6.4.2.1', 'Section 6.3.2.1'],
  bothAreRecommendations: true,
};

// The flight check question, answered from the other side. This Standard says
// what a test flight is FOR, and it is the exception rather than the method.
export const VERIFICATION = {
  dataSource: {
    ref: 'Section 8.2.2.1',
    quote: 'The data to be used for performance verification shall be live radar data '
      + 'obtained from opportunity traffic or from special test flights.',
  },
  whenTestFlightsAreUsed: {
    ref: 'Section 8.2.2.1, Note',
    quote: 'Special test flights will normally be used only in two cases:',
    cases: [
      'to measure performance parameters which require special aircraft configurations',
      'to measure performances in parts of the airspace where opportunity traffic rarely passes',
    ],
    note: 'A wind farm screening case is usually the second one: the question is cover in a '
      + 'particular piece of airspace, which ordinary traffic may not fly often enough to '
      + 'measure.',
  },
  sampleSize: {
    ref: 'Section 8.2.2.2',
    status: 'Recommendation',
    quote: 'In order to provide an adequate sample size for verifications using opportunity '
      + 'traffic, the collected data should cover a number of time periods of approximately '
      + 'one hour each and include at least 50 000 data samples.',
    samples: 50000,
  },
  // Directly relevant to a tool that models refraction: the Standard says not
  // to measure PSR performance in the conditions this tool lets you select.
  weatherExclusion: {
    ref: 'Section 8.2.2.2',
    quote: 'Data collected during conditions of severe weather or anomalous propagation '
      + 'should not be used to verify PSR performance.',
    note: 'This tool lets you run at k = 2 and in a surface duct, which is anomalous '
      + 'propagation. Those runs explore sensitivity. They are not the conditions in which '
      + 'this Standard says measured performance should be established.',
  },
  reassessment: {
    ref: 'Section 8.1.3',
    quote: 'The performances of the radar chain shall be re-assessed at regular intervals. '
      + 'This re-assessment can be made either by permanent monitoring (real-time quality '
      + 'control) or by annual performance measurements campaigns.',
  },
};

// Nothing in this module gates a calculation. It is here so the tool can say
// which of its numbers a published standard supports, and it supports exactly
// one: the default probability of detection.
export const NOT_IMPLEMENTED = [
  'No calculation in this tool is gated on this Standard.',
  'The PSR accuracy figures in 6.4.3.1 are acceptance criteria for a measured radar. This '
    + 'tool predicts detection margin and does not model radar position error at all.',
  'The false target rate of under 20 per scan is measured on a real installation. This tool '
    + 'reports how many turbine returns cross the detection threshold, which is a different '
    + 'quantity and is not comparable.',
];
