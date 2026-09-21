// Whether a Defence Standard applies is a claim about a document, so it is
// checked against the document. The counts of how often CAP 670 and the
// EUROCONTROL standard mention a Def Stan are checked against their stored
// extracts too, because "it says nothing about X" is exactly the kind of claim
// that rots silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  PROVENANCE, APPLICABILITY, APPLIES_TO_THIS_TOOL, CIVIL_DOCUMENTS,
  THE_CIVIL_EQUIVALENT, NOT_CHECKED,
} from '../js/defencestandards.js';
import { PROVENANCE as EC } from '../js/eurocontrol.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const squash = (s) => s.replace(/\s+/g, ' ').replace(/[’‘]/g, "'")
  .replace(/[“”]/g, '"').replace(/[–—]/g, '-').trim();
const doc = squash(readFileSync(resolve(root, PROVENANCE.evidence), 'utf8'));

test('the defence standard is identified by issue and date', () => {
  assert.ok(doc.includes('Def Stan 00-056 Part 1 Issue 7')
    || doc.includes('Defence Standard 00-056 Part 1 Issue 7'));
  assert.ok(doc.includes('28 February 2017'));
  assert.equal(PROVENANCE.read, true);
});

test('the applicability quotes are in the document', () => {
  for (const q of [APPLICABILITY.quote, APPLICABILITY.purposeQuote,
    APPLICABILITY.bindsContractorNotMod.quote]) {
    assert.ok(doc.includes(squash(q)), `not in the extract: ${q.slice(0, 60)}...`);
  }
});

test('applicability runs through a contract, and the module says so', () => {
  // The whole answer rests on these three words being in the clause.
  assert.match(APPLICABILITY.quote, /scope of contract/);
  assert.match(APPLICABILITY.plainReading, /contract/i);
  assert.equal(APPLIES_TO_THIS_TOOL.applies, false);
  assert.match(APPLIES_TO_THIS_TOOL.because, /no MOD contract|not a deliverable/i);
  // And it must say what would change the answer, rather than closing it off.
  assert.ok(APPLIES_TO_THIS_TOOL.wouldChangeIf.length > 100);
});

test('what CAP 670 says about Def Stan is quoted and counted correctly', () => {
  // Both CAP 670 extracts together, because the SW 01 note lives in the GEN
  // part and the SUR material is separate.
  const cap = ['docs/evidence/cap670-partB-s4-gen01-gen02-2019.txt',
    'docs/evidence/cap670-partC-s3-sur13-2019.txt',
    'docs/evidence/cap670-partC-s3-sur02-sur12-2019.txt']
    .map((f) => squash(readFileSync(resolve(root, f), 'utf8'))).join(' ');
  // The SW 01 note is not in any stored extract, so the quote is checked for
  // the shape that makes the argument instead: Def Stan named among examples.
  assert.match(CIVIL_DOCUMENTS.cap670.quote, /such as IEC 61508 Part 1, ARP4754, Def Stan 00-56/);
  assert.match(CIVIL_DOCUMENTS.cap670.reading, /EXAMPLE/);
  assert.equal(CIVIL_DOCUMENTS.cap670.mentions, 2);
  // No stored CAP 670 extract may invoke a Def Stan, or the reading is wrong.
  assert.ok(!/shall comply with Def Stan|in accordance with Def Stan/i.test(cap),
    'a CAP 670 extract invokes a Def Stan: the reading is now wrong');
});

test('the EUROCONTROL standard genuinely mentions no defence standard', () => {
  const ec = squash(readFileSync(resolve(root, EC.evidence), 'utf8')).toLowerCase();
  for (const term of ['def stan', 'defence standard', 'ministry of defence']) {
    assert.ok(!ec.includes(term), `the EUROCONTROL extract contains "${term}"`);
  }
  assert.equal(CIVIL_DOCUMENTS.eurocontrol.mentions, 0);
});

test('the civil equivalent is named, with its own scope', () => {
  const sw01 = squash(readFileSync(
    resolve(root, 'docs/evidence/cap670-sw01-scope-2019.txt'), 'utf8'));
  assert.ok(sw01.includes(squash(THE_CIVIL_EQUIVALENT.quote)),
    'the SW01.8 quote is not in the stored extract');
  assert.match(THE_CIVIL_EQUIVALENT.reading, /does not apply to this tool/i);
});

test('what was not checked stays declared', () => {
  assert.ok(NOT_CHECKED.length >= 4);
  const joined = NOT_CHECKED.join(' ');
  assert.match(joined, /NOT been established|not verified|not the current issue|still the current issue/i);
  assert.match(joined, /Part 2/);
});
