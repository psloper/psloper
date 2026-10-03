// Proves each test can fail: breaks one feature at a time in a scratch copy
// of kayak/, runs the tests, and checks that the tests named in `kills`
// fail. Then checks every test was made to fail by at least one break.
// Run with: npm run test:mutants
// While developing: MUTANT_ONLY=offline npm run test:mutants (runs matching breaks only,
// and skips the every-test-was-broken check).
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
// Inside the repo so the copy still finds node_modules/playwright.
const SCRATCH = join(REPO, '.mutants');
const UNIT = 'logic.test.mjs';
const BROWSER = 'browser.test.mjs';

const SPOTS = ['Oban', 'Rhoscolyn', 'Portland Bill', 'Hamble', 'Itchen', 'Poole'].map((s) => `UK spot: ${s}`);
const FAR_SPOTS = ['Oban', 'Hamble', 'Itchen', 'Poole'].map((s) => `UK spot: ${s}`);
const TIDE_SPOTS = SPOTS;
const OFFSHORE = ['offshore wind and editable limits (desktop)', 'offshore wind and editable limits (phone, dark)'];

// [file, text to find (must occur once), replacement, tests that must fail, what it breaks]
const MUTANTS = [
  ['logic.js', "return value / 1.852;", 'return value / 1.6;',
    ['unit conversion to knots', 'merge aligns marine data by timestamp and converts current'], 'km/h to knots factor'],
  ['logic.js', 'return d > 180 ? 360 - d : d;', 'return d;', ['angles and compass points'], 'angle wrap-around'],
  ['logic.js', 'return idx === -1 ? 12 : idx;', 'return idx === -1 ? 11 : idx;', ['beaufort scale boundaries'], 'Beaufort top of scale'],
  ['logic.js', "<= 45) return 'onshore';", "<= 45) return 'offshore';", ['wind relative to a south-facing beach'], 'onshore detection'],
  ['logic.js', "timeZone: 'UTC'", "timeZone: 'Europe/London'", ['local time strings stay in location wall-clock time'], 'local time display'],
  ['logic.js', 'const offset = denom === 0 ? 0 : 0.5 * (a - c) / denom;', 'const offset = 0;',
    ['tide turns found and interpolated between hours'], 'tide time interpolation'],
  ['logic.js', 'if (a == null || b == null || c == null) continue;', '', ['tide turns skip missing data'], 'missing tide data'],
  ['logic.js', 'const CAUTION_FRACTION = 0.8;', 'const CAUTION_FRACTION = 0.3;', ['calm hour is GO'], 'caution too eager'],
  ['logic.js', 'const CAUTION_FRACTION = 0.8;', 'const CAUTION_FRACTION = 0.95;', ['near a limit gives CAUTION'], 'caution too late'],
  ['logic.js', 'if (value > max) flag(RATING.NOGO', 'if (value > max * 2) flag(RATING.NOGO',
    ['strong wind is NO-GO for beginner, fine for advanced'], 'limit check'],
  ['logic.js', "if (rel === 'offshore' && h.windKn != null) {", 'if (false) {',
    ['offshore wind escalates only when a beach bearing is set', ...OFFSHORE], 'offshore wind flag'],
  ['logic.js', 'const THUNDER_CODES = new Set([95, 96, 99]);', 'const THUNDER_CODES = new Set([]);', ['fog and thunder are NO-GO'], 'thunderstorm flag'],
  ['logic.js', 'if (h.visibilityM < 1000) flag(RATING.NOGO', 'if (h.visibilityM < 100) flag(RATING.NOGO', ['fog and thunder are NO-GO'], 'fog flag'],
  ['logic.js', '&& angleDiff(h.windDir, h.currentDir) <= 45) {', '&& angleDiff(h.windDir, h.currentDir) >= 135) {',
    ['wind against current gives CAUTION'], 'wind-against-tide direction'],
  ['logic.js', 'if (daylight.length && !isDaylight(h.t, daylight))', 'if (false)', ['darkness gives CAUTION'], 'darkness flag'],
  ['logic.js', 'endIdx - start >= minHours', 'endIdx - start > minHours', ['paddling windows are runs of GO hours'], 'window length'],
  ['logic.js', 'const mi = marineIndex.get(time);', 'const mi = i;',
    ['merge aligns marine data by timestamp and converts current'], 'weather/marine time alignment'],
  ['logic.js', "return delta >= 0 ? 'rising' : 'falling';", "return delta >= 0 ? 'falling' : 'rising';",
    ['tide trend rising, falling and missing'], 'tide rising/falling'],
  ['logic.js', "if (n.startsWith(q) && !/[a-z]/.test(n.charAt(q.length))) return 1;", '',
    ['search for "Hamble" puts Hamble-le-Rice first, not Hambleton', 'UK spot: Hamble'], 'whole-word place match'],
  ['logic.js', '.sort((a, b) => a.uk - b.uk || a.m - b.m || a.i - b.i)', '.sort((a, b) => a.i - b.i)',
    ['search for "Hamble" puts Hamble-le-Rice first, not Hambleton', 'search for "Oban" puts Oban, Scotland before Assaria, Kansas',
      'UK spot: Oban', 'UK spot: Hamble'], 'place ranking'],
  ['logic.js', 'const rad = Math.PI / 180;', 'const rad = Math.PI / 360;',
    ['distance from launch to sea model point matches the live check', ...SPOTS], 'distance to sea point'],
  ['logic.js', 'export const FAR_SEA_POINT_KM = 5;', 'export const FAR_SEA_POINT_KM = 15;',
    ['sea coverage: near, far and inland', ...FAR_SPOTS], 'far sea point threshold'],
  ['logic.js', "if (!hasData) return { status: 'none', distanceKm: km };", '',
    ['sea coverage: near, far and inland', 'inland spot is flagged and never rated GO'], 'inland detection'],
  ['logic.js', 'if (h.waveM == null) {', 'if (false) {',
    ['missing sea data is never rated GO', 'inland spot is flagged and never rated GO'], 'missing sea data rating'],
  ['app.js', 'async function getJson(url, retries = 1) {', 'async function getJson(url, retries = 0) {',
    ['overloaded marine service is retried once'], 'retry on overload'],
  ['app.js', "LIMIT_KEYS.forEach((k) => $(k).addEventListener('input', onSettingsChange));", '', OFFSHORE, 'editable limits'],
  ['app.js', '  ].filter(Boolean));', '  ]);', OFFSHORE, 'stray "null" in verdict'],
  ['app.js', 'box.className = `sea-point ${cov.status}`;', "box.className = 'sea-point';", FAR_SPOTS, 'far sea point warning'],
  ['index.html', 'and 1.5 to 2.5 hours early in Southampton Water and Poole Harbour', 'and later elsewhere', SPOTS, 'measured tide error warning'],
  ['logic.js', '.filter(({ c, km }) => km <= c.radiusKm)', '.filter(() => true)',
    ['tide reliability outside the checked areas', 'unchecked open-coast spot: NOT CHECKED badge and general EasyTide link'], 'checked-area radius'],
  ['logic.js', '.sort((a, b) => a.km - b.km)[0];', '.sort((a, b) => b.km - a.km)[0];',
    ['tide reliability outside the checked areas'], 'nearest checked area'],
  ['logic.js', "if (coverage.status === 'far') {", 'if (false) {', ['tide reliability outside the checked areas'], 'far sea point lowers reliability'],
  ['logic.js', "if (!coverage || coverage.status === 'none') {", 'if (!coverage) {',
    ['tide reliability outside the checked areas', 'inland spot is flagged and never rated GO'], 'no-data reliability'],
  ['logic.js', "id: '0063A', level: 'low'", "id: '0063A', level: 'medium'",
    ['tide reliability for the six checked UK spots', 'UK spot: Hamble'], 'Hamble reliability level'],
  ['logic.js', '`${EASYTIDE_HOME}?PortID=', '`${EASYTIDE_HOME}?port=',
    ['EasyTide station link format', 'tide reliability for the six checked UK spots', ...TIDE_SPOTS], 'official station link'],
  ['app.js', '`Tide reliability: ${RELIABILITY_LABEL[rel.level]}`', '`Tide reliability: ${RELIABILITY_LABEL.medium}`',
    ['UK spot: Portland Bill', 'UK spot: Hamble', 'UK spot: Itchen', 'UK spot: Poole', 'inland spot is flagged and never rated GO',
      'unchecked open-coast spot: NOT CHECKED badge and general EasyTide link'], 'reliability badge text'],
  ['app.js', '  renderTideReliability(tideReliability(state.place.lat, state.place.lon, coverage));', '', TIDE_SPOTS, 'reliability panel shown'],
  ['sw.js', 'caches.open(CACHE).then((c) => c.addAll(SHELL))', 'Promise.resolve()',
    ['works offline: page and last forecast open with no connection'], 'offline: page files cached'],
  ['app.js', '  navigator.serviceWorker.register(\'sw.js\')', '  Promise.reject()',
    ['works offline: page and last forecast open with no connection'], 'offline: service worker registered'],
  ['app.js', '    saveForecast(place, state.data);\n', '',
    ['works offline: page and last forecast open with no connection'], 'offline: forecast saved'],
  ['logic.js', 'return same ? saved : null;', 'return null;',
    ['offline: saved forecast only reused for the same spot', 'works offline: page and last forecast open with no connection'], 'offline: saved forecast reused'],
  ['logic.js', "if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;", '', ['offline: age of a saved forecast in plain English'], 'offline: age wording'],
  ['logic.js', 'h.windP90 > limits.maxWindKn) {', 'h.windP90 > limits.maxWindKn * 3) {',
    ['confidence: wording bands and rating', 'forecast confidence: wide model spread flags Uncertain and shows the range'], 'confidence: uncertain caution'],
  ['logic.js', "filter((k) => k.startsWith('wind_speed_10m'))", "filter((k) => k === 'wind_speed_10m')",
    ['confidence: spread read from any wind_speed_10m key, in knots', 'forecast confidence: wide model spread flags Uncertain and shows the range'], 'confidence: all model runs read'],
  ['logic.js', '+ (sorted[hi] - sorted[lo]) * (idx - lo);', ';', ['confidence: percentile of model runs'], 'confidence: percentile interpolation'],
  ['logic.js', 'keys.map((k) => toKnots(h[k][i], unit))', 'keys.map((k) => h[k][i])',
    ['confidence: spread read from any wind_speed_10m key, in knots'], 'confidence: units'],
  ['logic.js', 'if (vals.length < 5) return; // too few runs to say anything', '',
    ['confidence: spread read from any wind_speed_10m key, in knots'], 'confidence: minimum runs'],
  ['logic.js', "if (range <= 6) return 'high';", "if (range <= 1) return 'high';", ['confidence: wording bands and rating'], 'confidence: wording'],
  ['logic.js', 'const s = spread.get(h.time);', 'const s = null;',
    ['confidence: spread read from any wind_speed_10m key, in knots', 'forecast confidence: wide model spread flags Uncertain and shows the range'], 'confidence: attached to hours'],
  ['app.js', '      if (pts.length > 1) {', '      if (false) {', ['forecast confidence: wide model spread flags Uncertain and shows the range'], 'confidence: chart band'],
  ['app.js', "h.windP90 == null ? 'Forecast confidence unavailable'", "h.windP90 == null ? ''", ['forecast confidence: ensemble service down, app carries on'], 'confidence: unavailable note'],
  ['app.js', "if (weather.status === 'rejected') throw", "if (weather.status === 'rejected' || ensemble.status === 'rejected') throw",
    ['forecast confidence: ensemble service down, app carries on'], 'confidence: optional service'],
  ['style.css', '.chart { overflow-x: auto; }', '', ['offshore wind and editable limits (phone, dark)'], 'phone layout'],
];

function runTests(dir, files) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: dir, encoding: 'utf8' });
  const failed = new Set();
  const passed = new Set();
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*(not ok|ok) \d+ - (.+?)(?: # .*)?$/);
    if (m) (m[1] === 'ok' ? passed : failed).add(m[2]);
  }
  return { failed, passed };
}

function freshCopy() {
  rmSync(SCRATCH, { recursive: true, force: true });
  cpSync(join(REPO, 'kayak'), join(SCRATCH, 'kayak'), { recursive: true });
  return join(SCRATCH, 'kayak');
}

// Baseline: everything must pass unmutated.
const base = runTests(freshCopy(), [UNIT, BROWSER]);
if (base.failed.size) {
  console.error('Baseline failing, fix tests first:', [...base.failed]);
  process.exit(1);
}
// Parent tests only (browser/unit tests have no nested subtests).
const allTests = [...base.passed].filter((n) => !n.endsWith('.mjs'));
const browserTests = new Set(runTests(freshCopy(), [BROWSER]).passed);

const only = process.env.MUTANT_ONLY;
const selected = only ? MUTANTS.filter((m) => m[4].includes(only)) : MUTANTS;
const killedBy = new Map(allTests.map((t) => [t, []]));
let problems = 0;
for (const [file, find, replace, kills, what] of selected) {
  const dir = freshCopy();
  const path = join(dir, file);
  const src = readFileSync(path, 'utf8');
  const count = src.split(find).length - 1;
  if (count !== 1) {
    console.log(`BAD MUTANT  ${what}: text found ${count} times in ${file}`);
    problems += 1;
    continue;
  }
  writeFileSync(path, src.replace(find, replace));
  const files = kills.some((k) => browserTests.has(k)) ? [UNIT, BROWSER] : [UNIT];
  const { failed } = runTests(dir, files);
  failed.forEach((t) => killedBy.get(t)?.push(what));
  const missed = kills.filter((k) => !failed.has(k));
  if (missed.length) problems += 1;
  console.log(`${missed.length ? 'SURVIVED' : 'caught  '}  ${what.padEnd(32)} -> ${missed.length ? `not failed: ${missed.join('; ')}` : `${failed.size} failing test(s)`}`);
}
rmSync(SCRATCH, { recursive: true, force: true });

console.log('\nEvery test, and the deliberate breaks that made it fail:');
for (const [t, whats] of killedBy) {
  if (only) break;
  if (!whats.length) problems += 1;
  console.log(`${whats.length ? 'ok  ' : 'NONE'}  ${t}  <-  ${whats.join(', ') || 'no break made this test fail'}`);
}
console.log(`\n${selected.length} deliberate breaks${only ? ` (only "${only}")` : ''}, ${allTests.length} tests, ${problems} problem(s).`);
process.exit(problems ? 1 : 0);
