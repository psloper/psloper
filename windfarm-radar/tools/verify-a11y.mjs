// Accessibility and interface checks that only a real browser can make.
//
// The unit tests read the stylesheet as text, which catches an undefined token
// or a hard-coded font size but cannot tell you what a colour actually measures
// against the surface it lands on, whether a control is big enough to hit, or
// whether anything shows a focus ring. Those need layout, so they need a page.
//
// Run: node tools/verify-a11y.mjs [url]
// Exits non-zero on any failure, so it can gate a build.

import { loadChromium, EXECUTABLE, LAUNCH_ARGS } from './playwright.mjs';

const URL_ = process.argv[2] || process.env.APP_URL || 'http://127.0.0.1:8777/index.html';

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: LAUNCH_ARGS });
const failures = [];
const note = (ok, label, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures.push(label);
};

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(URL_, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const m = await page.evaluate(() => {
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const nums = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const ratio = (a, c) => { const [x, y] = [lum(a), lum(c)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  function bgOf(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const v = nums(getComputedStyle(n).backgroundColor);
      if (v.length >= 3 && (v[3] === undefined || v[3] > 0.85)) return v.slice(0, 3);
      n = n.parentElement;
    }
    return [8, 11, 14];
  }

  // --- WCAG 1.4.3 contrast, on every element that owns visible text ---------
  const contrast = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(nums(cs.color).slice(0, 3), bgOf(el));
    if (got < need) {
      contrast.push({ sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        px, got: +got.toFixed(2), need, text: (el.textContent || '').trim().slice(0, 36) });
    }
  }

  // --- WCAG 2.5.8 target size. The TARGET is whatever you have to hit.
  //     For a checkbox or radio that is the label, because clicking the label
  //     toggles it. For a RANGE it is the control itself: clicking the label
  //     does not move a slider, so crediting a slider with its label's height
  //     lets an 18 px track through. The first version of this check did
  //     exactly that and passed a mutation that shrank every slider back.
  const labelIsTarget = new Set(['checkbox', 'radio']);
  const targets = [];
  for (const el of document.querySelectorAll('button, a[href], select, input')) {
    if (!shown(el) || el.type === 'hidden' || el.type === 'file') continue;
    const box = labelIsTarget.has(el.type) ? (el.closest('label') || el) : el;
    const r = box.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) {
      targets.push({ sel: el.tagName.toLowerCase() + (el.type ? `[${el.type}]` : ''),
        w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  // --- names, labels, heading order ----------------------------------------
  const unnamed = [...document.querySelectorAll('button, a[href], [role="button"]')]
    .filter(shown).filter((el) => !(el.getAttribute('aria-label') || el.textContent || el.title || '').trim()).length;
  const unlabelled = [...document.querySelectorAll('input, select, textarea')].filter(shown)
    .filter((el) => !(el.getAttribute('aria-label') || el.closest('label')
      || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)))).length;
  const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(shown).map((h) => +h.tagName[1]);
  const skips = [];
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skips.push(`${levels[i - 1]}->${levels[i]}`);

  return {
    contrast, targets, unnamed, unlabelled, skips, levels,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    themeColor: document.querySelector('meta[name="theme-color"]')?.content || null,
    skipLink: Boolean(document.querySelector('.skip-link')),
    zoomBlocked: /user-scalable\s*=\s*no|maximum-scale/.test(
      document.querySelector('meta[name=viewport]')?.content || ''),
    smallestText: Math.min(...[...document.querySelectorAll('body *')].filter(shown)
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((el) => parseFloat(getComputedStyle(el).fontSize))),
  };
});

note(m.contrast.length === 0, 'WCAG 1.4.3 contrast', `${m.contrast.length} failing text styles`);
for (const c of m.contrast.slice(0, 8)) console.log(`        ${c.got}:1 needs ${c.need}  ${c.sel} ${c.px}px  "${c.text}"`);
note(m.targets.length === 0, 'WCAG 2.5.8 target size (24px)', `${m.targets.length} under size`);
for (const t of m.targets.slice(0, 6)) console.log(`        ${t.sel} ${t.w}x${t.h}`);
note(m.unnamed === 0, 'every button has an accessible name', `${m.unnamed} unnamed`);
note(m.unlabelled === 0, 'every form control has a label', `${m.unlabelled} unlabelled`);
note(m.skips.length === 0, 'heading levels do not skip', m.skips.join(', ') || `order ${m.levels.join(',')}`);
note(m.colorScheme === 'dark', 'color-scheme: dark', m.colorScheme);
note(Boolean(m.themeColor), 'theme-color declared', m.themeColor || 'missing');
note(m.skipLink, 'skip link present');
note(!m.zoomBlocked, 'pinch zoom not disabled');
note(m.smallestText >= 11, 'no text below 11px', `smallest ${m.smallestText}px`);

// --- focus rings, by actually tabbing ---------------------------------------
let noRing = 0, stops = 0;
for (let i = 0; i < 30; i++) {
  await page.keyboard.press('Tab');
  const f = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { ring: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none',
      tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') };
  });
  if (!f) continue;
  stops++;
  if (!f.ring) { noRing++; if (noRing < 4) console.log(`        no ring: ${f.tag}`); }
}
note(noRing === 0, 'every tab stop shows a focus ring', `${stops} stops sampled`);
await page.close();

// --- reduced motion ----------------------------------------------------------
const rm = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await rm.emulateMedia({ reducedMotion: 'reduce' });
await rm.goto(URL_, { waitUntil: 'networkidle' });
await rm.waitForTimeout(2500);
const still = await rm.evaluate(() => {
  const box = [...document.querySelectorAll('#layer-toggles label')]
    .find((l) => l.textContent.trim() === 'Animate')?.querySelector('input');
  return { animateOff: box ? box.checked === false : null,
    css: getComputedStyle(document.querySelector('.btn')).transitionDuration };
});
note(still.animateOff === true, 'reduced motion stops the 3D animation', `Animate checked = ${!still.animateOff}`);
note(parseFloat(still.css) < 0.01, 'reduced motion collapses CSS transitions', still.css);
await rm.close();

// --- no horizontal overflow at phone and tablet ------------------------------
for (const w of [390, 768, 1366]) {
  const p2 = await browser.newPage({ viewport: { width: w, height: 900 } });
  await p2.goto(URL_, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(2000);
  // scrollWidth is NOT enough: this page sets `html { overflow: hidden }`, so
  // anything wider than the viewport is clipped and scrollWidth reads clean
  // while the content is visibly cut off. Measure the furthest right edge.
  const over = await p2.evaluate(() => {
    // A wide element inside a deliberately scrolling box is not overflow: the
    // turbine table is meant to scroll sideways inside .table-wrap. Only count
    // an element whose ancestors all let it spill onto the page.
    const contained = (el) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      }
      return false;
    };
    let worst = 0, who = '';
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || contained(el)) continue;
      if (r.right > worst) { worst = r.right; who = el.tagName.toLowerCase()
        + (el.className ? '.' + String(el.className).split(' ')[0] : ''); }
    }
    return { px: Math.round(worst - innerWidth), who };
  });
  note(over.px <= 1, `nothing overflows the viewport at ${w}px`, `${over.px}px past the edge${over.px > 1 ? ' (' + over.who + ')' : ''}`);
  await p2.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILING: ${failures.join('; ')}` : '\nall interface checks pass');
process.exit(failures.length ? 1 : 0);
