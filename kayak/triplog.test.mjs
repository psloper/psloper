// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEntry, cleanEntries, mergeEntries, suggestLimits, MIN_TRIPS } from './triplog.js';
import { PROFILES } from './logic.js';

const limits = { ...PROFILES.beginner }; // wind 10, gust 15, waves 0.5
let n = 0;
const trip = (feel, windKn, gustKn = windKn * 1.4, waveM = 0.3) => ({
  id: `t${n += 1}`, when: `2026-10-0${(n % 9) + 1}T10:00`, place: 'Poole', lat: 50.7, lon: -2, windKn, gustKn, waveM, feel, notes: '',
});
const byLimit = (s) => Object.fromEntries(s.map((x) => [x.metric.limit, x]));

test('trip log: entry records the hour and how it felt', () => {
  const e = makeEntry({ place: { name: 'Poole', lat: 50.7, lon: -2 }, hour: { time: '2026-10-03T10:00', windKn: 9.6, gustKn: 14, waveM: 0.4, windDir: 200 }, feel: 'ok', notes: 'lumpy at the entrance' });
  assert.equal(e.when, '2026-10-03T10:00');
  assert.equal(e.windKn, 9.6);
  assert.equal(e.feel, 'ok');
  assert.match(e.id, /^[a-z0-9]+-[a-z0-9]+$/);
});

test('trip log: not enough trips, no suggestion', () => {
  const s = byLimit(suggestLimits([trip('ok', 14), trip('ok', 15)], limits));
  assert.equal(s.maxWindKn.suggested, 10);
  assert.match(s.maxWindKn.reason, new RegExp(`2 of ${MIN_TRIPS}`));
});

test('trip log: too much inside your limit lowers it', () => {
  const s = byLimit(suggestLimits([trip('ok', 5), trip('ok', 6), trip('too-much', 8, 11, 0.4)], limits));
  assert.equal(s.maxWindKn.suggested, 7);
  assert.match(s.maxWindKn.reason, /8 kn felt too much/);
  assert.equal(s.maxWaveM.suggested, 0.3); // 0.4 m felt too much, inside the 0.5 m limit
});

test('trip log: comfortable trips above your limit raise it, cautiously', () => {
  const s = byLimit(suggestLimits([trip('easy', 12), trip('ok', 14), trip('ok', 16)], limits));
  assert.equal(s.maxWindKn.suggested, 14); // second highest, not the highest
  assert.match(s.maxWindKn.reason, /3 trips above your limit felt fine/);
});

test('trip log: a hard trip below the candidate blocks raising', () => {
  const s = byLimit(suggestLimits([trip('ok', 12), trip('ok', 14), trip('hard', 11)], limits));
  assert.equal(s.maxWindKn.suggested, 10);
  assert.match(s.maxWindKn.reason, /Mixed results/);
});

test('trip log: fits your limit, keep it', () => {
  const s = byLimit(suggestLimits([trip('ok', 5), trip('easy', 6), trip('hard', 9)], limits));
  assert.equal(s.maxWindKn.suggested, 10);
});

test('trip log: import keeps good entries, drops bad, no duplicates', () => {
  const a = trip('ok', 5);
  const incoming = [a, { ...a }, { id: 'x', when: '2026-10-01T09:00', feel: 'brilliant' }, null, { id: 7 }, trip('hard', 9)];
  assert.equal(cleanEntries(incoming).length, 3);
  const merged = mergeEntries([a], incoming);
  assert.equal(merged.length, 2);
  assert.deepEqual(cleanEntries('not a list'), []);
  assert.ok(merged[0].when >= merged[1].when, 'newest first');
});
