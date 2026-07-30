import test from 'node:test';
import assert from 'node:assert';
import { parseLogsToMessages } from './parser';
import { Task } from './types';

test('parseLogsToMessages builds correct user prompt and system logs timeline', () => {
  const task: Task = {
    task_id: '123',
    text: 'do task',
    status: 'done',
    chat_id: 0,
    created: 1722336829
  };
  const logs = [
    'Initializing...',
    'ask: run code?',
    'answer: User replied (free text): yes',
    'Running test...'
  ];
  const artifacts = [
    { kind: 'text', path: 'artifacts/log.txt' }
  ];

  const timeline = parseLogsToMessages(task, logs, artifacts);
  
  assert.strictEqual(timeline.length, 6);
  assert.strictEqual(timeline[0].type, 'prompt');
  assert.strictEqual(timeline[0].text, 'do task');
  
  assert.strictEqual(timeline[1].type, 'logs');
  assert.strictEqual(timeline[1].logs?.length, 1);
  assert.strictEqual(timeline[1].logs?.[0], 'Initializing...');
  
  assert.strictEqual(timeline[2].type, 'ask');
  assert.strictEqual(timeline[2].text, 'run code?');

  assert.strictEqual(timeline[3].type, 'answer');
  assert.strictEqual(timeline[3].text, 'yes');

  assert.strictEqual(timeline[4].type, 'logs');
  assert.strictEqual(timeline[4].logs?.[0], 'Running test...');

  assert.strictEqual(timeline[5].type, 'artifacts');
  assert.strictEqual(timeline[5].artifacts?.length, 1);
});
