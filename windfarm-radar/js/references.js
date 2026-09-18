// Evidence register.
//
// Every model component and every screening threshold in this tool traces to
// something. This file records what, and how well.
//
// READ THE STATUS ON EACH ENTRY. It is the most important field here.
//
//   read           Retrieved and read in full. Figures may be quoted directly.
//   search-summary Surfaced through a search, with a summary of its findings.
//                  Enough to know the work exists and roughly what it reports.
//                  NOT enough to quote a figure from.
//   recalled       Named from general knowledge and not retrieved at all. The
//                  citation itself may be wrong: edition, number, year, even
//                  the existence of the document as described.
//   blocked        Identified, and retrieval was attempted and refused. The
//                  environment this tool was built in had no route to it.
//
// NOTHING IN THIS REGISTER IS MARKED "read". The environment had no general
// outbound network access. Formulas taken from standard references were
// validated against values that are independently known instead, which is a
// different kind of confidence and is recorded per entry under `validation`.
//
// This register exists so that a reader can tell, for any number the tool
// produces, whether it rests on something checked or something assumed.

export const STATUS_LABELS = {
  read: 'Read in full',
  'search-summary': 'Search summary only, not read',
  recalled: 'From general knowledge, not retrieved',
  blocked: 'Retrieval attempted and blocked',
};

export const REFERENCES = [
  // ------------------------------------------------ regulation and guidance
  {
    id: 'cap764',
    title: 'CAP 764: CAA Policy and Guidelines on Wind Turbines',
    org: 'UK Civil Aviation Authority',
    type: 'Regulatory guidance',
    status: 'search-summary',
    supports: ['cap764-30km', 'cap764-ssr', 'RCS defaults and their caveat'],
    reports: 'A 30 km guide distance for assessing radar impact, with actual impact depending on '
      + 'whether the operating turbines are detectable by the radar. Effects on secondary surveillance '
      + 'radar relevant to consider inside 10 km. That, given the number of factors affecting radar '
      + 'cross-section, no standard RCS can be identified for micro, medium or large turbines, and the '
      + 'CAA endorses no single radar modelling tool.',
    caution: 'Edition not confirmed. Confirm the current edition and the figures before citing them.',
  },
  {
    id: 'cap670',
    title: 'CAP 670 (including SUR 13): Air Traffic Services Safety Requirements',
    org: 'UK Civil Aviation Authority',
    type: 'Regulatory requirement',
    status: 'recalled',
    supports: ['Mitigation approaches generally'],
    reports: 'Cited by CAP 764 as holding the detailed explanation and analysis of radar mitigation '
      + 'techniques.',
    caution: 'Not retrieved. Named only because CAP 764 points to it.',
  },
  {
    id: 'eurdoc015',
    title: 'EUR Doc 015: European Guidance Material on Managing Building Restricted Areas',
    org: 'ICAO EUR/NAT Office',
    type: 'Guidance material',
    status: 'recalled',
    supports: ['Regulatory framework finding'],
    reports: 'Understood to give guidance on safeguarding areas around communication, navigation and '
      + 'surveillance facilities.',
    caution: 'Not retrieved. The document number, edition and scope are all unconfirmed.',
  },
  {
    id: 'icao-annex14',
    title: 'Annex 14 to the Convention on International Civil Aviation, Volume I: Aerodromes',
    org: 'ICAO',
    type: 'International standard',
    status: 'recalled',
    supports: ['Regulatory framework finding', 'obstacle lighting flag'],
    reports: 'Understood to contain obstacle limitation surfaces and obstacle marking and lighting '
      + 'requirements.',
    caution: 'Not retrieved. This tool does NOT assess obstacle limitation surfaces.',
  },

  // ---------------------------------------------------------- turbine RCS
  {
    id: 'jenn2012',
    title: 'Wind Turbine Radar Cross Section',
    authors: 'Jenn, D. and Ton, C.',
    venue: 'International Journal of Antennas and Propagation',
    year: 2012,
    type: 'Journal article',
    status: 'search-summary',
    supports: ['scatterer-split', 'tower/blade split in the model'],
    reports: 'Monostatic and bistatic RCS patterns for horizontal-axis three-blade and vertical-axis '
      + 'helical designs. That the tower or mast is the dominant contributor to RCS at all angles '
      + 'regardless of rotor orientation, and may be considered the primary scatterer. Lobes at 90 and '
      + '270 degrees from the large flat sides of the nacelle. Discussion of material effects and '
      + 'mitigation.',
  },
  {
    id: 'amt2021',
    title: 'Insights into wind turbine reflectivity and radar cross-section (RCS) and their '
      + 'variability using X-band weather radar observations',
    venue: 'Atmospheric Measurement Techniques',
    year: 2021,
    type: 'Journal article',
    status: 'blocked',
    supports: ['RCS default values and their stated range'],
    reports: 'Measured turbine RCS from X-band weather radar. Maxima as low as 20 dBsm in scanning '
      + 'mode, and up to about 44 dBsm in fixed-pointing mode. Blade pitch angle, turbine orientation '
      + 'and rotor motion identified as key drivers of variability.',
    caution: 'Fetch refused by the network policy. Figures above come from the search summary, not '
      + 'from the paper.',
  },
  {
    id: 'appliedsci2019',
    title: 'Simulative Investigation of the Radar Cross Section of Wind Turbines',
    venue: 'Applied Sciences',
    year: 2019,
    type: 'Journal article',
    status: 'search-summary',
    supports: ['RCS sensitivity to geometry'],
    reports: 'Numerical simulation of turbine RCS against design parameters, with a focus on rotor '
      + 'blade aerodynamic shape.',
  },

  // ------------------------------------------------- clutter and mitigation
  {
    id: 'ntia2008',
    title: 'TR-08-454: Assessment of the Effects of Wind Turbines on Air Traffic Control Radars',
    org: 'NTIA Institute for Telecommunication Sciences',
    type: 'Technical report',
    status: 'search-summary',
    supports: ['desense', 'shadow'],
    reports: 'Two principal effects on primary radar: desensitisation over and around the farm, driven '
      + 'largely by turbine range processing sidelobes extending behind it, and shadowing. Simulations '
      + 'indicating the shadow is a three-dimensional wedge of angular extent around 2 degrees or less. '
      + 'Field tests showing loss of aircraft detections where wind farms lie within about 1 NM of the '
      + 'aircraft position.',
  },
  {
    id: 'wang2013',
    title: 'Detecting and Mitigating Wind Turbine Clutter for Airspace Radar Systems',
    venue: 'The Scientific World Journal',
    year: 2013,
    type: 'Journal article',
    status: 'search-summary',
    supports: ['false-plots', 'doppler-alias'],
    reports: 'That rotor motion is fast enough that conventional clutter filtering does not suppress '
      + 'the blade return, that Doppler shift increases from hub to tip along the blade, and that the '
      + 'resulting spectrum can mask real signals or appear as false ones.',
  },
  {
    id: 'ella2022',
    title: 'Mitigation Measures for Windfarm Effects on Radar Systems',
    venue: 'International Journal of Aerospace Engineering',
    year: 2022,
    type: 'Journal article',
    status: 'search-summary',
    supports: ['blanking-hole', 'naiz', 'infill'],
    reports: 'Mitigations applied in practice: area radar blanking, non-automatic initiation of tracks, '
      + 'in-fill radar, and post-detection processing including range-azimuth gating and the '
      + 'elimination of cells with significant clutter.',
  },
  {
    id: 'jtech2009',
    title: 'Detailed Observations of Wind Turbine Clutter with Scanning Weather Radars',
    venue: 'Journal of Atmospheric and Oceanic Technology',
    year: 2009,
    type: 'Journal article',
    status: 'search-summary',
    supports: ['weather radar preset'],
    reports: 'Observations of turbine clutter in weather radar, including corruption of reflectivity '
      + 'and radial velocity products.',
  },
  {
    id: 'marine-clutter',
    title: 'Simplified Formulae for the Estimation of Offshore Wind Turbines Clutter on Marine Radars',
    type: 'Journal article',
    status: 'search-summary',
    supports: ['marine-x radar preset', 'offshore siting'],
    reports: 'Estimation of offshore turbine clutter as seen by marine radar.',
  },

  // ----------------------------------------------------------- materials
  {
    id: 'qinetiq-vestas',
    title: 'Stealth turbine trial: radar-absorbent prototype blade on a Vestas V90',
    org: 'QinetiQ with Vestas',
    year: 2009,
    type: 'Industry trial, reported in trade press',
    status: 'search-summary',
    supports: ['ram-lightning', 'RAM mitigation caveat'],
    reports: 'A 44 m prototype blade incorporating absorbent materials fitted to a V90 in Norfolk, with '
      + 'RCS measured on a portable radar and reductions reported as in line with expectations. '
      + 'Absorbent materials described as integrated into blades, nacelle and tower, including '
      + 'sprayable coatings for static surfaces, and designable for aviation and maritime frequencies.',
    caution: 'Trade press reporting of a commercial trial, including a later claim of up to 99 per cent '
      + 'reduction in radar interference. No measurement report was retrieved and NO figure from this '
      + 'is used as a constant in the model.',
  },
  {
    id: 'ram-lps-patents',
    title: 'Patent family on radar-absorbing material compatible with lightning protection systems',
    type: 'Patents',
    status: 'search-summary',
    supports: ['ram-lightning'],
    reports: 'Multiple granted patents specifically addressing absorbent layers, circuit-analogue '
      + 'layers and conductive ground planes in blades that also carry lightning protection. The '
      + 'existence of the family is itself the evidence that the conflict is real rather than '
      + 'incidental.',
  },
  {
    id: 'blade-transparency',
    title: 'Glass-fibre blade structure and radar transparency',
    type: 'Patent and literature summary',
    status: 'search-summary',
    supports: ['scatterer-split', 'blade construction selector'],
    reports: 'That glass-fibre composite blades can appear largely transparent to radar, with '
      + 'illumination passing through the dielectric shell, and that the load-bearing spar, commonly '
      + 'incorporating carbon fibre, is the primary structure inside it.',
  },

  // --------------------------------------------------------- propagation
  {
    id: 'itu-p526',
    title: 'Recommendation ITU-R P.526: Propagation by diffraction',
    org: 'ITU-R',
    type: 'International recommendation',
    status: 'blocked',
    supports: ['knife-edge diffraction, terrain and turbine shadowing'],
    reports: 'The single knife-edge approximation and the Fresnel-Kirchhoff parameter.',
    validation: 'Formula stated in its standard reference form and checked against two values that are '
      + 'independently known: 6.02 dB at grazing incidence, and exactly 0 dB at the v = -0.78 cut-off, '
      + 'which is why that cut-off exists. Both are asserted by the test suite.',
    caution: 'Fetch refused by the network policy. The constants were not read from the document.',
  },
  {
    id: 'albersheim1981',
    title: 'A Closed-Form Approximation to Robertson’s Detection Characteristics',
    authors: 'Albersheim, W. J.',
    venue: 'Proceedings of the IEEE, vol. 69 no. 7',
    year: 1981,
    type: 'Journal article',
    status: 'recalled',
    supports: ['detection threshold'],
    reports: 'A closed form for the single-pulse SNR required for a given probability of detection and '
      + 'false alarm after non-coherent integration, for a non-fluctuating target and linear detector.',
    validation: 'Checked against the widely reproduced case Pd = 0.9, Pfa = 1e-6, single pulse, which '
      + 'must give 13.1 dB. Asserted by the test suite.',
    caution: 'Stated validity 0.1 <= Pd <= 0.9 and 1e-7 <= Pfa <= 1e-3. The tool warns outside it.',
  },
  {
    id: 'skolnik',
    title: 'Introduction to Radar Systems',
    authors: 'Skolnik, M. I.',
    type: 'Textbook',
    status: 'recalled',
    supports: ['radar range equation', 'antenna pattern forms', 'blind speeds'],
    reports: 'Standard treatment of the monostatic radar range equation, cosecant-squared coverage, '
      + 'MTI and blind speeds.',
    validation: 'The range equation is checked against a hand-worked example in the test suite, and the '
      + 'cosecant-squared pattern against the requirement that it exactly compensates R^-4 for a '
      + 'constant-altitude target.',
  },
  {
    id: 'ament1953',
    title: 'Toward a Theory of Reflection by a Rough Surface',
    authors: 'Ament, W. S.',
    year: 1953,
    type: 'Journal article',
    status: 'recalled',
    supports: ['sea-surface multipath roughness factor'],
    reports: 'The roughness reduction factor applied to the specular reflection coefficient.',
    validation: 'The two-ray model it feeds is checked against its own limits: +12.04 dB at the lobe '
      + 'peak for a perfect mirror, and lobing washing out as the surface roughens.',
  },
  {
    id: 'pierson-moskowitz',
    title: 'Fully developed sea spectrum',
    authors: 'Pierson, W. J. and Moskowitz, L.',
    year: 1964,
    type: 'Journal article',
    status: 'recalled',
    supports: ['wave height from wind speed'],
    reports: 'Significant wave height for a fully developed sea rising with the square of wind speed.',
    caution: 'Real sites are fetch and duration limited. The tool flags derived wave heights that this '
      + 'relation makes implausible.',
  },
  {
    id: 'doe-wtrim',
    title: 'Wind Turbine Radar Interference Mitigation',
    org: 'US Department of Energy',
    type: 'Programme fact sheet',
    status: 'search-summary',
    supports: ['mitigation context'],
    reports: 'A government programme on mitigating wind turbine interference with radar.',
  },
];

export function referencesFor(findingId) {
  return REFERENCES.filter((r) => (r.supports || []).includes(findingId));
}

export function statusCounts() {
  const out = {};
  for (const r of REFERENCES) out[r.status] = (out[r.status] || 0) + 1;
  return out;
}
