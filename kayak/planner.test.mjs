// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { alongTrack, planTrip, planDepartures } from './planner.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const H = 3600e3;
// Hourly rows from 00:00; current towards `dir` at `kn`.
const rows = (n, { kn = 0, dir = 0, rating = 'go' } = {}) => Array.from({ length: n }, (_, i) => ({
  t: i * H, rating: typeof rating === 'function' ? rating(i) : rating, reasons: [], currentKn: kn, currentDir: dir,
}));
const opts = { bearing: 0, distanceNm: 6, speedKn: 3 };

test('planner: current along the route', () => {
  near(alongTrack(1, 0, 0), 1); // with you
  near(alongTrack(1, 180, 0), -1); // against you
  near(alongTrack(1, 90, 0), 0); // across
  assert.equal(alongTrack(null, 0, 0), 0);
});

test('planner: still water takes distance / speed', () => {
  const p = planTrip(rows(24), 0, opts);
  assert.ok(p.feasible);
  near(p.hours, 2);
  near(p.avgAssistKn, 0);
  near(planTrip(rows(24), 0, { ...opts, distanceNm: 5.2 }).hours, 5.2 / 3); // not a whole number of 10-min steps
});

test('planner: tide with you and against you', () => {
  near(planTrip(rows(24, { kn: 1, dir: 0 }), 0, opts).hours, 1.5); // 6 nm at 4 kn
  near(planTrip(rows(24, { kn: 1, dir: 180 }), 0, opts).hours, 3); // 6 nm at 2 kn
  const held = planTrip(rows(24, { kn: 3.5, dir: 180 }), 0, opts);
  assert.equal(held.feasible, false);
  assert.match(held.why, /current against you \(3\.5 kn\) is too strong/);
});

test('planner: out and back turns round at half way', () => {
  // Out 3 nm against 1 kn (2 kn, 1.5 h), back 3 nm with it (4 kn, 0.75 h).
  near(planTrip(rows(24, { kn: 1, dir: 180 }), 0, { ...opts, roundTrip: true }).hours, 2.25);
  // Turn point inside a 10-min step: out 3.1 nm at 2 kn, back 3.1 nm at 4 kn.
  near(planTrip(rows(24, { kn: 1, dir: 180 }), 0, { ...opts, distanceNm: 6.2, roundTrip: true }).hours, 3.1 / 2 + 3.1 / 4);
});

test('planner: worst rating met on the way', () => {
  const r = rows(24, { rating: (i) => (i === 2 ? 'nogo' : 'go') });
  assert.equal(planTrip(r, 0, opts).worst, 'go'); // 00:00 to 02:00
  assert.equal(planTrip(r, 1, opts).worst, 'nogo'); // 01:00 to 03:00 crosses 02:00
});

test('planner: beyond the forecast is not a plan', () => {
  assert.equal(planTrip(rows(3), 2, opts).feasible, false);
});

test('planner: daylight departures, best first', () => {
  // Daylight 06:00 to 18:00. 08:00 and 09:00 are NO-GO; tide against you after 12:00.
  const r = rows(24, { rating: (i) => (i === 8 || i === 9 ? 'nogo' : 'go') }).map((h, i) => ({ ...h, currentKn: i >= 12 ? 1 : 0, currentDir: 180 }));
  const daylight = [{ sunrise: 6 * H, sunset: 18 * H }];
  const { best, infeasible } = planDepartures(r, daylight, opts);
  assert.equal(infeasible.length, 0);
  assert.ok(best.every((p) => p.start >= 6 * H && p.start < 18 * H), 'daylight starts only');
  assert.equal(best[0].worst, 'go');
  assert.equal(best[0].start, 6 * H); // 06:00 to 08:00 just clears the NO-GO hours, still water, earliest
  assert.equal(best.find((p) => p.start === 7 * H).worst, 'nogo'); // 07:00 runs into 08:00
  assert.equal(best.at(-1).worst, 'nogo');
  const late = best.find((p) => p.start === 17 * H);
  assert.equal(late.endsInDaylight, false);
});
