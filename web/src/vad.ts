/** Voice-activity detection.
 *
 *  Client-side and energy-based on purpose. Barge-in has to react in roughly
 *  150 ms, so the detector cannot sit behind a network round trip — which is
 *  what silero or webrtcvad on the server would mean, along with streaming the
 *  microphone continuously. The decision logic is isolated in VadStateMachine
 *  so a model-based detector could later feed it probabilities instead of RMS
 *  without touching anything above. */

export type VadSensitivity = 'low' | 'medium' | 'high';

export interface VadConfig {
  /** Analyser poll interval. 50 ms keeps barge-in under ~150 ms. */
  frameMs: number;
  /** Consecutive speech frames before speech-start. Rejects impulse noise. */
  startFrames: number;
  /** Silence after speech before speech-end. This is the hands-free endpoint. */
  silenceMs: number;
  /** Utterances shorter than this are discarded — a cough is not a question. */
  minSpeechMs: number;
  /** Absolute gate, so a silent room's noise floor cannot be scaled into speech. */
  floorRms: number;
  /** How far above the tracked noise floor counts as speech. */
  snrFactor: number;
  /** Extra multiplier while the assistant is speaking. Echo cancellation is
   *  imperfect; without this the assistant barges in on itself. */
  duckingFactor: number;
  /** EMA rate for the noise floor, applied only while not speaking. */
  noiseAdaptRate: number;
}

export const VAD_DEFAULTS: VadConfig = {
  frameMs: 50,
  startFrames: 3,
  silenceMs: 800,
  minSpeechMs: 300,
  floorRms: 0.01,
  snrFactor: 3,
  duckingFactor: 2.5,
  noiseAdaptRate: 0.05,
};

const SNR_BY_SENSITIVITY: Record<VadSensitivity, number> = {
  low: 4.5,    // noisy room / open-plan — needs a clear voice
  medium: 3,
  high: 2,     // quiet room / close mic — triggers easily
};

export function vadConfigFor(sensitivity: VadSensitivity, silenceMs: number): VadConfig {
  return {
    ...VAD_DEFAULTS,
    snrFactor: SNR_BY_SENSITIVITY[sensitivity] ?? VAD_DEFAULTS.snrFactor,
    silenceMs,
  };
}

export type VadEvent = 'speech-start' | 'speech-end' | null;

export function rmsOf(frame: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / (frame.length || 1));
}

export class VadStateMachine {
  private cfg: VadConfig;
  private noiseFloor: number;
  private speechFrames = 0;
  private silenceFrames = 0;
  private voicedFrames = 0;
  private speaking = false;

  constructor(cfg: Partial<VadConfig> = {}) {
    this.cfg = { ...VAD_DEFAULTS, ...cfg };
    this.noiseFloor = this.cfg.floorRms;
  }

  get active(): boolean { return this.speaking; }

  reset(): void {
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.voicedFrames = 0;
    this.speaking = false;
    this.noiseFloor = this.cfg.floorRms;
  }

  /** Feed one frame. `ducked` is true while the assistant is speaking. */
  push(rms: number, ducked = false): VadEvent {
    const factor = this.cfg.snrFactor * (ducked ? this.cfg.duckingFactor : 1);
    const threshold = Math.max(this.cfg.floorRms * (ducked ? this.cfg.duckingFactor : 1),
                               this.noiseFloor * factor);
    const isSpeech = rms > threshold;

    if (!isSpeech && !this.speaking && !ducked) {
      // Track the room only while nobody is talking, or a long utterance would
      // raise the floor until the speaker's own voice reads as silence.
      const r = this.cfg.noiseAdaptRate;
      this.noiseFloor = (1 - r) * this.noiseFloor + r * Math.max(rms, 1e-6);
    }

    if (this.speaking) {
      if (isSpeech) {
        this.silenceFrames = 0;
        this.voicedFrames++;
        return null;
      }
      this.silenceFrames++;
      if (this.silenceFrames * this.cfg.frameMs < this.cfg.silenceMs) return null;
      const spokenMs = this.voicedFrames * this.cfg.frameMs;
      this.speaking = false;
      this.speechFrames = 0;
      this.silenceFrames = 0;
      this.voicedFrames = 0;
      // Too short to transcribe: end the state without telling anyone, so no
      // empty round trip to /api/stt.
      return spokenMs >= this.cfg.minSpeechMs ? 'speech-end' : null;
    }

    if (!isSpeech) { this.speechFrames = 0; return null; }
    this.speechFrames++;
    if (this.speechFrames < this.cfg.startFrames) return null;
    this.speaking = true;
    this.voicedFrames = this.speechFrames;
    this.silenceFrames = 0;
    return 'speech-start';
  }
}

/** The RMS sampler, run inside an AudioWorklet. This is the whole reason
 *  hands-free keeps working while the dashboard tab is in the background: a
 *  `setInterval` is clamped to ~1 Hz (and far worse after a few minutes) once a
 *  tab is hidden, so the old analyser-poll loop simply stopped sampling and the
 *  mic went deaf. An AudioWorklet runs on the audio rendering thread, which is
 *  real-time and unthrottled by tab visibility, so `process()` keeps firing at
 *  full rate whatever tab has focus. It only computes RMS and posts it — every
 *  decision still runs in VadStateMachine on the main thread, so the tested
 *  logic is untouched. Kept as a source string and loaded from a Blob URL so no
 *  bundler/asset-pipeline config is needed to ship a second entrypoint. */
const VAD_WORKLET_SRC = `
class VadRmsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._frameSamples = options.processorOptions.frameSamples;
    this._sumSq = 0;
    this._count = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) this._sumSq += ch[i] * ch[i];
      this._count += ch.length;
      if (this._count >= this._frameSamples) {
        this.port.postMessage(Math.sqrt(this._sumSq / this._count));
        this._sumSq = 0;
        this._count = 0;
      }
    }
    return true;
  }
}
registerProcessor('vad-rms', VadRmsProcessor);
`;

/** Drives a VadStateMachine from a live MediaStream. Not covered by the node
 *  tests — it is WebAudio plumbing with no decisions in it. Uses an AudioWorklet
 *  so it keeps sampling in a backgrounded tab; falls back to a `setInterval`
 *  analyser poll only when the worklet API is unavailable (which then behaves
 *  exactly as before — fine while the tab is focused). */
export class MicVad {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private machine: VadStateMachine;
  private buf: Float32Array = new Float32Array(0);

  constructor(
    private cfg: VadConfig,
    private handlers: {
      onSpeechStart(): void;
      onSpeechEnd(): void;
      /** True while the assistant is speaking, so the threshold ducks. */
      isDucked?(): boolean;
    },
  ) {
    this.machine = new VadStateMachine(cfg);
  }

  /** Feed one RMS frame through the state machine and dispatch any event. */
  private feed(rms: number): void {
    const event = this.machine.push(rms, this.handlers.isDucked?.() ?? false);
    if (event === 'speech-start') this.handlers.onSpeechStart();
    if (event === 'speech-end') this.handlers.onSpeechEnd();
  }

  async start(stream: MediaStream): Promise<void> {
    if (this.ctx) return;
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    // A tab that was backgrounded suspends its context; resume or every frame
    // reads as silence and hands-free stops responding.
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.machine.reset();

    // frameMs of audio at this context's real sample rate, so the worklet posts
    // at the same cadence the state machine's silence/start counters assume.
    const frameSamples = Math.max(
      1, Math.round((this.cfg.frameMs / 1000) * this.ctx.sampleRate));

    if (this.ctx.audioWorklet) {
      const url = URL.createObjectURL(
        new Blob([VAD_WORKLET_SRC], { type: 'application/javascript' }));
      try {
        await this.ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      // start() may have been cancelled (tab navigated away) while addModule
      // was in flight; stop() nulls ctx, so bail rather than resurrect it.
      if (!this.ctx || !this.source) return;
      this.node = new AudioWorkletNode(this.ctx, 'vad-rms', {
        processorOptions: { frameSamples },
      });
      this.node.port.onmessage = (e) => this.feed(e.data as number);
      this.source.connect(this.node);
      // The worklet writes no output, so connecting it to the destination pulls
      // the graph (guaranteeing process() runs) while emitting pure silence —
      // no feedback from the microphone.
      this.node.connect(this.ctx.destination);
      return;
    }

    // Fallback: the old analyser poll. Throttled in a hidden tab, but correct
    // while focused — only reached on a browser without AudioWorklet.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buf as any);
      this.feed(rmsOf(this.buf));
    }, this.cfg.frameMs);
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); }
    this.source?.disconnect();
    this.analyser?.disconnect();
    void this.ctx?.close().catch(() => {});
    this.node = null;
    this.source = null;
    this.analyser = null;
    this.ctx = null;
    this.machine.reset();
  }
}
