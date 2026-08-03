/** Speech playback. Owns the one audio element, the fetch-ahead queue and the
 *  single stop() that barge-in pulls.
 *
 *  The DOM lives behind AudioSink so the queue's ordering and abort logic can
 *  be tested in the node runner, which has no HTMLAudioElement and no
 *  URL.createObjectURL. */

export interface AudioSink {
  /** Resolves when playback finishes, is stopped, or fails. Never rejects —
   *  a dead speaker must not stall the queue. */
  play(blob: Blob): Promise<void>;
  stop(): void;
}

export class HtmlAudioSink implements AudioSink {
  private el: HTMLAudioElement;
  private url: string | null = null;

  constructor(el?: HTMLAudioElement) {
    this.el = el ?? new Audio();
  }

  /** Play a zero-length sample from inside a click handler. Browsers only
   *  grant autoplay to an element that has already played under a gesture, and
   *  proactive speech (greeting, task notify) has no gesture of its own. */
  unlock(): void {
    this.el.src =
      'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA';
    this.el.play().catch(() => {});
  }

  play(blob: Blob): Promise<void> {
    this.revoke();
    this.url = URL.createObjectURL(blob);
    this.el.src = this.url;
    return new Promise<void>((resolve) => {
      const done = () => { this.el.onended = null; this.el.onerror = null; resolve(); };
      this.el.onended = done;
      this.el.onerror = done;
      this.el.play().catch(done);
    });
  }

  stop(): void {
    this.el.pause();
    // Fires whatever play() promise is outstanding, so the queue's await returns.
    this.el.onended?.(new Event('ended'));
    this.revoke();
  }

  private revoke(): void {
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }
}

export type SpeechFetcher = (
  endpoint: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<Blob | null>;

/** The real fetcher. `null` means HTTP 204 — the server had nothing speakable,
 *  which is not an error. */
export const fetchSpeech: SpeechFetcher = async (endpoint, payload, signal) => {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`TTS gagal (HTTP ${res.status})`);
  return res.blob();
};

interface QueueItem {
  blob: Promise<Blob | null>;
  controller: AbortController;
}

export class SpeechQueue {
  private items: QueueItem[] = [];
  private running = false;
  private _speaking = false;
  private readonly maxInFlight: number;
  private onSpeakingChange?: (speaking: boolean) => void;
  private turnStart: number | null = null;
  private readonly now: () => number;
  private onFirstAudio?: (ms: number) => void;

  constructor(
    private fetchAudio: SpeechFetcher,
    private sink: AudioSink,
    opts: {
      maxInFlight?: number;
      onSpeakingChange?: (speaking: boolean) => void;
      /** Injected so the measurement is testable without a real clock. */
      now?: () => number;
      /** Milliseconds from markTurnStart() to the first audio of that turn.
       *  The P3 target is under 1500. */
      onFirstAudio?: (ms: number) => void;
    } = {},
  ) {
    // Three concurrent edge-tts round trips is enough to hide the round-trip
    // latency of the sentence being spoken without opening a socket per
    // sentence of a long reply.
    this.maxInFlight = opts.maxInFlight ?? 3;
    this.onSpeakingChange = opts.onSpeakingChange;
    this.now = opts.now ?? (() => Date.now());
    this.onFirstAudio = opts.onFirstAudio;
  }

  /** Attach observers after construction. The queue is a process-wide
   *  singleton (see `sharedSpeechQueue`) so whichever page mounts first
   *  creates it, but only the Dashboard cares about the speaking flag and the
   *  first-audio measurement. */
  observe(opts: {
    onSpeakingChange?: (speaking: boolean) => void;
    onFirstAudio?: (ms: number) => void;
  }): void {
    if (opts.onSpeakingChange) this.onSpeakingChange = opts.onSpeakingChange;
    if (opts.onFirstAudio) this.onFirstAudio = opts.onFirstAudio;
  }

  /** Start the clock for one conversational turn. Proactive speech (greeting,
   *  task notify) deliberately does not call this — it has no turn to be late
   *  for, and would pollute the measurement. */
  markTurnStart(): void {
    this.turnStart = this.now();
  }

  get speaking(): boolean { return this._speaking; }
  get pending(): number { return this.items.length; }

  enqueue(endpoint: string, payload: Record<string, unknown>): void {
    const controller = new AbortController();
    const item: QueueItem = { controller, blob: Promise.resolve(null) };
    // Start the round trip now when there is a slot, otherwise when one frees.
    const inFlight = Math.min(this.items.length, this.maxInFlight);
    item.blob = inFlight < this.maxInFlight
      ? this.fetchAudio(endpoint, payload, controller.signal).catch(() => null)
      : this.waitForSlot().then(() =>
          controller.signal.aborted
            ? null
            : this.fetchAudio(endpoint, payload, controller.signal).catch(() => null));
    this.items.push(item);
    void this.drain();
  }

  stop(): void {
    for (const item of this.items) item.controller.abort();
    this.items = [];
    this.sink.stop();
    this.setSpeaking(false);
  }

  private slotWaiters: Array<() => void> = [];

  private waitForSlot(): Promise<void> {
    return new Promise<void>((resolve) => this.slotWaiters.push(resolve));
  }

  private releaseSlot(): void {
    this.slotWaiters.shift()?.();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.items.length > 0) {
        const item = this.items[0];
        let blob: Blob | null = null;
        try {
          blob = await item.blob;
        } catch {
          blob = null; // a dead round trip skips one sentence, not the reply
        }
        // stop() emptied the queue while we awaited: this item is stale.
        if (this.items[0] !== item) { this.releaseSlot(); continue; }
        this.items.shift();
        if (!blob || item.controller.signal.aborted) {
          this.releaseSlot();
          continue;
        }
        this.setSpeaking(true);
        if (this.turnStart !== null) {
          this.onFirstAudio?.(this.now() - this.turnStart);
          this.turnStart = null;   // one report per turn
        }
        await this.sink.play(blob);
        this.releaseSlot();
      }
    } finally {
      this.running = false;
      this.setSpeaking(false);
    }
  }

  private setSpeaking(next: boolean): void {
    if (this._speaking === next) return;
    this._speaking = next;
    this.onSpeakingChange?.(next);
  }
}

// ── the one queue everything speaks through ──
// Server-driven speech (task notify, step narration) arrives on the SSE feed,
// which the TasksProvider owns, while conversational speech is enqueued by the
// Dashboard. Two SpeechQueue instances would talk over each other — and stop()
// on one would not silence the other — so both share these.

let sharedQueue: SpeechQueue | null = null;
let sharedSink: HtmlAudioSink | null = null;

export function sharedAudioSink(): HtmlAudioSink {
  if (!sharedSink) sharedSink = new HtmlAudioSink();
  return sharedSink;
}

export function sharedSpeechQueue(): SpeechQueue {
  if (!sharedQueue) sharedQueue = new SpeechQueue(fetchSpeech, sharedAudioSink());
  return sharedQueue;
}
