// Verifies the ADS-B decoder against published reference messages from
// J. Sun, "The 1090 Megahertz Riddle", and round-trips the encoder used by the simulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hexToBits, decodeFrame, cprGlobal, encodeIdentification, encodeAirbornePosition,
  encodeVelocity, AdsbDemod, AircraftTracker,
} from '../js/decoders/adsb.js';

test('identification: 8D4840D6202CC371C32CE0576098 -> KLM1023', () => {
  const m = decodeFrame(hexToBits('8D4840D6202CC371C32CE0576098'));
  assert.equal(m.icao, '4840D6');
  assert.equal(m.tc, 4);
  assert.equal(m.callsign, 'KLM1023');
});

test('airborne position pair -> 52.2572, 3.9194 at 38000 ft', () => {
  const e = decodeFrame(hexToBits('8D40621D58C382D690C8AC2863A7'));
  const o = decodeFrame(hexToBits('8D40621D58C386435CC412692AD6'));
  assert.equal(e.odd, false);
  assert.equal(o.odd, true);
  assert.equal(e.altitude, 38000);
  const pos = cprGlobal({ lat: e.cprLat, lon: e.cprLon }, { lat: o.cprLat, lon: o.cprLon }, true);
  assert.ok(Math.abs(pos.lat - 52.2572) < 1e-3, `lat ${pos.lat}`);
  assert.ok(Math.abs(pos.lon - 3.91937) < 1e-3, `lon ${pos.lon}`);
});

test('velocity: 8D485020994409940838175B284F -> 159 kt, 182.9 deg, -832 fpm', () => {
  const m = decodeFrame(hexToBits('8D485020994409940838175B284F'));
  assert.ok(Math.abs(m.groundSpeed - 159.2) < 0.1, `gs ${m.groundSpeed}`);
  assert.ok(Math.abs(m.track - 182.88) < 0.05, `trk ${m.track}`);
  assert.equal(m.verticalRate, -832);
});

test('corrupted frame fails CRC', () => {
  const bits = hexToBits('8D4840D6202CC371C32CE0576098');
  bits[50] ^= 1;
  assert.equal(decodeFrame(bits), null);
});

test('encoder round-trips identification, position and velocity', () => {
  const icao = 0x43c0de;
  assert.equal(decodeFrame(encodeIdentification(icao, 'SIM204')).callsign, 'SIM204');
  const e = decodeFrame(encodeAirbornePosition(icao, 51.4712, -0.4531, 12025, false));
  const o = decodeFrame(encodeAirbornePosition(icao, 51.4712, -0.4531, 12025, true));
  assert.equal(e.altitude, 12025);
  const p = cprGlobal({ lat: e.cprLat, lon: e.cprLon }, { lat: o.cprLat, lon: o.cprLon }, false);
  assert.ok(Math.abs(p.lat - 51.4712) < 1e-4 && Math.abs(p.lon + 0.4531) < 1e-4, JSON.stringify(p));
  const v = decodeFrame(encodeVelocity(icao, 250, 275, -1280));
  assert.ok(Math.abs(v.groundSpeed - 250) < 1 && Math.abs(v.track - 275) < 0.5);
  assert.equal(v.verticalRate, -1280);
});

test('demodulator finds PPM frames in noisy 2 MS/s IQ', () => {
  const frames = [encodeIdentification(0xabc123, 'TEST1'), encodeVelocity(0xabc123, 300, 90, 0)];
  const n = 4000;
  const re = new Float32Array(n), im = new Float32Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  for (let i = 0; i < n; i++) { re[i] = rnd(); im[i] = rnd(); }
  frames.forEach((bits, f) => {
    const s0 = 500 + f * 1500;
    for (const k of [0, 2, 7, 9]) re[s0 + k] += 0.2;
    bits.forEach((b, i) => { re[s0 + 16 + i * 2 + (b ? 0 : 1)] += 0.2; });
  });
  const got = [];
  const demod = new AdsbDemod((m) => got.push(m));
  // Split across two calls to exercise the carry-over between blocks.
  demod.process(re.subarray(0, 1800), im.subarray(0, 1800), 1800);
  demod.process(re.subarray(1800), im.subarray(1800), n - 1800);
  assert.equal(got.length, 2);
  assert.equal(got[0].callsign, 'TEST1');
  const tracker = new AircraftTracker();
  got.forEach((m) => tracker.ingest(m, 0));
  assert.equal(tracker.list(0)[0].callsign, 'TEST1');
});
