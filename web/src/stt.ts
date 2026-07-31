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

/** One recording session. Holds the MediaStream so stop() can release the
 *  mic — without that the browser keeps showing the recording indicator and
 *  the mic stays hot long after the operator stopped talking. */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  async start(): Promise<void> {
    if (this.recording) return;
    // echoCancellation is what will let the mic stay open while the assistant
    // is speaking, once barge-in lands. Harmless now, and asking for it later
    // would mean re-acquiring the stream.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
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
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}
