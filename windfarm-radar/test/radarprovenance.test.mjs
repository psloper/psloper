// Every claim the tool makes about a real radar must be traceable to the
// document it came from. These tests read the extracted datasheet text and
// check the quotes against it, so editing a quote in model.js without the
// document supporting it fails the build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  RADAR_PRESETS, RADAR_PRESET_PROVENANCE, DATASHEET_SOURCES,
  radarPresetProvenanceNote,
} from '../js/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// The text layer wraps lines wherever the page did, so compare on words.
const squash = (s) => s.replace(/\s+/g, ' ').trim();

const evidence = squash(
  readFileSync(resolve(root, DATASHEET_SOURCES['thales-star-ng-2023'].text), 'utf8'),
);

const NM_M = 1852;

test('every radar preset declares where its numbers came from', () => {
  for (const key of Object.keys(RADAR_PRESETS)) {
    const prov = RADAR_PRESET_PROVENANCE[key];
    assert.ok(prov, `no provenance entry for radar preset ${key}`);
    assert.ok(['representative', 'mixed', 'datasheet'].includes(prov.kind),
      `preset ${key} has an unrecognised provenance kind ${prov.kind}`);
  }
});

test('the STAR NG evidence file is the document it claims to be', () => {
  assert.match(evidence, /STAR NG – RSM NG/);
  assert.match(evidence, /Military Air Traffic Management/);
  assert.match(evidence, /THALES LAS France/);
  assert.match(evidence, /15 June 2023/);
});

test('each quoted datasheet parameter appears verbatim in the document', () => {
  const prov = RADAR_PRESET_PROVENANCE['star-ng'];
  for (const [param, entry] of Object.entries(prov.datasheet)) {
    assert.ok(evidence.includes(squash(entry.quote)),
      `quote for ${param} is not in the extracted datasheet: "${entry.quote}"`);
  }
});

test('each qualitative claim quoted in the provenance table is in the document', () => {
  const prov = RADAR_PRESET_PROVENANCE['star-ng'];
  for (const claim of prov.claims) {
    assert.ok(evidence.includes(squash(claim)),
      `claim is not in the extracted datasheet: "${claim}"`);
  }
});

test('the preset values match the figures the datasheet actually gives', () => {
  const p = RADAR_PRESETS['star-ng'];
  const prov = RADAR_PRESET_PROVENANCE['star-ng'];

  // 120 NM, converted, not rounded to a friendly number.
  assert.equal(prov.datasheet.instrumentedRangeM.value, 120 * NM_M);
  assert.equal(p.instrumentedRangeM, prov.datasheet.instrumentedRangeM.value);

  // Scan rate inside the published range, not outside it.
  const [lo, hi] = prov.datasheet.rpm.range;
  assert.ok(p.rpm >= lo && p.rpm <= hi, `rpm ${p.rpm} outside published ${lo}-${hi}`);
  assert.equal(p.rpm, prov.datasheet.rpm.value);

  // S band means 2-4 GHz. The datasheet does not say where inside it.
  assert.ok(p.freqHz >= 2.0e9 && p.freqHz <= 4.0e9, 'frequency is not in S band');
});

test('every parameter not from the datasheet is identical to the preset it was copied from', () => {
  const prov = RADAR_PRESET_PROVENANCE['star-ng'];
  const star = RADAR_PRESETS['star-ng'];
  const parent = RADAR_PRESETS[prov.inherited];
  assert.ok(parent, `inherited preset ${prov.inherited} does not exist`);

  for (const key of prov.inheritedKeys) {
    assert.ok(key in parent, `${key} is not a parameter of ${prov.inherited}`);
    assert.equal(star[key], parent[key],
      `${key} is listed as copied from ${prov.inherited} but the values differ. `
      + 'Either it came from somewhere, in which case say where, or it is a typo.');
  }

  // Nothing is claimed as both measured and borrowed.
  for (const key of Object.keys(prov.datasheet)) {
    assert.ok(!prov.inheritedKeys.includes(key),
      `${key} is claimed both as a datasheet figure and as copied from ${prov.inherited}`);
  }

  // Every numeric parameter is accounted for one way or the other.
  const numeric = Object.keys(parent).filter((k) => typeof parent[k] === 'number');
  const accounted = new Set([...Object.keys(prov.datasheet), ...prov.inheritedKeys]);
  for (const key of numeric) {
    assert.ok(accounted.has(key), `${key} is neither sourced nor declared as copied`);
  }
});

test('the datasheet answers none of the parameters that dominate the result', () => {
  const prov = RADAR_PRESET_PROVENANCE['star-ng'];
  // Measured by tools/radar_sensitivity.mjs: the six inputs whose plausible
  // range moves the worst-case margin the most.
  const dominant = ['heightAgl', 'azBeamwidthDeg', 'elBeamwidthDeg', 'elPeakDeg', 'freqHz', 'gainDbi'];
  assert.deepEqual([...prov.dominantParametersUnanswered].sort(), [...dominant].sort());
  assert.deepEqual(prov.dominantParametersAnswered, []);

  // None of the six may be sourced from the datasheet, or the lists disagree.
  for (const key of dominant) {
    assert.ok(!(key in prov.datasheet),
      `${key} is listed as unanswered but also as a datasheet figure`);
  }
});

test('the claimed wind farm mitigation is not credited as a gain', () => {
  // The datasheet says the radar has dedicated wind farm processing but gives
  // no figure for it. Crediting an invented number would make the tool
  // optimistic about the one thing it is meant to warn about.
  assert.equal(RADAR_PRESETS['star-ng'].dopplerSpreadGainDb, 0);
  const q = RADAR_PRESET_PROVENANCE['star-ng'].qualitative.dopplerSpreadGainDb;
  assert.match(q, /upper bound/);
});

test('the note shown in the UI is built from the table, not typed twice', () => {
  const note = radarPresetProvenanceNote('star-ng');
  assert.match(note, /2023-06-15/);
  assert.match(note, /6 of the 6/);
  assert.equal(radarPresetProvenanceNote('psr-terminal').includes('representative'), true);
  assert.equal(radarPresetProvenanceNote('nonexistent'), 'Custom parameters.');
});
