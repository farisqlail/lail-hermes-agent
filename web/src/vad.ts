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

/** Drives a VadStateMachine from a live MediaStream. Not covered by the node
 *  tests — it is WebAudio plumbing with no decisions in it. */
export class MicVad {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
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

  async start(stream: MediaStream): Promise<void> {
    if (this.ctx) return;
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    // A tab that was backgrounded suspends its context; resume or every frame
    // reads as silence and hands-free stops responding.
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.machine.reset();

    this.timer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buf as any);
      const event = this.machine.push(rmsOf(this.buf), this.handlers.isDucked?.() ?? false);
      if (event === 'speech-start') this.handlers.onSpeechStart();
      if (event === 'speech-end') this.handlers.onSpeechEnd();
    }, this.cfg.frameMs);
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.source?.disconnect();
    this.analyser?.disconnect();
    void this.ctx?.close().catch(() => {});
    this.source = null;
    this.analyser = null;
    this.ctx = null;
    this.machine.reset();
  }
}
