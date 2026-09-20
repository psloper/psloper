// Imported files are untrusted input. A turbine schedule or site list is a CSV
// a user was handed by someone else, and the id and name columns are kept
// verbatim by design, because mangling someone's labels would be worse.
//
// That makes the RENDERER responsible for safety. These tests guard the class
// of bug rather than one instance: any template literal assigned to innerHTML
// must escape every value it interpolates.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { parseTurbineRows, readCsv, parseFarmSiteRows } from '../js/importers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Interpolations that cannot carry user text: loop counters, formatted numbers,
// fixed colour constants, and values that are themselves already-escaped HTML.
const SAFE = [
  /^esc\(/, /^dot\(/,
  /^i$/, /^k$/, /^j$/, /^n$/, /^id$/, /^colour$/, /^c$/,
  /^mine$/, /^myRadars$/, /^metrics$/, /^evidence$/, /^source$/, /^refs\b/,
  /^r\.i$/, /^f\.severity$/, /^r\.status$/,
  /toFixed\(/, /padStart\(/, /\.length\b/, /^SEVERITY_LABELS\[/,
  /^block\.(title|note)$/,          // fixed strings in the rail definition
  /^content$/,                       // a data: URL this tool generated
  /^\w+ \?/, /^\w+\.\w+ \?/,        // ternaries over booleans
  /^\(?counts\./, /^Date\.now\(\)$/, /^body$/,   // numbers, and the PDF body,
  /^def\.unit$/, /^r\.(label|before|after|dir|change)$/,  // which report.js escapes
  /^t\.(level|visibility)\b/, /^v$/, /^l$/, /^x\.(name|radar)$/,
  /^f\.(label|note)$/, /^result\.scenario\.target\.rcsDbsm$/,
  /^scope === /, /^i < \d/,    // a loop index deciding a static attribute
];

function unescapedInterpolations(src) {
  const out = [];
  const lines = src.split('\n');
  let window = 0;
  lines.forEach((line, n) => {
    if (/(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\s*[=(]/.test(line)) window = 16;
    if (window <= 0) return;
    window -= 1;
    for (const m of line.matchAll(/\$\{([^}]*)\}/g)) {
      const expr = m[1].trim();
      if (!expr) continue;
      if (SAFE.some((rx) => rx.test(expr))) continue;
      out.push(`${n + 1}: \${${expr.slice(0, 60)}}`);
    }
  });
  return out;
}

test('nothing is interpolated into innerHTML without escaping it', () => {
  const offenders = {};
  for (const f of readdirSync(join(root, 'js'))) {
    if (!f.endsWith('.js')) continue;
    const found = unescapedInterpolations(readFileSync(join(root, 'js', f), 'utf8'));
    if (found.length) offenders[f] = found;
  }
  assert.deepEqual(offenders, {},
    'unescaped values reach innerHTML:\n' + JSON.stringify(offenders, null, 2));
});

test('the importer keeps a hostile id verbatim, which is the renderer\'s problem to solve', () => {
  // If this ever starts sanitising, the escaping tests above become the only
  // defence and someone should know that changed.
  const csv = 'id,latitude,longitude,hub height,rotor diameter\n'
    + '<img src=x onerror=BOOM>,55.95,-3.21,120,150\nWTG02,55.96,-3.22,120,150\n';
  const sheets = readCsv(csv);
  const r = parseTurbineRows(sheets[0].rows, {
    origin: { lat: 55.9, lon: -3.2 }, originLat: 55.9, originLon: -3.2,
    radarEasting: 0, radarNorthing: 0,
  });
  assert.equal(r.turbines[0].id, '<img src=x onerror=BOOM>');
  assert.equal(r.turbines[1].id, 'WTG02');
});

test('a hostile site name survives the site-list importer too', () => {
  const csv = 'name,latitude,longitude,capacity mw\n'
    + '"<script>BOOM</script>",55.9,-3.2,10\n';
  const sheets = readCsv(csv);
  const r = parseFarmSiteRows(sheets[0].rows, {
    origin: { lat: 55.9, lon: -3.2 }, originLat: 55.9, originLon: -3.2,
  });
  assert.match(r.sites[0].name, /script/);
});

test('the escaper covers every character that can break out of markup', () => {
  // esc is not exported, so check the implementation is the one described.
  const src = readFileSync(join(root, 'js', 'ui.js'), 'utf8');
  const m = src.match(/function esc\(s\)[\s\S]{0,260}?\n\}/);
  assert.ok(m, 'esc() is gone; the escaping tests above assume it exists');
  for (const ch of ['&', '<', '>', '"', "'"]) {
    assert.ok(m[0].includes(`'${ch}'`) || m[0].includes(`"${ch}"`),
      `esc() does not handle ${ch}`);
  }
});

test('there is no way to execute a string as code anywhere in the tool', () => {
  const bad = [];
  for (const f of readdirSync(join(root, 'js'))) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(root, 'js', f), 'utf8');
    for (const rx of [/\beval\s*\(/, /new\s+Function\s*\(/, /\bimportScripts\s*\(/,
      /setTimeout\s*\(\s*['"]/, /setInterval\s*\(\s*['"]/]) {
      if (rx.test(src)) bad.push(`${f}: ${rx}`);
    }
  }
  assert.deepEqual(bad, [], 'code-execution primitives found');
});

test('the only network call in the tool reads its own files', () => {
  const calls = [];
  for (const f of readdirSync(join(root, 'js'))) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(root, 'js', f), 'utf8');
    for (const rx of [/\bfetch\s*\(/g, /XMLHttpRequest/g, /\bWebSocket\s*\(/g,
      /sendBeacon/g, /EventSource/g]) {
      for (const _ of src.matchAll(rx)) calls.push(f);
    }
  }
  // js/terrain.js reads data/terrain from the tool's own origin, twice.
  assert.deepEqual([...new Set(calls)], ['terrain.js'],
    `network calls outside terrain.js: ${[...new Set(calls)].join(', ')}`);
  const t = readFileSync(join(root, 'js', 'terrain.js'), 'utf8');
  assert.ok(!/fetch\(\s*['"`]https?:/.test(t), 'terrain.js fetches an absolute URL');
});
