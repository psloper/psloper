// AudioWorklet processors.
// sdr-player: ring buffer fed by the DSP worker over a MessagePort; reports fill level
//             so the worker can trim its resampler against the sound card clock.
// sdr-capture: forwards microphone / line-in audio to the DSP worker in 2048-sample chunks.

class SdrPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(sampleRate * 2);
    this.r = 0; this.w = 0; this.fill = 0;
    this.target = Math.round(sampleRate * 0.15);
    this.primed = false;
    this.underruns = 0;
    this.frames = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === 'port') {
        this.src = e.data.port;
        this.src.onmessage = (m) => this.write(m.data);
      } else if (e.data.type === 'flush') {
        this.r = this.w = this.fill = 0; this.primed = false;
      }
    };
  }

  write(chunk) {
    const buf = this.buf, N = buf.length;
    for (let i = 0; i < chunk.length; i++) {
      buf[this.w] = chunk[i];
      this.w = (this.w + 1) % N;
    }
    this.fill += chunk.length;
    if (this.fill > N) { // overflow: drop the oldest audio
      this.r = (this.r + this.fill - N) % N;
      this.fill = N;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const n = out.length;
    if (!this.primed && this.fill >= this.target) this.primed = true;
    if (this.primed && this.fill >= n) {
      const buf = this.buf, N = buf.length;
      for (let i = 0; i < n; i++) { out[i] = buf[this.r]; this.r = (this.r + 1) % N; }
      this.fill -= n;
    } else {
      out.fill(0);
      if (this.primed) { this.primed = false; this.underruns++; }
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    if (++this.frames % 40 === 0 && this.src) {
      this.src.postMessage({ type: 'fill', fill: this.fill, target: this.target, underruns: this.underruns });
    }
    return true;
  }
}

class SdrCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(2048);
    this.n = 0;
    this.port.onmessage = (e) => { if (e.data.type === 'port') this.dst = e.data.port; };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && this.dst) {
      for (let i = 0; i < ch.length; i++) {
        this.chunk[this.n++] = ch[i];
        if (this.n === this.chunk.length) {
          this.dst.postMessage(this.chunk, [this.chunk.buffer]);
          this.chunk = new Float32Array(2048);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('sdr-player', SdrPlayer);
registerProcessor('sdr-capture', SdrCapture);
