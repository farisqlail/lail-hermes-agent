/** Pulls the <voice> line out of a token stream.
 *
 *  The chat model opens its reply with one spoken sentence wrapped in a tag;
 *  extracting it here means synthesis starts while the rest of the answer is
 *  still arriving — one LLM call instead of two. Mirrors the grammar in
 *  hermes/voice.py, which strips the same tag before storing a turn.
 *
 *  The hard part is that deltas arrive mid-tag. Rendering "<voi" and then
 *  un-rendering it flickers, so the extractor holds back any suffix that could
 *  still grow into the opening tag and releases it the moment it cannot. */

export const VOICE_TAG_OPEN = '<voice>';
export const VOICE_TAG_CLOSE = '</voice>';

/** Beyond this the model ignored "one sentence"; the line is shown rather than
 *  spoken. Must match MAX_VOICE_CHARS in hermes/voice.py. */
export const MAX_VOICE_CHARS = 300;

export interface VoiceChunk {
  /** Text safe to append to the visible reply. May be empty. */
  display: string;
  /** The spoken line, exactly once, on the delta that completed it. */
  voice: string | null;
}

/** Length of the longest suffix of `s` that is a proper prefix of `tag`. */
function partialTagSuffix(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (s.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

export class VoiceTagExtractor {
  private buf = '';
  private inTag = false;
  private tagBuf = '';
  private captured = false;

  /** True once a well-formed, speakable line has been emitted. When this is
   *  still false at the end of a stream, the caller falls back to
   *  /api/tts/smart. */
  get sawTag(): boolean { return this.captured; }

  push(delta: string): VoiceChunk {
    let display = '';
    let voice: string | null = null;

    if (this.inTag) {
      this.tagBuf += delta;
      const close = this.tagBuf.indexOf(VOICE_TAG_CLOSE);
      if (close === -1) {
        // Guard against a model that opened the tag and kept writing: stop
        // buffering the whole reply into a "sentence".
        if (this.tagBuf.length > MAX_VOICE_CHARS + VOICE_TAG_CLOSE.length) {
          this.inTag = false;
          this.buf += this.tagBuf;
          this.tagBuf = '';
          return this.drain();
        }
        return { display: '', voice: null };
      }
      const line = this.tagBuf.slice(0, close).trim();
      const rest = this.tagBuf.slice(close + VOICE_TAG_CLOSE.length);
      this.inTag = false;
      this.tagBuf = '';
      if (!this.captured && line.length > 0 && line.length <= MAX_VOICE_CHARS) {
        voice = line;
        this.captured = true;
      } else if (line.length > MAX_VOICE_CHARS) {
        // Too long to speak, but it is still the model's prose — show it.
        this.buf += line;
      }
      this.buf += rest;
      const out = this.drain();
      return { display: out.display, voice };
    }

    this.buf += delta;
    return this.drain();
  }

  /** Everything held back, at end of stream. An unclosed tag is recovered as
   *  display text: losing the reply is worse than losing the latency win. */
  flush(): VoiceChunk {
    if (this.inTag) {
      this.buf += this.tagBuf;
      this.tagBuf = '';
      this.inTag = false;
    }
    const display = this.buf;
    this.buf = '';
    return { display, voice: null };
  }

  /** Emit everything in the buffer that cannot still be part of a tag. */
  private drain(): VoiceChunk {
    let display = '';
    for (;;) {
      const open = this.buf.indexOf(VOICE_TAG_OPEN);
      if (open === -1) break;
      display += this.buf.slice(0, open);
      this.buf = this.buf.slice(open + VOICE_TAG_OPEN.length);
      this.inTag = true;
      this.tagBuf = this.buf;
      this.buf = '';
      // Whatever followed the opening tag in this same delta is already tag
      // content; re-run the closing search over it.
      const delta = this.tagBuf;
      this.tagBuf = '';
      const inner = this.push(delta);
      return { display: display + inner.display, voice: inner.voice };
    }
    // Hold back a suffix that could still grow into "<voice>".
    const hold = partialTagSuffix(this.buf, VOICE_TAG_OPEN);
    display += this.buf.slice(0, this.buf.length - hold);
    this.buf = this.buf.slice(this.buf.length - hold);
    return { display, voice: null };
  }
}
