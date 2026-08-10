import { test } from 'node:test';
import assert from 'node:assert';
import { matchLocalCommand } from './commands';

test('recognises the Indonesian stop words', () => {
  for (const s of ['stop', 'Stop!', 'berhenti', 'diam', 'cukup', 'sudah cukup',
                   'diam dulu', 'berhenti dulu', 'stop dulu', 'diam dong']) {
    assert.equal(matchLocalCommand(s), 'stop', s);
  }
});

test('recognises the English stop words', () => {
  for (const s of ['stop', 'quiet', 'be quiet', 'shut up', 'enough', 'stop talking']) {
    assert.equal(matchLocalCommand(s), 'stop', s);
  }
});

test('ignores case, punctuation and surrounding whitespace', () => {
  assert.equal(matchLocalCommand('  BERHENTI...  '), 'stop');
});

test('a stop word inside a real instruction is not a command', () => {
  // this one has to keep working — it is a task, not an interruption
  assert.equal(matchLocalCommand('stop the build after the tests pass'), null);
  assert.equal(matchLocalCommand('berhenti kalau ada error lalu laporkan'), null);
  assert.equal(matchLocalCommand('cukup jelaskan bagian yang gagal saja'), null);
});

test('empty and non-command input yields null', () => {
  assert.equal(matchLocalCommand(''), null);
  assert.equal(matchLocalCommand('   '), null);
  assert.equal(matchLocalCommand('jalankan pengujian di myprofit'), null);
});

test('recognises confirm words', () => {
  for (const s of ['ya', 'iya', 'setuju', 'konfirmasi', 'oke', 'lanjut',
                   'yes', 'confirm', 'do it', 'go ahead']) {
    assert.equal(matchLocalCommand(s), 'confirm', s);
  }
});

test('recognises decline words', () => {
  for (const s of ['tidak', 'batal', 'batalkan', 'jangan', 'tolak',
                   'no', 'cancel', 'decline', 'abort']) {
    assert.equal(matchLocalCommand(s), 'decline', s);
  }
});

test('recognises camera-open words', () => {
  for (const s of ['buka kamera', 'nyalakan kamera', 'aktifkan kamera',
                   'liat kamera', 'kamera',
                   'open camera', 'open the camera', 'turn on the camera',
                   'start camera', 'Buka Kamera!']) {
    assert.equal(matchLocalCommand(s), 'camera', s);
  }
});

test('a camera word inside a real question is not a command', () => {
  // a question about a camera must reach the chat model, not open the webcam
  assert.equal(matchLocalCommand('jelaskan cara kerja kamera ini'), null);
  assert.equal(matchLocalCommand('kamera apa yang bagus untuk vlog'), null);
});

test('a confirm word inside a longer sentence is not a command', () => {
  // whole-utterance only — a spoken instruction that happens to contain "ya"
  // must reach the chat, not be swallowed as a confirmation
  assert.equal(matchLocalCommand('ya tolong buka file itu'), null);
  assert.equal(matchLocalCommand('jangan lupa jalankan tes dulu'), null);
});
