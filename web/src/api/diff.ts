/** Turning an edit tool's arguments into renderable diff hunks.
 *
 * No diff algorithm is needed and none is used: an `Edit` call already *is* a
 * hunk — `old_string` is exactly what leaves and `new_string` exactly what
 * arrives. Running an LCS over them would only re-derive what the caller
 * already told us, and would invent context lines the tool never sent.
 *
 * Line numbers are deliberately absent. The stream carries no file offsets, so
 * any number here would be made up; the terminal shows real ones because it
 * has the file open, and we would rather show none than a plausible lie. */

import { TraceEvent } from './trace';

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffHunk {
  file: string;
  lines: DiffLine[];
  /** Line counts, for the `⎿ N additions, M removals` summary. */
  added: number;
  removed: number;
  /** The stored arguments hit the 4 KB cap, so this hunk is only part of the
   *  edit. Rendered as a marker rather than silently showing a partial edit
   *  as if it were the whole one. */
  truncated: boolean;
}

/** Tool names, per engine, whose arguments describe a file edit. */
const EDIT_TOOLS = new Set([
  // claude
  'Edit', 'Write', 'MultiEdit', 'NotebookEdit',
  // agy
  'write_to_file', 'replace_file_content', 'multi_replace_file_content',
  'notebook_edit', 'sed_file',
]);

function splitLines(text: string): string[] {
  if (text === '') return [];
  // A trailing newline ends the last line rather than starting an empty one.
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n');
}

function pushEdit(lines: DiffLine[], oldText: unknown, newText: unknown): void {
  if (typeof oldText === 'string') {
    for (const line of splitLines(oldText)) lines.push({ type: 'del', text: line });
  }
  if (typeof newText === 'string') {
    for (const line of splitLines(newText)) lines.push({ type: 'add', text: line });
  }
}

/** Pull the old/new pair out of one edit descriptor, whichever engine wrote
 *  it. claude uses snake_case, agy PascalCase, and neither is documented as
 *  stable — so both spellings are accepted and an unknown one yields nothing
 *  rather than a wrong diff. */
function editPair(obj: Record<string, unknown>): [unknown, unknown] {
  const old = obj.old_string ?? obj.oldString ?? obj.TargetContent ?? obj.old_str;
  const next = obj.new_string ?? obj.newString ?? obj.ReplacementContent ?? obj.new_str;
  return [old, next];
}

/** The diff hunk a tool call describes, or null when it describes no edit. */
export function toolDiff(ev: TraceEvent): DiffHunk | null {
  if (ev.kind !== 'tool_use' || !EDIT_TOOLS.has(ev.tool_name)) return null;
  if (!ev.tool_input) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(ev.tool_input);
  } catch {
    // Cut mid-JSON by the storage cap. The file path survived on its own
    // column, so the edit is still worth announcing — just without its body.
    return ev.file_path
      ? { file: ev.file_path, lines: [], added: 0, removed: 0, truncated: true }
      : null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const args = parsed as Record<string, unknown>;

  const lines: DiffLine[] = [];
  const edits = args.edits ?? args.ReplacementChunks;
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (edit && typeof edit === 'object') {
        const [old, next] = editPair(edit as Record<string, unknown>);
        pushEdit(lines, old, next);
      }
    }
  } else {
    const [old, next] = editPair(args);
    if (old === undefined && next === undefined) {
      // A whole-file write: every line is an addition.
      const content = args.content ?? args.CodeContent ?? args.Content;
      if (typeof content === 'string') pushEdit(lines, undefined, content);
    } else {
      pushEdit(lines, old, next);
    }
  }

  const file = ev.file_path || '';
  if (lines.length === 0 && !file) return null;
  return {
    file,
    lines,
    added: lines.filter((l) => l.type === 'add').length,
    removed: lines.filter((l) => l.type === 'del').length,
    truncated: ev.tool_input.endsWith('…'),
  };
}

/** `3 additions, 1 removal` — the `⎿` line under an Update. */
export function diffSummary(hunk: DiffHunk): string {
  const parts: string[] = [];
  if (hunk.added) parts.push(`${hunk.added} addition${hunk.added === 1 ? '' : 's'}`);
  if (hunk.removed) parts.push(`${hunk.removed} removal${hunk.removed === 1 ? '' : 's'}`);
  if (parts.length === 0) parts.push('no line changes recorded');
  if (hunk.truncated) parts.push('truncated');
  return parts.join(', ');
}
