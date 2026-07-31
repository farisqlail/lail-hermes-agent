import { test } from 'node:test';
import assert from 'node:assert';
import { VadStateMachine, VAD_DEFAULTS, vadConfigFor, rmsOf, VadEvent } from './vad';

/** Feed n frames of one level and collect the events. */
function feed(vad: VadStateMachine, level: number, n: number, ducked = false): VadEvent[] {
  const out: VadEvent[] = [];
  for (let i = 0; i < n; i++) {
    const e = vad.push(level, ducked);
    if (e) out.push(e);
  }
  return out;
}

const QUIET = 0.002;
const LOUD = 0.2;

test('rmsOf measures a frame', () => {
  assert.equal(rmsOf(new Float32Array([0, 0, 0, 0])), 0);
  assert.ok(Math.abs(rmsOf(new Float32Array([1, -1, 1, -1])) - 1) < 1e-9);
});

test('silence alone never fires', () => {
  const vad = new VadStateMachine();
  assert.deepEqual(feed(vad, QUIET, 100), []);
  assert.equal(vad.active, false);
});

test('sustained speech fires speech-start exactly once', () => {
  const vad = new VadStateMachine();
  feed(vad, QUIET, 40);                    // learn the noise floor
  const events = feed(vad, LOUD, 40);
  assert.deepEqual(events, ['speech-start']);
  assert.equal(vad.active, true);
});

test('a single loud frame is a door slam, not speech', () => {
  const vad = new VadStateMachine();
  feed(vad, QUIET, 40);
  assert.deepEqual(feed(vad, LOUD, 1), []);
  assert.deepEqual(feed(vad, QUIET, 40), []);
});

test('speech-end fires after the silence hangover, not before', () => {
  const cfg = { frameMs: 50, silenceMs: 400 };
  const vad = new VadStateMachine(cfg);
  feed(vad, QUIET, 40);
  feed(vad, LOUD, 40);
  assert.deepEqual(feed(vad, QUIET, 5), []);   // 250 ms — still inside the pause
  assert.deepEqual(feed(vad, QUIET, 4), ['speech-end']);
  assert.equal(vad.active, false);
});

test('an utterance shorter than minSpeechMs is discarded', () => {
  const vad = new VadStateMachine({ frameMs: 50, minSpeechMs: 600, silenceMs: 200 });
  feed(vad, QUIET, 40);
  feed(vad, LOUD, 4);                          // 200 ms of "speech"
  const events = feed(vad, QUIET, 20);
  // it started, but ended too short to be worth transcribing
  assert.ok(!events.includes('speech-end'));
  assert.equal(vad.active, false);
});

test('ducking raises the bar while the assistant is speaking', () => {
  const vad = new VadStateMachine({ duckingFactor: 4 });
  feed(vad, QUIET, 40);
  // echo leaking past AEC sits well above the noise floor but below a person
  assert.deepEqual(feed(vad, 0.02, 40, true), []);
  assert.deepEqual(feed(vad, LOUD, 40, true), ['speech-start']);
});

test('the noise floor adapts to a loud room', () => {
  const vad = new VadStateMachine();
  feed(vad, 0.05, 200);                        // a noisy room, steady
  // once adapted, the same level is background, not speech
  assert.deepEqual(feed(vad, 0.05, 40), []);
});

test('reset clears the state machine', () => {
  const vad = new VadStateMachine();
  feed(vad, QUIET, 40);
  feed(vad, LOUD, 40);
  assert.equal(vad.active, true);
  vad.reset();
  assert.equal(vad.active, false);
});

test('sensitivity maps to a threshold factor and carries the silence setting', () => {
  assert.ok(vadConfigFor('high', 900).snrFactor < vadConfigFor('low', 900).snrFactor);
  assert.equal(vadConfigFor('medium', 900).snrFactor, VAD_DEFAULTS.snrFactor);
  assert.equal(vadConfigFor('high', 1200).silenceMs, 1200);
});
