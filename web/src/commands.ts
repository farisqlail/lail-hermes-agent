/** Utterances handled locally, without an LLM.
 *
 *  "Diam" has to take effect now. Routing it through the chat model would cost
 *  a round trip to learn the operator wants silence, which is the one request
 *  where latency is the whole point. */

export type LocalCommand = 'stop';

/** Spoken after a recognised stop, so the operator gets confirmation in the
 *  thread that the command landed rather than wondering if the mic heard it. */
export const STOP_ACK = 'Baik, saya diam.';

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

export function matchLocalCommand(text: string): LocalCommand | null {
  const normalised = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')   // drop punctuation, keep letters/digits
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalised) return null;
  return STOP_PHRASES.has(normalised) ? 'stop' : null;
}
