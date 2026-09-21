import { PROVENANCE as EC_STD, PSR as EC_PSR, SSR as EC_SSR } from './eurocontrol.js';
import { PROVENANCE as DS_STD, APPLIES_TO_THIS_TOOL as DS_APPLIES } from './defencestandards.js';
import { PROVENANCE as ES_SPEC, NON_COOPERATIVE as ES_PSR } from './esassp.js';
// Evidence register.
//
// Every model component and every screening threshold in this tool traces to
// something. This file records what, and how well.
//
// READ THE STATUS ON EACH ENTRY. It is the most important field here.
//
//   analysed       Data obtained and analysed directly in building this tool.
//                  Figures derived from it are measurements, not recall.
//   cross-checked  The document itself was NOT retrieved, but an independent
//                  implementation of the same thing was, and this tool's code
//                  was compared against it numerically. Weaker than reading the
//                  source; far stronger than recall.
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
// NOTHING IN THIS REGISTER IS MARKED "read": the environment had no general
// outbound network access to document repositories. FIVE entries are marked
// "analysed" and ONE "cross-checked". They are the only places in the tool
// where a number comes from data rather than from literature or recall:
//
//   fuhrlander-scada  1.07 million SCADA records. FIVE model assumptions about
//                     fleet behaviour were corrected against it, including the
//                     rotor speed control curve, which was 25 per cent wrong.
//   open-scada        Kelmarsh power and speed curves, recovered from saved
//                     notebook outputs on GitHub because Zenodo is blocked.
//                     Independently confirms the control curve correction.
//   kelmarsh-static   A real six-turbine layout. Two layout assumptions wrong.
//   repd-pipeline     2,489 UK wind records, current and planned, with status.
//                     Positional accuracy MEASURED against ground truth: the
//                     one testable record is 1,141 m out.
//   uk-radar-sites    55 real UK civil radar positions, from two sources that
//                     were cross-checked against each other.
//   itu-p526          The document is still unread, but both formulas taken
//                     from it now agree with the ITU's own published reference
//                     implementation to floating-point precision.
//
// All three were reachable only because they are mirrored on GitHub, which is
// the one bulk-data host this environment's network policy permits. Everything
// else attempted was refused: ITU, the CAA, NATS, Zenodo, Copernicus,
// data.gov.uk, OpenStreetMap and Overpass all return 403 on CONNECT.
//
// Formulas taken from standard references were validated against values that
// are independently known instead, which is a different kind of confidence and
// is recorded per entry under `validation`.
//
// This register exists so that a reader can tell, for any number the tool
// produces, whether it rests on something checked or something assumed.

export const STATUS_LABELS = {
  analysed: 'Data obtained and analysed directly',
  'cross-checked': 'Not retrieved, but checked against a reference implementation',
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
    id: 'defstan-00-56-part1-issue7',
    title: `${DS_STD.reference}, ${DS_STD.title}`,
    org: 'UK Ministry of Defence (DStan)',
    year: 2017,
    type: 'Defence Standard',
    // What it supports is a negative, which is still a claim the tool makes
    // and still needs a document behind it.
    supports: ['The statement that no UK Defence Standard applies to this tool'],
    status: 'read',
    reports: 'Read to answer whether a UK Defence Standard applies to this tool. It does not, '
      + 'and the reason is in its own scope. Section 1.1: "This Standard specifies the '
      + 'requirements for achieving, assuring and managing the safety of PSS defined by the '
      + 'scope of contract." It binds a Contractor for deliverables defined by an MOD '
      + 'contract, and a note at 15.1 adds that it "cannot place requirements on the MOD". '
      + 'Nothing about the subject matter of a piece of work brings it into force; a contract '
      + 'invoking it does, and this tool is a deliverable under no such contract. CAP 670 '
      + 'mentions Def Stan 00-56 exactly twice, both times in the same SW 01 Appendix A Note '
      + 'naming it as an example alongside IEC 61508 Part 1 and ARP4754, introduced by "such '
      + 'as". That is not an invocation. The EUROCONTROL radar surveillance Standard names no '
      + 'Defence Standard at all.',
    validation: 'Read from the published PDF of Part 1 Issue 7, decrypted with qpdf using an '
      + 'empty password because the file carried permissions encryption rather than a '
      + 'password. The scope, purpose, warning and the MOD note are stored at '
      + 'docs/evidence/defstan-00-56-part1-issue7-2017.txt and every quote in '
      + 'js/defencestandards.js is checked verbatim against it by '
      + 'test/defencestandards.test.mjs. The claim that the EUROCONTROL Standard mentions no '
      + 'Defence Standard is tested as a negative against its own extract. Mutation tested '
      + 'three ways, all caught: claiming the Standard applies to this tool, removing "scope '
      + 'of contract" from the quoted clause, and claiming CAP 670 invokes it.',
    caution: 'Only Part 1 was obtained. Part 2 carries the domain tailoring and compliance '
      + 'matrices that a Regulator mandates, and was not read. Whether Issue 7 of 28 February '
      + '2017 is still current was not checked, and whether any Defence Standard exists that '
      + 'is specific to wind turbine effects on radar was NOT established: dstan.mod.uk and '
      + 'asems.mod.uk are unreachable from the environment this tool was built in. If an MOD '
      + 'contract is ever in play, read the contract rather than this entry.',
  },
  {
    id: 'eurocontrol-esassp-spec-0147',
    title: `${ES_SPEC.title}, ${ES_SPEC.reference}, ${ES_SPEC.edition}`,
    org: 'EUROCONTROL',
    year: 2024,
    type: 'Specification',
    supports: ['The default probability of detection of 0.9'],
    status: 'read',
    reports: 'The current EUROCONTROL surveillance performance specification, and the '
      + 'successor to the 1997 Radar Surveillance Standard. It was put to this tool that the '
      + 'ESASSP supersedes that Standard; the document says something more precise and more '
      + 'useful. Neither volume uses the word supersede, replace or withdraw. The 1997 '
      + 'Standard is a referenced document, [RD 2], whose lessons learnt the ESASSP took into '
      + 'account, and Annex D states that its own non-cooperative requirements "are derived '
      + 'from PSR sensor requirements provided in [RD 2]". For a primary radar, Annex D is the '
      + 'live requirement set, every line of it mandatory. At 5 NM separation: '
      + ES_PSR.fiveNm.requirements.map((r) => `${r.id} ${r.performance.toLowerCase()}`).join('; ')
      + '. At 3 NM separation: '
      + ES_PSR.threeNm.requirements.map((r) => `${r.id} ${r.performance.toLowerCase()}`).join('; ')
      + `. ${ES_PSR.noTwoPointFiveNm}`,
    validation: 'Read from the published PDFs of Volumes 1 and 2 supplied by the user. The '
      + 'relevant sections are stored at '
      + 'docs/evidence/eurocontrol-esassp-spec-0147-ed1.3-2024.txt and every quote and figure '
      + 'in js/esassp.js is checked against it by test/esassp.test.mjs, including the two '
      + 'negatives: that the document never says supersede, and that no 2.5 NM non-cooperative '
      + 'requirement exists. Mutation tested three ways, all caught: claiming it says '
      + 'supersede, changing the 90% to 95%, and changing the 3 NM interval from 5 to 8 '
      + 'seconds.',
    caution: 'The 90% here is a probability of UPDATE of horizontal position within a stated '
      + 'measurement interval, assessed end to end across a whole surveillance chain. What '
      + 'this tool computes is a single-look detection probability from the radar range '
      + 'equation. The agreement with CAP 670 and with the 1997 Standard is in the number, not '
      + 'in the definition, and nothing in this tool is gated on the specification. The '
      + 'measurement interval and RMS error requirements are not modelled here at all. Volume '
      + '2 Appendices and the archived earlier editions were not read.',
  },
  {
    id: 'eurocontrol-radar-surveillance-1997',
    // Taken from the module that holds the quotes, so the register and the
    // document cannot drift apart.
    title: `${EC_STD.title}, ${EC_STD.reference}, ${EC_STD.edition}`,
    org: 'EUROCONTROL',
    year: 1997,
    type: 'Standard',
    supports: ['The default probability of detection of 0.9'],
    status: 'read',
    reports: 'Named in this tool as the document most likely to carry a reference target '
      + 'different from CAP 670\u2019s 1 square metre. It carries none. Section 6.2.1.3 requires the '
      + 'measured sample to be representative of the whole aircraft population "irrespective of '
      + 'radar cross sections", so performance is established against real traffic rather than a '
      + 'defined target. The words Swerling, dBsm, echoing area, reference target and test target '
      + 'do not appear in it. What it does set, both as Recommendations, is an overall probability '
      + `of target position detection above ${EC_PSR.detection.pd * 100}% for PSR `
      + `(${EC_PSR.detection.ref.replace('Section ', '')}) and above ${EC_SSR.detection.pd * 100}% for SSR `
      + `(${EC_SSR.detection.ref.replace('Section ', '')}), `
      + 'with fewer than 20 false target reports per antenna scan for PSR (6.4.2.2). On '
      + 'verification, 8.2.2.1 allows opportunity traffic or special test flights, and its note '
      + 'says test flights are normally used only where a special aircraft configuration is needed '
      + 'or where opportunity traffic rarely passes.',
    validation: 'Read from a .docx conversion of the published PDF supplied by the user. The '
      + 'relevant sections are stored at '
      + 'docs/evidence/eurocontrol-radar-surveillance-std-1997.txt and every quote in '
      + 'js/eurocontrol.js is checked verbatim against that file by test/eurocontrol.test.mjs. '
      + 'The absence of a reference target is tested as a negative: the test fails if the extract '
      + 'ever contains Swerling, dBsm, echoing area, reference target or test target. Mutation '
      + 'tested three ways, all caught: claiming a reference target exists, changing the PSR '
      + 'figure from 90% to 95%, and calling the Recommendation a Requirement.',
    caution: 'Edition 1.0 is dated March 1997. EUROCONTROL has since published a Specification '
      + 'for ATM Surveillance System Performance which may supersede this Standard in whole or '
      + 'in part, and that has NOT been checked: eurocontrol.int is unreachable from the '
      + 'environment this tool was built in and the later document was not supplied. Both '
      + 'headline figures are Recommendations in the document\u2019s own terms, not requirements. '
      + 'Its accuracy and false target criteria are acceptance figures for a measured radar and '
      + 'are not comparable with anything this tool predicts, so nothing here is gated on them.',
  },
  {
    id: 'cap670-sur13',
    title: 'CAP 670 Part C Section 3: SUR 13, Requirements for Implementation of Wind Turbine '
      + 'Interference Mitigation Techniques',
    org: 'UK Civil Aviation Authority',
    year: 2019,
    type: 'Regulatory requirement',
    status: 'read',
    supports: ['Mitigation approaches generally', 'line of sight analysis'],
    reports: 'The RADAR requirement, which CAP 764 points to. It places duties on an air '
      + 'navigation service provider rather than setting numbers: inform the CAA Regional '
      + 'Inspector of known wind turbine effects, conduct a Line Of Sight Analysis where there '
      + 'is reasonable doubt that turbines are likely to affect the radars, justify the chosen '
      + 'mitigation by local safety assessment, and comply with the listed interoperability, '
      + 'ICAO and CAP 670 provisions for any in-fill radar or co-operative sensor used as '
      + 'mitigation. Where clutter is tolerated, the assessment must cover its nature and '
      + 'extent, the operational significance of the area, controller ability to work in known '
      + 'clutter, and the consequences of delayed target recognition.',
    validation: 'Read in full from the same .docx copy of CAP 670 as the GEN 01 and GEN 02 '
      + 'extract. The text is stored at docs/evidence/cap670-partC-s3-sur13-2019.txt and the '
      + 'quoted line of sight duty is checked against that file by the test suite.',
    caution: 'SUR 13 contains NO radar performance thresholds, no RCS figures and no acceptance '
      + 'criteria a tool can compute against, so nothing in this tool is gated on it. The line '
      + 'of sight analysis this tool performs is the kind SUR 13.5 requires, but SUR 13 sets no '
      + 'pass or fail criterion for it, so what the tool reports is geometry, not compliance. '
      + 'Its schematics are images and were not read. Whether a later amendment supersedes the '
      + '1 August 2019 edition was not checked.',
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
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were onlinelibrary.wiley.com and downloads.hindawi.com. Each is refused by this environment\'s network egress policy, which answers 403 to CONNECT. The '
      + 'open-access aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, '
      + 'core.ac.uk, europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing '
      + 'here was read. The summary above is what a search returned about the work, and NO figure '
      + 'from it is used as a constant in the model.',
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
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were www.mdpi.com. Each is refused by this environment\'s '
      + 'network egress policy, which answers 403 to CONNECT. The open-access aggregators were tried '
      + 'as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, europepmc.org, '
      + 'scholar.archive.org and web.archive.org are blocked too. Nothing here was read. The summary '
      + 'above is what a search returned about the work, and NO figure from it is used as a constant '
      + 'in the model.',
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
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were its.bldrdoc.gov and www.ntia.gov. Each is refused by this environment\'s network egress policy, which answers 403 to CONNECT. The open-access '
      + 'aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, '
      + 'europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing here was '
      + 'read. The summary above is what a search returned about the work, and NO figure from it is '
      + 'used as a constant in the model.',
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
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were downloads.hindawi.com. Each is refused by this '
      + 'environment\'s network egress policy, which answers 403 to CONNECT. The open-access '
      + 'aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, '
      + 'europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing here was '
      + 'read. The summary above is what a search returned about the work, and NO figure from it is '
      + 'used as a constant in the model.',
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
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were onlinelibrary.wiley.com. Each is refused by this '
      + 'environment\'s network egress policy, which answers 403 to CONNECT. The open-access '
      + 'aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, '
      + 'europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing here was '
      + 'read. The summary above is what a search returned about the work, and NO figure from it is '
      + 'used as a constant in the model.',
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
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were journals.ametsoc.org. Each is refused by this '
      + 'environment\'s network egress policy, which answers 403 to CONNECT. The open-access '
      + 'aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, '
      + 'europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing here was '
      + 'read. The summary above is what a search returned about the work, and NO figure from it is '
      + 'used as a constant in the model.',
  },
  {
    id: 'marine-clutter',
    title: 'Simplified Formulae for the Estimation of Offshore Wind Turbines Clutter on Marine Radars',
    type: 'Journal article',
    status: 'search-summary',
    supports: ['marine-x radar preset', 'offshore siting'],
    reports: 'Estimation of offshore turbine clutter as seen by marine radar.',
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were onlinelibrary.wiley.com, www.mdpi.com and the '
      + 'aggregators below. Each is refused by this environment\'s network egress policy, which answers '
      + '403 to CONNECT. The open-access aggregators were tried as well, and api.openalex.org, '
      + 'api.semanticscholar.org, core.ac.uk, europepmc.org, scholar.archive.org and web.archive.org '
      + 'are blocked too. Nothing here was read. The summary above is what a search returned about '
      + 'the work, and NO figure from it is used as a constant in the model.',
  },

  // ------------------------------------------------------------- elevation
  {
    id: 'copernicus-dem-glo30',
    title: 'Copernicus DEM GLO-30 (COP-DEM_GLO-30-DGED), 30 m global digital surface model',
    org: 'European Space Agency / Copernicus programme, via AWS Open Data',
    year: 2022,
    type: 'Elevation data',
    status: 'analysed',
    supports: ['Real terrain for UK sites', 'terrain masking'],
    reports: '30 m posts globally, referenced to the EGM2008 geoid, served as Cloud Optimized '
      + 'GeoTIFF from copernicus-dem-30m.s3.amazonaws.com. 96 one-degree tiles cover the British '
      + 'Isles, 1.54 GB raw. Resampled here onto a 500 m national grid and 100 m blocks, 27.9 MB '
      + 'committed. Free, full and open under the Copernicus programme.',
    validation: 'Downloaded and read directly, then checked against published heights. Ben Nevis '
      + 'reads 1342 m against 1345 m, Scafell Pike 972 m against 978 m and Snowdon 1071 m against '
      + '1085 m; two open-water points read exactly 0.0 m and the highest cell in the Ben Nevis '
      + 'tile is 1343 m, which is right because it is the highest point in the British Isles. The '
      + 'resample MAX-POOLS rather than taking the nearest post: nearest-neighbour lost 33 m at '
      + 'Snowdon and 11 m at Scafell Pike, and under-reading a hill is the direction that makes a '
      + 'beam look as though it clears ground it does not. 34 cells out of 85.3 million read below '
      + '-20 m, which is quarries, polders and Copernicus artefacts near the Channel coast.',
    caution: 'A SURFACE model, not bare earth: it includes trees and buildings. Arguably right for '
      + 'whether a beam clears an obstruction, wrong for a turbine base ground level in forest. '
      + 'ACCURACY IS NOT PRECISION: the grid is 100 m but the position it is sampled at carries '
      + 'its own error, and the built-in UK farm positions are out by about 1,100 m. Measured '
      + 'inside that radius, ground height varies by a median of 232 m in coastal terrain, 331 m '
      + 'in rolling and 543 m in upland. Real terrain sampled at an uncertain position is a '
      + 'precise number with a large unknown error. It is worth having with surveyed positions. '
      + 'The data is pre-baked into this repository because the bucket sends no CORS headers: an '
      + 'OPTIONS preflight carrying an Origin returns 403, so a browser cannot read it directly.',
  },

  // ------------------------------------------------------ radar equipment
  {
    id: 'thales-star-ng-2023',
    title: 'STAR NG / RSM NG, Military Air Traffic Management datasheet',
    org: 'THALES LAS France, Limours Cedex',
    year: 2023,
    type: 'Manufacturer datasheet',
    status: 'read',
    supports: ['star-ng radar preset', 'What to ask a radar operator for'],
    reports: 'Scan rate from 10 to 15 RPM. Range up to 120 NM with PSR in S Band, and up to 256 NM '
      + 'with MSSR. Military Mode 1, 2, 3 and civil Mode A/C, S. ADS-B extended squitter detection '
      + 'over 360 degrees. 2000 tracks per scan. 3D detection, ECCM with frequency agility, least '
      + 'jammed frequency and jamming strobe detection. MTBCF 66000 h, availability better than '
      + '99.999 per cent, 24/7 unmanned operation. States that "STAR NG has a dedicated, and field '
      + 'proven, processing to mitigate windfarm impact", and that it can be operated under adverse '
      + 'conditions using frequency agility, a 4G/5G filter or an interference map. Compliance '
      + 'claimed against EUROCONTROL specifications and ICAO standard recommendations, with '
      + 'cybersecurity based on the NIST framework.',
    validation: 'Read in full from a saved copy of the manufacturer viewer page supplied by the user. '
      + 'The text is stored verbatim at docs/evidence/thales-star-ng-datasheet-2023-06-15.txt and '
      + 'every quoted figure in the star-ng preset is checked against that file by the test suite.',
    caution: 'A sales datasheet, not a specification. It gives NONE of the six parameters that the '
      + 'sensitivity run showed dominate the result: antenna height, azimuth beamwidth, elevation '
      + 'beamwidth, beam tilt, exact frequency and antenna gain. It gives scan rate and maximum '
      + 'range, which that run showed change the answer by 1.1 dB and 0.0 dB. The wind farm '
      + 'mitigation processing is claimed without any figure, so the preset credits it with nothing '
      + 'and the tool\'s output for this radar is an upper bound on the problem, not a prediction. '
      + 'Two pages, dated 15 June 2023; a later edition may differ.',
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
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were patents.google.com. Each is refused by this '
      + 'environment\'s network egress policy, which answers 403 to CONNECT. The open-access '
      + 'aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, '
      + 'europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing here was '
      + 'read. The summary above is what a search returned about the work, and NO figure from it is '
      + 'used as a constant in the model.',
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
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were patents.google.com. Each is refused by this '
      + 'environment\'s network egress policy, which answers 403 to CONNECT. The open-access '
      + 'aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, '
      + 'europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing here was '
      + 'read. The summary above is what a search returned about the work, and NO figure from it is '
      + 'used as a constant in the model.',
  },

  {
    id: 'kelmarsh-static',
    title: 'Kelmarsh wind farm static data: per-turbine position, hub height and ground level',
    authors: 'Cubico Sustainable Investments, via charlie9578/CubicoOpenData',
    type: 'Open dataset, CC BY 4.0, recovered from a notebook cell output',
    status: 'analysed',
    supports: ['layout irregularity', 'mixed hub heights', 'uniform-hub-height finding'],
    reports: 'Six Senvion MM92, 2050 kW, 92 m rotor. Latitude, longitude, ground elevation, hub '
      + 'height and commercial operations date for each machine.',
    validation: 'TWO LAYOUT ASSUMPTIONS WERE CORRECTED AGAINST IT. (1) Spacing. Nearest-neighbour '
      + 'distances run from 2.94 to 4.29 rotor diameters, a max/min ratio of 1.46. The layout '
      + 'generator was producing 1.10 at its default jitter of 60 m, which is far tidier than the one '
      + 'real array available. The default is now 210 m, which reproduces 1.46. (2) Hub height. TWO OF '
      + 'THE SIX MACHINES ARE 10 m LOWER than the other four, at 68.5 m against 78.5 m. The model had '
      + 'no way to express that at all. Combined with ground levels spanning 21.5 m, the real array '
      + 'spans 31.5 m in tip height above sea level, against about 8 m from the model. Tip height '
      + 'above sea level is exactly what decides which machines clear a horizon, so that understated '
      + 'how mixed the visibility across a real farm is by a factor of about four.',
    caution: 'ONE FARM, SIX TURBINES. That is thin evidence for a default, and the spacing figure is '
      + 'fitted to it. The magnitude of the hub-height difference is site specific, so the tool does '
      + 'NOT invent one: the hub-height spread defaults to zero and the tool raises a finding saying '
      + 'the assumption is known to be wrong at real sites. The remaining gap in tip-height spread, '
      + '31.5 m measured against about 17 m modelled with a 10 m hub spread, is synthetic terrain '
      + 'being too flat at farm scale. Import real terrain rather than tuning that to one farm.',
    source: 'https://github.com/charlie9578/CubicoOpenData',
  },

  {
    id: 'cap670',
    title: 'CAP 670 Part B Section 4: GEN 01, GEN 02 and Appendix A to GEN 02',
    org: 'UK Civil Aviation Authority',
    year: 2019,
    type: 'Regulatory requirement',
    status: 'read',
    supports: ['CAP 670 GEN 02 zonal check for ATC radio sites'],
    reports: 'A wind turbine assessment for ATC RADIO sites. Turbine classification by hub '
      + 'height, rotor diameter and tip height (Table 1), zonal thresholds by distance and by '
      + 'the elevation angle of the hub above the site base level (Table 2), and a nine-cell '
      + 'matrix combining the two (Table 3). A process flow routes to a carrier-to-interference '
      + 'method when the tip exceeds 110 m AGL, there are more than 10 turbines, or the zone is '
      + 'Amber. C/I thresholds of 20 dB for a single turbine, 23 dB for the worst of several and '
      + '14 dB aggregate, with coverage plot field strength limits of 26 dBuV/m VHF and '
      + '35 dBuV/m UHF at 127 and 368 MHz. Radar cross sections per class in Tables 4 and 5, '
      + 'with a scaling formula from a 23281 m2 reference turbine at 90 m rotor and 461 MHz. '
      + 'GEN 01 gives a 20 km consultation radius, 34 km for ILS approaches, and a visual '
      + 'horizon allowance from 25 m above the site.',
    validation: 'Read in full from a .docx copy of CAP 670, Third Issue, Amendment 1/2019, '
      + 'effective 1 August 2019, supplied on 2026-09-19. The text is stored at '
      + 'docs/evidence/cap670-partB-s4-gen01-gen02-2019.txt and every figure and quote in '
      + 'js/cap670.js is checked against that file by the test suite. Reading it corrected four '
      + 'things this tool previously printed: the green distance thresholds for Small, Medium, '
      + 'Large and Reference, which are EMPTY cells in Table 2 and were not figures at all; the '
      + 'angle, which is the elevation of the turbine hub above the radio site base level, not '
      + 'the angular subtense this tool had inferred; Table 3, where four of eight inferred '
      + 'cells were harsher than the document; and Table 1, which is now implemented from the '
      + 'published bands instead of inferred from rotor diameter.',
    caution: 'GEN 02 COVERS ATC RADIO SITES, NOT RADAR. The radar requirement is SUR 13, listed '
      + 'separately. Figure 3 and the Appendix A process flow chart are IMAGES and were not '
      + 'read, so the reported inversion of the last flow chart decision box is still '
      + 'unresolved; the conservative reading is implemented. Two further things are not '
      + 'implemented: a Green distance verdict for four of the five classes, because Table 2 '
      + 'leaves those cells empty, and any C/I ratio, because the source requires that work be '
      + 'done by a suitably qualified consultancy and this tool has no validated propagation '
      + 'model for a radio site. One contradiction is implemented as printed rather than '
      + 'resolved: Table 3 turns a Red distance with a Green angle into an overall Green, while '
      + 'the Red zone is defined as an automatic rejection. One internal inconsistency was found '
      + 'by running the document\'s own scaling formula against its own tables: four of five '
      + 'classes scale exactly from the top of their Table 1 rotor band, but the Large class '
      + 'figures correspond to a 55 m rotor against a published band top of 60 m, a gap of '
      + '0.75 dB identical in both bands. The published values are used as printed. Whether a '
      + 'Supplementary Amendment supersedes this edition was not checked.',
  },

  // ------------------------------------------------- real UK site positions
  {
    id: 'repd-pipeline',
    title: 'UK Renewable Energy Planning Database, wind records',
    authors: 'Department for Energy Security and Net Zero (Crown copyright)',
    type: 'Open Government Licence v3, reached through a third-party snapshot',
    status: 'analysed',
    supports: ['real UK wind farm positions', 'current and planned projects', 'the UK site picker'],
    reports: '2,489 wind records with valid geometry, each with latitude, longitude, capacity, '
      + 'planning authority, offshore or onshore, and a DEVELOPMENT STATUS. 832 operational '
      + '(31,519 MW), 44 under construction (13,883 MW), 220 awaiting construction (38,017 MW) and '
      + '179 with an application submitted (28,900 MW), for 1,275 current or planned projects '
      + 'totalling 89,199 MW. 85 of those are offshore. The snapshot contains Hornsea 3 and 4, '
      + 'Dogger Bank A to D, Berwick Bank, Morgan and Mona, so it is current rather than historical.',
    validation: 'THE POSITIONAL ACCURACY WAS MEASURED AT TWO SITES, NOT ASSUMED, AND THE TWO AGREE. '
      + '(1) Kelmarsh, whose six turbine positions were recovered from the Zenodo static table. The '
      + 'array centroid is 52.401461, -0.943105, the array radius is 483 m and its longest span is '
      + '935 m. The REPD record sits 1,140 m from the centroid, 695 m from the NEAREST turbine and '
      + '1,623 m from the furthest, so the whole array lies between 0.7 and 1.6 km from the recorded '
      + 'point, and the error is 2.4 times the radius of the thing being located. (2) Penmanshiel, '
      + 'for which two unrelated third parties publish a turbine coordinate: the REPD record is '
      + '1,121 m from one and 1,289 m from the other, while those two differ from each other by only '
      + '188 m. Two unrelated sites, both out by about 1.1 km, which is why this tool now carries '
      + 'POSITION_UNCERTAINTY_M = 1100 as a measured quantity rather than a quoted one. '
      + 'INDEPENDENCE WAS CHECKED BEFORE TREATING AGREEMENT AS CONFIRMATION. The WRI Global Power '
      + 'Plant Database, which this dataset replaced, records per row that its coordinate came from '
      + 'the REPD: 771 of its 780 UK wind rows carry geolocation_source = "UK Renewable Energy '
      + 'Planning Database". That is documentary, not inferred. The agreement between them is '
      + 'accordingly bimodal: of 531 exact name matches, 96.6 per cent agree within 10 m, NONE fall '
      + 'between 10 m and 100 m, and the remaining 3.4 per cent are name collisions. A continuous '
      + 'spread would mean two measurements of one place; a gap like that means one measurement '
      + 'copied twice.',
    caution: 'ONE GROUND-TRUTH MEASUREMENT IS NOT AN ERROR DISTRIBUTION. The 1,141 m figure is a '
      + 'single measured case, consistent with the roughly 1 km the REPD is generally described as '
      + 'carrying, and is quoted as such rather than as a bound. Coordinates are written to five '
      + 'decimal places, which is PRECISION AND NOT ACCURACY. Each row is one planning record with '
      + 'one point, so NO LAYOUT can be taken from it, and 88 of the records carry planning-process '
      + 'wording in their names: resubmission, revised application, extension, repowering. TWO '
      + 'THIRDS OF THE TABLE WILL NOT BE BUILT AS RECORDED, so any total that does not filter on '
      + 'status overstates the fleet roughly threefold. data.gov.uk is refused by this environment, '
      + 'so the official download was not used; the snapshot is a third-party rendering whose '
      + 'currency depends on when its author last refreshed it, and the mirroring repository '
      + 'declares no licence of its own.',
    source: 'https://github.com/Ventusltd/globalgrid2050',
  },
  {
    id: 'uk-radar-sites',
    title: 'UK civil radar site positions, merged from two community aviation data sets',
    authors: 'VATSIM-UK/UK-Sector-File; open-air-data/atc-radar',
    type: 'Community data sets. The second is ODbL; the first declares no licence.',
    status: 'analysed',
    supports: ['real UK radar positions', 'the UK site picker'],
    reports: '17 NATS En Route surveillance sites and 32 aerodrome sites from the sector file, and 23 '
      + 'features inside the UK and Ireland box from the ODbL set. Merged on position rather than name, '
      + 'because the two sets name the same sites differently: Sandwick and Stornoway are the same '
      + 'installation 10 m apart, and Allanshill is also spelled Alanshill. 55 distinct sites result, '
      + '17 of them carried by both sources.',
    validation: 'THE TWO SOURCES WERE CROSS-CHECKED AGAINST EACH OTHER, which is the only independent '
      + 'check available here. Of the 17 sites both carry, the median positional disagreement is 1,416 '
      + 'm and the maximum 5,891 m (Tiree). Claxby agrees to 3 m and Great Dun Fell to 173 m; Cromer, '
      + 'Burrington, St Annes and Clee Hill all disagree by more than 2.6 km. Re-running the screening '
      + 'with every dual-sourced site moved to its alternative position changes the count of farms '
      + 'within 30 km from 278 to 280, and the count in smooth-earth line of sight from 647 to 646. So '
      + 'the disagreement barely moves an aggregate and matters a great deal to an individual close '
      + 'pairing.',
    caution: 'NEITHER SOURCE IS OFFICIAL. Both are maintained by hobbyist communities, one for flight '
      + 'simulation. The sector file also carries numeric columns that look like site elevation, and '
      + 'those were NOT used: Great Dun Fell is given as 1,428 ft where the summit it stands on is '
      + 'about 2,780 ft, so the column means something other than what it appears to. Only the '
      + 'coordinates are used. NO MILITARY RADAR IS IN EITHER SOURCE: the sector file marks that '
      + 'section with the literal line ";Mil Radars TBA". MOD safeguarding of air defence radar is what '
      + 'most often decides a real UK wind farm application, and this tool carries none of it. '
      + 'nats.aero and caa.co.uk are both blocked from this environment, so no official list was '
      + 'obtainable.',
  },

  // --------------------------------------------------------- fleet behaviour
  {
    id: 'fuhrlander-scada',
    title: 'Fuhrl\u00e4nder FL2500 2.5 MW wind farm SCADA dataset',
    authors: 'Blanco-M, A.',
    type: 'Open dataset, Eclipse Public License v2.0',
    status: 'analysed',
    supports: ['fleet-stopped', 'fleet-spread', 'rotor speed floor',
      'yaw scatter shape and systematic offsets', 'stoppage clustering'],
    reports: 'Five turbines, 2012 to 2014, five-minute resolution, 78 sensors reported as min, max, '
      + 'mean and standard deviation. 1.07 million records analysed here, covering nacelle position, '
      + 'wind direction, wind speed, rotor speed, active power and availability.',
    validation: 'FOUR MODEL ASSUMPTIONS WERE CORRECTED AGAINST IT. (1) Rotor speed does not fall '
      + 'proportionally to zero below rated: a running machine holds a floor near 60 per cent of '
      + 'rated, measured at a median 8.8 rpm against 14.6 rated in 3 to 4 m/s wind, where the previous '
      + 'proportional model predicted 5.1. The model understated low-wind blade Doppler by about 40 '
      + 'per cent. (2) Yaw scatter is peaked near zero with a tail, not uniform across a deadband: '
      + 'pairwise difference between well-behaved machines had a median of 7.3 degrees and a 99th '
      + 'percentile of 32. (3) Machines carry PERSISTENT nacelle reference offsets from each other, up '
      + 'to 35 degrees between well-behaved machines generating in the same wind, and 61 degrees '
      + 'including an anomalous one, so a fleet does not share one rotor aspect even in steady wind. '
      + '(4) Stoppages cluster rather than occurring independently: all five ran 61.3 per cent of the '
      + 'time against 53.5 per cent under independence, and all five were stopped together 0.56 per '
      + 'cent of the time against essentially never under independence.',
    caution: 'ONE SITE, FIVE TURBINES, ONE MACHINE TYPE, AND NO COORDINATES, so the wake model could '
      + 'not be tested at all. The measured 12.2 per cent of operating-wind time stopped is far above '
      + 'the 2 to 3 per cent unavailability often quoted, but those are different questions: this '
      + 'counts every reason a rotor was still while the wind was usable. One of the five machines was '
      + 'plainly anomalous in yaw and is reported separately rather than averaged in. Penmanshiel and '
      + 'Kelmarsh, which have coordinates and would allow the wake model to be tested, are on Zenodo '
      + 'and could not be reached from this environment.',
  },
  {
    id: 'jensen-park',
    title: 'The Jensen (Park) wake model',
    type: 'Engineering model, widely reproduced',
    status: 'search-summary',
    supports: ['fleet-spread', 'wake deficits across the array'],
    reports: 'Wake velocity deficit taken as uniform across a wake expanding linearly downstream at a '
      + 'decay rate k, with the deficit falling as the wake widens and the speed recovering '
      + 'asymptotically to free stream. Wake expansion rate conventionally 0.075 onshore and 0.04 '
      + 'offshore.',
    caution: 'A deliberately simple engineering model. It assumes a top-hat deficit profile and does '
      + 'not represent wake meandering, added turbulence or blockage.',
  },
  {
    id: 'yaw-deadband',
    title: 'Yaw control deadbands and wake steering in operating wind farms',
    type: 'Literature summary',
    status: 'search-summary',
    supports: ['fleet-spread', 'yaw scatter across the array'],
    reports: 'That yaw control uses a deadband, with a manoeuvre triggered only once the yaw error '
      + 'exceeds a threshold, so machines sit scattered around the wind rather than on it. That wake '
      + 'steering deliberately misaligns upstream turbines, with field campaigns using misalignments '
      + 'of around 20 degrees. That simulations driven by SCADA-measured yaw distributions differ from '
      + 'those using ideal yaw settings.',
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were arxiv.org and core.ac.uk. Each is refused by this '
      + 'environment\'s network egress policy, which answers 403 to CONNECT. The open-access '
      + 'aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, '
      + 'europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing here was '
      + 'read. The summary above is what a search returned about the work, and NO figure from it is '
      + 'used as a constant in the model.',
  },
  {
    id: 'availability',
    title: 'Onshore wind turbine availability and downtime causes',
    type: 'Literature summary',
    status: 'search-summary',
    supports: ['fleet-stopped'],
    reports: 'Availability of many turbines in use today around 98 per cent, with roughly seven days '
      + 'of annual downtime for a well-maintained onshore machine. Available time decomposed into '
      + 'generating, grid-unavailable, broken down, under maintenance and idle for insufficient wind. '
      + 'Faults concentrated in electrical systems, control systems and sensors, with the longest '
      + 'downtimes in gearbox, electrical, control and yaw systems.',
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were arxiv.org and core.ac.uk. Each is refused by this '
      + 'environment\'s network egress policy, which answers 403 to CONNECT. The open-access '
      + 'aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, '
      + 'europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing here was '
      + 'read. The summary above is what a search returned about the work, and NO figure from it is '
      + 'used as a constant in the model.',
  },
  {
    id: 'open-scada',
    title: 'Open per-turbine SCADA datasets: Penmanshiel, Kelmarsh, La Haute Borne',
    type: 'Open datasets',
    status: 'analysed',
    supports: ['rotor speed control curve', 'layout irregularity', 'mixed hub heights',
      'validating fleet behaviour against real operation'],
    reports: 'Ten-minute SCADA and event data per turbine, with coordinates, rated power, rotor '
      + 'diameter and hub height. Penmanshiel: 14 Senvion MM82 turbines, 2016 to mid-2021. Kelmarsh: '
      + '6 Senvion MM92 turbines, 2016 to end 2024. Both released by Cubico Sustainable Investments '
      + 'under CC-BY-4.0 on Zenodo. La Haute Borne: 4 Senvion MM82 turbines, 2012 to 2018, with wind '
      + 'speed, wind direction, rotor speed and active power per turbine.',
    validation: 'ZENODO IS BLOCKED, SO THE DATASETS THEMSELVES WERE NOT DOWNLOADED. What was reachable '
      + 'is charlie9578/CubicoOpenData on GitHub, a set of notebooks by the person who published the '
      + 'data, whose SAVED CELL OUTPUTS carry real Kelmarsh data. Three things came out of it. (1) The '
      + 'static table: six Senvion MM92, 2050 kW, 92 m rotor, latitude, longitude, ground elevation '
      + 'and hub height per machine. (2) Power against wind speed, binned, per machine, 0 to 6.85 m/s. '
      + '(3) Power against generator speed, binned, per machine. Composing (2) and (3) gives the '
      + 'generator speed the machines actually run at by wind speed. THAT COMPOSED CURVE, CROSS-CHECKED '
      + 'AGAINST THE FUHRLANDER DATASET, OVERTURNED THE CONTROL CURVE IN THIS MODEL: see the '
      + 'fuhrlander-scada entry. The static table also contradicted two layout assumptions, recorded '
      + 'under kelmarsh-static.',
    caution: 'CELL OUTPUTS, NOT THE DATASET. Everything here is what happened to be saved in somebody '
      + 'else\u2019s notebook, so it is a small and arbitrary slice: six turbines, wind speeds only up '
      + 'to 6.85 m/s, and generator speed rather than rotor speed. The generator-speed bins start at '
      + '800 rpm because that is where the notebook\u2019s bin range starts, so anything slower was '
      + 'discarded before plotting and the measured minimum is censored. No time series, no yaw, no '
      + 'availability, and nothing at all from Penmanshiel or La Haute Borne. zenodo.org and doi.org '
      + 'are both refused by this environment.',
    source: 'https://github.com/charlie9578/CubicoOpenData',
  },

  // --------------------------------------------------------- propagation
  {
    id: 'itu-p526',
    title: 'Recommendation ITU-R P.526: Propagation by diffraction',
    org: 'ITU-R',
    type: 'International recommendation',
    status: 'cross-checked',
    supports: ['knife-edge diffraction, terrain and turbine shadowing'],
    reports: 'The single knife-edge approximation and the Fresnel-Kirchhoff parameter.',
    validation: 'THE DOCUMENT IS STILL UNREAD, BUT THE CODE NO LONGER RESTS ON RECALL. The same '
      + 'knife-edge approximation appears as equation (13) of Recommendation ITU-R P.452, and the '
      + 'ITU-R Study Group 3 reference implementation of P.452 is published as open source at '
      + 'eeveetza/Py452 on GitHub, which this environment can reach. Both formulas here were compared '
      + 'against that code directly. The knife-edge loss agrees to 7e-15 dB, which is floating-point '
      + 'rounding, over the whole range -3 <= v <= 6. The Fresnel-Kirchhoff parameter agrees to 2e-16 '
      + 'relative across five geometries after unit conversion, ITU writing distances in km and this '
      + 'tool in metres. Both comparisons reproduce the ITU code line for line in the test suite. Note '
      + 'that the approximation gives 6.0329 dB at grazing incidence, not the exact 6.02 dB of the '
      + 'underlying theory; the register previously quoted the exact value for the approximation.',
    caution: 'P.526 ITSELF WAS NOT RETRIEVED. itu.int. Each is refused by this environment. What was checked '
      + 'is an ITU-authored implementation of the same equation as it appears in a different '
      + 'Recommendation. If P.452 and P.526 state the formula differently, this check would not show '
      + 'it. The Fresnel-Kirchhoff parameter was matched against P.452 equation (20), which is a '
      + 'Bullington-point form, not against P.526 directly.',
    source: 'https://github.com/eeveetza/Py452',
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
    caution: 'RETRIEVAL WAS ATTEMPTED AND REFUSED. The hosts tried were www.nrel.gov and www.osti.gov. Each is refused by this '
      + 'environment\'s network egress policy, which answers 403 to CONNECT. The open-access '
      + 'aggregators were tried as well, and api.openalex.org, api.semanticscholar.org, core.ac.uk, '
      + 'europepmc.org, scholar.archive.org and web.archive.org are blocked too. Nothing here was '
      + 'read. The summary above is what a search returned about the work, and NO figure from it is '
      + 'used as a constant in the model.',
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
