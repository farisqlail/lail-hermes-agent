import { test } from 'node:test';
import assert from 'node:assert';
import { splitSentences, flushSentence } from './sentences';

test('emits a sentence only once its terminator is followed by more input', () => {
  // mid-stream the trailing text may still grow — holding it back is the point
  assert.deepEqual(splitSentences('Halo tuan.'), { sentences: [], remainder: 'Halo tuan.' });
  assert.deepEqual(splitSentences('Halo tuan. Ada'),
    { sentences: ['Halo tuan.'], remainder: 'Ada' });
});

test('handles the three terminators and the ellipsis', () => {
  const { sentences, remainder } = splitSentences('Selesai! Benar? Mungkin… lalu');
  assert.deepEqual(sentences, ['Selesai!', 'Benar?', 'Mungkin…']);
  assert.equal(remainder, 'lalu');
});

test('does not split a decimal number', () => {
  assert.deepEqual(splitSentences('Nilainya 3.5 detik lebih cepat. Oke'),
    { sentences: ['Nilainya 3.5 detik lebih cepat.'], remainder: 'Oke' });
});

test('does not split known abbreviations', () => {
  const { sentences } = splitSentences('Ada tiga: A, B, dll. lalu kita lanjut. Ya');
  assert.deepEqual(sentences, ['Ada tiga: A, B, dll. lalu kita lanjut.']);
  assert.deepEqual(splitSentences('Lihat No. 4 di tabel. Berikutnya').sentences,
    ['Lihat No. 4 di tabel.']);
});

test('a blank line ends a sentence even without a terminator', () => {
  // markdown headings and list items rarely carry a full stop
  const { sentences, remainder } = splitSentences('# Ringkasan\n\nBaris berikutnya');
  assert.deepEqual(sentences, ['# Ringkasan']);
  assert.equal(remainder, 'Baris berikutnya');
});

test('a fenced code block is never split apart', () => {
  const src = 'Jalankan ini:\n\n```sh\ncd app. lalu\npytest -q\n```\n\nSelesai.';
  const { sentences } = splitSentences(src + ' ');
  // the fence travels as one chunk; the server strips it and answers 204
  assert.ok(sentences.some((s) => s.includes('```sh') && s.includes('pytest -q')));
  assert.ok(!sentences.some((s) => s === 'cd app.'));
});

test('drops fragments too short to be worth a round trip', () => {
  const { sentences } = splitSentences('A. Kalimat yang cukup panjang. B');
  assert.deepEqual(sentences, ['A. Kalimat yang cukup panjang.']);
});

test('flushSentence emits whatever is left, or nothing', () => {
  assert.deepEqual(flushSentence('kalimat terakhir tanpa titik'),
    ['kalimat terakhir tanpa titik']);
  assert.deepEqual(flushSentence('  '), []);
  assert.deepEqual(flushSentence('.'), []);
});
