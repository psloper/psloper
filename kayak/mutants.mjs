// Proves each test can fail: breaks one feature at a time in a scratch copy
// of kayak/, runs the tests, and checks that the tests named in `kills`
// fail (only those tests are run, to keep it fast). Then checks every test
// was made to fail by at least one break.
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
const UNITS = ['logic.test.mjs', 'tides-official.test.mjs', 'live-check.test.mjs', 'planner.test.mjs', 'triplog.test.mjs'];
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
  ['app.js', "  renderTideReliability(off?.status === 'ok'", "  (off?.status === 'ok'", TIDE_SPOTS, 'reliability panel shown'],
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
  ['hazards.js', '.filter((h) => h.km <= radiusKm)', '.filter((h) => h.km <= radiusKm * 2)',
    ['hazards: nearest known races for the six UK spots', 'UK spot: Hamble'], 'hazards: radius'],
  ['hazards.js', '.sort((a, b) => a.km - b.km);', '.sort((a, b) => b.km - a.km);',
    ['hazards: nearest known races for the six UK spots', 'UK spot: Poole'], 'hazards: nearest first'],
  ['hazards.js', 'return ((Math.atan2(y, x) / rad) + 360) % 360;', 'return ((Math.atan2(x, y) / rad) + 360) % 360;',
    ['hazards: bearing between points', 'hazards: nearest known races for the six UK spots'], 'hazards: direction'],
  ['hazards.js', "{ name: 'Portland Race', lat: 50.49,", "{ name: 'Portland Race', lat: 50.3,",
    ['hazards: nearest known races for the six UK spots', 'UK spot: Portland Bill'], 'hazards: Portland Race position'],
  ['hazards.js', "source: 'Wikipedia (Falls of Lora, Connel Bridge)',", '', ['hazards: list is sane'], 'hazards: checked needs a source'],
  ['app.js', "hazards.length ? el('p', { class: 'hazard-line' }", "false ? el('p', { class: 'hazard-line' }", ['UK spot: Oban', 'UK spot: Rhoscolyn', 'UK spot: Portland Bill', 'UK spot: Poole'], 'hazards: verdict line'],
  ['app.js', '  renderHazards(hazards);\n', '', ['UK spot: Oban', 'UK spot: Rhoscolyn', 'UK spot: Portland Bill', 'UK spot: Poole'], 'hazards: list shown'],
  ['sw.js', "'logic.js', 'hazards.js',", "'logic.js',", ['works offline: page and last forecast open with no connection'], 'offline: hazards file cached'],
  ['tides-official.js', "{ 'Ocp-Apim-Subscription-Key': key }", "{ 'Subscription-Key': key }",
    ['official tides: fetch sends the key and uses the nearest station', 'official tides: with a key, nearest station times replace the model'], 'official: key header'],
  ['tides-official.js', 'if (!best || km < best.km)', 'if (!best || km > best.km)',
    ['official tides: nearest station', 'official tides: fetch sends the key and uses the nearest station', 'official tides: with a key, nearest station times replace the model'], 'official: nearest station'],
  ['tides-official.js', '? dt : `${dt}Z`', '? dt : dt', ['official tides: events parsed from text or number types, UTC times'], 'official: times are UTC'],
  ['tides-official.js', 'rawType === 0 || ', '', ['official tides: events parsed from text or number types, UTC times'], 'official: numeric event types'],
  ['tides-official.js', 'Math.abs(m.t - t) <= 4 * 3600e3', 'Math.abs(m.t - t) <= 99 * 3600e3', ['official tides: model difference in minutes, in local time'], 'official: match window'],
  ['tides-official.js', 'const t = e.utcMs + utcOffsetSeconds * 1000;', 'const t = e.utcMs;', ['official tides: model difference in minutes, in local time'], 'official: local time'],
  ['tides-official.js', "if (res.status === 401 || res.status === 403) throw new Error('Admiralty API key was rejected');", '',
    ['official tides: clear errors for a bad key or no connection', 'official tides: rejected key falls back to the model, with a clear message'], 'official: rejected key message'],
  ['app.js', '    loadOfficialTides(place);\n', '', ['official tides: with a key, nearest station times replace the model'], 'official: fetched after forecast'],
  ['app.js', "if (!key) { state.official = null; return; }", "if (false) { state.official = null; return; }", ['official tides: no key, Admiralty never contacted'], 'official: only with a key'],
  ['app.js', "      level: 'official', area: off.station.name,", "      level: 'medium', area: off.station.name,", ['official tides: with a key, nearest station times replace the model'], 'official: badge'],
  ['sw.js', "'hazards.js', 'tides-official.js',", "'hazards.js',", ['offline cache lists every file the app loads'], 'offline: official tides file cached'],
  ['tides-official.js', '.filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));', '.filter((s) => s.id);',
    ['official tides: station list parsed, bad entries dropped'], 'official: bad stations dropped'],
  ['live-check-lib.mjs', "else if (first.name !== spot.expect || first.country_code !== 'GB')", "else if (first.country_code !== 'GB')",
    ['live check: wrong first search result fails'], 'live check: search ranking'],
  ['live-check-lib.mjs', "if (weather.hourly_units?.wind_speed_10m !== 'kn')", 'if (false)',
    ['live check: missing field, wrong unit and unknown current unit fail'], 'live check: wind unit'],
  ['live-check-lib.mjs', 'if (!KNOWN_SPEED_UNITS.includes(cu))', 'if (false)', ['live check: missing field, wrong unit and unknown current unit fail'], 'live check: current unit'],
  ['live-check-lib.mjs', 'for (const k of MARINE_HOURLY) {', 'for (const k of []) {', ['live check: missing field, wrong unit and unknown current unit fail'], 'live check: marine fields'],
  ['live-check-lib.mjs', 'share(rows, (h) => isNum(h.waveM)) < 0.9', 'share(rows, (h) => isNum(h.waveM)) < 0',
    ['live check: misaligned hours and too few ensemble runs fail'], 'live check: hour alignment'],
  ['live-check-lib.mjs', 'if (runs < 20)', 'if (runs < 2)', ['live check: misaligned hours and too few ensemble runs fail'], 'live check: ensemble runs'],
  ['live-check-lib.mjs', 'warnings.push(`marine: sea model point now', 'fail(`marine: sea model point now',
    ['live check: moved sea model point is a warning, not a failure'], 'live check: moved point only warns'],
  ['live-check-lib.mjs', "fail(`marine: ${e.message}`); marine = null;", 'throw e;', ['live check: service error is reported, not thrown'], 'live check: errors reported'],
  ['live-check-lib.mjs', 'if (admiraltyKey && weather) {', 'if (false) {', ['live check: official tide comparison with a key'], 'live check: official comparison'],
  ['live-check-lib.mjs', 'const result = r.failures.length ? `FAIL', 'const result = false ? `FAIL', ['live check: report lists failures'], 'live check: report'],
  ['live-check-lib.mjs', 'if (turns.length < 10 || turns.length > 20)', 'if (turns.length < 10 || turns.length > 12)',
    ['live check: healthy services pass'], 'live check: no false alarms on healthy data'],
  ['logic.js', 'export const MIN_TIDE_RANGE_M = 0.15;', 'export const MIN_TIDE_RANGE_M = 0;',
    ['tides: double high water shown as one high, first peak kept', 'live check: wiggly Solent-style tide passes once wiggles are merged',
      'tides: double high water shown once, with its second peak'], 'tides: wiggles merged'],
  ['logic.js', 'export const MIN_TIDE_RANGE_M = 0.15;', 'export const MIN_TIDE_RANGE_M = 0.6;', ['tides: real highs and lows are never merged'], 'tides: real tides kept'],
  ['logic.js', '      turns.splice(i + 1, 2);', '      turns.splice(i, 2);', ['tides: double high water shown as one high, first peak kept'], 'tides: first peak kept'],
  ['app.js', "    t.secondT ? el('span', { class: 'fine' }", "    false ? el('span', { class: 'fine' }", ['tides: double high water shown once, with its second peak'], 'tides: double label'],
  ['planner.js', 'return currentKn * Math.cos((diff * Math.PI) / 180);', 'return currentKn;',
    ['planner: current along the route', 'planner: tide with you and against you', 'trip planner: durations follow the tide, best departure first'], 'planner: current direction'],
  ['planner.js', 'const heading = outbound ? bearing : (bearing + 180) % 360;', 'const heading = bearing;',
    ['planner: out and back turns round at half way', 'trip planner: durations follow the tide, best departure first'], 'planner: turn at half way'],
  ['planner.js', 'if (ground < MIN_PROGRESS_KN) {', 'if (false) {', ['planner: tide with you and against you'], 'planner: held by the tide'],
  ['planner.js', '    if (done + ground * dt > target) dt = (target - done) / ground;\n', '',
    ['planner: still water takes distance / speed', 'planner: out and back turns round at half way', 'trip planner: durations follow the tide, best departure first'], 'planner: exact finish and turn'],
  ['planner.js', 'if (ORDER.indexOf(h.rating) > ORDER.indexOf(worst)) worst = h.rating;', '', ['planner: worst rating met on the way'], 'planner: worst rating'],
  ['planner.js', "if (!h) return { start, feasible: false, why: 'the trip runs past the end of the forecast' };", 'if (!h) return { start, feasible: false, why: \'\' };',
    ['planner: beyond the forecast is not a plan'], 'planner: end of forecast'],
  ['planner.js', 'if ((t - start) / 3600e3 > MAX_TRIP_H) return', 'if (false) return', ['planner: beyond the forecast is not a plan'], 'planner: 12-hour cap'],
  ['planner.js', '    if (!isDaylight(h.t, daylight)) return;\n', '', ['planner: daylight departures, best first'], 'planner: daylight starts only'],
  ['planner.js', 'const feasible = plans.filter((p) => p.feasible).sort((a, b) => ORDER.indexOf(a.worst) - ORDER.indexOf(b.worst)\n    || ',
    'const feasible = plans.filter((p) => p.feasible).sort((a, b) => ', ['planner: daylight departures, best first'], 'planner: safest first'],
  ['app.js', "el('tr', { class: i === 0 ? 'best' : '' }", "el('tr', { class: '' }", ['trip planner: durations follow the tide, best departure first'], 'planner: best highlighted'],
  ['app.js', "    note.textContent = 'Enter a distance and paddling speed above zero.';", "    note.textContent = '';", ['trip planner: durations follow the tide, best departure first'], 'planner: bad input message'],
  ['sw.js', "'requests.js', 'planner.js',", "'requests.js',", ['offline cache lists every file the app loads'], 'offline: planner file cached'],
  ['triplog.js', 'if (trips.length < MIN_TRIPS) {', 'if (false) {', ['trip log: not enough trips, no suggestion'], 'trip log: minimum trips'],
  ['triplog.js', "e.feel === 'too-much' && e[m.key] <= current", "e.feel === 'hard' && e[m.key] <= current",
    ['trip log: too much inside your limit lowers it', 'trip log: log, keep after reload, suggest, apply, export, import, delete'], 'trip log: too much lowers'],
  ['triplog.js', 'const candidate = above[1];', 'const candidate = above[0];', ['trip log: comfortable trips above your limit raise it, cautiously'], 'trip log: cautious raise'],
  ['triplog.js', 'const contradicted = trips.some(', 'const contradicted = false && trips.some(', ['trip log: a hard trip below the candidate blocks raising'], 'trip log: hard trip blocks raise'],
  ['triplog.js', 'if (above.length >= 2) {', 'if (above.length >= 0) {', ['trip log: fits your limit, keep it'], 'trip log: keep when it fits'],
  ['triplog.js', "typeof e.when === 'string' && FEELS[e.feel])", "typeof e.when === 'string')", ['trip log: import keeps good entries, drops bad, no duplicates'], 'trip log: bad entries dropped'],
  ['triplog.js', 'const byId = new Map(existing.map((e) => [e.id, e]));', 'const byId = new Map(existing.map((e, i) => [i, e]));',
    ['trip log: import keeps good entries, drops bad, no duplicates'], 'trip log: no duplicates'],
  ['triplog.js', 'windKn: num(hour.windKn), gustKn', 'windKn: null, gustKn', ['trip log: entry records the hour and how it felt', 'trip log: log, keep after reload, suggest, apply, export, import, delete'], 'trip log: conditions recorded'],
  ['app.js', '    saveLog(mergeEntries(loadLog(), [entry]));\n', '', ['trip log: log, keep after reload, suggest, apply, export, import, delete'], 'trip log: trips saved'],
  ['app.js', '    for (const s of state.suggestions || []) limits[s.metric.limit] = s.suggested;\n', '', ['trip log: log, keep after reload, suggest, apply, export, import, delete'], 'trip log: apply suggestions'],
  ['app.js', "download: 'kayak-trip-log.json'", "'data-x': 'kayak-trip-log.json'", ['trip log: log, keep after reload, suggest, apply, export, import, delete'], 'trip log: export'],
  ['app.js', '      saveLog(merged);\n', '', ['trip log: log, keep after reload, suggest, apply, export, import, delete'], 'trip log: import'],
  ['sw.js', "'planner.js', 'triplog.js',", "'planner.js',", ['offline cache lists every file the app loads'], 'offline: trip log file cached'],
  ['style.css', '.file-btn input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }', '',
    ['offshore wind and editable limits (phone, dark)'], 'phone layout: file picker'],
  ['logic.js', 'const shown = value > max && Number(value.toFixed(digits)) <= max ? value.toFixed(digits + 1) : value.toFixed(digits);',
    'const shown = value.toFixed(digits);', ['over-limit values never read as equal to the limit'], 'wording: over-limit decimals'],
  ['style.css', '.chart { overflow-x: auto; }', '', ['offshore wind and editable limits (phone, dark)'], 'phone layout'],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Runs the given test files; with `names`, only those tests (much faster
// than the whole browser suite for every break).
function runTests(dir, files, names) {
  const filter = names ? [`--test-name-pattern=^(?:${names.map(escapeRe).join('|')})$`] : [];
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...filter, ...files], { cwd: dir, encoding: 'utf8' });
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
const base = runTests(freshCopy(), [...UNITS, BROWSER]);
if (base.failed.size) {
  console.error('Baseline failing, fix tests first:', [...base.failed]);
  process.exit(1);
}
// Parent tests only (browser/unit tests have no nested subtests).
const allTests = [...base.passed].filter((n) => !n.endsWith('.mjs'));
const browserTests = new Set(runTests(freshCopy(), [BROWSER]).passed);
const unitTests = new Set(runTests(freshCopy(), UNITS).passed);

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
  const unknown = kills.filter((k) => !browserTests.has(k) && !unitTests.has(k));
  if (unknown.length) {
    console.log(`BAD MUTANT  ${what}: no such test(s): ${unknown.join('; ')}`);
    problems += 1;
    continue;
  }
  const files = [...(kills.some((k) => unitTests.has(k)) ? UNITS : []), ...(kills.some((k) => browserTests.has(k)) ? [BROWSER] : [])];
  // Only the named tests run, so this proves each named test fails.
  const { failed } = runTests(dir, files, kills);
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
