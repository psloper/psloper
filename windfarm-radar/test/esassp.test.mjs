// The ESASSP was read from the published PDFs. These tests check every quote
// and every requirement figure against the stored extract, including the
// claims that are negatives: that the document nowhere says "supersede", and
// that its non-cooperative annex has no 2.5 NM case.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  PROVENANCE, RELATION_TO_1997, NON_COOPERATIVE, EFFECT_ON_THIS_TOOL, CORRECTIONS,
} from '../js/esassp.js';
import { PSR as EC_PSR } from '../js/eurocontrol.js';
import { PD_REQUIREMENT } from '../js/cap670.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const squash = (s) => s.replace(/\s+/g, ' ').replace(/[\u2019\u2018]/g, "'")
  .replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').trim();
const doc = squash(readFileSync(resolve(root, PROVENANCE.evidence), 'utf8'));

test('the specification is identified by reference, edition and date', () => {
  assert.ok(doc.includes(PROVENANCE.reference));
  assert.ok(doc.includes(PROVENANCE.date));
  assert.ok(doc.includes('Released Issue'));
  assert.equal(PROVENANCE.read, true);
});

test('the relationship to the 1997 standard is quoted, not characterised', () => {
  assert.ok(doc.includes(squash(RELATION_TO_1997.lessonsQuote)),
    'the development context quote is not in the extract');
  assert.ok(doc.includes(squash(RELATION_TO_1997.carriesItForwardQuote)),
    'the Annex D - 3 quote is not in the extract');
  for (const l of RELATION_TO_1997.lessons) {
    assert.ok(doc.includes(squash(l)), `lesson not in the extract: ${l.slice(0, 50)}...`);
  }
});

test('the claim that it never says "supersede" is tested as a negative', () => {
  // This is the claim most likely to be wrong, so it is checked against the
  // text rather than asserted. The extract deliberately includes the section
  // where a supersession statement would live if there were one.
  for (const word of ['supersede', 'supersedes', 'superseded', 'withdraw']) {
    const inQuotedText = new RegExp(`\\b${word}\\b`, 'i').test(
      doc.replace(/The words "supersede"[^.]*\./g, ''));
    assert.ok(!inQuotedText, `the extract contains "${word}"`);
  }
  assert.equal(RELATION_TO_1997.usesTheWordSupersede, false);
  assert.match(RELATION_TO_1997.reading, /overstates/);
});

test('every non-cooperative requirement matches the table', () => {
  for (const set of [NON_COOPERATIVE.fiveNm, NON_COOPERATIVE.threeNm]) {
    assert.ok(doc.includes(squash(set.table)), `table caption missing: ${set.table}`);
    for (const r of set.requirements) {
      assert.ok(doc.includes(r.id), `requirement id ${r.id} is not in the extract`);
      assert.ok(doc.includes(squash(r.performance)),
        `${r.id}: "${r.performance}" is not in the extract`);
    }
  }
  // The figures carried as numbers must match the words they came from.
  const five = NON_COOPERATIVE.fiveNm.requirements;
  const three = NON_COOPERATIVE.threeNm.requirements;
  assert.equal(five[0].seconds, 8);
  assert.equal(three[0].seconds, 5);
  assert.equal(five[1].fraction, 0.90);
  assert.equal(three[1].fraction, 0.90);
  assert.equal(five[2].metres, 500);
  assert.equal(three[2].metres, 300);
});

test('the 90 per cent survives from 1997 into 2024 and matches CAP 670', () => {
  assert.equal(NON_COOPERATIVE.fiveNm.requirements[1].fraction, EC_PSR.detection.pd);
  assert.equal(NON_COOPERATIVE.fiveNm.requirements[1].fraction,
    PD_REQUIREMENT.recommended.conventionalPd);
  // And the module must not let that agreement be mistaken for sameness.
  assert.match(EFFECT_ON_THIS_TOOL.butAlso, /not the same quantity/);
  assert.match(EFFECT_ON_THIS_TOOL.butAlso, /probability of UPDATE/);
});

test('the absence of a 2.5 NM primary radar case is stated and true', () => {
  assert.match(NON_COOPERATIVE.noTwoPointFiveNm, /5 NM and 3 NM only/);
  // No non-cooperative requirement id may carry a 2.5 NM prefix.
  const ids = [...NON_COOPERATIVE.fiveNm.requirements, ...NON_COOPERATIVE.threeNm.requirements]
    .map((r) => r.id);
  assert.ok(!ids.some((i) => /2\.5|25N/.test(i)));
  assert.ok(!/2\.5N_N/.test(doc), 'the extract contains a 2.5 NM non-cooperative requirement');
});

test('nothing in the tool is gated on the specification', () => {
  assert.ok(EFFECT_ON_THIS_TOOL.notImplemented.length >= 3);
  assert.match(EFFECT_ON_THIS_TOOL.notImplemented[0], /No calculation/);
});

test('every correction records what was reported and what the document says', () => {
  assert.ok(CORRECTIONS.length >= 4);
  for (const c of CORRECTIONS) {
    assert.ok(c.reported && c.reported.length > 20, 'a correction has no reported claim');
    assert.ok(c.found && c.found.length > 40, 'a correction has no finding');
  }
  // The supersession correction is the one that must not quietly disappear.
  assert.ok(CORRECTIONS.some((c) => /supersede/i.test(c.reported)));
});
