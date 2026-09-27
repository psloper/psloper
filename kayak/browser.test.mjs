// End-to-end check of the page in headless Chromium with every Open-Meteo
// call answered by fixed fake data, so it runs offline and is repeatable.
// Run with: npm run test:browser
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };

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

// 96 hours starting at today's midnight. utc_offset 0 keeps local time = UTC.
function fakeData() {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const times = Array.from({ length: 96 }, (_, i) => new Date(start + i * 3600e3).toISOString().slice(0, 16));
  const days = Array.from({ length: 4 }, (_, d) => new Date(start + d * 864e5).toISOString().slice(0, 10));
  const same = (v) => times.map(() => v);
  return {
    weather: {
      utc_offset_seconds: 0,
      hourly: {
        time: times,
        wind_speed_10m: same(7), wind_gusts_10m: same(9), wind_direction_10m: same(90), // steady easterly
        temperature_2m: same(14), apparent_temperature: same(12), precipitation_probability: same(10),
        precipitation: same(0), visibility: same(24000), weather_code: same(2),
      },
      daily: { time: days, sunrise: days.map((d) => `${d}T06:00`), sunset: days.map((d) => `${d}T20:00`) },
    },
    marine: {
      hourly_units: { ocean_current_velocity: 'km/h' },
      hourly: {
        time: times,
        wave_height: same(0.3), wave_direction: same(250), wave_period: same(6),
        swell_wave_height: same(0.2), swell_wave_period: same(10), sea_surface_temperature: same(13),
        sea_level_height_msl: times.map((_, i) => 2 * Math.cos((2 * Math.PI * (i - 3)) / 12.42)),
        ocean_current_velocity: same(0.5), ocean_current_direction: same(0),
      },
    },
    geo: {
      results: [
        { name: 'Newport', country_code: 'US', country: 'United States', latitude: 41.49, longitude: -71.31 },
        { name: 'Newport', country_code: 'GB', admin1: 'Wales', country: 'United Kingdom', latitude: 51.58, longitude: -2.99 },
      ],
    },
  };
}

test('kayak page end to end with mocked data', async (t) => {
  const server = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); server.close(); });
  const data = fakeData();

  for (const [label, opts] of [
    ['desktop', { viewport: { width: 1200, height: 900 } }],
    ['phone, dark', { viewport: { width: 390, height: 844 }, colorScheme: 'dark' }],
  ]) {
    await t.test(label, async () => {
      const page = await browser.newPage(opts);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: data.weather }));
      await page.route('https://marine-api.open-meteo.com/**', (r) => r.fulfill({ json: data.marine }));
      await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: data.geo }));

      await page.goto(`http://127.0.0.1:${server.address().port}/kayak/`);
      await page.fill('#search', 'Newport');
      await page.click('#search-form button[type=submit]');
      const first = page.locator('#search-results button').first();
      assert.match(await first.textContent(), /Wales/, 'UK result should be listed first');
      await first.click();
      await page.waitForSelector('#report:not([hidden])');

      // Beginner, no beach bearing: 7 kn is under the 10 kn limit and 80% of it, so GO in daylight.
      // Beach faces west; an easterly blows off the land = offshore, over the 5 kn beginner limit.
      await page.selectOption('#sea-bearing', '270');
      const hourly = page.locator('#hourly tbody tr:not(.day-break)');
      assert.equal(await hourly.count(), 72, '72 hourly rows');
      assert.equal(await page.locator('#hourly .pill.nogo').count(), 72, 'every hour NO-GO for offshore wind');
      const whyText = await page.locator('#hourly td.why').allTextContents();
      assert.ok(whyText.every((w) => w.includes('Offshore')), 'every hour flags offshore wind');
      assert.match(await page.textContent('#verdict'), /NO-GO/);
      assert.doesNotMatch(await page.textContent('#verdict'), /null|undefined/);

      // Tides: listed, and labelled as a model estimate with an official link.
      assert.match(await page.textContent('#tides'), /High .*m/);
      assert.match(await page.textContent('.warn'), /not official/i);
      assert.equal(await page.locator('a[href^="https://easytide.admiralty.co.uk"]').count() > 0, true);

      // Raising the offshore limit clears the flag, proving limits are live.
      await page.fill('#maxOffshoreKn', '10');
      // Nothing else is near a limit, so no hour should stay NO-GO (offshore stays a CAUTION).
      assert.equal(await page.locator('#hourly .pill.nogo').count(), 0, 'no NO-GO hours after raising limit');
      assert.equal(await page.locator('#hourly .pill.go').count(), 0, 'offshore still at least CAUTION');

      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
});
