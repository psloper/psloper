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
  // Said plainly because it matters: this edition is old enough that it may
  // have been replaced, and this tool has not established either way.
  currency: 'Edition 1.0 dates from March 1997. EUROCONTROL has since published a '
    + 'Specification for ATM Surveillance System Performance, which may supersede this '
    + 'Standard in whole or in part. That has NOT been checked: eurocontrol.int is '
    + 'unreachable from the environment this tool was built in, and the later document '
    + 'was not supplied. Treat the figures here as the 1997 Standard’s, not as current '
    + 'EUROCONTROL policy.',
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
