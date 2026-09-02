import test from 'node:test';
import assert from 'node:assert';
import {
  TraceEvent,
  buildTraceRows,
  editedFiles,
  formatTokens,
  planTodos,
  sessionInfo,
  summarizeToolInput,
  traceTotals,
} from './trace';

let nextId = 1;
function ev(partial: Partial<TraceEvent>): TraceEvent {
  return {
    id: nextId++, task_id: 't', step_idx: 0, seq: 0, ts: 0,
    kind: 'text', text: '', tool_name: '', tool_use_id: '', tool_input: '',
    file_path: '', ok: null, tokens_in: null, tokens_out: null, cost_usd: null,
    ...partial,
  };
}

test('buildTraceRows folds a tool result into the call it answers', () => {
  const call = ev({ kind: 'tool_use', tool_name: 'Read', tool_use_id: 'tu1' });
  const result = ev({ kind: 'tool_result', tool_use_id: 'tu1', ok: 1, text: 'contents' });
  const rows = buildTraceRows([call, result]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].event.tool_name, 'Read');
  assert.strictEqual(rows[0].result?.text, 'contents');
});

test('buildTraceRows matches results to the right call when several are open', () => {
  const rows = buildTraceRows([
    ev({ kind: 'tool_use', tool_name: 'Read', tool_use_id: 'a' }),
    ev({ kind: 'tool_use', tool_name: 'Grep', tool_use_id: 'b' }),
    ev({ kind: 'tool_result', tool_use_id: 'b', text: 'grep out' }),
    ev({ kind: 'tool_result', tool_use_id: 'a', text: 'read out' }),
  ]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].result?.text, 'read out');
  assert.strictEqual(rows[1].result?.text, 'grep out');
});

test('buildTraceRows keeps an orphaned result rather than dropping it', () => {
  const rows = buildTraceRows([ev({ kind: 'tool_result', tool_use_id: 'gone', text: 'x' })]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].event.kind, 'tool_result');
});

test('buildTraceRows leaves other kinds in stream order', () => {
  const rows = buildTraceRows([
    ev({ kind: 'thinking', text: 'hm' }),
    ev({ kind: 'text', text: 'answer' }),
    ev({ kind: 'result', text: 'done' }),
  ]);
  assert.deepStrictEqual(rows.map((r) => r.event.kind), ['thinking', 'text', 'result']);
});

test('editedFiles lists each file once, in first-touch order', () => {
  const files = editedFiles([
    ev({ kind: 'tool_use', tool_name: 'Write', file_path: '/b.py' }),
    ev({ kind: 'tool_use', tool_name: 'Edit', file_path: '/a.py' }),
    ev({ kind: 'tool_use', tool_name: 'Edit', file_path: '/b.py' }),
  ]);
  assert.deepStrictEqual(files, ['/b.py', '/a.py']);
});

test('editedFiles ignores events that carry no path', () => {
  assert.deepStrictEqual(editedFiles([ev({ kind: 'tool_use', tool_name: 'Bash' })]), []);
  assert.deepStrictEqual(editedFiles([ev({ kind: 'text', text: '/not/a/file.py' })]), []);
});

test('traceTotals sums usage across turns and retry rounds', () => {
  const totals = traceTotals([
    ev({ kind: 'text', tokens_in: 100, tokens_out: 20 }),
    ev({ kind: 'tool_use', tool_name: 'Read', tokens_in: 50, tokens_out: 5 }),
    ev({ kind: 'result', cost_usd: 0.02 }),
    ev({ kind: 'result', cost_usd: 0.03 }),
  ]);
  assert.strictEqual(totals.tokensIn, 150);
  assert.strictEqual(totals.tokensOut, 25);
  assert.ok(Math.abs(totals.costUsd - 0.05) < 1e-9);
  assert.strictEqual(totals.toolCalls, 1);
  assert.strictEqual(totals.hasUsage, true);
});

test('traceTotals reports no usage when the engine reported none', () => {
  const totals = traceTotals([ev({ kind: 'text', text: 'hi' })]);
  assert.strictEqual(totals.hasUsage, false);
  assert.strictEqual(totals.tokensIn, 0);
});

test('summarizeToolInput prefers the file path when there is one', () => {
  const row = ev({
    kind: 'tool_use', tool_name: 'Edit', file_path: '/repo/a.py',
    tool_input: JSON.stringify({ file_path: '/repo/a.py', old_string: 'x'.repeat(500) }),
  });
  assert.strictEqual(summarizeToolInput(row), '/repo/a.py');
});

test('summarizeToolInput surfaces the command for a shell call', () => {
  const row = ev({
    kind: 'tool_use', tool_name: 'Bash',
    tool_input: JSON.stringify({ command: 'npm run build', description: 'Build' }),
  });
  assert.strictEqual(summarizeToolInput(row), 'npm run build');
});

test('summarizeToolInput falls back to compact JSON for an unknown shape', () => {
  const row = ev({ kind: 'tool_use', tool_name: 'Odd', tool_input: JSON.stringify({ a: 1 }) });
  assert.strictEqual(summarizeToolInput(row), '{"a":1}');
});

test('summarizeToolInput survives JSON truncated by the storage cap', () => {
  const row = ev({ kind: 'tool_use', tool_name: 'Write', tool_input: '{"content":"abc…' });
  assert.strictEqual(summarizeToolInput(row), '{"content":"abc…');
});

test('summarizeToolInput collapses whitespace and caps length', () => {
  const row = ev({
    kind: 'tool_use', tool_name: 'Bash',
    tool_input: JSON.stringify({ command: 'a\n  b\tc' }),
  });
  assert.strictEqual(summarizeToolInput(row), 'a b c');

  const long = ev({
    kind: 'tool_use', tool_name: 'Bash',
    tool_input: JSON.stringify({ command: 'x'.repeat(400) }),
  });
  assert.strictEqual(summarizeToolInput(long).length, 120);
});

test('summarizeToolInput is empty when there is nothing to say', () => {
  assert.strictEqual(summarizeToolInput(ev({ kind: 'tool_use', tool_name: 'X' })), '');
});

test('formatTokens shortens large counts', () => {
  assert.strictEqual(formatTokens(0), '0');
  assert.strictEqual(formatTokens(999), '999');
  assert.strictEqual(formatTokens(1500), '1.5k');
  assert.strictEqual(formatTokens(15000), '15k');
  assert.strictEqual(formatTokens(2_500_000), '2.5M');
});

// --- antigravity shapes ------------------------------------------------------
// agy names the same ideas in PascalCase, and pairs a call to its result by
// `conversation_id:step_index` rather than a tool_use_id.

test('summarizeToolInput reads agy PascalCase argument names', () => {
  const cmd = ev({
    kind: 'tool_use', tool_name: 'run_command',
    tool_input: JSON.stringify({ CommandLine: 'npm run build', Blocking: 'true' }),
  });
  assert.strictEqual(summarizeToolInput(cmd), 'npm run build');

  const dir = ev({
    kind: 'tool_use', tool_name: 'list_dir',
    tool_input: JSON.stringify({ DirectoryPath: 'C:\\repo\\src' }),
  });
  assert.strictEqual(summarizeToolInput(dir), 'C:\\repo\\src');
});

test('summarizeToolInput prefers the command over a path when both are present', () => {
  const row = ev({
    kind: 'tool_use', tool_name: 'run_command',
    tool_input: JSON.stringify({ TargetFile: 'C:\\repo\\a.ts', CommandLine: 'tsc a.ts' }),
  });
  assert.strictEqual(summarizeToolInput(row), 'tsc a.ts');
});

test('buildTraceRows pairs agy step ids the same way it pairs tool_use ids', () => {
  const rows = buildTraceRows([
    ev({ kind: 'tool_use', tool_name: 'list_dir', tool_use_id: 'c1:2' }),
    ev({ kind: 'tool_use', tool_name: 'run_command', tool_use_id: 'c1:4' }),
    ev({ kind: 'tool_result', tool_use_id: 'c1:4', ok: 0, text: 'permission denied' }),
    ev({ kind: 'tool_result', tool_use_id: 'c1:2', ok: 1, text: '' }),
  ]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].result?.ok, 1);
  assert.strictEqual(rows[1].result?.text, 'permission denied');
});

test('traceTotals reports tokens with no cost for an antigravity run', () => {
  const totals = traceTotals([
    ev({ kind: 'text', tokens_in: 19223, tokens_out: 23 }),
    ev({ kind: 'result', tokens_in: 26310, tokens_out: 741 }),
  ]);
  assert.strictEqual(totals.tokensIn, 45533);
  assert.strictEqual(totals.tokensOut, 764);
  assert.strictEqual(totals.costUsd, 0);
  // hasUsage still true — the header shows tokens and simply omits the cost chip.
  assert.strictEqual(totals.hasUsage, true);
});

// --- plan checklist ----------------------------------------------------------

function step(partial: Partial<{ id: number; idx: number; kind: string; detail: string; status: string }>) {
  return { id: 1, idx: 0, kind: 'code', detail: '{}', status: 'queued', ...partial };
}

test('planTodos labels a step with the planner prompt', () => {
  const todos = planTodos([
    step({ id: 1, detail: JSON.stringify({ type: 'code', prompt: 'fix the navbar' }), status: 'done' }),
  ]);
  assert.deepStrictEqual(todos, [{ key: 's1', label: 'fix the navbar', status: 'done' }]);
});

test('planTodos maps every step status the store can write', () => {
  const todos = planTodos([
    step({ id: 1, status: 'done' }),
    step({ id: 2, status: 'running' }),
    step({ id: 3, status: 'failed' }),
    step({ id: 4, status: 'queued' }),
  ]);
  assert.deepStrictEqual(todos.map((t) => t.status), ['done', 'active', 'failed', 'todo']);
});

test('planTodos falls back to the step kind, never a raw blob', () => {
  assert.strictEqual(planTodos([step({ kind: 'build', detail: 'not json' })])[0].label, 'build');
  assert.strictEqual(planTodos([step({ kind: 'test', detail: '{"type":"test"}' })])[0].label, 'test');
  assert.strictEqual(planTodos([step({ kind: '', detail: '' })])[0].label, 'step');
});

test('planTodos ignores a blank prompt', () => {
  const todos = planTodos([step({ kind: 'code', detail: JSON.stringify({ prompt: '   ' }) })]);
  assert.strictEqual(todos[0].label, 'code');
});

// --- session banner ----------------------------------------------------------

test('sessionInfo reads engine and project off the opening log lines', () => {
  const info = sessionInfo([
    'project: C:\Users\USER\myprofit-v3',
    'engine: antigravity',
    'step 0 [code]: coded',
  ]);
  assert.strictEqual(info.engine, 'antigravity');
  assert.strictEqual(info.project, 'C:\Users\USER\myprofit-v3');
});

test('sessionInfo returns blanks when the log says neither', () => {
  assert.deepStrictEqual(sessionInfo(['task complete']), { engine: '', project: '' });
  assert.deepStrictEqual(sessionInfo([]), { engine: '', project: '' });
});

test('sessionInfo keeps the first of each, not the last', () => {
  const info = sessionInfo(['engine: claude', 'engine: antigravity']);
  assert.strictEqual(info.engine, 'claude');
});
