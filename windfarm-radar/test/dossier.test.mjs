// The validation dossier is the document that gets handed to someone deciding
// whether to trust the tool. A figure in it that has quietly stopped being true
// is worse than no dossier at all, because it is presented as checked.
//
// So every number the dossier quotes about the repository is checked against
// the repository here: the test count against the tests, the evidence files
// against the filesystem, the CAP 670 tally against the verification record,
// the sensitivity figures against the module that carries them.
//
// This test deliberately does NOT re-derive the physics. Those numbers are
// owned by test/physics.test.mjs and test/calibration.test.mjs. What it checks
// is that the dossier still agrees with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { RADAR_FIELDS } from '../js/completeness.js';
import { RADAR_PRESETS } from '../js/model.js';
import { UNIFORM_APERTURE_SIDELOBE_DB } from '../js/rf.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dossier = readFileSync(resolve(root, 'docs/VALIDATION-DOSSIER.md'), 'utf8');

/** The number the dossier prints next to a phrase, e.g. "327 tests". */
function quoted(pattern, label) {
  const m = dossier.match(pattern);
  assert.ok(m, `the dossier no longer states ${label}`);
  return Number(m[1]);
}

test('the test count in the dossier is the real one', () => {
  // Count the test files' own declarations rather than running the suite
  // inside itself. Every test in this repository is a top-level test(' call.
  let total = 0;
  for (const f of readdirSync(resolve(root, 'test'))) {
    if (!f.endsWith('.test.mjs')) continue;
    const src = readFileSync(resolve(root, 'test', f), 'utf8');
    total += (src.match(/^test\(/gm) || []).length;
  }
  const claimed = quoted(/\*\*(\d+) tests, all passing\.\*\*/, 'a test count');
  assert.equal(claimed, total,
    `the dossier claims ${claimed} tests and the suite declares ${total}`);
  assert.equal(quoted(/npm test\s+# (\d+) unit and traceability tests/, 'the test count in section 12'),
    total, 'section 12 disagrees with section 3');
});

test('every evidence file the dossier lists actually exists', () => {
  // The traceability table names files by glob-ish shorthand; check the real
  // ones, because a missing primary document turns a traceability claim into
  // an assertion.
  const expected = [
    'cap764-ed7-draft-consultation.txt',
    'eurocontrol-radar-surveillance-std-1997.txt',
    'eurocontrol-esassp-spec-0147-ed1.3-2024.txt',
    'defstan-00-56-part1-issue7-2017.txt',
  ];
  for (const f of expected) {
    assert.ok(dossier.includes(f), `the dossier stopped naming ${f}`);
    assert.ok(existsSync(resolve(root, 'docs/evidence', f)), `missing evidence: ${f}`);
  }
  const cap670 = readdirSync(resolve(root, 'docs/evidence')).filter((f) => f.startsWith('cap670-'));
  assert.equal(cap670.length, 4,
    `the dossier says CAP 670 is 4 files, found ${cap670.length}`);
});

test('the per-document check counts match the test files', () => {
  const pairs = [
    ['cap670', 45], ['cap764', 8], ['eurocontrol', 13], ['esassp', 8], ['defencestandards', 7],
  ];
  for (const [file, claimed] of pairs) {
    const src = readFileSync(resolve(root, 'test', `${file}.test.mjs`), 'utf8');
    const actual = (src.match(/^test\(/gm) || []).length;
    assert.equal(actual, claimed,
      `${file}.test.mjs declares ${actual} tests, the dossier's table says ${claimed}`);
    assert.ok(dossier.includes(`| ${claimed} |`),
      `the dossier no longer prints ${claimed} for ${file}`);
  }
});

test('the CAP 670 tally matches the verification record', () => {
  const rec = readFileSync(resolve(root, 'docs/CAP670-VERIFICATION.md'), 'utf8');
  const m = rec.match(/\*\*(\d+) checks: (\d+) confirmed, (\d+) corrected, (\d+) still open\.\*\*/);
  assert.ok(m, 'CAP670-VERIFICATION.md no longer states its tally');
  const [, all, ok, fixed, open] = m.map(Number);
  assert.equal(ok + fixed + open, all, 'the record does not add up');
  assert.ok(dossier.includes(`${all} checks, ${ok} confirmed, ${fixed} corrected, ${open} still open`),
    `the dossier disagrees with the record: ${all}/${ok}/${fixed}/${open}`);
});

test('the terrain figures match the ground-truth table', () => {
  const terrain = readFileSync(resolve(root, 'docs/TERRAIN.md'), 'utf8');
  for (const [name, tool, known] of [
    ['Ben Nevis', 1342, 1345], ['Scafell Pike', 972, 978], ['Snowdon', 1071, 1085]]) {
    assert.ok(terrain.includes(`| ${tool} m | ${known} m |`),
      `TERRAIN.md no longer records ${name} as ${tool} against ${known}`);
    assert.ok(dossier.includes(`| ${tool} m | ${known} m |`),
      `the dossier no longer records ${name} as ${tool} against ${known}`);
  }
});

test('the SCADA record count matches the calibration record', () => {
  const cal = readFileSync(resolve(root, 'calibration/README.md'), 'utf8');
  const m = cal.match(/\*\*([\d,]+) records\*\*/);
  assert.ok(m, 'the calibration record no longer states how many records were used');
  assert.ok(dossier.includes(m[1]),
    `the dossier quotes a different record count from ${m[1]}`);
});

test('the sidelobe figures match the code they describe', () => {
  assert.ok(dossier.includes(String(UNIFORM_APERTURE_SIDELOBE_DB).replace('-', '−')),
    `the dossier no longer quotes ${UNIFORM_APERTURE_SIDELOBE_DB} dB for the uniform aperture`);
  // The parameter it calls an assumption must still be an input on every
  // preset, or the dossier is describing a tool that no longer exists.
  for (const [key, p] of Object.entries(RADAR_PRESETS)) {
    assert.equal(typeof p.azSidelobeFloorDb, 'number', `${key} lost its sidelobe level`);
  }
  const field = RADAR_FIELDS.find((f) => f.key === 'azSidelobeFloorDb');
  assert.ok(field, 'the completeness audit no longer asks for the sidelobe level');
  assert.equal(field.tier, 'conditional',
    'the dossier describes it as conditional with its condition stated');
});

test('the dossier does not promise a check that no longer exists', () => {
  for (const cmd of ['npm test', 'tools/systems_check.mjs', 'tools/radar_sensitivity.mjs',
    'tools/verify-a11y.mjs', 'tools/build_cap670_checklist.mjs', 'tools/build_package.sh']) {
    assert.ok(dossier.includes(cmd), `the dossier stopped listing ${cmd}`);
    const path = cmd === 'npm test' ? 'package.json' : cmd;
    assert.ok(existsSync(resolve(root, path)), `the dossier points at a missing ${path}`);
  }
});

test('the dossier still states what is NOT verified', () => {
  // The section that makes the document worth reading. A dossier that loses it
  // has become marketing, so this fails rather than letting that happen
  // quietly.
  const i = dossier.indexOf('## 11. What is not verified');
  assert.ok(i > 0, 'the unverified section is gone');
  const section = dossier.slice(i, dossier.indexOf('## 12.'));
  const bullets = (section.match(/^- \*\*/gm) || []).length;
  assert.ok(bullets >= 10, `only ${bullets} limitations are listed; there are more than that`);
  for (const must of ['wake model', 'Multipath', 'M.1851', 'CAP 670', 'Blade chord']) {
    assert.ok(section.includes(must), `the unverified section stopped mentioning ${must}`);
  }
});

test('the dossier claims no network requests, and the code still makes none', () => {
  assert.ok(dossier.includes('No third-party network requests at runtime'));
  // Do not take the dossier's word for it: this is the claim that matters most
  // to the people the document is written for.
  const bad = [];
  for (const f of readdirSync(resolve(root, 'js'))) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(resolve(root, 'js', f), 'utf8');
    for (const m of src.matchAll(/\b(fetch|XMLHttpRequest|importScripts|EventSource|WebSocket)\s*\(/g)) {
      if (f === 'terrain.js' && m[1] === 'fetch') continue;   // own-origin data files
      bad.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `network calls outside terrain.js: ${bad.join(', ')}`);
});
