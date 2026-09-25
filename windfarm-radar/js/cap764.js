// CAP 764, CAA Policy and Guidelines on Wind Turbines.
//
// READ, BUT AS A CONSULTATION DRAFT. What was supplied is the Seventh Edition
// red-underline draft: its cover says "Published by the Civil Aviation
// Authority, YYYY" and "Seventh Edition [publication date to be inserted]".
// A draft out for consultation is not policy. The published edition is the
// Sixth, January 2016, and it has NOT been read. Where the draft changes
// something, the Sixth Edition may still say the old thing, and this tool
// cannot tell you which.
//
// Every quote is checked verbatim against
// docs/evidence/cap764-ed7-draft-consultation.txt by test/cap764.test.mjs.

export const PROVENANCE = {
  read: true,
  status: 'draft-read',
  isDraft: true,
  title: 'CAA Policy and Guidelines on Wind Turbines, CAP 764',
  org: 'UK Civil Aviation Authority',
  editionRead: 'Seventh Edition, draft for consultation, red-underline version',
  publicationDate: 'None. The cover reads "Seventh Edition [publication date to be inserted]".',
  publishedEdition: 'Sixth Edition, January 2016. NOT read.',
  evidence: 'docs/evidence/cap764-ed7-draft-consultation.txt',
  caution: 'Do not cite this as CAP 764 without saying which edition. A consultation draft can '
    + 'change before publication or not be adopted at all.',
};

/**
 * The consultation distances, which is the part of CAP 764 this tool leans on.
 *
 * The preamble matters as much as the numbers: the draft calls them "not
 * definitive" and says the radar distance "can be far greater than 30 km".
 * They are triggers for consultation, not boundaries of effect.
 */
export const CONSULTATION = {
  ref: 'Draft CAP 764 Edition 7, paragraph 3.4',
  preambleQuote: 'Whilst not definitive, it should be anticipated that any wind turbine '
    + 'development within the following criteria24 might have an impact upon civil aerodrome25 '
    + '- related operations:.',
  radarQuote: 'Unless otherwise specified by the aerodrome or indicated on the aerodrome’s '
    + 'published wind turbine consultation map, within 30 km of an aerodrome with a '
    + 'surveillance radar facility. The distance can be far greater than 30 km depending upon a '
    + 'number of factors including the type and coverage of the radar and the particular '
    + 'operation at the aerodrome;',
  // The full tier list. A summary of this document gave only the first two.
  tiers: [
    { km: 30, of: 'an aerodrome with a surveillance radar facility',
      note: 'Subject to the aerodrome’s own published consultation map, and the draft says '
        + 'the distance can be far greater.' },
    { km: 17, of: 'a non-radar equipped licensed aerodrome with a runway of 1100 m or more' },
    { km: 5, of: 'a non-radar equipped licensed aerodrome with a runway of less than 1100 m' },
    { km: 4, of: 'a non-radar equipped unlicensed aerodrome with a runway of more than 800 m' },
  ],
  alsoIfp: 'Within airspace coincidental with any published Instrument Flight Procedure '
    + '(IFP) to take into account the aerodrome’s requirement to protect its IFPs;',
  offshore: {
    ref: 'Draft CAP 764 Edition 7, paragraph 5.2',
    nm: 9,
    quote: 'Wind turbine developments (including anemometer masts) within a 9 NM radius of an '
      + 'offshore helicopter installation could introduce obstructions that would have an '
      + 'impact on the ability to safely conduct essential instrument flight procedures to such '
      + 'facilities in low visibility conditions.',
    note: 'Stated in the offshore chapter as an impact statement, not in the 3.4 consultation '
      + 'list. It is not phrased as a consultation trigger.',
  },
  glidingNote: 'The draft’s other 10 km figure, at paragraph 3.x on gliding, is about '
    + 'consulting the British Gliding Association near a charted glider launch site. It is not '
    + 'the SSR proximity figure and must not be confused with it.',
};

/**
 * The paragraph that speaks most directly to a tool like this one.
 *
 * It says two things this tool has to carry: the CAA endorses no radar
 * modelling tool, and no standard turbine radar cross section can be
 * identified. The second is a caution on figures this tool ships as defaults.
 */
export const ON_MODELLING = {
  ref: 'Draft CAP 764 Edition 7, paragraph 2.17',
  quote: 'The CAA does not endorse any one specific radar modelling tool. Nor, given the '
    + 'multitude of factors affecting RCS, can a ‘standard’ RCS be identified for micro, '
    + 'medium and large wind turbines. It is strongly suggested that developers engage with the '
    + 'appropriate ANSP prior to commissioning a propagation assessment in order to ensure that '
    + 'the proposed model is suitable.',
  appliesToThisTool: 'Directly. This tool is a radar modelling tool and it ships default '
    + 'turbine radar cross sections. The draft says no standard RCS can be identified for any '
    + 'turbine class, so those defaults are a starting point for exploring sensitivity and are '
    + 'not a figure to assert. It also says to engage the ANSP before commissioning a '
    + 'propagation assessment, which is a step this tool does not replace.',
};

/**
 * Whether the CAA approves mitigations. It was reported that CAP 764 details
 * "approved technical and operational mitigations". It does not.
 */
export const MITIGATION_STATUS = {
  usesTheWordApprovedOfMitigations: false,
  checked: 'The word "approved" appears in the draft only of instrument flight procedures and '
    + 'of planning applications. The word "endorsed" appears nowhere in it.',
  whatItSaysRef: 'Draft CAP 764 Edition 7, paragraph 2.21',
  whatItSaysQuote: 'It must also be noted that most mitigation methods would be subject to a '
    + 'standard safety assessment process by the ANSP who, in turn, would need to demonstrate '
    + 'that the system is safe in order to gain CAA approval (where applicable).',
  defersToCap670Ref: 'Draft CAP 764 Edition 7, paragraph 2.22',
  defersToCap670Quote: 'Mitigation techniques can be categorised into several key types. This '
    + 'section provides a summary of each category.  More detailed explanation is available in '
    + 'the CAP 670.',
  reading: 'What can be approved is a particular ANSP’s system change, case by case, after a '
    + 'safety assessment, where approval applies at all. Not a technique in the abstract. And '
    + 'CAP 764 sends the reader to CAP 670 for the detail, where SUR 13A.107 says the listed '
    + 'mechanisms "must not be regarded as mitigations that are recommended or endorsed by the '
    + 'CAA". Calling a mitigation CAA-approved in a planning submission is not supported by '
    + 'either document.',
};

/**
 * Obstacle lighting. The duty is not CAP 764's; CAP 764 describes it.
 */
export const LIGHTING = {
  dutyFrom: 'Article 222 of the Air Navigation Order 2016 as amended',
  dutyRef: 'Draft CAP 764 Edition 7, paragraphs 4.4 and 4.5',
  dutyQuote: 'Article 222 of the ANO (2016) as amended, regarding onshore obstacle lighting '
    + 'requirements, states that for structures away from the immediate vicinity of an '
    + 'aerodrome, which have a height of 150 m (492 ft) or more AGL are fitted with medium '
    + 'intensity steady red lights positioned as close as possible to the top of the obstacle, '
    + 'and also equally spaced at intermediate levels, so far as practicable, between the top '
    + 'lights and ground level with an interval not exceeding 52 m.',
  thresholdM: 150,
  turbineSpecificRef: 'Draft CAP 764 Edition 7, paragraph 4.6',
  turbineSpecificQuote: 'In accordance with Article 222(6) of the ANO (2016) as amended and '
    + 'considering ICAO Annex 14 Volume 1 Chapter 6, the CAA has determined the following '
    + 'specific lighting requirements apply to wind turbines:',
  // The detail a one-line summary loses, and the part that matters to this
  // tool, which already measures tip height.
  measuredFromTipQuote: 'The requirement to fit lights is based on the maximum height from the '
    + 'ground to the tip of the blades, but the requirement for the positioning of lights is '
    + 'based on the fixed structure (nacelle and tower).',
  nacelleQuote: 'One medium intensity (2000 candela) red light must be placed on the nacelle '
    + 'of the turbine; a second 2000 candela red light serving as an alternate should be '
    + 'provided in case of failure of the operating light.',
  intermediateQuote: 'At least three (to provide 360 degree coverage) low-intensity Type B '
    + 'lights (32 candela) lights must be provided at an intermediate level of half the nacelle '
    + 'height ± 10 m.',
  perimeterChange: 'The draft lights the PERIMETER of a wind farm rather than every turbine '
    + 'above 150 m, and notes that under the previous requirement all turbines above 150 m AGL '
    + 'were lit. That is a change a consultation draft proposes, so it is exactly the kind of '
    + 'thing that may differ in the published Sixth Edition.',
};

/**
 * Aviation Detection Lighting Systems, and the 1 m2 target again.
 */
export const ADLS = {
  mandatory: false,
  ref: 'Draft CAP 764 Edition 7, paragraph 4.17',
  quote: 'Implementation of ADLS is not a mandatory requirement and its deployment may act as '
    + 'a mitigation to the visual impact of aviation obstacle lighting operating on wind '
    + 'turbines at night in light sensitive areas but continue to comply with the law and '
    + 'red',
  notNearAerodromesRef: 'Draft CAP 764 Edition 7, paragraph 4.18',
  notNearAerodromesQuote: 'ADLS for wind turbine obstruction lighting will not be permitted '
    + 'within the obstacle limitation surfaces of a licensed aerodrome due to issues concerning '
    + 'the potential late detection of aircraft.',
  failSafeRef: 'Draft CAP 764 Edition 7, paragraph 4.19',
  failSafeQuote: 'In operation, the default position for an ADLS is to have the obstacle lights '
    + 'switched on, with the ADLS switching off the lights when aircraft are not within the '
    + 'pre-defined detection volume of airspace.',
  // A third independent document naming the same target as CAP 670 SUR 12.35.
  oneSquareMetreTarget: {
    ref: 'Draft CAP 764 Edition 7, paragraph 4.29',
    quote: 'The required Pd shall be achieved for a target with a radar cross section of 1m2.',
    rcsM2: 1,
    context: 'The detection performance an ADLS surveillance system must achieve: 99% '
      + 'probability of detection for a target entering the zone 4 to 3 NM from the wind farm '
      + 'perimeter, and 90% while tracked out to 4 NM.',
    note: 'A third document naming a 1 m² target, after CAP 670 SUR 12.35 and SUR 13.44. It is '
      + 'a different application, lighting activation rather than air traffic surveillance, but '
      + 'the target size is the same and it is the same size this tool offers as its CAP 670 '
      + 'test target.',
  },
};

// What this document does NOT support, recorded because the tool previously
// attributed it here.
export const NOT_IN_THIS_DRAFT = [
  {
    figure: 'A 10 km secondary surveillance radar proximity figure',
    finding: 'The draft’s only 10 km figure is about consulting the British Gliding '
      + 'Association near a charted glider launch site. There is no SSR proximity distance in '
      + 'it. The tool’s SSR finding cites CAP 670 SUR 13A.75, which was read in full and does '
      + 'carry the figure, so the finding stands; the attribution to CAP 764 did not.',
  },
  {
    figure: 'Turbine radar cross section figures',
    finding: 'The draft gives none, and says at 2.17 that no standard RCS can be identified. '
      + 'The tool’s turbine RCS defaults are its own and are labelled as such.',
  },
];
