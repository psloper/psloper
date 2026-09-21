// The EUROCONTROL radar surveillance Standard was read from a copy of the
// document. These tests check every quote in js/eurocontrol.js against the
// stored text, so a figure cannot be edited into the module unless the
// document actually contains it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  PROVENANCE, NO_REFERENCE_TARGET, PSR, SSR, AGREES_WITH_CAP670, VERIFICATION,
  NOT_IMPLEMENTED,
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

test('the age of the edition is declared, and supersession is declared unchecked', () => {
  assert.match(PROVENANCE.currency, /1997/);
  assert.match(PROVENANCE.currency, /NOT been checked/);
});

test('nothing in the tool is gated on this standard', () => {
  assert.ok(NOT_IMPLEMENTED.length >= 3);
  assert.match(NOT_IMPLEMENTED[0], /No calculation/);
});
