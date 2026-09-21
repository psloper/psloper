// CAP 764, CAA Policy and Guidelines on Wind Turbines.
//
// This is the document the tool most needs and has least of. Three figures in
// the tool trace to it and NONE of them has been read from it: the 30 km
// primary radar assessment guide, the SSR proximity note, and the radar cross
// section defaults' caveat. Everything below is therefore a list of things to
// check the day a copy arrives, not a list of facts.
//
// A research summary about CAP 764, produced by another AI tool, was shown to
// this project. Its claims are recorded here verbatim as CLAIMS, because a
// summary of a document is not the document, and because recording them makes
// them checkable rather than absorbable.

export const PROVENANCE = {
  read: false,
  status: 'not-read',
  title: 'CAP 764: CAA Policy and Guidelines on Wind Turbines',
  org: 'UK Civil Aviation Authority',
  editionKnown: false,
  whyNotRead: 'Every CAA host is blocked by the network egress policy of the environment this '
    + 'tool was built in: caa.co.uk, consultations.caa.co.uk and the third-party planning '
    + 'sites that host copies. No copy has been supplied as a file.',
  note: 'Edition 6 is dated February 2016 according to search results, and a draft Edition 7 '
    + 'went out for consultation. Neither has been read here, and this tool does not know '
    + 'which edition is current.',
};

/**
 * Claims from a third-party research summary, recorded unverified.
 *
 * Each entry says what was claimed, and what this tool can say about it from
 * documents it HAS read. That second field is the useful part: some of these
 * can be partly checked against CAP 670 without CAP 764 in hand, and one of
 * them is contradicted by it.
 */
export const REPORTED_CLAIMS = [
  {
    claim: 'CAP 764 sets consultation trigger distances of 30 km around aerodromes equipped '
      + 'with surveillance radar, 17 km for licensed non-radar aerodromes with long runways, '
      + 'and 9 NM for offshore helicopter facilities.',
    status: 'unverified',
    whatWeKnow: 'The 30 km matches the figure this tool already carries, which also came from '
      + 'a search summary rather than the document. The 17 km and 9 NM figures are new to this '
      + 'tool and are used nowhere in it. The string "30 km" appears nowhere in CAP 670, which '
      + 'has been read in full, so CAP 670 cannot corroborate any of them.',
  },
  {
    claim: 'Moving turbine blade tips exceed Doppler velocity thresholds in radar data '
      + 'processors, causing false returns, track corruption or desensitisation.',
    status: 'consistent',
    whatWeKnow: 'This is the mechanism the tool models and CAP 670 describes the same effects '
      + 'in SUR 13 and its Appendix A. Nothing here needs CAP 764 to support it.',
  },
  {
    claim: 'CAP 764 details "approved technical and operational mitigations", including '
      + 'in-fill radar, non-auto-track zones, 3D primary radar upgrades and instrument '
      + 'procedure redesigns.',
    status: 'contradicted-in-part',
    whatWeKnow: 'The mitigations named are the ones this tool already offers, so the list is '
      + 'plausible. The word "approved" is the problem. CAP 670 SUR 13A.107, read in full, '
      + 'says: "ANSPs are also reminded that the mitigation mechanisms listed here are '
      + 'guidance only and must not be regarded as mitigations that are recommended or '
      + 'endorsed by the CAA." That is CAP 670 speaking about its own Appendix A list rather '
      + 'than about CAP 764, so it is not a direct contradiction of CAP 764’s text. It is a '
      + 'direct contradiction of the idea that the CAA approves mitigations, and it is the '
      + 'position this tool takes until CAP 764 is read and says otherwise. Describing a '
      + 'mitigation as CAA-approved in a planning submission is a claim worth being sure of.',
  },
  {
    claim: 'Steady red nacelle lighting is required for turbines 150 metres or taller, and '
      + 'Edition 7 introduces formal pathways for Aviation Detection Lighting Systems.',
    status: 'unverified',
    whatWeKnow: 'This tool already flags 150 m AGL as a height that commonly triggers en-route '
      + 'obstacle lighting and charting, and already marks that finding as needing '
      + 'confirmation because it verifies it against no jurisdiction. The lighting '
      + 'specification, the colour, whether it is steady or flashing, and any detection '
      + 'lighting pathway are all unverified here. Note also that obstacle lighting in the UK '
      + 'is set by the Air Navigation Order and CAP 393 as well as by CAP 764; which '
      + 'instrument actually imposes the duty has not been established.',
  },
];

// What to do when a copy arrives. Written as a checklist because the figures
// above are the ones that would change what the tool prints.
export const TO_CHECK_ON_ARRIVAL = [
  'The edition and date, and whether Edition 7 has been published.',
  'The 30 km figure: its exact wording, what it is a distance FROM, and whether it is a '
    + 'consultation trigger, an assessment guide, or both. The tool currently calls it an '
    + '"assessment guide".',
  'The 17 km figure and what "long runways" means numerically.',
  'The 9 NM offshore helicopter figure.',
  'Whether CAP 764 describes any mitigation as approved or endorsed, given CAP 670 SUR '
    + '13A.107 says the opposite of its own list.',
  'The obstacle lighting threshold, specification and colour, and which instrument imposes it.',
  'The SSR proximity figure this tool carries, which CAP 670 SUR 13A.75 independently '
    + 'corroborates at 10 km.',
  'Whether CAP 764 gives turbine RCS figures, and at what frequencies.',
];
