// rtl_tcp path: fake rtl_tcp server <-TCP-> ws_tcp_bridge.py <-WebSocket-> RtlTcpSource.
// Checks the header parse, command encoding and that IQ arrives intact (tone at +100 kHz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RtlTcpSource } from '../js/sources/rtltcp.js';
import { SpectrumAnalyzer } from '../js/dsp/fft.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function start(cmd, args, readyText) {
  const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.lines = [];
  const ready = new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => {
      for (const l of String(d).split('\n').filter(Boolean)) {
        proc.lines.push(l);
        if (l.includes(readyText)) resolve();
      }
    });
    proc.on('exit', (c) => reject(new Error(`${args[0]} exited ${c}`)));
  });
  return { proc, ready };
}

test('rtl_tcp stream reaches the client through the WebSocket bridge', { timeout: 20000 }, async (t) => {
  const fake = start('python3', ['-u', here('./fake_rtl_tcp.py'), '12234'], 'READY');
  const bridge = start('python3', ['-u', here('../bridge/ws_tcp_bridge.py'), '--listen', '18765', '--target', '127.0.0.1:12234'], 'ws://');
  t.after(() => { fake.proc.kill(); bridge.proc.kill(); });
  await Promise.all([fake.ready, bridge.ready]);

  const spec = new SpectrumAnalyzer(4096);
  const statuses = [];
  let samples = 0;
  const src = new RtlTcpSource({
    url: 'ws://127.0.0.1:18765', fs: 2000000,
    onData: (re, im, n) => { samples += n; spec.push(re, im, n, 2e6, 1000); },
    onStatus: (s, text) => statuses.push([s, text]),
  });
  src.center = 1090000000;
  src.gain = { auto: false, db: 40.2 };
  src.ppm = -3;
  src.start();
  await wait(1500);
  src.setCenter(118500000);
  await wait(300);
  src.stop();

  assert.ok(statuses.some(([s, t]) => s === 'running' && t.includes('R820T') && t.includes('29 gain')), JSON.stringify(statuses));
  assert.ok(samples > 500000, `received ${samples} samples`);
  const bins = spec.take();
  let peak = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i;
  const hz = (peak - bins.length / 2) * (2e6 / bins.length);
  assert.ok(Math.abs(hz - 100000) < 1000, `tone at ${hz} Hz`);

  const cmds = fake.proc.lines.filter((l) => l.startsWith('CMD'));
  for (const want of ['CMD 2 2000000', 'CMD 1 1090000000', `CMD 5 ${(-3 >>> 0)}`, 'CMD 3 1', 'CMD 4 402', 'CMD 1 118500000']) {
    assert.ok(cmds.includes(want), `missing ${want} in ${cmds.join(', ')}`);
  }
});

test('bridge reports a clear error when rtl_tcp is not running', { timeout: 10000 }, async (t) => {
  const bridge = start('python3', ['-u', here('../bridge/ws_tcp_bridge.py'), '--listen', '18766', '--target', '127.0.0.1:1'], 'ws://');
  t.after(() => bridge.proc.kill());
  await bridge.ready;
  const statuses = [];
  const src = new RtlTcpSource({ url: 'ws://127.0.0.1:18766', fs: 2e6, onData: () => {}, onStatus: (s, text) => statuses.push([s, text]) });
  src.start();
  await wait(1000);
  const last = statuses[statuses.length - 1];
  assert.equal(last[0], 'error');
  assert.match(last[1], /rtl_tcp not reachable/);
});
