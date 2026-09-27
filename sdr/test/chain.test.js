// End-to-end: simulator IQ -> Receiver (mix, decimate, demodulate) -> CW / RTTY / ADS-B decoders.
// Also checks the chain runs faster than real time, since the browser must keep up at 2 MS/s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator, SIM_FS } from '../js/sources/simulator.js';
import { Receiver } from '../js/dsp/receiver.js';
import { CwDecoder } from '../js/decoders/cw.js';
import { RttyDecoder } from '../js/decoders/rtty.js';
import { AdsbDemod, AircraftTracker } from '../js/decoders/adsb.js';
import { SpectrumAnalyzer } from '../js/dsp/fft.js';

function run({ center, seconds, onBlock }) {
  const sim = new Simulator({ onData: onBlock });
  sim.setCenter(center);
  const block = SIM_FS / 50;
  const t0 = performance.now();
  for (let i = 0; i < seconds * 50; i++) sim.generate(block);
  return (performance.now() - t0) / 1000;
}

test('RTTY station on 14.0835 MHz decodes through USB demodulation', () => {
  const rx = new Receiver(48000);
  rx.configure({ fs: SIM_FS, mode: 'USB', bw: 2700, offset: 14.0835e6 - 14.1e6 });
  let text = '';
  const rtty = new RttyDecoder(rx.ifRate, (c) => { text += c; });
  rtty.configure({ markIsHigh: true });
  const spec = new SpectrumAnalyzer(4096);
  const elapsed = run({
    center: 14.1e6, seconds: 11,
    onBlock: (re, im, n) => {
      spec.push(re, im, n, SIM_FS);
      const r = rx.process(re, im, n);
      rtty.process(r.demod, r.demodN);
    },
  });
  console.log(`  RTTY text: ${JSON.stringify(text)}  (11 s simulated in ${elapsed.toFixed(2)} s)`);
  assert.match(text, /CQ CQ CQ DE SIM1RT/);
  assert.ok(elapsed < 11, 'chain must run faster than real time');
});

test('CW station on 14.025 MHz decodes in CW mode', () => {
  const rx = new Receiver(48000);
  rx.configure({ fs: SIM_FS, mode: 'CW', bw: 500, offset: 14.025e6 - 14.1e6 });
  let text = '';
  const cw = new CwDecoder(rx.ifRate, (c) => { text += c; });
  run({
    center: 14.1e6, seconds: 14,
    onBlock: (re, im, n) => { const r = rx.process(re, im, n); cw.process(r.demod, r.demodN); },
  });
  console.log(`  CW text: ${JSON.stringify(text)}  (${cw.wpm.toFixed(1)} WPM)`);
  assert.match(text, /DE SIM1CW/);
});

test('ADS-B traffic decodes at 1090 MHz with positions', () => {
  const tracker = new AircraftTracker();
  const demod = new AdsbDemod((m) => tracker.ingest(m, performance.now()));
  run({ center: 1090e6, seconds: 6, onBlock: (re, im, n) => demod.process(re, im, n) });
  const list = tracker.list(performance.now());
  const withPos = list.filter((a) => a.lat != null && a.callsign);
  console.log(`  ADS-B: ${list.length} aircraft, ${withPos.length} with callsign+position, stats ${JSON.stringify(demod.stats)}`);
  assert.ok(withPos.length >= 6);
  for (const a of withPos) assert.ok(Math.abs(a.lat - 51.47) < 2 && Math.abs(a.lon + 0.45) < 3);
});
