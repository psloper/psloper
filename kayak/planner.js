// Departure planner: for a route direction, distance and paddling speed,
// works out how long the trip takes from each daylight departure time,
// using the modelled tidal current along the route, and the worst rating
// met on the way.
//
// Simplifications (shown on the page): current is the model's, at one sea
// point, so it inherits the tide reliability limits; wind is not taken off
// your speed; the route is a straight line.
import { angleDiff, isDaylight, RATING } from './logic.js';

const STEP_H = 1 / 6; // 10-minute steps
const MAX_TRIP_H = 12;
const MIN_PROGRESS_KN = 0.5; // below this you are effectively held by the current
const ORDER = [RATING.GO, RATING.CAUTION, RATING.NOGO];

// Current component along a heading (knots, + helps, - hinders). Current
// direction is "towards", heading is the way you paddle.
export function alongTrack(currentKn, currentDir, headingDeg) {
  if (currentKn == null || currentDir == null) return 0;
  const diff = angleDiff(currentDir, headingDeg); // 0 = with you, 180 = against
  return currentKn * Math.cos((diff * Math.PI) / 180);
}

// Simulates one trip starting at rows[startIdx].t.
export function planTrip(rows, startIdx, { bearing, distanceNm, speedKn, roundTrip = false }) {
  const start = rows[startIdx].t;
  const legNm = roundTrip ? distanceNm / 2 : distanceNm;
  let t = start;
  let done = 0;
  let assistTime = 0; // knot-hours of current along the route
  let worst = RATING.GO;
  const reasons = new Set();
  while (done < distanceNm - 1e-9) {
    const idx = startIdx + Math.floor((t - start) / 3600e3 + 1e-9);
    const h = rows[idx];
    if (!h || (t - start) / 3600e3 > MAX_TRIP_H) {
      return { start, feasible: false, why: `does not finish within ${MAX_TRIP_H} hours of forecast` };
    }
    if (ORDER.indexOf(h.rating) > ORDER.indexOf(worst)) worst = h.rating;
    h.reasons?.forEach((r) => reasons.add(r.tag));
    const outbound = !roundTrip || done < legNm - 1e-9;
    const heading = outbound ? bearing : (bearing + 180) % 360;
    const assist = alongTrack(h.currentKn, h.currentDir, heading);
    const ground = speedKn + assist;
    if (ground < MIN_PROGRESS_KN) {
      return { start, feasible: false, why: `current against you (${(-assist).toFixed(1)} kn) is too strong at ${new Date(t).toISOString().slice(11, 16)}` };
    }
    // Step 10 minutes, but stop exactly at the turning point or the finish.
    const target = outbound ? legNm : distanceNm;
    let dt = STEP_H;
    if (done + ground * dt > target) dt = (target - done) / ground;
    done += ground * dt;
    assistTime += assist * dt;
    t += dt * 3600e3;
  }
  const hours = (t - start) / 3600e3;
  return {
    start, end: t, hours, avgAssistKn: assistTime / hours,
    worst, reasons: [...reasons], feasible: true,
  };
}

// Plans from every hour that starts in daylight; best first: lowest worst
// rating, then finishing in daylight, then shortest.
export function planDepartures(rows, daylight, opts) {
  const plans = [];
  rows.forEach((h, i) => {
    if (!isDaylight(h.t, daylight)) return;
    const p = planTrip(rows, i, opts);
    if (p.feasible) p.endsInDaylight = isDaylight(p.end - 1, daylight);
    plans.push(p);
  });
  const feasible = plans.filter((p) => p.feasible).sort((a, b) => ORDER.indexOf(a.worst) - ORDER.indexOf(b.worst)
    || Number(b.endsInDaylight) - Number(a.endsInDaylight) || a.hours - b.hours || a.start - b.start);
  return { best: feasible, infeasible: plans.filter((p) => !p.feasible) };
}
