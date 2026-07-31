import { test } from 'node:test';
import assert from 'node:assert';
import { VoiceTagExtractor, MAX_VOICE_CHARS } from './voicetag';

/** Feed a string one character at a time — the worst case a token stream can
 *  produce, and the one where a naive splitter leaks "<voi" onto the screen. */
function drip(src: string) {
  const x = new VoiceTagExtractor();
  let display = '';
  const voices: string[] = [];
  for (const ch of src) {
    const out = x.push(ch);
    display += out.display;
    if (out.voice) voices.push(out.voice);
  }
  const last = x.flush();
  display += last.display;
  if (last.voice) voices.push(last.voice);
  return { display, voices, sawTag: x.sawTag };
}

test('extracts the spoken line and keeps it off the screen', () => {
  const { display, voices, sawTag } = drip('<voice>Semua lulus.</voice>## Hasil\nRinci.');
  assert.deepEqual(voices, ['Semua lulus.']);
  assert.equal(display, '## Hasil\nRinci.');
  assert.equal(sawTag, true);
});

test('never emits a partial opening tag', () => {
  const x = new VoiceTagExtractor();
  // "<voi" could still become "<voice>" — holding it back is the whole job
  assert.equal(x.push('<voi').display, '');
  assert.equal(x.push('ce>Halo.</voice>Sisa').display, 'Sisa');
  assert.equal(x.flush().display, '');
});

test('releases a false alarm once it cannot become the tag', () => {
  const x = new VoiceTagExtractor();
  assert.equal(x.push('<vo').display, '');
  // "<vox" can never grow into "<voice>", so it is text after all
  assert.equal(x.push('x oke').display, '<vox oke');
});

test('passes untagged text straight through', () => {
  const { display, voices, sawTag } = drip('Tidak ada tag di sini.');
  assert.equal(display, 'Tidak ada tag di sini.');
  assert.deepEqual(voices, []);
  assert.equal(sawTag, false);
});

test('emits the voice line as soon as the closing tag lands', () => {
  const x = new VoiceTagExtractor();
  x.push('<voice>Beres.');
  assert.equal(x.push('</voi').voice, null);   // not yet — latency, not correctness
  assert.equal(x.push('ce>').voice, 'Beres.');
});

test('recovers an unclosed tag as display text at flush', () => {
  const { display, voices, sawTag } = drip('<voice>Jawaban tanpa penutup');
  assert.deepEqual(voices, []);
  assert.equal(display, 'Jawaban tanpa penutup');
  // the caller must fall back to /api/tts/smart, so this stays false
  assert.equal(sawTag, false);
});

test('refuses an oversized spoken line and shows it instead', () => {
  const long = 'x'.repeat(MAX_VOICE_CHARS + 1);
  const { display, voices } = drip(`<voice>${long}</voice>Sisa.`);
  assert.deepEqual(voices, []);
  assert.ok(display.includes(long));
  assert.ok(display.endsWith('Sisa.'));
});

test('a second tag is removed but not spoken twice', () => {
  const { display, voices } = drip('<voice>Satu.</voice>Isi.<voice>Dua.</voice>Lagi.');
  assert.deepEqual(voices, ['Satu.']);
  assert.equal(display, 'Isi.Lagi.');
});

test('text before the tag is displayed, not swallowed', () => {
  const { display, voices } = drip('Halo. <voice>Ringkas.</voice>Sisa.');
  assert.deepEqual(voices, ['Ringkas.']);
  assert.equal(display, 'Halo. Sisa.');
});
