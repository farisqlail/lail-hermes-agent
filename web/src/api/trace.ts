/** Shaping the engine trace for the task timeline.
 *
 * The backend stores one flat row per distilled event (hermes/engine_stream.py).
 * Rendering wants something different: a tool call and its result are two rows
 * but one line on screen, and the header needs totals the rows only carry
 * piecemeal. Pure functions so both are testable without a browser. */

export type TraceKind =
  | 'init' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'result' | 'truncated';

export interface TraceEvent {
  id: number;
  task_id: string;
  step_idx: number;
  seq: number;
  ts: number;
  kind: TraceKind;
  text: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: string;
  file_path: string;
  /** SQLite has no boolean: 1/0 for a tool result, null everywhere else. */
  ok: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
}

/** One line in the timeline. A `tool_use` row carries its own result, so the
 *  two never drift apart on screen or render as two disconnected entries. */
export interface TraceRow {
  key: string;
  event: TraceEvent;
  result?: TraceEvent;
}

export interface TraceTotals {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  toolCalls: number;
  /** Whether anything at all was counted — distinguishes "0 tokens" from
   *  "an engine that reports none", which must not show a totals row. */
  hasUsage: boolean;
}

export function buildTraceRows(events: TraceEvent[]): TraceRow[] {
  const rows: TraceRow[] = [];
  const byToolUseId = new Map<string, number>();

  for (const ev of events) {
    if (ev.kind === 'tool_result') {
      const at = ev.tool_use_id ? byToolUseId.get(ev.tool_use_id) : undefined;
      if (at !== undefined) {
        rows[at] = { ...rows[at], result: ev };
        continue;
      }
      // No matching call — a result from a step whose start was pruned, or a
      // trace that began mid-run. Better shown orphaned than dropped.
      rows.push({ key: `t${ev.id}`, event: ev });
      continue;
    }
    if (ev.kind === 'tool_use' && ev.tool_use_id) {
      byToolUseId.set(ev.tool_use_id, rows.length);
    }
    rows.push({ key: `t${ev.id}`, event: ev });
  }
  return rows;
}

/** Files the agent actually changed, first touch first.
 *
 * Read off the edit tools' own arguments rather than git, so it reports what
 * this run did — not whatever else happens to be dirty in the working tree. */
export function editedFiles(events: TraceEvent[]): string[] {
  const seen: string[] = [];
  for (const ev of events) {
    if (ev.kind !== 'tool_use' || !ev.file_path) continue;
    if (!seen.includes(ev.file_path)) seen.push(ev.file_path);
  }
  return seen;
}

export function traceTotals(events: TraceEvent[]): TraceTotals {
  let tokensIn = 0, tokensOut = 0, costUsd = 0, toolCalls = 0, hasUsage = false;
  for (const ev of events) {
    if (ev.kind === 'tool_use') toolCalls += 1;
    if (typeof ev.tokens_in === 'number') { tokensIn += ev.tokens_in; hasUsage = true; }
    if (typeof ev.tokens_out === 'number') { tokensOut += ev.tokens_out; hasUsage = true; }
    // Only the final envelope reports cost, and a step that retried has one
    // per round — summing is what makes the header show the task's real spend.
    if (typeof ev.cost_usd === 'number') { costUsd += ev.cost_usd; hasUsage = true; }
  }
  return { tokensIn, tokensOut, costUsd, toolCalls, hasUsage };
}

/** The argument worth showing, most specific first.
 *
 * Compared against keys stripped to letters and lowercased, because the two
 * engines disagree on style for the same idea: claude sends `command` and
 * `file_path`, agy sends `CommandLine` and `TargetFile`. */
const PREFERRED_ARG_KEYS = [
  'command', 'commandline', 'pattern', 'query', 'searchterm', 'url',
  'targetfile', 'filepath', 'notebookpath', 'directorypath',
  'description', 'prompt',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

/** A tool call's arguments as one short line: `{"file_path":"/a/b.py"}` reads
 *  as `/a/b.py`, and anything unrecognised falls back to compact JSON. */
export function summarizeToolInput(ev: TraceEvent): string {
  if (ev.file_path) return ev.file_path;
  if (!ev.tool_input) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(ev.tool_input);
  } catch {
    // Truncated mid-JSON by the storage cap — show it raw rather than nothing.
    return collapse(ev.tool_input);
  }
  if (!parsed || typeof parsed !== 'object') return collapse(String(parsed));
  const args = parsed as Record<string, unknown>;
  const byNormalized = new Map<string, string>();
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value) byNormalized.set(normalizeKey(key), value);
  }
  for (const key of PREFERRED_ARG_KEYS) {
    const found = byNormalized.get(key);
    if (found) return collapse(found);
  }
  return collapse(JSON.stringify(args));
}

function collapse(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= 120 ? flat : flat.slice(0, 119) + '…';
}

/** Engine and working directory, read back off the orchestrator's own log.
 *
 * It writes `project: <path>` and `engine: <name>` as a task's opening lines
 * (orchestrator._exec_step). Neither is on the task row, and adding them there
 * would mean a schema change for two strings the log already carries. */
export function sessionInfo(logs: string[]): { engine: string; project: string } {
  let engine = '';
  let project = '';
  for (const line of logs) {
    if (!engine && line.startsWith('engine: ')) engine = line.slice(8).trim();
    if (!project && line.startsWith('project: ')) project = line.slice(9).trim();
    if (engine && project) break;
  }
  return { engine, project };
}

export type TodoStatus = 'done' | 'active' | 'failed' | 'todo';

export interface PlanTodo {
  key: string;
  label: string;
  status: TodoStatus;
}

/** The planner's steps as a checklist.
 *
 * `detail` is the planner's own JSON, so the label is dug out defensively:
 * its `prompt` when there is one, else the step kind — never a raw JSON blob,
 * which is what the operator would otherwise be asked to read. */
export function planTodos(steps: Array<{
  id: number; idx: number; kind: string; detail: string; status: string;
}>): PlanTodo[] {
  return steps.map((step) => {
    let label = '';
    try {
      const parsed = JSON.parse(step.detail || '{}');
      if (parsed && typeof parsed === 'object') {
        const prompt = (parsed as Record<string, unknown>).prompt;
        if (typeof prompt === 'string') label = prompt;
      }
    } catch {
      // Not JSON — fall through to the kind, never show the raw string.
    }
    return {
      key: `s${step.id}`,
      label: label.trim() || step.kind || 'step',
      status: todoStatus(step.status),
    };
  });
}

function todoStatus(status: string): TodoStatus {
  if (status === 'done') return 'done';
  if (status === 'running') return 'active';
  if (status === 'failed') return 'failed';
  return 'todo';
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
