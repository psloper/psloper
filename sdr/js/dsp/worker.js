// DSP worker: owns the active source and runs spectrum, receiver, decoders and audio off the UI thread.
import { SpectrumAnalyzer } from './fft.js';
import { Receiver, MODES } from './receiver.js';
import { Simulator, SIM_FS, SIM_REF } from '../sources/simulator.js';
import { RtlTcpSource } from '../sources/rtltcp.js';
import { AdsbDemod, AircraftTracker } from '../decoders/adsb.js';
import { CwDecoder } from '../decoders/cw.js';
import { RttyDecoder } from '../decoders/rtty.js';

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const log = (text, level = 'info') => post({ type: 'log', level, text });

const S = {
  audioRate: 48000,
  audioPort: null,
  source: null,
  kind: null,
  fs: 0,
  center: 145e6,
  vfo: 145.5e6,
  rx: { mode: 'NFM', bw: MODES.NFM.bw, squelchDb: -200, cwPitch: 700, deemphTau: 50e-6 },
  dec: { adsb: true, cw: true, rtty: true, rttyBaud: 45.45, rttyShift: 170, rttyReverse: false },
  monitor: false,
  gain: { db: 30, auto: false },
  fftSize: 4096,
};

const spectrum = new SpectrumAnalyzer(S.fftSize);
let receiver = null;
let cw = null, rtty = null, decRate = 0;
const tracker = new AircraftTracker();
const adsb = new AdsbDemod((m) => tracker.ingest(m, Date.now()));
const textBuf = { cw: '', rtty: '' };
const timers = { spec: 0, meter: 0, iq: 0, ac: 0, text: 0, load: 0 };
let load = { busy: 0, span: 0, value: 0 };
let audioStat = { fill: 0, target: 0, underruns: 0 };

function ensureDecoders(rate) {
  if (rate === decRate && cw) return;
  decRate = rate;
  cw = new CwDecoder(rate, (c) => { textBuf.cw += c; }, S.rx.cwPitch);
  rtty = new RttyDecoder(rate, (c) => { textBuf.rtty += c; });
  configureRtty();
}

function configureRtty() {
  if (!rtty) return;
  const usbLike = S.kind === 'audio' || S.rx.mode !== 'LSB';
  rtty.configure({ baud: S.dec.rttyBaud, shift: S.dec.rttyShift, markIsHigh: usbLike !== S.dec.rttyReverse });
}

function configureReceiver() {
  if (!receiver || !S.fs) return;
  receiver.configure({ fs: S.fs, offset: S.vfo - S.center, ...S.rx });
  if (S.kind !== 'audio') ensureDecoders(receiver.ifRate);
  configureRtty();
}

function adsbActive() {
  return S.dec.adsb && S.kind !== 'audio' && S.fs === 2e6 && Math.abs(S.center - 1090e6) <= 100e3;
}

function sendAudio(buf, n) {
  if (!S.audioPort || !n) return;
  const chunk = buf.slice(0, n);
  S.audioPort.postMessage(chunk, [chunk.buffer]);
}

// -------------------------------------------------------------------------- per-block processing

function onIQ(re, im, n) {
  const t0 = performance.now();
  spectrum.push(re, im, n, S.fs);
  if (adsbActive()) adsb.process(re, im, n);
  const r = receiver.process(re, im, n);
  if (S.rx.mode === 'CW' && S.dec.cw) cw.process(r.demod, r.demodN);
  if ((S.rx.mode === 'USB' || S.rx.mode === 'LSB') && S.dec.rtty) rtty.process(r.demod, r.demodN);
  sendAudio(r.audio, r.audioN);
  finishBlock(t0, n / S.fs, receiver.powerDb, receiver.squelchOpen);
}

function onAudioIn(x) {
  const t0 = performance.now();
  const n = x.length;
  spectrum.push(x, null, n, S.fs);
  if (S.dec.cw) cw.process(x, n);
  if (S.dec.rtty) rtty.process(x, n);
  if (S.monitor) sendAudio(x, n);
  let p = 0;
  for (let i = 0; i < n; i++) p += x[i] * x[i];
  finishBlock(t0, n / S.fs, 10 * Math.log10(p / n + 1e-20), true);
}

function finishBlock(t0, seconds, chDb, sqOpen) {
  const now = performance.now();
  load.busy += now - t0;
  load.span += seconds * 1000;
  if (now - timers.load > 1000) {
    load.value = load.span ? load.busy / load.span : 0;
    load.busy = 0; load.span = 0; timers.load = now;
  }
  if (now - timers.spec > 33) {
    timers.spec = now;
    const real = S.kind === 'audio';
    const bins = spectrum.take(real);
    if (bins) {
      const sorted = Float32Array.from(bins).sort();
      const noiseDb = sorted[Math.floor(sorted.length * 0.25)];
      const span = real ? S.fs / 2 : S.fs;
      post({ type: 'spectrum', bins, center: real ? S.fs / 4 : S.center, span, noiseDb,
             binHz: S.fs / spectrum.n, enbw: spectrum.enbw }, [bins.buffer]);
    }
  }
  if (now - timers.meter > 50) {
    timers.meter = now;
    post({ type: 'meter', chDb, sqOpen, load: load.value, audio: audioStat,
           halfWidth: receiver ? receiver.halfWidth : 0,
           cw: cw ? { wpm: cw.wpm, level: cw.level, key: cw.key } : null,
           rtty: rtty ? { mark: rtty.markLevel, space: rtty.spaceLevel, lock: rtty.lock } : null });
  }
  if (now - timers.iq > 66 && receiver && S.kind !== 'audio' && receiver.iqSnapN) {
    timers.iq = now;
    const iq = receiver.iqSnap.slice(0, receiver.iqSnapN * 2);
    post({ type: 'iq', iq }, [iq.buffer]);
  }
  if (now - timers.text > 100) {
    timers.text = now;
    for (const k of ['cw', 'rtty']) if (textBuf[k]) { post({ type: 'text', decoder: k, text: textBuf[k] }); textBuf[k] = ''; }
  }
  if (now - timers.ac > 1000) {
    timers.ac = now;
    post({ type: 'aircraft', active: adsbActive(), list: tracker.list(Date.now()), stats: { ...adsb.stats },
           messages: tracker.messages });
  }
}

// -------------------------------------------------------------------------- sources

function status(state, text) { post({ type: 'status', state, text, fs: S.fs, kind: S.kind }); }

function stopSource() {
  if (S.source && S.source.stop) S.source.stop();
  if (S.capturePort) { S.capturePort.onmessage = null; S.capturePort = null; }
  S.source = null;
}

function startSource(msg) {
  stopSource();
  S.kind = msg.source;
  receiver = new Receiver(S.audioRate);
  decRate = 0;
  if (msg.source === 'sim') {
    S.fs = SIM_FS;
    const sim = new Simulator({ onData: onIQ });
    sim.setCenter(S.center);
    sim.setGain(S.gain.db);
    S.source = sim;
    configureReceiver();
    sim.start();
    post({ type: 'markers', list: sim.markers, rxPos: SIM_REF });
    status('running', 'Simulator running: synthetic RF, no hardware needed');
    log('Simulator started at 2.000 MS/s. Try the band presets: every one has live signals.');
  } else if (msg.source === 'rtltcp') {
    S.fs = msg.fs;
    const src = new RtlTcpSource({ url: msg.url, fs: msg.fs, onData: onIQ,
      onStatus: (state, text) => { status(state, text); log(text, state === 'error' ? 'error' : 'info'); } });
    src.center = S.center;
    src.gain = { ...S.gain };
    src.ppm = msg.ppm || 0;
    S.source = src;
    configureReceiver();
    post({ type: 'markers', list: [], rxPos: null });
    src.start();
  } else if (msg.source === 'audio') {
    S.fs = S.audioRate;
    S.capturePort = msg.capturePort;
    S.capturePort.onmessage = (e) => onAudioIn(e.data);
    ensureDecoders(S.fs);
    post({ type: 'markers', list: [], rxPos: null });
    status('running', 'Audio input: decoding CW / RTTY from the sound card');
    log('Audio input started. Feed a receiver\'s audio (USB for RTTY, CW with ~700 Hz pitch).');
  }
  spectrum.setSize(S.fftSize);
}

// -------------------------------------------------------------------------- messages

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      S.audioRate = m.audioRate;
      S.audioPort = m.audioPort;
      if (S.audioPort) S.audioPort.onmessage = (ev) => {
        if (ev.data.type !== 'fill') return;
        audioStat = ev.data;
        // Trim the resampler so the playback buffer hovers around its target (sound-card clock drift).
        const err = (ev.data.fill - ev.data.target) / ev.data.target;
        if (receiver) receiver.trimAudio(1 + Math.max(-0.01, Math.min(0.01, err * 0.01)));
      };
      break;
    case 'start': startSource(m); break;
    case 'stop':
      stopSource();
      S.kind = null;
      status('off', 'Receiver off');
      break;
    case 'tune': {
      const centerChanged = m.center !== S.center;
      S.center = m.center; S.vfo = m.vfo;
      if (centerChanged && S.source && S.source.setCenter) S.source.setCenter(S.center);
      configureReceiver();
      break;
    }
    case 'rx':
      Object.assign(S.rx, m.rx);
      if (cw && m.rx.cwPitch) cw.setPitch(m.rx.cwPitch);
      configureReceiver();
      break;
    case 'gain':
      S.gain = { db: m.db, auto: m.auto };
      if (S.source && S.source.setGain) S.source.setGain(m.db, m.auto);
      break;
    case 'ppm': if (S.source && S.source.setPpm) S.source.setPpm(m.ppm); break;
    case 'biasTee': if (S.source && S.source.setBiasTee) S.source.setBiasTee(m.on); break;
    case 'fft': S.fftSize = m.size; spectrum.setSize(m.size); break;
    case 'decoders':
      Object.assign(S.dec, m.dec);
      configureRtty();
      break;
    case 'monitor': S.monitor = m.on; break;
    case 'reset':
      if (m.what === 'cw' && cw) cw.reset();
      if (m.what === 'rtty' && rtty) rtty.reset();
      if (m.what === 'adsb') { tracker.aircraft.clear(); tracker.messages = 0; }
      break;
  }
};
