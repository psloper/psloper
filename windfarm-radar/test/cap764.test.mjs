// CAP 764 has not been read. These tests exist to keep it that way until a
// copy is actually in the repository, because three figures in this tool trace
// to it and the temptation to treat a summary as a source is exactly what this
// project has been guarding against.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { PROVENANCE, REPORTED_CLAIMS, TO_CHECK_ON_ARRIVAL } from '../js/cap764.js';
import { SUR13_MITIGATION } from '../js/cap670.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('CAP 764 is marked unread, and names no evidence file', () => {
  assert.equal(PROVENANCE.read, false);
  assert.equal(PROVENANCE.status, 'not-read');
  // If someone later marks it read, they must add a stored text first. This is
  // the same rule the references register applies to every other document.
  assert.ok(!('evidence' in PROVENANCE) || existsSync(resolve(root, PROVENANCE.evidence)),
    'CAP 764 names an evidence file that does not exist');
  assert.equal(PROVENANCE.editionKnown, false);
});

test('every reported claim carries a status and what we can say about it', () => {
  assert.ok(REPORTED_CLAIMS.length >= 4);
  const allowed = ['unverified', 'consistent', 'contradicted-in-part', 'contradicted', 'verified'];
  for (const c of REPORTED_CLAIMS) {
    assert.ok(allowed.includes(c.status), `bad status: ${c.status}`);
    assert.ok(c.claim.length > 40, 'a claim is too short to be checkable');
    assert.ok(c.whatWeKnow.length > 60, `claim has no assessment: ${c.claim.slice(0, 40)}`);
    // Nothing may be marked verified while the document is unread.
    assert.notEqual(c.status, 'verified',
      'a claim is marked verified but CAP 764 has not been read');
  }
});

test('the approved-mitigation claim is flagged against the CAP 670 quote', () => {
  const c = REPORTED_CLAIMS.find((x) => /approved/i.test(x.claim));
  assert.ok(c, 'the approved-mitigations claim is no longer recorded');
  assert.equal(c.status, 'contradicted-in-part');
  // The assessment must quote CAP 670 rather than paraphrase it, and the quote
  // must be the one the CAP 670 module actually carries.
  assert.ok(c.whatWeKnow.includes(SUR13_MITIGATION.notEndorsed.quote),
    'the assessment does not carry the verbatim CAP 670 quote it relies on');
  assert.ok(c.whatWeKnow.includes(SUR13_MITIGATION.notEndorsed.ref));
  // And it must not overstate: CAP 670 is not speaking about CAP 764.
  assert.match(c.whatWeKnow, /not a direct contradiction of CAP 764/);
});

test('the arrival checklist covers the figures the tool actually prints', () => {
  const joined = TO_CHECK_ON_ARRIVAL.join(' ');
  for (const figure of ['30 km', '17 km', '9 NM', 'lighting', 'edition']) {
    assert.ok(new RegExp(figure, 'i').test(joined), `the checklist omits ${figure}`);
  }
});
