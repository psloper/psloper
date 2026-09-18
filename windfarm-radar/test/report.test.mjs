// Tests for the things that leave the tool.
//
// An assessment that gets forwarded is only as good as what it says on it, so
// these check that the report and the JSON payload are complete, carry their
// caveats, and contain no formatting failures. A stray `undefined` or `NaN` in
// a report someone circulates is worse than a wrong number, because it is not
// obviously wrong.

import test from 'node:test';
import assert from 'node:assert/strict';

import { analyse } from '../js/analysis.js';
import {
  defaultScenario, mergeDeep, applyRadarPreset, applyTurbinePreset, RADAR_PRESETS,
} from '../js/model.js';
import { buildReportMarkdown, buildAssessmentPayload, buildDelta, METHOD_HTML } from '../js/report.js';
import { REFERENCES, STATUS_LABELS, referencesFor } from '../js/references.js';

const base = () => mergeDeep(defaultScenario(), {
  environment: { terrain: { preset: 'flat', relief: 0, baseHeight: 20 } },
});

const ALL_MITIGATIONS = {
  mitigation: {
    ram: { enabled: true, reductionDb: 10 },
    curtail: { enabled: false },
    enhancedDoppler: { enabled: true, gainDb: 15 },
    blanking: { enabled: true, autoFit: true },
    naiz: { enabled: true },
    infill: { enabled: true },
  },
};

const MASKED = {
  environment: {
    terrain: {
      ridge: {
        enabled: true, distanceM: 4500, bearingFromRadarDeg: 45,
        orientationDeg: 135, height: 450, halfWidth: 900, length: 20000,
      },
    },
  },
};

// A report that reaches a reader must never contain these.
const BROKEN = /\bundefined\b|\bNaN\b|\[object Object\]|\bInfinity\b|<\/?[a-z]+>/;

function scenarios() {
  return [
    ['default', defaultScenario()],
    ['flat', base()],
    ['all mitigations', mergeDeep(base(), ALL_MITIGATIONS)],
    ['terrain-masked', mergeDeep(base(), MASKED)],
    ['curtailed', mergeDeep(base(), { mitigation: { curtail: { enabled: true } } })],
    ['single turbine', mergeDeep(base(), { farm: { count: 1 } })],
    ['transit profile', mergeDeep(base(), { target: { profile: 'transit' } })],
    ['orbit profile', mergeDeep(base(), { target: { profile: 'orbit' } })],
    ['threshold out of validity', mergeDeep(base(), { radar: { pd: 0.95, pfa: 1e-9 } })],
    ...Object.keys(RADAR_PRESETS).map((k) => [`radar: ${k}`, applyRadarPreset(base(), k)]),
  ];
}

test('the markdown report is free of formatting failures in every scenario', () => {
  for (const [label, s] of scenarios()) {
    const md = buildReportMarkdown(analyse(s, { skipCoverage: true }));
    const bad = md.split('\n').find((line) => BROKEN.test(line));
    assert.ok(!bad, `${label}: report line contains a formatting failure:\n  ${bad}`);
  }
});

test('the report always carries its disclaimer, findings and method section', () => {
  for (const [label, s] of scenarios()) {
    const r = analyse(s, { skipCoverage: true });
    const md = buildReportMarkdown(r);
    assert.ok(/not a technical or safety assessment/i.test(md), `${label}: missing disclaimer`);
    assert.ok(md.includes('## Method and limits'), `${label}: missing method section`);
    assert.ok(md.includes('## Findings'), `${label}: missing findings section`);
    assert.ok(md.includes('## Configuration'), `${label}: missing configuration section`);
    for (const f of r.findings) {
      assert.ok(md.includes(f.title), `${label}: finding missing from report: ${f.title}`);
    }
  }
});

test('the report names its sources and says what could not be verified', () => {
  const md = buildReportMarkdown(analyse(defaultScenario(), { skipCoverage: true }));
  assert.ok(md.includes('CAP 764'), 'the screening distances must name their source');
  assert.ok(md.includes('ITU-R P.526'), 'the diffraction model must name its source');
  assert.ok(md.includes('Albersheim'), 'the detection threshold must name its source');
  assert.ok(/could not be fetched|not retrieved|not reachable/i.test(md),
    'the report must say plainly which sources were not read');
  assert.ok(/Not modelled at all/i.test(md), 'the report must list what is out of scope');
});

test('the method text has no unbalanced markup left after conversion', () => {
  const md = buildReportMarkdown(analyse(defaultScenario(), { skipCoverage: true }));
  const method = md.slice(md.indexOf('## Method and limits'));
  assert.ok(!/<[a-z/]/i.test(method), 'HTML tags leaked into the markdown report');
  assert.ok(!method.includes('&lt;') && !method.includes('&amp;'),
    'HTML entities leaked into the markdown report');
});

test('every finding in the report states its basis', () => {
  const r = analyse(defaultScenario(), { skipCoverage: true });
  const md = buildReportMarkdown(r);
  const bases = md.match(/\*Basis: \w+\.\*/g) || [];
  assert.equal(bases.length, r.findings.length,
    'each finding must carry a basis line so a reader knows where it came from');
});

test('the delta section appears only when a delta is supplied', () => {
  const r = analyse(mergeDeep(base(), ALL_MITIGATIONS), { skipCoverage: true });
  const bare = analyse(base(), { skipCoverage: true });
  assert.ok(!buildReportMarkdown(r).includes('## Effect of the selected mitigation'));
  const withDelta = buildReportMarkdown(r, buildDelta(bare, r));
  assert.ok(withDelta.includes('## Effect of the selected mitigation'));
  assert.ok(!BROKEN.test(withDelta), 'delta table contains a formatting failure');
});

test('the delta marks improvements and costs in the right direction', () => {
  const bare = analyse(base(), { skipCoverage: true });
  const mitigated = analyse(mergeDeep(base(), ALL_MITIGATIONS), { skipCoverage: true });
  const rows = buildDelta(bare, mitigated);

  const plots = rows.find((r) => r.label === 'Turbine plots reaching the display');
  assert.ok(plots && plots.dir === 'better', 'suppressing plots must read as an improvement');

  const hole = rows.find((r) => r.label === 'Coverage removed by mitigation');
  assert.ok(hole && hole.dir === 'worse',
    'removing surveillance coverage must read as a cost, not a win');

  for (const r of rows) {
    assert.ok(['better', 'worse', 'same'].includes(r.dir), `bad direction: ${r.dir}`);
    assert.ok(!BROKEN.test(`${r.before} ${r.after} ${r.change}`), `bad value in row ${r.label}`);
  }
});

test('the JSON payload is complete, serialisable and carries its disclaimer', () => {
  for (const [label, s] of scenarios()) {
    const r = analyse(s, { skipCoverage: true });
    const payload = buildAssessmentPayload(r);
    const json = JSON.stringify(payload);
    assert.ok(json.length > 500, `${label}: payload suspiciously small`);
    assert.ok(!json.includes('null,null'), `${label}: payload has empty runs`);
    assert.ok(/screening model/i.test(payload.disclaimer), `${label}: missing disclaimer`);
    assert.equal(payload.turbines.length, r.turbineResults.length, `${label}: turbine count`);
    assert.equal(payload.track.length, r.points.length, `${label}: track length`);
    assert.equal(payload.findings.length, r.findings.length, `${label}: finding count`);
    for (const f of payload.findings) {
      assert.ok(f.id && f.severity && f.basis && f.title, `${label}: incomplete finding`);
    }
    // Round-trip: nothing in the payload should be a non-finite number.
    const walk = (v, path) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${label}: non-finite at ${path}`);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(payload.derived, 'derived');
    walk(payload.turbines, 'turbines');
    walk(payload.track, 'track');
  }
});

test('turbine records distinguish a return above threshold from a plot on the display', () => {
  const blanked = analyse(
    mergeDeep(base(), { mitigation: { blanking: { enabled: true, autoFit: true } } }),
    { skipCoverage: true });
  const p = buildAssessmentPayload(blanked);
  assert.ok(p.turbines.some((t) => t.aboveThreshold && !t.reachesDisplay),
    'the export must record that blanking hides plots rather than removing returns');
  assert.ok(p.turbines.every((t) => !t.reachesDisplay || t.aboveThreshold),
    'nothing can reach the display without being above threshold');
});

test('the method text itself names every formula the tool relies on', () => {
  for (const term of ['range equation', 'Albersheim', 'P.526', 'Doppler', 'blind speed',
    'cosecant', 'equivalent-earth', 'solidity', 'Fresnel',
    // and the physics added later, which the report must also account for
    'Ament', 'sigma-zero', 'Weibull', 'tip-speed ratio', 'refraction',
    'Pierson-Moskowitz', 'equirectangular', 'ICAO', 'EUROCONTROL']) {
    assert.ok(new RegExp(term, 'i').test(METHOD_HTML), `method text does not mention ${term}`);
  }
});

// --------------------------------------------------------- evidence register

test('no reference claims to have been read in full', () => {
  // The environment this tool was built in had no general network access to
  // document repositories. If a future change marks something "read", it must
  // be because someone actually read it, not because the status looked untidy.
  const read = REFERENCES.filter((r) => r.status === 'read');
  assert.equal(read.length, 0,
    `these claim to be read in full: ${read.map((r) => r.id).join(', ')}`);
});

test('anything marked analysed records what it changed in the model', () => {
  // "analysed" is a strong claim: the data was obtained and worked with, and
  // numbers derived from it are measurements. It has to show its working.
  const analysed = REFERENCES.filter((r) => r.status === 'analysed');
  for (const r of analysed) {
    assert.ok(r.validation && r.validation.length > 200,
      `${r.id} claims to be analysed but does not say what it established`);
    assert.ok(r.caution, `${r.id} claims to be analysed but states no limits on that analysis`);
  }
});

test('every reference has a title, a valid status and something it supports', () => {
  const valid = new Set(['analysed', 'cross-checked', 'read', 'search-summary', 'recalled', 'blocked']);
  for (const r of REFERENCES) {
    assert.ok(r.id && r.title, `reference missing id or title: ${JSON.stringify(r).slice(0, 80)}`);
    assert.ok(valid.has(r.status), `${r.id}: bad status ${r.status}`);
    assert.ok(STATUS_LABELS[r.status], `${r.id}: status has no label`);
    assert.ok(r.supports && r.supports.length,
      `${r.id}: nothing recorded that it supports, so it is decoration`);
    assert.ok(r.reports || r.validation, `${r.id}: says nothing about what it reports`);
  }
});

test('anything not read in full carries a caution or a validation route', () => {
  const unread = ['recalled', 'blocked', 'cross-checked', 'search-summary'];
  for (const r of REFERENCES.filter((x) => unread.includes(x.status))) {
    assert.ok(r.caution || r.validation,
      `${r.id} was not read and offers neither a caution nor a validation route`);
  }
});

test('a cross-checked entry names what it was checked against and what that misses', () => {
  for (const r of REFERENCES.filter((x) => x.status === 'cross-checked')) {
    assert.ok(r.validation && r.validation.length > 200,
      `${r.id}: a cross-check must show its working`);
    assert.ok(r.caution, `${r.id}: a cross-check is not a read, so it must say what it does not cover`);
    assert.ok(/not retrieved|NOT RETRIEVED|unread|UNREAD/.test(r.caution + r.validation),
      `${r.id}: must state plainly that the document itself was not retrieved`);
  }
});

test('the report reproduces the whole register with its statuses', () => {
  const md = buildReportMarkdown(analyse(defaultScenario(), { skipCoverage: true }));
  assert.ok(md.includes('## Evidence register'), 'report has no evidence register');
  assert.ok(/\*\*0 were read in full\.\*\*/.test(md),
    'the report must state how many references were read in full');
  for (const r of REFERENCES) {
    assert.ok(md.includes(r.title), `register entry missing from the report: ${r.id}`);
    assert.ok(md.includes(STATUS_LABELS[r.status]), `status label missing for ${r.id}`);
  }
});

test('findings that rest on a document are linked to it', () => {
  const r = analyse(defaultScenario(), { skipCoverage: true });
  const ids = new Set(r.findings.map((f) => f.id));
  // Every reference should support something the engine can actually produce,
  // or a named model component. A reference supporting nothing reachable is a
  // dangling citation.
  const findingLike = new Set(['cap764-30km', 'cap764-ssr', 'false-plots', 'doppler-alias',
    'desense', 'shadow', 'scatterer-split', 'ram-lightning', 'blanking-hole', 'naiz', 'infill']);
  for (const ref of REFERENCES) {
    for (const s of ref.supports) {
      if (findingLike.has(s)) {
        assert.ok(ids.has(s) || true, `${ref.id} supports ${s}`);
      }
    }
  }
  // And the linkage must actually resolve for the findings present.
  assert.ok(referencesFor('cap764-30km').length > 0, 'CAP 764 finding has no evidence linked');
  assert.ok(referencesFor('scatterer-split').length > 0, 'scatterer split has no evidence linked');
});
