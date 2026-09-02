import test from 'node:test';
import assert from 'node:assert';
import { diffSummary, toolDiff } from './diff';
import { TraceEvent } from './trace';

let nextId = 1;
function call(tool: string, input: unknown, file = ''): TraceEvent {
  return {
    id: nextId++, task_id: 't', step_idx: 0, seq: 0, ts: 0,
    kind: 'tool_use', text: '', tool_name: tool, tool_use_id: 'tu',
    tool_input: typeof input === 'string' ? input : JSON.stringify(input),
    file_path: file, ok: null, tokens_in: null, tokens_out: null, cost_usd: null,
  };
}

test('a claude Edit becomes removed lines then added lines', () => {
  const hunk = toolDiff(call('Edit', {
    file_path: '/repo/a.ts',
    old_string: 'const a = 1;\nconst b = 2;',
    new_string: 'const a = 10;',
  }, '/repo/a.ts'))!;
  assert.strictEqual(hunk.file, '/repo/a.ts');
  assert.deepStrictEqual(hunk.lines, [
    { type: 'del', text: 'const a = 1;' },
    { type: 'del', text: 'const b = 2;' },
    { type: 'add', text: 'const a = 10;' },
  ]);
  assert.strictEqual(hunk.removed, 2);
  assert.strictEqual(hunk.added, 1);
});

test('a Write is all additions', () => {
  const hunk = toolDiff(call('Write', {
    file_path: '/repo/new.ts', content: 'line one\nline two\n',
  }, '/repo/new.ts'))!;
  assert.deepStrictEqual(hunk.lines.map((l) => l.type), ['add', 'add']);
  assert.strictEqual(hunk.added, 2);
  assert.strictEqual(hunk.removed, 0);
});

test('a trailing newline does not add a phantom blank line', () => {
  const hunk = toolDiff(call('Write', { content: 'only\n' }, '/f'))!;
  assert.deepStrictEqual(hunk.lines, [{ type: 'add', text: 'only' }]);
});

test('an empty string contributes no lines', () => {
  const hunk = toolDiff(call('Edit', { old_string: '', new_string: 'x' }, '/f'))!;
  assert.deepStrictEqual(hunk.lines, [{ type: 'add', text: 'x' }]);
});

test('MultiEdit concatenates every edit in order', () => {
  const hunk = toolDiff(call('MultiEdit', {
    file_path: '/repo/a.ts',
    edits: [
      { old_string: 'a', new_string: 'A' },
      { old_string: 'b', new_string: 'B' },
    ],
  }, '/repo/a.ts'))!;
  assert.deepStrictEqual(hunk.lines, [
    { type: 'del', text: 'a' },
    { type: 'add', text: 'A' },
    { type: 'del', text: 'b' },
    { type: 'add', text: 'B' },
  ]);
});

test('an agy replace_file_content is read through its own spellings', () => {
  const hunk = toolDiff(call('replace_file_content', {
    TargetFile: 'C:\\repo\\a.ts',
    ReplacementChunks: [{ TargetContent: 'old line', ReplacementContent: 'new line' }],
  }, 'C:\\repo\\a.ts'))!;
  assert.deepStrictEqual(hunk.lines, [
    { type: 'del', text: 'old line' },
    { type: 'add', text: 'new line' },
  ]);
});

test('a non-edit tool has no diff', () => {
  assert.strictEqual(toolDiff(call('Bash', { command: 'ls' })), null);
  assert.strictEqual(toolDiff(call('Read', { file_path: '/a' }, '')), null);
});

test('a non-tool event has no diff', () => {
  const ev = { ...call('Edit', { old_string: 'a' }), kind: 'text' as const };
  assert.strictEqual(toolDiff(ev), null);
});

test('arguments cut by the storage cap still announce the file', () => {
  const ev = call('Edit', '{"file_path":"/repo/a.ts","new_string":"abc…', '/repo/a.ts');
  const hunk = toolDiff(ev)!;
  assert.strictEqual(hunk.file, '/repo/a.ts');
  assert.strictEqual(hunk.lines.length, 0);
  assert.strictEqual(hunk.truncated, true);
});

test('a truncated but still-parseable edit is flagged', () => {
  const ev = call('Edit', { file_path: '/f', new_string: 'x' }, '/f');
  ev.tool_input = ev.tool_input.slice(0, -1) + '…';
  // Not valid JSON any more, but the path column survives.
  assert.strictEqual(toolDiff(ev)!.truncated, true);
});

test('an unrecognised edit shape yields no invented lines', () => {
  const hunk = toolDiff(call('Edit', { file_path: '/f', mystery: 'z' }, '/f'))!;
  assert.deepStrictEqual(hunk.lines, []);
  assert.strictEqual(hunk.added, 0);
});

test('diffSummary counts and pluralises', () => {
  assert.strictEqual(
    diffSummary({ file: 'f', lines: [], added: 3, removed: 1, truncated: false }),
    '3 additions, 1 removal');
  assert.strictEqual(
    diffSummary({ file: 'f', lines: [], added: 1, removed: 0, truncated: false }),
    '1 addition');
});

test('diffSummary says so when it recorded nothing', () => {
  assert.strictEqual(
    diffSummary({ file: 'f', lines: [], added: 0, removed: 0, truncated: false }),
    'no line changes recorded');
  assert.strictEqual(
    diffSummary({ file: 'f', lines: [], added: 2, removed: 0, truncated: true }),
    '2 additions, truncated');
});
