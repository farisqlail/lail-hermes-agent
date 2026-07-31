/** Voice input. Records from the mic, sends the blob to POST /api/stt and
 *  hands back the transcript. Sibling of tts.ts, which owns voice output. */

/** Mirrors MAX_AUDIO_BYTES in hermes/stt.py. Checked here too so a runaway
 *  recorder is caught before 25MB crosses the wire. */
export const STT_MAX_BYTES = 25 * 1024 * 1024;

export class SttError extends Error {}

export interface SttStatus {
  available: boolean;
  loaded: boolean;
  model: string;
  enabled: boolean;
  language: string;
}

/** Turns a failed response into something an operator can act on. The server
 *  already writes actionable detail; this only covers the case where it
 *  cannot be read. */
export function sttErrorMessage(status: number, detail: string): string {
  if (detail) return detail;
  return `Transkripsi gagal (HTTP ${status})`;
}

export async function fetchSttStatus(): Promise<SttStatus> {
  const res = await fetch('/api/stt/status');
  if (!res.ok) throw new SttError(`Status STT tidak terbaca (HTTP ${res.status})`);
  return res.json();
}

async function readDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.detail === 'string' ? body.detail : '';
  } catch {
    return '';
  }
}

export async function transcribeBlob(blob: Blob): Promise<string> {
  if (blob.size === 0) throw new SttError('Tidak ada suara yang terekam');
  if (blob.size > STT_MAX_BYTES) {
    throw new SttError('Rekaman terlalu panjang — coba bicara lebih singkat');
  }

  const res = await fetch('/api/stt', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  });

  // 204 means the recording held no speech. Not an error: the caller leaves
  // the input box as it found it.
  if (res.status === 204) return '';
  if (!res.ok) throw new SttError(sttErrorMessage(res.status, await readDetail(res)));

  const data = await res.json();
  return String(data?.text ?? '').trim();
}

/** What we ask the browser for. echoCancellation is what lets the mic stay open
 *  while the assistant speaks; autoGainControl keeps a quiet speaker above the
 *  VAD threshold on laptop mics. */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export interface MicWarning {
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export const MIC_AEC_WARNING =
  'Peredam gema tidak aktif di mikrofon ini — asisten bisa menyela suaranya ' +
  'sendiri. Pakai headset, atau matikan Sela Otomatis di pengaturan Suara.';

/** Chrome drops these constraints silently on some capture devices, and with
 *  echo cancellation off, barge-in makes the assistant interrupt itself. A
 *  browser that reports nothing is taken at its word: warning on every Firefox
 *  session would train the operator to ignore the warning. */
export function checkMicConstraints(applied: MediaTrackSettings): MicWarning {
  return {
    echoCancellation: applied.echoCancellation !== false,
    autoGainControl: applied.autoGainControl !== false,
  };
}

/** One microphone, shared and reference counted.
 *
 *  The analyser must outlive any single recording, and re-acquiring per
 *  utterance costs 200-400 ms of device warm-up — enough to clip the first
 *  word of every hands-free reply. */
export class MicStream {
  static shared = new MicStream();

  private stream: MediaStream | null = null;
  private pending: Promise<MediaStream> | null = null;
  private refs = 0;
  private _warning: MicWarning | null = null;

  get warning(): MicWarning | null { return this._warning; }
  get live(): boolean { return this.stream !== null; }

  async acquire(): Promise<MediaStream> {
    this.refs++;
    if (this.stream) return this.stream;
    if (!this.pending) {
      this.pending = navigator.mediaDevices
        .getUserMedia({ audio: MIC_CONSTRAINTS })
        .then((s) => {
          this.stream = s;
          const track = s.getAudioTracks?.()[0];
          this._warning = track ? checkMicConstraints(track.getSettings()) : null;
          this.pending = null;
          return s;
        })
        .catch((e) => {
          this.refs = Math.max(0, this.refs - 1);
          this.pending = null;
          throw e;
        });
    }
    return this.pending;
  }

  release(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs > 0 || !this.stream) return;
    this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this._warning = null;
  }
}

/** One recording session over a shared MicStream. Never stops the tracks
 *  itself — the stream is refcounted and may be feeding the analyser. */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private held = false;

  constructor(private mic: MicStream = MicStream.shared) {}

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  async start(): Promise<void> {
    if (this.recording) return;
    const stream = await this.mic.acquire();
    this.held = true;
    this.chunks = [];
    this.recorder = new MediaRecorder(stream);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      this.release();
      return new Blob([], { type: 'audio/webm' });
    }
    const type = recorder.mimeType || 'audio/webm';
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type }));
      recorder.stop();
    });
    this.release();
    return blob;
  }

  private release(): void {
    this.recorder = null;
    this.chunks = [];
    if (this.held) { this.mic.release(); this.held = false; }
  }
}
