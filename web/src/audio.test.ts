import { test } from 'node:test';
import assert from 'node:assert';
import { SpeechQueue, AudioSink, SpeechFetcher } from './audio';

function fakeSink() {
  const played: string[] = [];
  let stopped = 0;
  let release: (() => void) | null = null;
  const sink: AudioSink = {
    play: (blob) => new Promise<void>((resolve) => {
      played.push((blob as unknown as { tag: string }).tag);
      release = resolve;
    }),
    stop: () => { stopped++; release?.(); release = null; },
  };
  return { sink, played, finish: () => { release?.(); release = null; },
           get stopped() { return stopped; } };
}

function fakeFetcher(): SpeechFetcher & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (_e: string, p: Record<string, unknown>, signal: AbortSignal) => {
    calls.push(String(p.text));
    if (signal.aborted) throw new Error('aborted');
    return { tag: String(p.text) } as unknown as Blob;
  }) as SpeechFetcher & { calls: string[] };
  f.calls = calls;
  return f;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('plays queued utterances in order', async () => {
  const { sink, played, finish } = fakeSink();
  const q = new SpeechQueue(fakeFetcher(), sink);
  q.enqueue('/api/tts', { text: 'satu' });
  q.enqueue('/api/tts', { text: 'dua' });
  await tick(); await tick();
  assert.deepEqual(played, ['satu']);   // strictly one at a time
  finish(); await tick(); await tick();
  assert.deepEqual(played, ['satu', 'dua']);
});

test('fetches ahead while the previous utterance is still playing', async () => {
  const { sink, finish } = fakeSink();
  const fetcher = fakeFetcher();
  const q = new SpeechQueue(fetcher, sink);
  q.enqueue('/api/tts', { text: 'satu' });
  q.enqueue('/api/tts', { text: 'dua' });
  await tick(); await tick();
  // the second round trip is already in flight — that is the latency win
  assert.deepEqual(fetcher.calls, ['satu', 'dua']);
  finish();
});

test('respects the in-flight cap', async () => {
  const { sink } = fakeSink();
  const fetcher = fakeFetcher();
  const q = new SpeechQueue(fetcher, sink, { maxInFlight: 2 });
  for (const t of ['a', 'b', 'c', 'd']) q.enqueue('/api/tts', { text: t });
  await tick(); await tick();
  assert.deepEqual(fetcher.calls, ['a', 'b']);
});

test('stop() clears the queue, halts playback and aborts fetches', async () => {
  const s = fakeSink();
  const q = new SpeechQueue(fakeFetcher(), s.sink);
  q.enqueue('/api/tts', { text: 'satu' });
  q.enqueue('/api/tts', { text: 'dua' });
  await tick(); await tick();
  q.stop();
  await tick(); await tick();
  assert.equal(s.stopped, 1);
  assert.equal(q.pending, 0);
  assert.equal(q.speaking, false);
  // nothing queued before the stop may surface afterwards
  assert.deepEqual(s.played, ['satu']);
});

test('a 204 answer is skipped without stalling the queue', async () => {
  const { sink, played, finish } = fakeSink();
  const empty: SpeechFetcher = async (_e, p) =>
    (p.text === 'kosong' ? null : ({ tag: String(p.text) } as unknown as Blob));
  const q = new SpeechQueue(empty, sink);
  q.enqueue('/api/tts', { text: 'kosong' });
  q.enqueue('/api/tts', { text: 'isi' });
  await tick(); await tick(); await tick();
  assert.deepEqual(played, ['isi']);
  finish();
});

test('a failed fetch does not stall the queue', async () => {
  const { sink, played, finish } = fakeSink();
  const flaky: SpeechFetcher = async (_e, p) => {
    if (p.text === 'gagal') throw new Error('network');
    return { tag: String(p.text) } as unknown as Blob;
  };
  const q = new SpeechQueue(flaky, sink);
  q.enqueue('/api/tts', { text: 'gagal' });
  q.enqueue('/api/tts', { text: 'lanjut' });
  await tick(); await tick(); await tick();
  assert.deepEqual(played, ['lanjut']);
  finish();
});

test('reports speaking transitions once each way', async () => {
  const { sink, finish } = fakeSink();
  const seen: boolean[] = [];
  const q = new SpeechQueue(fakeFetcher(), sink, { onSpeakingChange: (v) => seen.push(v) });
  q.enqueue('/api/tts', { text: 'satu' });
  await tick(); await tick();
  finish(); await tick(); await tick();
  assert.deepEqual(seen, [true, false]);
});

test('reports milliseconds from turn start to the first audio, once per turn', async () => {
  const { sink, finish } = fakeSink();
  let clock = 0;
  const reported: number[] = [];
  const q = new SpeechQueue(fakeFetcher(), sink, {
    now: () => clock,
    onFirstAudio: (ms) => reported.push(ms),
  });

  q.markTurnStart();
  clock = 900;
  q.enqueue('/api/tts', { text: 'satu' });
  await tick(); await tick();
  assert.deepEqual(reported, [900]);

  // the second utterance of the same turn is not a first audio
  finish(); await tick();
  q.enqueue('/api/tts', { text: 'dua' });
  await tick(); await tick();
  assert.deepEqual(reported, [900]);

  // a new turn re-arms the measurement
  finish(); await tick(); await tick();
  clock = 2000;
  q.markTurnStart();
  clock = 2400;
  q.enqueue('/api/tts', { text: 'tiga' });
  await tick(); await tick();
  assert.deepEqual(reported, [900, 400]);
});

test('does not report when no turn was marked', async () => {
  const { sink, finish } = fakeSink();
  const reported: number[] = [];
  const q = new SpeechQueue(fakeFetcher(), sink, { onFirstAudio: (ms) => reported.push(ms) });
  q.enqueue('/api/tts', { text: 'greeting' });   // proactive speech, no turn
  await tick(); await tick();
  assert.deepEqual(reported, []);
  finish();
});
