/** Utterances handled locally, without an LLM.
 *
 *  "Diam" has to take effect now. Routing it through the chat model would cost
 *  a round trip to learn the operator wants silence, which is the one request
 *  where latency is the whole point. */

export type LocalCommand = 'stop' | 'confirm' | 'decline' | 'camera';

/** Spoken after a recognised stop, so the operator gets confirmation in the
 *  thread that the command landed rather than wondering if the mic heard it. */
export const STOP_ACK = 'Baik, saya diam.';

/** Shown when the camera opens by voice/text, so the operator knows the phrase
 *  was heard as a command and not sent to the chat model. */
export const CAMERA_ACK = 'Membuka kamera.';

/** Whole-utterance only: "buka kamera" opens the webcam locally. A camera word
 *  inside a longer sentence ("jelaskan cara kerja kamera ini") is a question,
 *  not a command, and must still reach the chat model. */
const CAMERA_PHRASES = new Set([
  // Indonesian
  'buka kamera', 'nyalakan kamera', 'aktifkan kamera', 'kamera',
  'buka kameranya', 'nyalakan kameranya', 'tolong buka kamera',
  'lihat kamera', 'liat kamera',
  // English
  'open camera', 'open the camera', 'turn on camera', 'turn on the camera',
  'start camera', 'camera',
]);

/** Whole-utterance matches only. A stop word inside a longer sentence
 *  ("stop the build after tests pass") is an instruction, not an interruption,
 *  and swallowing it would lose a real task. */
const STOP_PHRASES = new Set([
  // Indonesian
  'stop', 'stop stop', 'stop dulu', 'stop bicara',
  'berhenti', 'berhenti dulu', 'berhenti bicara', 'jangan bicara',
  'diam', 'diam dulu', 'diam dong', 'diam ya',
  'cukup', 'sudah cukup', 'udah cukup', 'sudah', 'udah',
  // English
  'quiet', 'be quiet', 'shut up', 'enough', 'stop talking', 'stop it',
  'hush', 'silence',
]);

/** Approve / decline a parked write action by voice. Whole-utterance only, and
 *  the caller ignores them when nothing is pending — so a bare "ya" mid-chat is
 *  still sent as normal text, not swallowed as a confirmation. */
const CONFIRM_PHRASES = new Set([
  // Indonesian
  'ya', 'iya', 'ya betul', 'betul', 'setuju', 'oke', 'ok', 'oke lanjut',
  'lanjut', 'lanjutkan', 'konfirmasi', 'konfirmasi ya', 'jalankan', 'kirim',
  'ya jalankan', 'ya kirim', 'boleh', 'silakan', 'gas',
  // English
  'yes', 'yeah', 'confirm', 'approve', 'approved', 'do it', 'go ahead',
  'proceed', 'send it',
]);

const DECLINE_PHRASES = new Set([
  // Indonesian
  'tidak', 'nggak', 'gak', 'jangan', 'batal', 'batalkan', 'tolak', 'tolak ya',
  'jangan kirim', 'jangan jalankan', 'stop jangan', 'no jangan',
  // English
  'no', 'nope', 'cancel', 'decline', 'reject', 'abort', 'do not', "don't",
]);

export function matchLocalCommand(text: string): LocalCommand | null {
  const normalised = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')   // drop punctuation, keep letters/digits
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalised) return null;
  if (STOP_PHRASES.has(normalised)) return 'stop';
  if (CAMERA_PHRASES.has(normalised)) return 'camera';
  if (CONFIRM_PHRASES.has(normalised)) return 'confirm';
  if (DECLINE_PHRASES.has(normalised)) return 'decline';
  return null;
}
