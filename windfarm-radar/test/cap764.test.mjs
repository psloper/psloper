// CAP 764 has now been read, but as a CONSULTATION DRAFT. These tests check
// every quote against the stored text and, as importantly, keep the draft
// status visible: a draft is not policy, and the published Sixth Edition has
// not been read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  PROVENANCE, CONSULTATION, ON_MODELLING, MITIGATION_STATUS, LIGHTING, ADLS,
  NOT_IN_THIS_DRAFT,
} from '../js/cap764.js';
import { SUR13_MITIGATION, TEST_TARGET } from '../js/cap670.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const squash = (s) => s.replace(/\s+/g, ' ').replace(/[’‘]/g, "'")
  .replace(/[“”]/g, '"').replace(/[–—]/g, '-').trim();
const doc = squash(readFileSync(resolve(root, PROVENANCE.evidence), 'utf8'));

test('the draft is stored, and its draft status is unmistakable', () => {
  assert.ok(existsSync(resolve(root, PROVENANCE.evidence)));
  assert.equal(PROVENANCE.isDraft, true);
  assert.equal(PROVENANCE.status, 'draft-read');
  assert.match(PROVENANCE.publicationDate, /to be inserted/);
  assert.match(PROVENANCE.publishedEdition, /NOT read/);
  // The cover wording is what makes it a draft, so it has to be in the stored text.
  assert.ok(doc.includes('publication date to be inserted'));
});

test('every consultation distance is quoted, and the tier list is complete', () => {
  assert.ok(doc.includes(squash(CONSULTATION.radarQuote)), 'the 30 km quote is not in the extract');
  assert.ok(doc.includes(squash(CONSULTATION.preambleQuote)), 'the 3.4 preamble is missing');
  assert.ok(doc.includes(squash(CONSULTATION.offshore.quote)), 'the 9 NM quote is missing');
  // Each tier must appear in the document with its distance and its subject.
  for (const t of CONSULTATION.tiers) {
    assert.ok(new RegExp(`${t.km} km`).test(doc), `${t.km} km is not in the extract`);
  }
  assert.deepEqual(CONSULTATION.tiers.map((t) => t.km), [30, 17, 5, 4]);
  // The preamble is the thing most often dropped when this is summarised.
  assert.match(CONSULTATION.preambleQuote, /not definitive/);
  assert.match(CONSULTATION.radarQuote, /can be far greater than 30 km/);
});

test('the 10 km in this draft is about gliding, not secondary radar', () => {
  assert.match(CONSULTATION.glidingNote, /British Gliding Association/);
  const ssr = NOT_IN_THIS_DRAFT.find((n) => /secondary surveillance/i.test(n.figure));
  assert.ok(ssr, 'the SSR attribution correction is no longer recorded');
  assert.match(ssr.finding, /SUR 13A\.75/);
});

test('the CAA position on modelling tools and standard RCS is quoted', () => {
  assert.ok(doc.includes(squash(ON_MODELLING.quote)), 'the 2.17 quote is not in the extract');
  assert.match(ON_MODELLING.quote, /does not endorse any one specific radar modelling tool/);
  // The document puts 'standard' in typographic quotes, so compare on the
  // normalised form rather than writing curly quotes into a regex.
  assert.match(squash(ON_MODELLING.quote), /can a 'standard' RCS be identified/);
  assert.match(ON_MODELLING.appliesToThisTool, /Directly/);
});

test('the document does not call any mitigation approved', () => {
  assert.equal(MITIGATION_STATUS.usesTheWordApprovedOfMitigations, false);
  assert.ok(doc.includes(squash(MITIGATION_STATUS.whatItSaysQuote)));
  assert.ok(doc.includes(squash(MITIGATION_STATUS.defersToCap670Quote)));
  // The reading must rest on the CAP 670 quote as that module actually carries
  // it, not on a paraphrase.
  assert.ok(MITIGATION_STATUS.reading.includes(
    'must not be regarded as mitigations that are recommended or endorsed by the CAA'));
  assert.ok(SUR13_MITIGATION.notEndorsed.quote.includes(
    'must not be regarded as mitigations that are recommended or endorsed by the CAA'));
});

test('the lighting duty is traced to the Air Navigation Order, not to CAP 764', () => {
  assert.match(LIGHTING.dutyFrom, /Air Navigation Order 2016/);
  assert.ok(doc.includes(squash(LIGHTING.dutyQuote)));
  assert.ok(doc.includes(squash(LIGHTING.measuredFromTipQuote)));
  assert.ok(doc.includes(squash(LIGHTING.nacelleQuote)));
  assert.equal(LIGHTING.thresholdM, 150);
  // The tool measures tip height for safeguarding; the document says the
  // trigger is tip height. If that ever diverges, this catches it.
  assert.match(LIGHTING.measuredFromTipQuote, /tip of the blades/);
});

test('ADLS is recorded as optional, fail-safe and barred near aerodromes', () => {
  assert.equal(ADLS.mandatory, false);
  assert.ok(doc.includes(squash(ADLS.notNearAerodromesQuote)));
  assert.ok(doc.includes(squash(ADLS.failSafeQuote)));
  assert.match(ADLS.failSafeQuote, /default position for an ADLS is to have the obstacle lights switched on/);
});

test('the 1 square metre target appears here too, and matches CAP 670', () => {
  assert.ok(doc.includes(squash(ADLS.oneSquareMetreTarget.quote)));
  assert.equal(ADLS.oneSquareMetreTarget.rcsM2, TEST_TARGET.rcsM2);
  // Same size, different application. The module must say so rather than
  // letting a reader merge the two.
  assert.match(ADLS.oneSquareMetreTarget.note, /different application/);
});
