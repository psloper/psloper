// rtl_tcp client over WebSocket. Browsers cannot open raw TCP sockets, so this talks to
// bridge/ws_tcp_bridge.py (or websockify), which relays bytes to an rtl_tcp-compatible server.
// Protocol: 12-byte header "RTL0" + tuner type + gain count (big-endian u32),
// then interleaved unsigned 8-bit I/Q. Commands are 5 bytes: opcode + big-endian u32.

export const TUNERS = ['Unknown', 'E4000', 'FC0012', 'FC0013', 'FC2580', 'R820T', 'R828D'];

const CMD = { FREQ: 0x01, RATE: 0x02, GAIN_MODE: 0x03, GAIN: 0x04, PPM: 0x05, RTL_AGC: 0x08, BIAS_TEE: 0x0e };

export class RtlTcpSource {
  constructor({ url, fs, onData, onStatus }) {
    Object.assign(this, { url, fs, onData, onStatus });
    this.header = null;
    this.pending = new Uint8Array(0);
    this.carry = -1;
    this.re = new Float32Array(0);
    this.im = new Float32Array(0);
    this.center = 100e6;
    this.gain = { auto: true, db: 30 };
    this.ppm = 0;
    this.bytes = 0;
  }

  start() {
    this.onStatus('connecting', `Connecting to ${this.url}`);
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.onStatus('error', `Invalid bridge address: ${e.message}`);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => this.onStatus('connecting', 'Bridge connected, waiting for rtl_tcp header');
    ws.onmessage = (ev) => this.receive(new Uint8Array(ev.data));
    ws.onerror = () => this.onStatus('error',
      `No bridge at ${this.url}. Start rtl_tcp, then: python3 sdr/bridge/ws_tcp_bridge.py`);
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.onStatus(this.header ? 'closed' : 'error',
        ev.reason || (this.header ? 'Connection closed' : 'Bridge closed before rtl_tcp answered (is rtl_tcp running?)'));
    };
  }

  stop() {
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
  }

  send(cmd, value) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const b = new DataView(new ArrayBuffer(5));
    b.setUint8(0, cmd);
    b.setUint32(1, value >>> 0, false);
    this.ws.send(b.buffer);
  }

  configure() {
    this.send(CMD.RATE, this.fs);
    this.send(CMD.FREQ, this.center);
    this.send(CMD.PPM, this.ppm);
    this.applyGain();
  }

  applyGain() {
    this.send(CMD.GAIN_MODE, this.gain.auto ? 0 : 1);
    if (!this.gain.auto) this.send(CMD.GAIN, Math.round(this.gain.db * 10));
  }

  setCenter(f) { this.center = Math.round(f); this.send(CMD.FREQ, this.center); }
  setSampleRate(fs) { this.fs = fs; this.send(CMD.RATE, fs); }
  setGain(db, auto) { this.gain = { db, auto }; this.applyGain(); }
  setPpm(ppm) { this.ppm = ppm | 0; this.send(CMD.PPM, this.ppm); }
  setBiasTee(on) { this.send(CMD.BIAS_TEE, on ? 1 : 0); }

  receive(bytes) {
    this.bytes += bytes.length;
    if (!this.header) {
      const buf = new Uint8Array(this.pending.length + bytes.length);
      buf.set(this.pending); buf.set(bytes, this.pending.length);
      if (buf.length < 12) { this.pending = buf; return; }
      const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
      if (magic !== 'RTL0') {
        this.onStatus('error', 'Connected, but the server is not speaking rtl_tcp (bad header)');
        this.stop();
        return;
      }
      const dv = new DataView(buf.buffer, buf.byteOffset);
      this.header = { tuner: TUNERS[dv.getUint32(4)] || `type ${dv.getUint32(4)}`, gains: dv.getUint32(8) };
      this.onStatus('running', `rtl_tcp: ${this.header.tuner} tuner, ${this.header.gains} gain steps`);
      this.configure();
      bytes = buf.subarray(12);
      this.pending = new Uint8Array(0);
    }
    let start = 0;
    const hasCarry = this.carry >= 0;
    const pairs = (bytes.length + (hasCarry ? 1 : 0)) >> 1;
    if (this.re.length < pairs) { this.re = new Float32Array(pairs * 1.5 | 0); this.im = new Float32Array(pairs * 1.5 | 0); }
    const re = this.re, im = this.im;
    let k = 0;
    if (hasCarry && bytes.length) {
      re[k] = (this.carry - 127.5) / 128;
      im[k] = (bytes[0] - 127.5) / 128;
      k++; start = 1;
      this.carry = -1;
    }
    for (let i = start; i + 1 < bytes.length; i += 2, k++) {
      re[k] = (bytes[i] - 127.5) / 128;
      im[k] = (bytes[i + 1] - 127.5) / 128;
    }
    if ((bytes.length - start) & 1) this.carry = bytes[bytes.length - 1];
    if (k) this.onData(re, im, k);
  }
}
