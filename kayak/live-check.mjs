// Runs the live check against the real services. Used by the daily GitHub
// Actions job; can also be run by hand where the network allows it:
//   node kayak/live-check.mjs            (ADMIRALTY_API_KEY optional)
import { appendFileSync } from 'node:fs';
import { LIVE_SPOTS, checkSpot, formatReport } from './live-check-lib.mjs';

const RETRY_DELAY_MS = 2000;
const PAUSE_BETWEEN_SPOTS_MS = 500; // be polite to the free services

async function fetchJson(url, retries = 1) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (res.ok && !body.error) return body;
  if (retries > 0 && (res.status >= 500 || res.status === 429 || /overload/i.test(body.reason || ''))) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return fetchJson(url, retries - 1);
  }
  throw new Error(body.reason || `HTTP ${res.status}`);
}

const admiraltyKey = process.env.ADMIRALTY_API_KEY || '';
const results = [];
for (const spot of LIVE_SPOTS) {
  results.push(await checkSpot(spot, { fetchJson, admiraltyKey, fetchFn: fetch }));
  await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_SPOTS_MS));
}

const report = formatReport(results, { admiralty: Boolean(admiraltyKey) });
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
if (!admiraltyKey) console.log('\n(No ADMIRALTY_API_KEY: official tide comparison skipped.)');
process.exit(results.some((r) => r.failures.length) ? 1 : 0);
