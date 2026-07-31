/** Streaming sentence splitter for text-to-speech.
 *
 *  Fed a buffer that is still growing, it returns only the sentences it is
 *  certain about and hands the rest back. Speaking cannot start until a
 *  sentence is complete, and re-speaking a sentence because the buffer grew is
 *  worse than waiting one more chunk. */

/** Below this a "sentence" is punctuation or a stray letter — not worth an
 *  edge-tts round trip, so it is merged into the next one. */
export const MIN_SPEAK_CHARS = 2;

/** Tokens that end in a full stop without ending a sentence. Indonesian first
 *  (the assistant answers in Bahasa); the English ones show up in code talk. */
const ABBREVIATIONS = [
  'dll', 'dsb', 'dst', 'tsb', 'yg', 'no', 'hal', 'jl', 'rp', 'a.n', 'u.b', 'd.a',
  'bpk', 'sdr', 'sdri', 'prof', 'dr', 'ir', 'st', 'mis',
  'e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'fig', 'approx',
];

const TERMINATORS = '.!?…';

function endsWithAbbreviation(text: string): boolean {
  const m = text.match(/\b([A-Za-z]+)\.$/);
  if (!m) return false;
  const word = m[1].toLowerCase();
  return word.length === 1 || ABBREVIATIONS.includes(word);
}

/** True when the full stop at `i` sits between two digits — "3.5", "v1.2". */
function isDecimalPoint(buffer: string, i: number): boolean {
  return buffer[i] === '.'
    && /\d/.test(buffer[i - 1] ?? '')
    && /\d/.test(buffer[i + 1] ?? '');
}

/** Index just past the closing fence of the code block opening at `i`, or -1
 *  when the block is still open (the stream has not delivered the close yet). */
function endOfFence(buffer: string, i: number): number {
  const close = buffer.indexOf('```', i + 3);
  if (close === -1) return -1;
  const nl = buffer.indexOf('\n', close);
  return nl === -1 ? buffer.length : nl + 1;
}

export function splitSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let start = 0;
  let i = 0;

  const emit = (end: number, next: number) => {
    const chunk = buffer.slice(start, end).trim();
    if (chunk.length >= MIN_SPEAK_CHARS) {
      sentences.push(chunk);
      start = next;
      return true;
    }
    return false; // too short: keep accumulating from the same start
  };

  while (i < buffer.length) {
    // A fenced block is atomic. It is unspeakable anyway — the server cleans it
    // to nothing and answers 204 — but splitting inside it would emit lines of
    // code as sentences.
    if (buffer.startsWith('```', i)) {
      const end = endOfFence(buffer, i);
      if (end === -1) return { sentences, remainder: buffer.slice(start).trimStart() };
      i = end;
      continue;
    }

    // A blank line ends a unit: headings, list items and table rows rarely
    // carry a terminator, and holding them until the next full stop would
    // stall speech for a whole paragraph.
    if (buffer.startsWith('\n\n', i)) {
      if (emit(i, i + 2)) { i = start; continue; }
      i += 2;
      continue;
    }

    if (TERMINATORS.includes(buffer[i])) {
      if (isDecimalPoint(buffer, i)) { i++; continue; }
      // consume a run of terminators ("?!", "...")
      let end = i + 1;
      while (end < buffer.length && TERMINATORS.includes(buffer[end])) end++;
      // Only safe once there is a following character: mid-stream the buffer
      // may still be growing into "3." -> "3.5".
      if (end >= buffer.length) break;
      if (!/\s/.test(buffer[end])) { i = end; continue; }
      if (endsWithAbbreviation(buffer.slice(start, end))) { i = end; continue; }
      if (emit(end, end)) { i = start; continue; }
      i = end;
      continue;
    }
    i++;
  }

  return { sentences, remainder: buffer.slice(start).trimStart() };
}

/** What is left when the stream ends. A remainder that is only punctuation or
 *  whitespace is dropped rather than sent to the synthesiser. */
export function flushSentence(remainder: string): string[] {
  const chunk = remainder.trim();
  if (chunk.length < MIN_SPEAK_CHARS) return [];
  if (!/[A-Za-z0-9]/.test(chunk)) return [];
  return [chunk];
}
