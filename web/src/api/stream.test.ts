import test from 'node:test';
import assert from 'node:assert';
import { parseStreamBuffer } from './stream';

test('parseStreamBuffer splits multiple events correctly', () => {
  const input = 'data: {"delta": "hello"}\n\ndata: {"delta": " world"}\n\n';
  const { events, remaining } = parseStreamBuffer(input);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].delta, 'hello');
  assert.strictEqual(events[1].delta, ' world');
  assert.strictEqual(remaining, '');
});

test('parseStreamBuffer keeps incomplete data in remaining buffer', () => {
  const input = 'data: {"delta": "hello"}\n\ndata: {"del';
  const { events, remaining } = parseStreamBuffer(input);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].delta, 'hello');
  assert.strictEqual(remaining, 'data: {"del');
});
