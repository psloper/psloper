// The EUROCONTROL radar surveillance Standard was read from a copy of the
// document. These tests check every quote in js/eurocontrol.js against the
// stored text, so a figure cannot be edited into the module unless the
// document actually contains it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  PROVENANCE, NO_REFERENCE_TARGET, PSR, SSR, AGREES_WITH_CAP670, VERIFICATION,
  NOT_IMPLEMENTED, SUPERSEDED,
} from '../js/eurocontrol.js';
import { PD_REQUIREMENT } from '../js/cap670.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The text layer wraps where the page did and uses typographic punctuation.
const squash = (s) => s.replace(/\s+/g, ' ').replace(/[’‘]/g, "'")
  .replace(/[“”]/g, '"').replace(/[–—]/g, '-').trim();
const doc = squash(readFileSync(resolve(root, PROVENANCE.evidence), 'utf8'));

test('the document is identified by reference and edition', () => {
  assert.ok(doc.includes(PROVENANCE.reference), 'the reference number is not in the extract');
  assert.ok(doc.includes('March 1997'));
  assert.equal(PROVENANCE.read, true);
});

test('the standard measures against real traffic, not a reference target', () => {
  assert.ok(doc.includes(squash(NO_REFERENCE_TARGET.quote)),
    'the 6.2.1.3 quote is not in the extract');
  assert.equal(NO_REFERENCE_TARGET.hasReferenceTarget, false);
  // The claim is a negative, so test the negative against the document.
  for (const word of ['Swerling', 'dBsm', 'echoing area', 'reference target', 'test target']) {
    assert.ok(!doc.toLowerCase().includes(word.toLowerCase()),
      `the extract contains "${word}": NO_REFERENCE_TARGET is now wrong`);
  }
});

test('the PSR and SSR detection figures are quoted', () => {
  assert.ok(doc.includes(squash(PSR.detection.quote)), 'PSR 6.4.2.1 quote missing');
  assert.ok(doc.includes(squash(PSR.falseTargets.quote)), 'PSR 6.4.2.2 quote missing');
  assert.ok(doc.includes(squash(SSR.detection.quote)), 'SSR 6.3.2.1 quote missing');
  assert.equal(PSR.detection.pd, 0.90);
  assert.equal(SSR.detection.pd, 0.97);
  // The numeric field and the quoted sentence must not disagree.
  assert.ok(PSR.detection.quote.includes('90 %'));
  assert.ok(SSR.detection.quote.includes('97 %'));
});

test('both headline figures are carried as recommendations, not requirements', () => {
  assert.ok(doc.includes(squash(PSR.statusQuote)), 'the 6.4.1 recommendation is missing');
  assert.equal(PSR.status, 'Recommendation');
  assert.equal(SSR.status, 'Recommendation');
  assert.equal(AGREES_WITH_CAP670.bothAreRecommendations, true);
});

test('the agreement with CAP 670 is real, not asserted', () => {
  // Check the claim against the other module rather than against prose.
  assert.equal(PSR.detection.pd, PD_REQUIREMENT.recommended.conventionalPd);
  assert.equal(SSR.detection.pd, PD_REQUIREMENT.recommended.cooperativePd);
  assert.equal(PD_REQUIREMENT.recommended.status, 'Recommendation');
});

test('every verification quote is in the document', () => {
  const quotes = [
    VERIFICATION.dataSource.quote,
    VERIFICATION.whenTestFlightsAreUsed.quote,
    VERIFICATION.sampleSize.quote,
    VERIFICATION.weatherExclusion.quote,
    VERIFICATION.reassessment.quote,
  ];
  const missing = quotes.filter((q) => !doc.includes(squash(q)));
  assert.deepEqual(missing, [], 'verification quotes not found in the extract');
  for (const c of VERIFICATION.whenTestFlightsAreUsed.cases) {
    assert.ok(doc.includes(squash(c)), `the case "${c}" is not in the extract`);
  }
  assert.equal(VERIFICATION.sampleSize.samples, 50000);
});

test('a test flight is the exception in this standard, not the method', () => {
  assert.match(VERIFICATION.whenTestFlightsAreUsed.quote, /normally be used only in two cases/);
  assert.equal(VERIFICATION.whenTestFlightsAreUsed.cases.length, 2);
  assert.match(VERIFICATION.dataSource.quote, /opportunity traffic/);
});

test('the age of the edition is declared, and the reader is pointed at the successor', () => {
  assert.match(PROVENANCE.currency, /1997/);
  assert.match(PROVENANCE.currency, /superseded/i);
  assert.match(PROVENANCE.currency, /SUPERSEDED/);
});

test('the successor is read, and its evidence exists', () => {
  // This guard used to assert the opposite: that the successor must never be
  // marked read, because at the time it had only been described to the tool.
  // The document was then supplied, so the guard inverts. Marking something
  // read still costs an evidence file that the quotes can be checked against.
  assert.equal(SUPERSEDED.readByThisTool, true);
  assert.equal(SUPERSEDED.status, 'read');
  assert.ok(existsSync(resolve(root, SUPERSEDED.evidence)),
    'SUPERSEDED claims to be read but names no stored text');
  assert.match(SUPERSEDED.module, /esassp/);
});

test('the supersession is described precisely, not loosely', () => {
  // "Superseded" is the word that was reported. The document does not use it,
  // and the module must keep saying so.
  assert.match(SUPERSEDED.precise, /does not say it supersedes/);
  assert.match(SUPERSEDED.precise, /RD 2/);
  assert.match(SUPERSEDED.effectOnThisTool, /90%/);
});

test('the correction to the PSR figure matches the document', () => {
  // The 90 in the correction must be the figure the module actually carries,
  // and the document must contain no 95% detection figure.
  assert.equal(PSR.detection.pd, 0.90);
  assert.match(SUPERSEDED.correction, /6\.4\.2\.1/);
  assert.match(SUPERSEDED.correction, /no\s+95% PSR detection figure/i);
  assert.ok(!/probability of target position detection:\s*> 95/.test(doc),
    'the document does contain a 95% PSR detection figure after all');
  assert.ok(doc.includes('probability of association'),
    'the 95% the correction points at is not in the extract');
});

test('the 90 per cent is traced forward into the current specification', () => {
  // Before the successor was read, this test checked that the tool did not
  // depend on a possibly-withdrawn document. Now that it has been read, the
  // stronger statement holds: the figure is carried into a 2024 specification.
  assert.match(SUPERSEDED.effectOnThisTool, /survives/);
  assert.match(SUPERSEDED.effectOnThisTool, /5 NM and\s+|3 NM/);
  assert.match(SUPERSEDED.effectOnThisTool, /metric is not identical/);
});

test('nothing in the tool is gated on this standard', () => {
  assert.ok(NOT_IMPLEMENTED.length >= 3);
  assert.match(NOT_IMPLEMENTED[0], /No calculation/);
});
