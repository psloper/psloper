// UI controller: owns user state, talks to the DSP worker, drives the displays.
import { SpectrumView } from './ui/spectrum.js';
import { FreqDisplay } from './ui/vfo.js';
import { AirPicture, IqScope } from './ui/scopes.js';
import { PRESETS, allocationAt, formatHz, formatBw, parseFrequency } from './ui/bandplan.js';
import { MODES, passband } from './dsp/receiver.js';
import { rangeBearing } from './decoders/adsb.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const BW_RANGE = { AM: [3000, 15000], NFM: [5000, 25000], WFM: [60000, 200000], USB: [1500, 4000], LSB: [1500, 4000], CW: [100, 1500] };
const MODE_KEYS = ['AM', 'NFM', 'WFM', 'USB', 'LSB', 'CW'];
const STORE_KEY = 'aether.sdr.v1';

// ------------------------------------------------------------------ state

const defaults = {
  source: 'sim', bridgeUrl: 'ws://127.0.0.1:8765', rtlRate: 2000000, ppm: 0,
  center: 118.9e6, vfo: 118.5e6, mode: 'AM', bw: MODES.AM.bw, step: 25000,
  volume: 60, squelch: -121, muted: false, gain: 30, agcAuto: false,
  fftSize: 4096, avg: 0.6, range: 'auto', zoom: 1, peak: false,
  tab: 'adsb', radarRange: 100, cwPitch: 700, rttyBaud: 45.45, rttyShift: 170, rttyRev: false,
  dec: { adsb: true, cw: true, rtty: true }, memories: [], monitor: false,
};

function load() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return { ...defaults }; }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch { /* storage unavailable */ } }, 300);
}

const st = load();
const rt = {
  on: false, fs: 0, kind: null, markers: [], rxPos: null, audio: null, stream: null,
  lastSpec: null, peakDb: -150, meter: null, aircraft: [], acActive: false, selected: null,
  msgs: { last: 0, t: 0, rate: 0 }, logErrors: 0,
};

// ------------------------------------------------------------------ worker + audio

const worker = new Worker(new URL('./dsp/worker.js', import.meta.url), { type: 'module' });
worker.onerror = (e) => log(`DSP worker failed: ${e.message || 'unknown error'} (module workers need a current browser)`, 'error');
const send = (msg, transfer) => worker.postMessage(msg, transfer || []);

// Browsers only allow sound after a user gesture. Never block on it: the receiver
// runs silently and the "Tap for sound" button (or any tap) unlocks the output.
function resumeAudio() {
  const ctx = rt.audio && rt.audio.ctx;
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}).finally(updateSoundHint);
}

function updateSoundHint() {
  const ctx = rt.audio && rt.audio.ctx;
  $('soundHint').hidden = !ctx || ctx.state === 'running';
}

document.addEventListener('pointerdown', resumeAudio);
document.addEventListener('keydown', resumeAudio);

async function ensureAudio() {
  if (rt.audio) { resumeAudio(); return; }
  try {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(new URL('./audio/worklet.js', import.meta.url));
    const player = new AudioWorkletNode(ctx, 'sdr-player', { numberOfInputs: 0, outputChannelCount: [1] });
    const gain = ctx.createGain();
    player.connect(gain).connect(ctx.destination);
    const ch = new MessageChannel();
    player.port.postMessage({ type: 'port', port: ch.port1 }, [ch.port1]);
    send({ type: 'init', audioRate: ctx.sampleRate, audioPort: ch.port2 }, [ch.port2]);
    rt.audio = { ctx, gain, player };
    applyVolume();
    ctx.onstatechange = updateSoundHint;
    resumeAudio();
  } catch (e) {
    rt.audio = { ctx: null, gain: null, failed: true };
    send({ type: 'init', audioRate: 48000, audioPort: null });
    log(`Audio output unavailable (${e.message}). Displays and decoders still work.`, 'error');
  }
}

function applyVolume() {
  if (!rt.audio || !rt.audio.gain) return;
  const v = st.muted ? 0 : (st.volume / 100) ** 2 * 1.6;
  rt.audio.gain.gain.setTargetAtTime(v, rt.audio.ctx.currentTime, 0.02);
}

async function startCapture() {
  const { ctx } = rt.audio;
  if (!ctx) throw new Error('audio system unavailable');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const srcNode = ctx.createMediaStreamSource(stream);
  const cap = new AudioWorkletNode(ctx, 'sdr-capture', { numberOfOutputs: 1 });
  const sink = ctx.createGain();
  sink.gain.value = 0;
  srcNode.connect(cap).connect(sink).connect(ctx.destination);
  const ch = new MessageChannel();
  cap.port.postMessage({ type: 'port', port: ch.port1 }, [ch.port1]);
  rt.stream = { stream, nodes: [srcNode, cap, sink] };
  return ch.port2;
}

function stopCapture() {
  if (!rt.stream) return;
  rt.stream.stream.getTracks().forEach((t) => t.stop());
  rt.stream.nodes.forEach((n) => n.disconnect());
  rt.stream = null;
}

// ------------------------------------------------------------------ power

async function powerOn() {
  if (rt.on || rt.starting) return;
  rt.starting = true;
  try { await startReceiver(); } finally { rt.starting = false; }
}

async function startReceiver() {
  setLink('connecting', 'Starting…');
  await ensureAudio();
  let capturePort = null;
  if (st.source === 'audio') {
    try {
      capturePort = await startCapture();
    } catch (e) {
      setLink('error', `Audio input refused: ${e.message}. Allow microphone / line-in access and try again.`);
      log(`Audio input refused: ${e.message}`, 'error');
      return;
    }
  }
  pushAll();
  send({ type: 'start', source: st.source, url: st.bridgeUrl, fs: +st.rtlRate, ppm: +st.ppm, capturePort },
       capturePort ? [capturePort] : []);
  rt.on = true;
  document.body.classList.add('on');
  for (const b of [$('power')]) b.setAttribute('aria-pressed', 'true');
}

function powerOff() {
  if (!rt.on || rt.starting) return;
  send({ type: 'stop' });
  stopCapture();
  rt.on = false;
  document.body.classList.remove('on');
  $('power').setAttribute('aria-pressed', 'false');
}

function restartIfOn() { if (rt.on) { powerOff(); powerOn(); } }

// ------------------------------------------------------------------ tuning

function span() { return rt.fs || (st.source === 'rtltcp' ? +st.rtlRate : 2e6); }

function setVfo(f, { keepCenter = false, snap = false } = {}) {
  if (snap) f = Math.round(f / st.step) * st.step;
  f = Math.round(clamp(f, 10e3, 6e9));
  st.vfo = f;
  if (!keepCenter) {
    const s = span();
    const [lo, hi] = passband(st.mode, st.bw);
    if (f + lo < st.center - s * 0.47 || f + hi > st.center + s * 0.47) {
      // Retune the hardware so the VFO sits a quarter-span off centre, away from the DC spike.
      st.center = Math.round(f - s * 0.25 * Math.sign(f - st.center || 1));
    }
  }
  sendTune();
}

function setCenter(c) {
  st.center = Math.round(clamp(c, 10e3, 6e9));
  const s = span();
  if (Math.abs(st.vfo - st.center) > s * 0.47) st.vfo = Math.round(st.center + Math.sign(st.vfo - st.center) * s * 0.4);
  sendTune();
}

let tuneQueued = false;
function sendTune() {
  updateTuningUI();
  save();
  if (tuneQueued) return;
  tuneQueued = true;
  requestAnimationFrame(() => {
    tuneQueued = false;
    send({ type: 'tune', center: st.center, vfo: st.vfo });
  });
}

function setMode(mode, bw) {
  st.mode = mode;
  st.bw = bw || MODES[mode].bw;
  sendRx();
  updateTuningUI();
  save();
}

function sendRx() {
  send({ type: 'rx', rx: { mode: st.mode, bw: st.bw, squelchDb: st.squelch <= -121 ? -200 : st.squelch, cwPitch: +st.cwPitch } });
}

function sendDecoders() {
  send({ type: 'decoders', dec: { ...st.dec, rttyBaud: +st.rttyBaud, rttyShift: +st.rttyShift, rttyReverse: st.rttyRev } });
}

function pushAll() {
  send({ type: 'tune', center: st.center, vfo: st.vfo });
  sendRx();
  sendDecoders();
  send({ type: 'gain', db: +st.gain, auto: st.agcAuto });
  send({ type: 'fft', size: +st.fftSize });
  send({ type: 'monitor', on: st.monitor });
}

function applyPreset(p) {
  st.step = p.step;
  st.mode = p.mode;
  st.bw = p.bw || MODES[p.mode].bw;
  st.center = p.center;
  st.vfo = p.vfo;
  if (p.tab) selectTab(p.tab);
  sendRx();
  sendTune();
  syncControls();
  if (p.id === 'adsb' && st.source === 'rtltcp' && +st.rtlRate !== 2e6) {
    log('ADS-B needs 2.000 MS/s: switching the rtl_tcp sample rate.');
    st.rtlRate = 2000000;
    $('rtlRate').value = '2000000';
    restartIfOn();
  }
  if (!rt.on) powerOn();
}

// ------------------------------------------------------------------ UI: tuning panel

const freqDisplay = new FreqDisplay($('freq'), (f) => setVfo(f));
const spectrum = new SpectrumView({
  spec: $('spectrum'), wf: $('waterfall'),
  onTune: (f) => setVfo(f, { keepCenter: true, snap: true }),
  onDrag: (hz, zoomed) => (zoomed ? setVfo(st.vfo - hz, { keepCenter: false }) : setCenter(st.center - hz)),
  onStep: (dir) => setVfo(st.vfo + dir * st.step, { snap: true }),
  onZoom: (dir) => setZoom(clamp(st.zoom * (dir > 0 ? 2 : 0.5), 1, 16)),
  onHover: (f, db) => {
    $('cursorRead').textContent = f == null ? '' : `${formatHz(f, f >= 1e6 ? 4 : 2)}${db != null ? ` · ${db.toFixed(1)} dBFS` : ''}`;
  },
});
const radar = new AirPicture($('radar'), (icao) => { rt.selected = icao; radar.selected = icao; renderAircraft(); });
const iqScope = new IqScope($('iqScope'));

function bwToSlider(mode, bw) {
  const [lo, hi] = BW_RANGE[mode];
  return Math.round((Math.log(bw / lo) / Math.log(hi / lo)) * 100);
}
function sliderToBw(mode, v) {
  const [lo, hi] = BW_RANGE[mode];
  const bw = lo * (hi / lo) ** (v / 100);
  return bw > 20000 ? Math.round(bw / 5000) * 5000 : bw > 2000 ? Math.round(bw / 100) * 100 : Math.round(bw / 10) * 10;
}

function updateTuningUI() {
  freqDisplay.set(st.vfo);
  const pb = passband(st.mode, st.bw);
  spectrum.setTuning({ vfo: st.vfo, pb, mode: st.mode, bw: st.bw, step: st.step });
  for (const b of $('modes').children) b.setAttribute('aria-checked', String(b.dataset.mode === st.mode));
  $('bw').value = bwToSlider(st.mode, st.bw);
  $('bwOut').textContent = formatBw(st.bw);
  const alloc = allocationAt(st.vfo);
  const near = rt.markers.find((m) => Math.abs(m.freq - st.vfo) < 3000);
  $('bandName').textContent = near ? near.label : alloc ? alloc.name : 'Unallocated / unknown';
  const suggest = near && near.mode && MODE_KEYS.includes(near.mode) ? near.mode : alloc && alloc.mode;
  const sb = $('suggestMode');
  if (suggest && suggest !== st.mode && st.source !== 'audio') {
    sb.hidden = false;
    sb.textContent = `Use ${suggest}`;
    sb.dataset.mode = suggest;
  } else sb.hidden = true;
  for (const b of $('bands').children) {
    const p = PRESETS.find((x) => x.id === b.dataset.id);
    b.classList.toggle('active', Math.abs(p.vfo - st.vfo) < 1 && p.mode === st.mode);
  }
  updateDecoderStatus();
}

function setZoom(z) {
  st.zoom = z;
  spectrum.setZoom(z);
  for (const b of $('zoom').children) b.setAttribute('aria-checked', String(+b.dataset.zoom === z));
  save();
}

// ------------------------------------------------------------------ worker messages

worker.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'spectrum':
      rt.lastSpec = m;
      spectrum.setData(m);
      break;
    case 'meter': onMeter(m); break;
    case 'iq': iqScope.draw(m.iq); break;
    case 'status':
      rt.fs = m.fs; rt.kind = m.kind;
      setLink(m.state, m.text);
      $('tFs').textContent = m.fs ? `${(m.fs / 1e6).toFixed(3)} MS/s` : '--';
      if (m.state === 'error' || m.state === 'closed') {
        rt.on = false;
        document.body.classList.remove('on');
        $('power').setAttribute('aria-pressed', 'false');
      }
      updateTuningUI();
      break;
    case 'markers':
      rt.markers = m.list;
      rt.rxPos = m.rxPos;
      spectrum.setMarkers(m.list);
      updateTuningUI();
      break;
    case 'text': appendText(m.decoder, m.text); break;
    case 'aircraft': onAircraft(m); break;
    case 'log': log(m.text, m.level); break;
  }
};

function setLink(state, text) {
  $('link').dataset.state = state;
  $('linkText').textContent = text;
  $('linkText').title = text;
}

function onMeter(m) {
  rt.meter = m;
  const toPct = (db) => clamp(((db + 120) / 120) * 100, 0, 100);
  const ch = m.chDb;
  rt.peakDb = Math.max(rt.peakDb - 0.6, ch);
  const sm = $('smeter');
  sm.style.setProperty('--v', `${toPct(ch)}%`);
  sm.style.setProperty('--p', `${toPct(rt.peakDb)}%`);
  sm.style.setProperty('--s', st.squelch > -121 ? `${toPct(st.squelch)}%` : '-10%');
  $('chDb').textContent = `${ch.toFixed(1)} dBFS`;
  const sq = $('sqState');
  sq.dataset.open = String(m.sqOpen);
  sq.textContent = st.squelch <= -121 ? 'OFF' : m.sqOpen ? 'OPEN' : 'CLOSED';

  const spec = rt.lastSpec;
  if (spec && m.halfWidth && rt.kind !== 'audio') {
    // Noise in the channel = per-bin noise floor scaled from the FFT's noise bandwidth to the channel bandwidth.
    const nCh = spec.noiseDb + 10 * Math.log10((2 * m.halfWidth) / (spec.enbw * spec.binHz));
    const pS = 10 ** (ch / 10) - 10 ** (nCh / 10);
    $('nfDb').textContent = `${nCh.toFixed(1)} dBFS`;
    $('snrOut').textContent = pS > 0 ? `SNR ${(10 * Math.log10(pS / 10 ** (nCh / 10))).toFixed(1)} dB` : 'SNR < 0 dB';
  } else {
    $('nfDb').textContent = spec ? `${spec.noiseDb.toFixed(1)} dB/bin` : '--';
    $('snrOut').textContent = 'input level';
  }
  const load = Math.round(m.load * 100);
  const tl = $('tLoad');
  tl.textContent = `${load}%`;
  tl.style.color = load > 85 ? 'var(--red)' : '';
  if (rt.kind === 'audio' && !st.monitor) $('tAudio').textContent = 'monitor off';
  else if (m.audio && m.audio.target && rt.audio && rt.audio.ctx) {
    $('tAudio').textContent = `${Math.round((m.audio.fill / rt.audio.ctx.sampleRate) * 1000)} ms${m.audio.underruns ? ` · ${m.audio.underruns} gaps` : ''}`;
  }
  if (m.cw) {
    $('cwKey').classList.toggle('on', m.cw.key);
    $('cwLevel').style.width = `${m.cw.level * 100}%`;
    $('cwWpm').textContent = m.cw.wpm.toFixed(0);
  }
  if (m.rtty) {
    const tot = m.rtty.mark + m.rtty.space + 1e-12;
    $('rttyMark').style.width = `${(m.rtty.mark / tot) * 100 * Math.min(1, m.rtty.lock * 2)}%`;
    $('rttySpace').style.width = `${(m.rtty.space / tot) * 100 * Math.min(1, m.rtty.lock * 2)}%`;
    $('rttyLock').classList.toggle('on', m.rtty.lock > 0.15);
  }
}

// ------------------------------------------------------------------ decoders UI

function appendText(which, text) {
  const el = $(which === 'cw' ? 'cwText' : 'rttyText');
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  el.textContent = (el.textContent + text).slice(-6000);
  if (stick) el.scrollTop = el.scrollHeight;
}

function onAircraft(m) {
  rt.acActive = m.active;
  rt.aircraft = m.list;
  const now = performance.now();
  if (rt.msgs.t) rt.msgs.rate = ((m.messages - rt.msgs.last) * 1000) / (now - rt.msgs.t);
  rt.msgs.last = m.messages; rt.msgs.t = now;
  $('acCount').textContent = m.list.length;
  $('adsbStats').textContent = `${Math.max(0, rt.msgs.rate).toFixed(0)} msg/s · ${m.stats.frames} frames · ${m.stats.crcFail} CRC rejects`;
  renderAircraft();
  updateDecoderStatus();
}

function renderAircraft() {
  const ref = rt.rxPos || radar.centre();
  radar.setData(rt.aircraft, rt.rxPos);
  const now = Date.now();
  const rows = rt.aircraft
    .map((a) => ({ a, rng: ref && a.lat != null ? rangeBearing(ref, a).range : null }))
    .sort((x, y) => (x.rng ?? 1e9) - (y.rng ?? 1e9));
  const body = $('acBody');
  body.replaceChildren(...rows.map(({ a, rng }) => {
    const tr = document.createElement('tr');
    tr.dataset.icao = a.icao;
    const age = (now - a.lastSeen) / 1000;
    if (age > 30) tr.classList.add('stale');
    if (a.icao === rt.selected) tr.classList.add('sel');
    const vs = a.verticalRate;
    const cells = [
      a.callsign || '·····', a.icao,
      a.altitude != null ? String(Math.round(a.altitude / 100)).padStart(3, '0') : '--',
      a.groundSpeed != null ? Math.round(a.groundSpeed) : '--',
      a.track != null ? String(Math.round(a.track) % 360).padStart(3, '0') : '--',
      vs != null ? (vs > 0 ? '+' : '') + vs : '--',
      rng != null ? rng.toFixed(1) : '--',
      age.toFixed(0),
    ];
    cells.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v;
      if (i >= 2) td.className = 'num';
      if (i === 5 && vs) td.classList.add(vs > 0 ? 'up' : 'down');
      tr.appendChild(td);
    });
    return tr;
  }));
}

$('acBody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  rt.selected = rt.selected === tr.dataset.icao ? null : tr.dataset.icao;
  radar.selected = rt.selected;
  renderAircraft();
});

function statusLine(id, state, html) {
  const el = $(id);
  el.dataset.state = state;
  el.innerHTML = html;
}

function updateDecoderStatus() {
  const go = (id, label) => `<button data-go="${id}">${label}</button>`;
  const audio = st.source === 'audio';
  if (!rt.on) statusLine('adsbStatus', 'idle', `Receiver off. ${go('adsb', 'Start on ADS-B 1090')}`);
  else if (audio) statusLine('adsbStatus', 'idle', 'ADS-B needs an SDR source (simulator or rtl_tcp), not audio input.');
  else if (rt.acActive) statusLine('adsbStatus', 'live', `Decoding 1090 MHz Extended Squitter. ${rt.aircraft.length} aircraft tracked.`);
  else if (rt.fs !== 2e6) statusLine('adsbStatus', 'wait', `Needs a 2.000 MS/s sample rate (now ${(rt.fs / 1e6).toFixed(3)}). ${go('adsb', 'Switch to ADS-B')}`);
  else statusLine('adsbStatus', 'wait', `Idle: tune the SDR to 1090 MHz. ${go('adsb', 'Go to ADS-B 1090')}`);

  if (audio || (rt.on && st.mode === 'CW')) statusLine('cwStatus', 'live', `Listening for a ${st.cwPitch} Hz tone${audio ? ' on the audio input' : ''}.`);
  else statusLine('cwStatus', 'wait', `Needs CW mode on a Morse signal. ${go('cw', 'Go to 20 m CW')}`);

  if (audio || (rt.on && (st.mode === 'USB' || st.mode === 'LSB'))) {
    const hi = (audio || st.mode === 'USB') !== st.rttyRev;
    statusLine('rttyStatus', 'live', `${st.rttyBaud} Bd, ${st.rttyShift} Hz shift, tones 2125 / ${2125 + +st.rttyShift} Hz, mark ${hi ? 'high' : 'low'}.`);
  } else statusLine('rttyStatus', 'wait', `Needs USB or LSB on an RTTY signal. ${go('rtty', 'Go to 20 m RTTY')}`);
}

document.querySelector('.decode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) applyPreset(PRESETS.find((p) => p.id === b.dataset.go));
});

function selectTab(tab) {
  st.tab = tab;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('.tabpane')) p.hidden = p.dataset.pane !== tab;
  if (tab === 'log') { rt.logErrors = 0; $('logCount').hidden = true; }
  if (tab === 'adsb') requestAnimationFrame(() => radar.draw());
  save();
}

function log(text, level = 'info') {
  const li = document.createElement('li');
  if (level === 'error') li.className = 'error';
  const t = document.createElement('time');
  t.textContent = new Date().toISOString().slice(11, 19);
  li.append(t, document.createTextNode(text));
  const ol = $('log');
  ol.prepend(li);
  while (ol.children.length > 200) ol.lastChild.remove();
  if (level === 'error' && st.tab !== 'log') { rt.logErrors++; $('logCount').hidden = false; }
}

// ------------------------------------------------------------------ presets + memories

function renderPresets() {
  $('bands').replaceChildren(...PRESETS.map((p) => {
    const b = document.createElement('button');
    b.dataset.id = p.id;
    b.innerHTML = `<b>${p.name}</b><small>${formatHz(p.vfo, p.vfo >= 1e8 ? 3 : 4)} ${p.id === 'adsb' ? 'PPM' : p.mode}</small>`;
    b.addEventListener('click', () => applyPreset(p));
    return b;
  }));
}

function renderMemories() {
  $('memories').replaceChildren(...st.memories.map((m, i) => {
    const b = document.createElement('button');
    b.className = 'mem';
    b.innerHTML = `<b></b><small>${formatHz(m.f, 4)} ${m.mode}</small><span class="x" title="Delete" aria-label="Delete memory">×</span>`;
    b.querySelector('b').textContent = m.name;
    b.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) { st.memories.splice(i, 1); renderMemories(); save(); return; }
      setMode(m.mode, m.bw);
      setVfo(m.f);
      syncControls();
    });
    return b;
  }));
}

function storeMemory() {
  const near = rt.markers.find((m) => Math.abs(m.freq - st.vfo) < 3000);
  const alloc = allocationAt(st.vfo);
  const name = near ? near.label : alloc ? alloc.name.split(' (')[0] : formatHz(st.vfo, 4);
  st.memories = st.memories.filter((m) => m.f !== st.vfo).concat([{ f: st.vfo, mode: st.mode, bw: st.bw, name }]).slice(-12);
  renderMemories();
  save();
  log(`Stored ${formatHz(st.vfo, 4)} ${st.mode} as "${name}".`);
}

// ------------------------------------------------------------------ controls

function syncControls() {
  document.body.dataset.source = st.source;
  $('source').value = st.source;
  $('bridgeUrl').value = st.bridgeUrl;
  $('rtlRate').value = String(st.rtlRate);
  $('ppm').value = st.ppm;
  $('gain').value = st.gain;
  $('gainOut').textContent = st.agcAuto ? 'auto' : `${(+st.gain).toFixed(1)} dB`;
  $('agcAuto').checked = st.agcAuto;
  $('step').value = String(st.step);
  if ($('step').value !== String(st.step)) $('step').value = '1000';
  $('volume').value = st.volume;
  $('volOut').textContent = `${st.volume}%`;
  $('squelch').value = st.squelch;
  $('sqOut').textContent = st.squelch <= -121 ? 'Off' : `${st.squelch} dBFS`;
  $('mute').setAttribute('aria-pressed', String(st.muted));
  $('fftSize').value = String(st.fftSize);
  $('avg').value = st.avg;
  $('range').value = st.range;
  $('peak').checked = st.peak;
  $('cwPitch').value = String(st.cwPitch);
  $('rttyBaud').value = String(st.rttyBaud);
  $('rttyShift').value = String(st.rttyShift);
  $('rttyRev').checked = st.rttyRev;
  $('decAdsb').checked = st.dec.adsb; $('decCw').checked = st.dec.cw; $('decRtty').checked = st.dec.rtty;
  $('monitor').checked = st.monitor;
  for (const b of $('radarRange').children) b.setAttribute('aria-checked', String(+b.dataset.range === st.radarRange));
  radar.range = st.radarRange;
  applyRange();
  spectrum.avg = +st.avg;
  spectrum.peakOn = st.peak;
  spectrum.enabled = st.source !== 'audio';
  setZoom(st.zoom);
  updateTuningUI();
}

const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

on('power', 'click', () => (rt.on ? powerOff() : powerOn()));
on('powerBig', 'click', () => powerOn());
on('source', 'change', (e) => {
  const was = rt.on;
  powerOff();
  st.source = e.target.value;
  rt.fs = 0; rt.markers = []; rt.rxPos = null;
  spectrum.setMarkers([]);
  if (st.source === 'rtltcp') log('rtl_tcp: run "rtl_tcp -a 127.0.0.1" and "python3 sdr/bridge/ws_tcp_bridge.py", then press POWER.');
  syncControls(); save();
  setLink('off', 'Off');
  if (was && st.source !== 'rtltcp') powerOn();
});
on('bridgeUrl', 'change', (e) => { st.bridgeUrl = e.target.value.trim(); save(); });
on('rtlRate', 'change', (e) => { st.rtlRate = +e.target.value; save(); restartIfOn(); });
on('ppm', 'change', (e) => { st.ppm = clamp(Math.round(+e.target.value || 0), -200, 200); send({ type: 'ppm', ppm: st.ppm }); save(); });
on('gain', 'input', (e) => {
  st.gain = +e.target.value; st.agcAuto = false;
  $('agcAuto').checked = false;
  $('gainOut').textContent = `${st.gain.toFixed(1)} dB`;
  send({ type: 'gain', db: st.gain, auto: false }); save();
});
on('agcAuto', 'change', (e) => {
  st.agcAuto = e.target.checked;
  $('gainOut').textContent = st.agcAuto ? 'auto' : `${(+st.gain).toFixed(1)} dB`;
  send({ type: 'gain', db: +st.gain, auto: st.agcAuto }); save();
});

$('modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
on('suggestMode', 'click', (e) => setMode(e.currentTarget.dataset.mode));
on('bw', 'input', (e) => { st.bw = sliderToBw(st.mode, +e.target.value); sendRx(); updateTuningUI(); save(); });
on('step', 'change', (e) => { st.step = +e.target.value; save(); });
on('volume', 'input', (e) => { st.volume = +e.target.value; $('volOut').textContent = `${st.volume}%`; applyVolume(); save(); });
on('squelch', 'input', (e) => {
  st.squelch = +e.target.value;
  $('sqOut').textContent = st.squelch <= -121 ? 'Off' : `${st.squelch} dBFS`;
  sendRx(); save();
});
on('mute', 'click', () => { st.muted = !st.muted; $('mute').setAttribute('aria-pressed', String(st.muted)); applyVolume(); save(); });
on('monitor', 'change', (e) => { st.monitor = e.target.checked; send({ type: 'monitor', on: st.monitor }); save(); });

$('zoom').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setZoom(+b.dataset.zoom); });
on('fftSize', 'change', (e) => { st.fftSize = +e.target.value; send({ type: 'fft', size: st.fftSize }); save(); });
on('avg', 'input', (e) => { st.avg = +e.target.value; spectrum.avg = st.avg; save(); });
on('range', 'change', (e) => { st.range = e.target.value; applyRange(); save(); });
function applyRange() {
  if (st.range === 'auto') spectrum.setRange('auto');
  else { const [t, b] = st.range.split(',').map(Number); spectrum.setRange(t, b); }
}
on('peak', 'change', (e) => { st.peak = e.target.checked; spectrum.peakOn = st.peak; spectrum.clearPeak(); spectrum.dirty = true; save(); });

on('freqForm', 'submit', (e) => {
  e.preventDefault();
  const input = $('freqInput');
  const f = parseFrequency(input.value);
  if (f == null) {
    input.setAttribute('aria-invalid', 'true');
    $('freqError').hidden = false;
    $('freqError').textContent = `Could not read "${input.value}". Try 145.5M, 1090 MHz or 14083.5k (10 kHz to 6 GHz).`;
    return;
  }
  input.removeAttribute('aria-invalid');
  $('freqError').hidden = true;
  input.value = '';
  input.blur();
  const s = span();
  st.center = Math.round(f - s * 0.25);
  setVfo(f, { keepCenter: true });
  const alloc = allocationAt(f);
  if (alloc && alloc.mode && alloc.mode !== st.mode) log(`${alloc.name}: ${alloc.mode} is the usual mode here (button in the Mode panel).`);
});
on('freqInput', 'input', () => { $('freqInput').removeAttribute('aria-invalid'); $('freqError').hidden = true; });

document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) selectTab(b.dataset.tab); });
$('radarRange').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  st.radarRange = +b.dataset.range; radar.range = st.radarRange;
  for (const x of $('radarRange').children) x.setAttribute('aria-checked', String(x === b));
  radar.draw(); save();
});
on('cwPitch', 'change', (e) => { st.cwPitch = +e.target.value; sendRx(); updateDecoderStatus(); save(); });
on('cwClear', 'click', () => { $('cwText').textContent = ''; send({ type: 'reset', what: 'cw' }); });
on('rttyClear', 'click', () => { $('rttyText').textContent = ''; send({ type: 'reset', what: 'rtty' }); });
for (const id of ['rttyBaud', 'rttyShift']) on(id, 'change', (e) => { st[id] = +e.target.value; sendDecoders(); updateDecoderStatus(); save(); });
on('rttyRev', 'change', (e) => { st.rttyRev = e.target.checked; sendDecoders(); updateDecoderStatus(); save(); });
for (const [id, key] of [['decAdsb', 'adsb'], ['decCw', 'cw'], ['decRtty', 'rtty']]) {
  on(id, 'change', (e) => { st.dec[key] = e.target.checked; sendDecoders(); save(); });
}
on('memAdd', 'click', storeMemory);
on('helpBtn', 'click', () => $('help').showModal());

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); rt.on ? powerOff() : powerOn(); }
  else if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); setVfo(st.vfo + (k === 'ArrowRight' ? 1 : -1) * st.step, { snap: true }); }
  else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); setVfo(st.vfo + (k === 'ArrowUp' ? 10 : -10) * st.step, { snap: true }); }
  else if (k >= '1' && k <= '6') setMode(MODE_KEYS[+k - 1]);
  else if (k === 'z' || k === 'Z') setZoom(st.zoom >= 16 ? 1 : st.zoom * 2);
  else if (k === 'm' || k === 'M') $('mute').click();
  else if (k === 'f' || k === 'F') { e.preventDefault(); $('freqInput').focus(); }
  else if (k === 's' || k === 'S') storeMemory();
  else if (k === 'p' || k === 'P') $('peak').click();
  else if (k === '?') $('help').showModal();
});

// ------------------------------------------------------------------ loops

function frame() {
  spectrum.draw();
  requestAnimationFrame(frame);
}

setInterval(() => { $('tClock').textContent = new Date().toISOString().slice(11, 19); }, 1000);

renderPresets();
renderMemories();
syncControls();
selectTab(st.tab);
iqScope.draw(null);
setLink('off', 'Off');
log('Ready. Press POWER (or Space) to start the receiver.');
if (document.body.dataset.autostart !== undefined) powerOn();
requestAnimationFrame(frame);
