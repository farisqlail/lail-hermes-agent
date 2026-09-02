import React from 'react';
import { DiffHunk, diffSummary, toolDiff } from '../api/diff';
import {
  PlanTodo,
  TraceEvent,
  TraceRow,
  buildTraceRows,
  editedFiles,
  formatTokens,
  summarizeToolInput,
  traceTotals,
} from '../api/trace';
import { Markdown } from './Markdown';

/** The task timeline, drawn as a Claude Code session.
 *
 * Ported by hand from the `claude-session` block rather than installed: that
 * block is a shadcn/Tailwind registry item and this app has neither, so the
 * markup and palette are reproduced against the styling this codebase already
 * uses. What is kept is what makes it read as a terminal — the ⏺ / ⎿ glyph
 * grammar with its alignment spacer, the Tokyo Night palette, monospace at
 * 13px, square corners, tight spacing — and the semantics its docs insist on:
 * real <details> disclosures, live regions, never flattened into one <pre>. */

const C = {
  ok: '#4ea96f',
  err: '#f7768e',
  pending: '#e0af68',
  text: '#c0caf5',
  dim: '#8b8fa3',
  faint: '#565f89',
  arg: '#7dcfff',
  gutter: '#3b3f52',
  panel: '#101010',
  border: '#202022',
  todoDone: '#87d787',
  todoActive: '#d78787',
  todoDim: '#949494',
};

const MONO = 'var(--font-mono, ui-monospace, monospace)';
const BASE: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: '13px',
  lineHeight: 1.55,
};

/** Invisible ⏺ that puts the ⎿ continuation under the tool name rather than
 *  under its status glyph — the alignment the terminal gets for free. */
function GlyphSpacer() {
  return <span aria-hidden style={{ visibility: 'hidden', flexShrink: 0 }}>⏺</span>;
}

function Continuation({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'flex', minWidth: 0, alignItems: 'baseline', gap: '8px', color: C.dim }}>
      <GlyphSpacer />
      <span style={{ display: 'flex', minWidth: 0, alignItems: 'baseline', gap: '8px' }}>
        <span aria-hidden style={{ flexShrink: 0, color: C.faint }}>⎿</span>
        <span style={{ minWidth: 0, overflowWrap: 'break-word' }}>{children}</span>
      </span>
    </span>
  );
}

function ToolName({ tool, arg }: { tool: string; arg?: string }) {
  return (
    <span style={{ minWidth: 0, overflowWrap: 'break-word' }}>
      <span style={{ color: C.text }}>{tool}</span>
      {arg ? (
        <>
          <span style={{ color: C.faint }}>(</span>
          <span style={{ color: C.arg }}>{arg}</span>
          <span style={{ color: C.faint }}>)</span>
        </>
      ) : null}
    </span>
  );
}

function DiffView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div style={{ ...BASE, minWidth: 0 }}>
      <div style={{ display: 'flex', minWidth: 0, flexWrap: 'wrap', alignItems: 'baseline', gap: '0 8px' }}>
        <span aria-hidden style={{ flexShrink: 0, color: C.ok }}>⏺</span>
        <ToolName tool="Update" arg={hunk.file} />
      </div>
      <Continuation>{diffSummary(hunk)}</Continuation>
      {hunk.lines.length > 0 && (
        <div
          style={{
            marginTop: '4px', minWidth: 0, overflowX: 'auto', borderRadius: 0,
            border: `1px solid ${C.border}`, background: C.panel, padding: '6px 12px 6px 8px',
          }}
        >
          {hunk.lines.map((line, i) => (
            <div
              key={i}
              style={{
                display: 'flex', minWidth: 0,
                background: line.type === 'add' ? 'rgba(78,169,111,.10)'
                  : line.type === 'del' ? 'rgba(247,118,142,.12)' : 'transparent',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: '12px', flexShrink: 0, userSelect: 'none',
                  color: line.type === 'add' ? C.ok : line.type === 'del' ? C.err : C.faint,
                }}
              >
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
              </span>
              <span
                style={{
                  minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
                  color: line.type === 'ctx' ? C.dim : C.text,
                }}
              >
                {/* Readable without colour: the marker column is aria-hidden. */}
                {line.type !== 'ctx' && (
                  <span className="sr-only">{line.type === 'add' ? 'added: ' : 'removed: '}</span>
                )}
                {line.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolLine({ row }: { row: TraceRow }) {
  const { event, result } = row;
  const pending = result === undefined;
  const failed = result !== undefined && result.ok === 0;
  const colour = pending ? C.pending : failed ? C.err : C.ok;

  const output = (result?.text || '').trim();
  const firstLine = output.split('\n')[0] || (pending ? 'running…' : 'done');
  const expandable = output.includes('\n') || Boolean(event.tool_input);

  return (
    <details style={{ ...BASE }} className="claude-tool">
      <summary style={{ listStyle: 'none', cursor: expandable ? 'pointer' : 'default', outline: 'none' }}>
        <span style={{ display: 'flex', minWidth: 0, alignItems: 'baseline', gap: '8px' }}>
          <span aria-hidden style={{ flexShrink: 0, color: colour }}>⏺</span>
          <ToolName tool={event.tool_name || 'tool'} arg={summarizeToolInput(event) || undefined} />
        </span>
        <Continuation>
          {firstLine}
          {expandable && (
            <span className="claude-expand-hint" style={{ marginLeft: '8px', color: C.faint }}>
              (click to expand)
            </span>
          )}
        </Continuation>
      </summary>
      {expandable && (
        <div style={{ marginTop: '4px', paddingLeft: '32px', color: C.dim, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {event.tool_input && <div style={{ color: C.faint }}>{event.tool_input}</div>}
          {output && <div style={{ marginTop: event.tool_input ? '4px' : 0 }}>{output}</div>}
        </div>
      )}
    </details>
  );
}

function ThinkingLine({ event }: { event: TraceEvent }) {
  const body = event.text.trim();
  if (!body) return null;
  const first = body.split('\n')[0];
  return (
    <details style={{ ...BASE }} className="claude-tool">
      <summary style={{ listStyle: 'none', cursor: 'pointer', outline: 'none' }}>
        <span style={{ display: 'flex', minWidth: 0, alignItems: 'baseline', gap: '8px' }}>
          <span aria-hidden style={{ flexShrink: 0, color: C.todoActive }}>✳</span>
          <span style={{ color: C.dim, fontStyle: 'italic', minWidth: 0, overflowWrap: 'break-word' }}>
            {first}
          </span>
        </span>
      </summary>
      <div style={{ marginTop: '4px', paddingLeft: '32px', color: C.dim, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
        {body}
      </div>
    </details>
  );
}

function Row({ row }: { row: TraceRow }) {
  const { event } = row;
  switch (event.kind) {
    case 'thinking':
      return <ThinkingLine event={event} />;
    case 'text':
    case 'result': {
      if (!event.text.trim()) return null;
      return (
        <div style={{ ...BASE, display: 'flex', minWidth: 0, alignItems: 'baseline', gap: '8px' }}>
          <span aria-hidden style={{ flexShrink: 0, color: C.text }}>⏺</span>
          <div style={{ minWidth: 0, color: C.text }} className="claude-prose">
            <Markdown content={event.text} />
          </div>
        </div>
      );
    }
    case 'tool_use': {
      const hunk = toolDiff(event);
      // An edit renders as its diff instead of a generic tool line — that is
      // the whole point of showing the hunk.
      if (hunk) return <DiffView hunk={hunk} />;
      return <ToolLine row={row} />;
    }
    case 'tool_result':
      return (
        <div style={{ ...BASE }}>
          <Continuation>{event.text || 'tool result (no matching call)'}</Continuation>
        </div>
      );
    case 'init':
      return null;   // folded into the session header
    case 'truncated':
      return (
        <div style={{ ...BASE, color: C.pending }}>⚠ {event.text}</div>
      );
    default:
      return null;
  }
}

/** The session banner: model, engine, working directory. */
export function TraceHeader({
  events, engine, project,
}: { events: TraceEvent[]; engine?: string; project?: string }) {
  const model = events.find((e) => e.kind === 'init')?.text || '';
  const bits = [model, engine, project].filter(Boolean);
  if (bits.length === 0) return null;
  return (
    <div style={{ ...BASE, color: C.faint, display: 'flex', flexWrap: 'wrap', gap: '0 10px' }}>
      {model && <span style={{ color: C.dim }}>{model}</span>}
      {engine && <span>engine: {engine}</span>}
      {project && <span style={{ overflowWrap: 'anywhere' }}>{project}</span>}
    </div>
  );
}

const TODO_ICON: Record<PlanTodo['status'], string> = {
  done: '✔', active: '◼', failed: '✘', todo: '◻',
};
const TODO_COLOUR: Record<PlanTodo['status'], string | undefined> = {
  done: C.todoDone, active: C.todoActive, failed: C.err, todo: undefined,
};
const TODO_LABEL: Record<PlanTodo['status'], string> = {
  done: 'completed', active: 'in progress', failed: 'failed', todo: 'pending',
};

export function PlanList({ todos }: { todos: PlanTodo[] }) {
  if (todos.length === 0) return null;
  return (
    <ol style={{ ...BASE, listStyle: 'none', margin: 0, padding: 0, lineHeight: 1.6 }}>
      {todos.map((todo, i) => (
        <li key={todo.key} style={{ whiteSpace: 'pre', display: 'flex', alignItems: 'baseline' }}>
          <span aria-hidden style={{ color: C.faint }}>{i === 0 ? '  ⎿ ' : '    '}</span>
          <span aria-hidden style={{ color: TODO_COLOUR[todo.status] }}>{TODO_ICON[todo.status]} </span>
          <span
            style={{
              color: todo.status === 'done' ? C.todoDim : C.text,
              textDecoration: todo.status === 'done' ? 'line-through' : undefined,
              fontWeight: todo.status === 'active' ? 600 : undefined,
              whiteSpace: 'pre-wrap', minWidth: 0, overflowWrap: 'anywhere',
            }}
          >
            {todo.label}
            <span className="sr-only"> ({TODO_LABEL[todo.status]})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The status footer: what the run consumed, and what it touched. */
export function TraceSummary({ events }: { events: TraceEvent[] }) {
  const totals = traceTotals(events);
  const files = editedFiles(events);
  if (events.length === 0) return null;

  const bits: string[] = [];
  if (totals.hasUsage) {
    bits.push(`↑ ${formatTokens(totals.tokensIn)}`);
    bits.push(`↓ ${formatTokens(totals.tokensOut)} tokens`);
  }
  if (totals.costUsd > 0) bits.push(`$${totals.costUsd.toFixed(4)}`);
  if (totals.toolCalls > 0) bits.push(`${totals.toolCalls} tool calls`);
  if (bits.length === 0 && files.length === 0) return null;

  return (
    <div style={{ ...BASE, color: C.faint, display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {bits.length > 0 && <div>{bits.join(' · ')}</div>}
      {files.length > 0 && (
        <details className="claude-tool">
          <summary style={{ listStyle: 'none', cursor: 'pointer', color: C.dim, outline: 'none' }}>
            {files.length} file{files.length === 1 ? '' : 's'} edited
          </summary>
          <div style={{ paddingLeft: '16px', color: C.arg, display: 'flex', flexDirection: 'column' }}>
            {files.map((f) => <span key={f} style={{ overflowWrap: 'anywhere' }}>{f}</span>)}
          </div>
        </details>
      )}
    </div>
  );
}

export function TraceTimeline({ events }: { events: TraceEvent[] }) {
  const rows = buildTraceRows(events);
  if (rows.length === 0) return null;
  return (
    <div
      className="claude-session"
      style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', textAlign: 'left' }}
    >
      {rows.map((row) => <Row key={row.key} row={row} />)}
    </div>
  );
}
