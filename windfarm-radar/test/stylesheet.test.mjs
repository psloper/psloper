// Checks on the stylesheet that the browser will not make for you.
//
// CSS fails silently. A `var(--line)` that names a custom property nobody ever
// defined does not throw and does not log: the declaration is simply invalid at
// computed-value time and the property falls back to its initial value. In this
// tool that meant three map panels drew their border in currentColor and ignored
// their heading colour entirely, and it survived every visual pass because the
// panels still LOOKED like panels. The only way it gets caught is by asking.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');

/** Custom properties the sheet defines, anywhere. */
function defined(text) {
  const names = new Set();
  for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) names.add(m[1]);
  return names;
}

/** Every `var(--x)` use, with a note on whether it supplied a fallback. */
function used(text) {
  const out = [];
  for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)) {
    out.push({ name: m[1], hasFallback: Boolean(m[2]) });
  }
  return out;
}

test('every custom property used without a fallback is defined', () => {
  const have = defined(css);
  const missing = [...new Set(
    used(css).filter((u) => !u.hasFallback && !have.has(u.name)).map((u) => u.name),
  )];
  assert.deepEqual(missing, [],
    `undefined custom properties: ${missing.join(', ')}. `
    + 'A var() naming a property that is never defined makes the whole '
    + 'declaration invalid, silently.');
});

test('no font-size is hard-coded in pixels; every one uses the scale', () => {
  const hard = [...css.matchAll(/font-size:\s*[0-9.]+px/g)].map((m) => m[0]);
  assert.deepEqual(hard, [],
    `${hard.length} hard-coded font sizes. Nine distinct sizes were rendering at `
    + 'once before the scale was enforced, which is why nothing read as more '
    + 'important than anything else.');
});

test('the smallest step on the scale is at least 11px', () => {
  const m = css.match(/--t-tag:\s*([0-9.]+)px/);
  assert.ok(m && Number(m[1]) >= 11, 'the type floor dropped below 11px');
});

test('the type scale is declared and used, not hard-coded font sizes', () => {
  const have = defined(css);
  for (const token of ['--t-tag', '--t-data', '--t-small', '--t-body', '--t-lead', '--t-metric']) {
    assert.ok(have.has(token), `${token} is missing from the type scale`);
  }
  // The scale must be strictly increasing, or it is not a scale.
  const sizes = ['--t-tag', '--t-data', '--t-small', '--t-body', '--t-lead', '--t-metric']
    .map((t) => {
      const m = css.match(new RegExp(`${t}:\\s*([0-9.]+)px`));
      assert.ok(m, `${t} is not declared in px`);
      return Number(m[1]);
    });
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i] > sizes[i - 1],
      `type scale is not increasing at step ${i}: ${sizes[i - 1]} then ${sizes[i]}`);
  }
});

test('no selector is declared twice at the top level of the sheet', () => {
  // Two rules for the same selector is how a stylesheet starts cancelling
  // itself out. Caught one already: a second `.toggles` block that set
  // `display: grid` after the first had set `flex-direction: column`.
  const counts = new Map();
  for (const m of css.matchAll(/^([.#][a-z0-9_-]+)\s*\{/gim)) {
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  const dupes = [...counts].filter(([, n]) => n > 1).map(([sel, n]) => `${sel} (${n}x)`);
  assert.deepEqual(dupes, [], `duplicated simple selectors: ${dupes.join(', ')}`);
});
