// Mic -> utterance chunks. Cuts at natural pauses (like Wispr, but continuous).
// Two modes: continuous (VAD splits on silence) and push-to-talk (hold a key).

export class Recorder {
  constructor({ onChunk, onLevel, onState, silenceMs = 900, maxMs = 25000 }) {
    Object.assign(this, { onChunk, onLevel, onState, silenceMs, maxMs });
    this.active = false;
    this.ptt = false;
  }

  async init() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    this.floor = 0.01;
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.sqrt(sum / this.buf.length);
  }

  startSegment() {
    this.parts = [];
    this.speechMs = 0;
    this.segStart = performance.now();
    const rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    const parts = this.parts;
    const seg = { speechMs: 0 };
    this.seg = seg;
    this.rec = rec;
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      if (seg.speechMs >= 250 && parts.length) this.onChunk(new Blob(parts, { type: rec.mimeType || this.mime }));
    };
    rec.start(250);
  }

  cut() {
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    this.rec = null;
  }

  // Continuous listening
  async start() {
    await this.init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.active = true;
    this.lastVoice = 0;
    this.heard = false;
    this.startSegment();
    this.onState?.('listening');
    const tick = () => {
      if (!this.active) return;
      const lvl = this.level();
      const now = performance.now();
      // slow-adapting noise floor
      if (lvl < this.floor * 2) this.floor = this.floor * 0.98 + lvl * 0.02;
      const speaking = lvl > Math.max(0.012, this.floor * 3);
      this.onLevel?.(lvl, speaking);
      if (speaking) {
        this.seg.speechMs += 50;
        this.lastVoice = now;
        this.heard = true;
        this.onState?.('hearing');
      }
      const segLen = now - this.segStart;
      if (this.heard && now - this.lastVoice > this.silenceMs) {
        this.cut();
        this.heard = false;
        this.startSegment();
        this.onState?.('listening');
      } else if (segLen > this.maxMs || (!this.heard && segLen > 6000)) {
        // force-cut long speech; recycle silent segments so they stay small
        this.cut();
        this.heard = false;
        this.startSegment();
      }
      this.timer = setTimeout(tick, 50);
    };
    tick();
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.cut();
    this.onState?.('off');
  }

  // Push-to-talk: everything between down() and up() is one chunk.
  async down() {
    if (this.active || this.ptt) return;
    await this.init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.ptt = true;
    this.startSegment();
    this.seg.speechMs = 1000; // user meant it; don't drop
    this.onState?.('hearing');
    const meter = () => {
      if (!this.ptt) return;
      this.onLevel?.(this.level(), true);
      this.pttTimer = setTimeout(meter, 50);
    };
    meter();
  }
  up() {
    if (!this.ptt) return;
    this.ptt = false;
    clearTimeout(this.pttTimer);
    setTimeout(() => this.cut(), 200); // catch the last syllable
    this.onState?.('off');
  }
}
