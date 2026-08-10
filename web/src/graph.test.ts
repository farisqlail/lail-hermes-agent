import { test } from 'node:test';
import assert from 'node:assert';
import { taskLinkTarget } from './graph';

test('a task links to its own session when that session has a node', () => {
  assert.equal(taskLinkTarget('sess-a', ['sess-a', 'sess-b']), 'sess-a');
});

test('a task of the default conversation falls back to the core', () => {
  // "web" is a real conv_id but never appears in /api/sessions.
  assert.equal(taskLinkTarget('web', ['sess-a']), 'core');
});

test('a session-less task falls back to the core', () => {
  assert.equal(taskLinkTarget(null, ['sess-a']), 'core');
  assert.equal(taskLinkTarget(undefined, []), 'core');
});

test('an unknown session never borrows the open one', () => {
  // The old bug: a Telegram task drawn as a child of whatever thread was open.
  assert.equal(taskLinkTarget('tg-77', ['sess-open']), 'core');
});
