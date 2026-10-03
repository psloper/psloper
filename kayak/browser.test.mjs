// End-to-end checks of the page in headless Chromium. Every Open-Meteo call
// is answered locally, so the tests run offline and give the same result
// every time. Run with: npm run test:browser
//
// Place search results and sea model points for the six UK spots are copied
// from the live Open-Meteo services (checked 27 Sept 2026). Weather, wave
// and tide values are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

function serve() {
  const server = http.createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const place = (name, admin1, country_code, latitude, longitude) => ({
  name, admin1, country_code, country: country_code === 'GB' ? 'United Kingdom' : country_code, latitude, longitude,
});

// query -> live result order (trimmed), the result we expect first, and the
// live marine grid point for that launch with its distance.
const SPOTS = [
  {
    hazard: 'Falls of Lora',
    query: 'Oban', expect: 'Oban, Scotland', sea: [56.291664, -5.4583282], km: '13.8', far: true, tide: ['MEDIUM', 'Oban', '0372'],
    results: [place('Assaria', 'Kansas', 'US', 38.68028, -97.60448), place('Oban', 'Scotland', 'GB', 56.41535, -5.47184),
      place('Oban', 'Southland', 'NZ', -46.89887, 168.12897)],
  },
  {
    hazard: 'Penrhyn Mawr',
    query: 'Rhoscolyn', expect: 'Rhoscolyn, Wales', sea: [53.291664, -4.6249847], km: '5.0', far: false, tide: ['MEDIUM', 'Trearddur Bay', '0479'],
    results: [place('Rhoscolyn', 'Wales', 'GB', 53.25014, -4.59793), place('Rhoscolyn Head', 'Wales', 'GB', 53.25, -4.61667)],
  },
  {
    hazard: 'Portland Race',
    query: 'Portland Bill', expect: 'Portland Bill, England', sea: [50.541664, -2.4583282], km: '2.7', far: false, tide: ['LOW', 'Portland', '0033'],
    results: [place('Portland Bill', 'England', 'GB', 50.51733, -2.45566)],
  },
  {
    hazard: null,
    query: 'Hamble', expect: 'Hamble-le-Rice, England', sea: [50.791664, -1.3749847], km: '8.4', far: true, tide: ['LOW', 'Warsash', '0063A'],
    results: [place('Hamble', 'Tennessee', 'US', 36.307, -87.28334), place('Hambleton', 'England', 'GB', 53.76667, -1.16667),
      place('Hambledon', 'England', 'GB', 50.93155, -1.08104), place('Hamble-le-Rice', 'England', 'GB', 50.85966, -1.32432)],
  },
  {
    hazard: null,
    query: 'Itchen', expect: 'Itchen, England', sea: [50.791664, -1.3749847], km: '12.6', far: true, tide: ['LOW', 'Southampton', '0062'],
    results: [place('Itchen', 'England', 'GB', 50.90451, -1.36936), place('Itchenor', 'England', 'GB', 50.80561, -0.86689),
      place('Itchen Abbas', 'England', 'GB', 51.09336, -1.23828)],
  },
  {
    hazard: 'Poole Harbour entrance',
    query: 'Poole', expect: 'Poole, England', sea: [50.625008, -1.9583282], km: '10.1', far: true, tide: ['LOW', 'Poole Harbour', '0036A'],
    results: [place('Poole', 'England', 'GB', 50.71429, -1.98458), place('Poole', 'Kentucky', 'US', 37.64032, -87.64418)],
  },
];

// 96 hours from today's midnight. utc_offset 0 keeps local time = UTC.
function fakeData({ windDir = 90, sea = [0, 0], seaNull = false, spread = 0.1 } = {}) {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const times = Array.from({ length: 96 }, (_, i) => new Date(start + i * 3600e3).toISOString().slice(0, 16));
  const days = Array.from({ length: 4 }, (_, d) => new Date(start + d * 864e5).toISOString().slice(0, 10));
  const same = (v) => times.map(() => (seaNull ? null : v));
  const fixed = (v) => times.map(() => v);
  return {
    weather: {
      utc_offset_seconds: 0,
      hourly: {
        time: times,
        wind_speed_10m: fixed(7), wind_gusts_10m: fixed(9), wind_direction_10m: fixed(windDir),
        temperature_2m: fixed(14), apparent_temperature: fixed(12), precipitation_probability: fixed(10),
        precipitation: fixed(0), visibility: fixed(24000), weather_code: fixed(2),
      },
      daily: { time: days, sunrise: days.map((d) => `${d}T06:00`), sunset: days.map((d) => `${d}T20:00`) },
    },
    // 51 runs (control + 50 members) around the 7 kn forecast; `spread` is
    // the knots between neighbouring runs. Member naming follows Open-Meteo's
    // pattern, but the app reads any key starting "wind_speed_10m".
    ensemble: {
      hourly_units: { wind_speed_10m: 'kn' },
      hourly: Object.fromEntries([
        ['time', times],
        ...Array.from({ length: 51 }, (_, m) => [
          m === 0 ? 'wind_speed_10m' : `wind_speed_10m_member${String(m).padStart(2, '0')}`,
          fixed(Math.max(0, 7 + (m - 25) * spread)),
        ]),
      ]),
    },
    marine: {
      latitude: sea[0], longitude: sea[1],
      hourly_units: { ocean_current_velocity: 'km/h' },
      hourly: {
        time: times,
        wave_height: same(0.3), wave_direction: same(250), wave_period: same(6),
        swell_wave_height: same(0.2), swell_wave_period: same(10), sea_surface_temperature: same(13),
        sea_level_height_msl: times.map((_, i) => (seaNull ? null : 2 * Math.cos((2 * Math.PI * (i - 3)) / 12.42))),
        ocean_current_velocity: same(0.5), ocean_current_direction: same(0),
      },
    },
  };
}

// The page renders in well under a second; a short timeout keeps failing
// runs (and the deliberate-break check) fast.
const STEP_TIMEOUT_MS = 5000;

let server;
let browser;
let base;
test.before(async () => {
  server = await serve();
  browser = await chromium.launch();
  base = `http://127.0.0.1:${server.address().port}/kayak/`;
});
test.after(async () => { await browser?.close(); server?.close(); });

// Opens the page with mocked services. `marine` may be a function (route) => void.
async function openPage({ opts = { viewport: { width: 1200, height: 900 } }, geo, data, marine, ensemble } = {}) {
  const page = await browser.newPage(opts);
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: data.weather }));
  await page.route('https://marine-api.open-meteo.com/**', marine || ((r) => r.fulfill({ json: data.marine })));
  await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: { results: geo } }));
  await page.route('https://ensemble-api.open-meteo.com/**', ensemble || ((r) => r.fulfill({ json: data.ensemble })));
  await page.goto(base);
  return { page, errors };
}

async function searchAndPickFirst(page, query) {
  await page.fill('#search', query);
  await page.click('#search-form button[type=submit]');
  const first = page.locator('#search-results button').first();
  const label = await first.textContent();
  await first.click();
  await page.waitForSelector('#report:not([hidden])');
  return label;
}

for (const spot of SPOTS) {
  test(`UK spot: ${spot.query}`, async () => {
    const { page, errors } = await openPage({ geo: spot.results, data: fakeData({ sea: spot.sea }) });
    const label = await searchAndPickFirst(page, spot.query);
    assert.match(label, new RegExp(`^${spot.expect}`), `first result for "${spot.query}"`);

    const seaPoint = page.locator('#sea-point');
    assert.match(await seaPoint.textContent(), new RegExp(`${spot.km.replace('.', '\\.')} km from your launch`));
    assert.equal(await seaPoint.evaluate((n) => n.classList.contains('far')), spot.far, 'far sea point warning');

    assert.match(await page.textContent('#tides'), /High .*m/);
    assert.match(await page.textContent('.warn'), /1\.5 to 2\.5 hours early in Southampton Water and Poole Harbour/);

    // Nearest known tidal race, in the list and in the verdict.
    if (spot.hazard) {
      assert.match(await page.locator('#hazards li').first().textContent(), new RegExp(`^${spot.hazard} \\d+\\.\\d km`));
      assert.match(await page.textContent('#verdict .hazard-line'), new RegExp(`Known tidal race nearby: ${spot.hazard}`));
    } else {
      assert.match(await page.textContent('#hazards'), /None on this list within 20 km/);
      assert.equal(await page.locator('#verdict .hazard-line').count(), 0);
    }

    // Tide reliability badge and a link to that area's official station.
    const [level, station, id] = spot.tide;
    assert.match(await page.textContent('#tide-reliability .badge'), new RegExp(`Tide reliability: ${level}$`));
    const link = page.locator('#tide-reliability a.official');
    assert.equal(await link.getAttribute('href'), `https://easytide.admiralty.co.uk/?PortID=${id}`);
    assert.match(await link.textContent(), new RegExp(`Official tide times: ${station} `));
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('inland spot is flagged and never rated GO', async () => {
  // Hambleton, North Yorkshire: the live marine API returned all nulls.
  const geo = [place('Hambleton', 'England', 'GB', 53.76667, -1.16667)];
  const { page, errors } = await openPage({ geo, data: fakeData({ sea: [53.791664, -1.2083282], seaNull: true, windDir: 270 }) });
  await searchAndPickFirst(page, 'Hambleton');
  assert.match(await page.textContent('#sea-point'), /looks inland/);
  assert.match(await page.textContent('#tide-reliability .badge'), /NO DATA/);
  assert.equal(await page.locator('#hourly .pill.go').count(), 0, 'no GO hours without sea data');
  assert.doesNotMatch(await page.textContent('#verdict'), /^GO/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('unchecked open-coast spot: NOT CHECKED badge and general EasyTide link', async () => {
  // Synthetic spot with a close sea point, away from every checked area.
  const geo = [place('St Ives', 'England', 'GB', 50.21, -5.48)];
  const { page, errors } = await openPage({ geo, data: fakeData({ sea: [50.225, -5.475] }) });
  await searchAndPickFirst(page, 'St Ives');
  assert.match(await page.textContent('#tide-reliability .badge'), /NOT CHECKED/);
  assert.equal(await page.locator('#tide-reliability a.official').getAttribute('href'), 'https://easytide.admiralty.co.uk/');
  assert.deepEqual(errors, []);
  await page.close();
});

test('works offline: page and last forecast open with no connection', async () => {
  // Own server, so it can be shut down: the reload must then come from the
  // service worker cache, not the network.
  const ownServer = await serve();
  const url = `http://127.0.0.1:${ownServer.address().port}/kayak/`;
  const spot = SPOTS[5]; // Poole
  const data = fakeData({ sea: spot.sea });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: data.weather }));
  await page.route('https://marine-api.open-meteo.com/**', (r) => r.fulfill({ json: data.marine }));
  await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: { results: spot.results } }));
  await page.route('https://ensemble-api.open-meteo.com/**', (r) => r.fulfill({ json: data.ensemble }));
  try {
    await page.goto(url);
    await searchAndPickFirst(page, spot.query);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 });

    await new Promise((resolve) => ownServer.close(resolve));
    await page.unrouteAll();
    await page.route('https://*.open-meteo.com/**', (r) => r.abort('internetdisconnected'));
    await context.setOffline(true);
    await page.reload();

    await page.waitForSelector('#offline-banner:not([hidden])', { timeout: 10000 });
    assert.match(await page.textContent('#offline-banner'), /No connection\. Showing the forecast saved .* ago/);
    assert.equal(await page.locator('#report').isVisible(), true);
    assert.match(await page.textContent('#tides'), /High .*m/);
    assert.match(await page.textContent('#status'), /saved forecast for Poole/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    ownServer.close();
  }
});

test('forecast confidence: wide model spread flags Uncertain and shows the range', async () => {
  const spot = SPOTS[2]; // Portland Bill
  // Runs 7 + (m - 25) * 0.5 kn, clamped at 0: 10th percentile 0 kn, 90th 17 kn.
  const { page, errors } = await openPage({ geo: spot.results, data: fakeData({ sea: spot.sea, spread: 0.5 }) });
  await searchAndPickFirst(page, spot.query);
  const why = await page.locator('#hourly td.why').allTextContents();
  assert.ok(why.every((w) => w.includes('Uncertain')), 'every hour tagged Uncertain');
  assert.equal(await page.locator('#hourly .pill.go').count(), 0, 'no GO hours when the high end is over the limit');
  assert.match(await page.textContent('#verdict'), /1 in 10 model runs show 17 kn or more/);
  assert.match(await page.textContent('#now-cards'), /Wind range\s*0 to 17 kn\s*Model runs disagree: low confidence/);
  assert.match((await page.locator('#hourly tbody tr:not(.day-break)').first().textContent()), /0-17/);
  assert.equal(await page.locator('#chart path.spread-band').count(), 1, 'shaded range on the chart');
  assert.deepEqual(errors, []);
  await page.close();
});

test('forecast confidence: ensemble service down, app carries on', async () => {
  const spot = SPOTS[2];
  const ensemble = (r) => r.fulfill({ status: 400, json: { error: true, reason: 'Model not available' } });
  const { page } = await openPage({ geo: spot.results, data: fakeData({ sea: spot.sea }), ensemble });
  await searchAndPickFirst(page, spot.query);
  assert.match(await page.textContent('#now-cards'), /Forecast confidence unavailable/);
  assert.equal(await page.locator('#hourly tbody tr:not(.day-break)').count(), 72);
  assert.equal(await page.locator('#chart path.spread-band').count(), 0);
  await page.close();
});

test('overloaded marine service is retried once', async () => {
  const spot = SPOTS[2];
  let calls = 0;
  const data = fakeData({ sea: spot.sea });
  const marine = (r) => {
    calls += 1;
    if (calls === 1) return r.fulfill({ status: 503, json: { error: true, reason: 'The service is overloaded' } });
    return r.fulfill({ json: data.marine });
  };
  const { page } = await openPage({ geo: spot.results, data, marine });
  await searchAndPickFirst(page, spot.query);
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Forecast for'));
  assert.equal(calls, 2);
  assert.doesNotMatch(await page.textContent('#status'), /unavailable/);
  assert.doesNotMatch(await page.textContent('#sea-point'), /could not be loaded/);
  await page.close();
});

for (const [label, opts] of [
  ['desktop', { viewport: { width: 1200, height: 900 } }],
  ['phone, dark', { viewport: { width: 390, height: 844 }, colorScheme: 'dark' }],
]) {
  test(`offshore wind and editable limits (${label})`, async () => {
    const spot = SPOTS[2]; // Portland Bill
    const { page, errors } = await openPage({ opts, geo: spot.results, data: fakeData({ sea: spot.sea }) });
    await searchAndPickFirst(page, spot.query);

    // Beginner limits. Beach faces west; the steady easterly blows off the
    // land (offshore) at 7 kn, over the 5 kn beginner offshore limit.
    await page.selectOption('#sea-bearing', '270');
    assert.equal(await page.locator('#hourly tbody tr:not(.day-break)').count(), 72, '72 hourly rows');
    assert.equal(await page.locator('#hourly .pill.nogo').count(), 72, 'every hour NO-GO for offshore wind');
    assert.match(await page.textContent('#verdict'), /NO-GO/);
    assert.doesNotMatch(await page.textContent('#verdict'), /null|undefined/);
    assert.equal(await page.locator('a[href^="https://easytide.admiralty.co.uk"]').count() > 0, true);

    // Raising the offshore limit clears every NO-GO; offshore stays CAUTION.
    await page.fill('#maxOffshoreKn', '10');
    assert.equal(await page.locator('#hourly .pill.nogo').count(), 0, 'no NO-GO hours after raising limit');
    assert.equal(await page.locator('#hourly .pill.go').count(), 0, 'offshore still at least CAUTION');

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errors, []);
    await page.close();
  });
}
