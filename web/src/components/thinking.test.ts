import test from 'node:test';
import assert from 'node:assert';
import { ACTIVITY_STALE_MS, cleanLogLine, formatElapsed, thinkingText } from './TaskCard';

test('formatElapsed renders seconds below a minute', () => {
  assert.strictEqual(formatElapsed(0), '0s');
  assert.strictEqual(formatElapsed(12), '12s');
  assert.strictEqual(formatElapsed(59), '59s');
});

test('formatElapsed crosses into minutes at 60s', () => {
  assert.strictEqual(formatElapsed(60), '1m 0s');
  assert.strictEqual(formatElapsed(61), '1m 1s');
  assert.strictEqual(formatElapsed(72), '1m 12s');
  assert.strictEqual(formatElapsed(3599), '59m 59s');
});

test('formatElapsed crosses into hours at 3600s', () => {
  assert.strictEqual(formatElapsed(3600), '1h 0m');
  assert.strictEqual(formatElapsed(7325), '2h 2m');
});

test('formatElapsed clamps junk to 0s', () => {
  assert.strictEqual(formatElapsed(-5), '0s');
  assert.strictEqual(formatElapsed(NaN), '0s');
});

test('cleanLogLine collapses whitespace and keeps the step prefix', () => {
  assert.strictEqual(cleanLogLine('  [step 1]   Running   npm build  '), '[step 1] Running npm build');
  assert.strictEqual(cleanLogLine('line\nwith\tbreaks'), 'line with breaks');
});

test('cleanLogLine truncates long lines', () => {
  const long = 'x'.repeat(200);
  const out = cleanLogLine(long);
  assert.strictEqual(out.length, 72);
  assert.ok(out.endsWith('…'));
});

test('cleanLogLine returns empty for blank input', () => {
  assert.strictEqual(cleanLogLine('   '), '');
  assert.strictEqual(cleanLogLine(''), '');
});

test('thinkingText prefers a fresh log line over the rotating phrase', () => {
  const now = 1_000_000;
  const activity = { line: 'Running npm build', ts: now - 1000 };
  assert.strictEqual(thinkingText(activity, 'Thinking', now), 'Running npm build');
});

test('thinkingText keeps the log line right up to the staleness threshold', () => {
  const now = 1_000_000;
  const activity = { line: 'Running npm build', ts: now - ACTIVITY_STALE_MS + 1 };
  assert.strictEqual(thinkingText(activity, 'Thinking', now), 'Running npm build');
});

test('thinkingText falls back once the agent goes quiet', () => {
  const now = 1_000_000;
  const activity = { line: 'Running npm build', ts: now - ACTIVITY_STALE_MS };
  assert.strictEqual(thinkingText(activity, 'Thinking', now), 'Thinking');
});

test('thinkingText falls back when there is no activity at all', () => {
  assert.strictEqual(thinkingText(undefined, 'Thinking', 1_000_000), 'Thinking');
});

test('thinkingText falls back when the log line is blank', () => {
  const now = 1_000_000;
  assert.strictEqual(thinkingText({ line: '   ', ts: now }, 'Thinking', now), 'Thinking');
});

test('thinkingText tolerates a clock that jumped backwards', () => {
  const now = 1_000_000;
  const activity = { line: 'Running npm build', ts: now + 5000 };
  assert.strictEqual(thinkingText(activity, 'Thinking', now), 'Running npm build');
});
