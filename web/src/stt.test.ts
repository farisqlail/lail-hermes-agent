import { test } from 'node:test';
import assert from 'node:assert';
import { sttErrorMessage, transcribeBlob, SttError, STT_MAX_BYTES } from './stt';

test('sttErrorMessage explains a missing install for 503', () => {
  const msg = sttErrorMessage(503, 'faster-whisper belum terinstal. Jalankan: pip install -e .[voice]');
  assert.ok(msg.includes('pip install -e .[voice]'));
});

test('sttErrorMessage points at the setting for 403', () => {
  const msg = sttErrorMessage(403, 'Voice input dimatikan di pengaturan Suara');
  assert.ok(msg.includes('pengaturan'));
});

test('sttErrorMessage falls back to the status code when detail is empty', () => {
  const msg = sttErrorMessage(500, '');
  assert.ok(msg.includes('500'));
});

test('transcribeBlob rejects an empty recording without calling the server', async () => {
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response(); }) as typeof fetch;
  await assert.rejects(
    () => transcribeBlob(new Blob([], { type: 'audio/webm' })),
    (e: Error) => e instanceof SttError,
  );
  assert.equal(called, false);
});

test('transcribeBlob rejects an oversized recording without calling the server', async () => {
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response(); }) as typeof fetch;
  const big = new Blob([new Uint8Array(STT_MAX_BYTES + 1)], { type: 'audio/webm' });
  await assert.rejects(
    () => transcribeBlob(big),
    (e: Error) => e instanceof SttError,
  );
  assert.equal(called, false);
});

test('transcribeBlob returns the trimmed transcript', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ text: '  jalankan test  ' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
  const text = await transcribeBlob(new Blob([new Uint8Array(64)], { type: 'audio/webm' }));
  assert.equal(text, 'jalankan test');
});

test('transcribeBlob returns empty string on 204', async () => {
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  const text = await transcribeBlob(new Blob([new Uint8Array(64)], { type: 'audio/webm' }));
  assert.equal(text, '');
});

test('transcribeBlob surfaces the server detail on failure', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: 'ctranslate2 blew up' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
  await assert.rejects(
    () => transcribeBlob(new Blob([new Uint8Array(64)], { type: 'audio/webm' })),
    (e: Error) => e.message.includes('ctranslate2 blew up'),
  );
});
