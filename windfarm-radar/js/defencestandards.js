// Does a UK Defence Standard apply to this tool?
//
// Asked directly, and the answer turns on how a Def Stan comes to apply at
// all. It is not a standard you comply with because of what you are building.
// It is a standard that binds a Contractor through the scope of an MOD
// contract, and its own Scope section says so.
//
// Read from Defence Standard 00-056 Part 1 Issue 7, obtained as the published
// PDF. Quotes are checked verbatim against
// docs/evidence/defstan-00-56-part1-issue7-2017.txt by
// test/defencestandards.test.mjs.

export const PROVENANCE = {
  read: true,
  title: 'Safety Management Requirements for Defence Systems, Part 1: Requirements',
  reference: 'Defence Standard 00-056 Part 1 Issue 7',
  date: '28 February 2017',
  org: 'UK Ministry of Defence (DStan)',
  evidence: 'docs/evidence/defstan-00-56-part1-issue7-2017.txt',
  howObtained: 'Published PDF, decrypted with qpdf using an empty password because the file '
    + 'carried permissions encryption rather than a password, then text pulled from its '
    + 'content streams. Only the scope, purpose, warning and the MOD note were extracted; '
    + 'the body of the requirements was not.',
};

// The clause that answers the question.
export const APPLICABILITY = {
  ref: 'Section 1.1',
  quote: 'This Standard specifies the requirements for achieving, assuring and managing the '
    + 'safety of PSS defined by the scope of contract.',
  // PSS is the Standard's own term.
  pss: 'Products, Services and/or Systems',
  purposeRef: 'Section 0.1',
  purposeQuote: 'The purpose of this Standard is to support acquisition organisations '
    + 'delivery of ESL&S by setting Safety Requirements on Contractors that enable '
    + 'procurement of Products, Services and/or Systems (PSS) that are compliant with safety '
    + 'legislation and regulations and with MOD safety and acquisition policy.',
  bindsContractorNotMod: {
    ref: 'Section 15.1, Note iii',
    quote: 'This Standard cannot place requirements on the MOD.',
  },
  plainReading: 'It binds a Contractor, for deliverables defined by the scope of a contract. '
    + 'Nothing about the subject matter of a piece of work brings it into force. An MOD '
    + 'contract invoking it does.',
};

// Whether this tool is in scope, answered rather than left open.
export const APPLIES_TO_THIS_TOOL = {
  applies: false,
  because: 'This tool is not a deliverable under any MOD contract. It is a screening tool for '
    + 'civil wind farm and radar work, written outside the defence acquisition process. With no '
    + 'contract to define the PSS, Section 1.1 has nothing to attach to.',
  wouldChangeIf: 'An MOD contract, for example through DE&S or the Defence Infrastructure '
    + 'Organisation, named this tool or its output as a deliverable and invoked the Standard. '
    + 'The contract would then decide which parts apply, and Part 2 carries the domain '
    + 'tailoring and compliance matrices that a Regulator mandates. Read the contract, not '
    + 'this note.',
  doNotInfer: 'The fact that a wind farm may affect a military radar does not put this tool '
    + 'under a Def Stan. Those are different things: one is the subject being modelled, the '
    + 'other is a contractual regime over a deliverable.',
};

// What the civil documents actually say about Def Stans, checked rather than
// assumed. Both were read in full elsewhere in this tool.
export const CIVIL_DOCUMENTS = {
  cap670: {
    mentions: 2,
    ref: 'CAP 670 SW 01 Appendix A, the Notes at SW01A.16 and SW01A.22',
    quote: 'This document assumes that software safety requirements have been derived from a '
      + 'full risk and safety analysis of the system. This will have established the overall '
      + 'safety requirements that have been refined and allocated in the design to software. '
      + 'This is a commonplace system safety process and is described in standards and '
      + 'guidelines such as IEC 61508 Part 1, ARP4754, Def Stan 00-56.',
    reading: 'Both mentions are the same Note, and both name Def Stan 00-56 as an EXAMPLE, '
      + 'alongside IEC 61508 Part 1 and ARP4754, introduced by "such as". CAP 670 does not '
      + 'invoke it, require it, or prefer it.',
  },
  eurocontrol: {
    mentions: 0,
    reading: 'The EUROCONTROL radar surveillance Standard names no Defence Standard, no '
      + 'Ministry of Defence and no military requirement anywhere.',
  },
};

// The requirement that WOULD bite, if any did. Worth naming because it is the
// one a reader is usually reaching for when they ask this question.
export const THE_CIVIL_EQUIVALENT = {
  ref: 'CAP 670 SW 01, SW01.8',
  quote: 'This document applies to any ATS system where the Software is needed to fulfil a '
    + 'system safety requirement.',
  reading: 'SW 01 is the CAA’s software safety assurance requirement. It is what applies to '
    + 'software inside a UK air traffic services system, and it is the thing to look at if '
    + 'anyone ever proposes putting output from a tool like this inside an ANSP safety case. '
    + 'It does not apply to this tool as it stands: this is not an ATS system and none of its '
    + 'software fulfils a system safety requirement.',
  alsoNote: 'CAP 670 SW01.12 makes the same point from the other side: it assumes software '
    + 'safety requirements have already been derived from a full system risk and safety '
    + 'analysis. This tool performs no such analysis and produces no such requirements.',
};

export const NOT_CHECKED = [
  'The current DStan catalogue. Whether a Defence Standard exists that is specific to wind '
    + 'turbine effects on radar has NOT been established: dstan.mod.uk and asems.mod.uk are '
    + 'unreachable from the environment this tool was built in.',
  'Def Stan 00-056 Part 2, which carries the domain tailoring and compliance matrices. Only '
    + 'Part 1 was obtained.',
  'Whether Issue 7 of 28 February 2017 is still the current issue.',
  'MOD safeguarding procedure for air defence radar, which is a planning process run by the '
    + 'Defence Infrastructure Organisation and is not a Defence Standard at all. This tool '
    + 'excludes military radar and says so; the safeguarding route itself is not verified here.',
];
