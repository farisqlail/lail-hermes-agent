import React, { useEffect, useState } from 'react';
import { Button } from './Button';
import { useTasksContext } from '../api/events';

/** Extracts every real orchestration task id (`YYYYMMDD-HHMMSS-hex`) out of a
 *  chat reply — the format `ChatEngine.task_card_suffix` appends, and the
 *  same one an auto-started `@project` task embeds. Shared between the main
 *  chat pane and Office employee chat so a task started by either renders
 *  the identical inline card. */
export function findTaskIds(text: string): string[] {
  const TASK_ID_REGEX = /\b(\d{8}-\d{6}-[0-9a-f]{6})\b/g;
  const matches: string[] = [];
  let match;
  while ((match = TASK_ID_REGEX.exec(text)) !== null) {
    if (!matches.includes(match[1])) {
      matches.push(match[1]);
    }
  }
  return matches;
}

const THINKING_PHRASES = [
  'Thinking',
  'Analyzing request',
  'Formulating response',
  'Processing context',
  'Synthesizing thoughts',
  'Crafting answer',
  'Reflecting on steps',
  'Connecting ideas',
  'Evaluating context',
  'Organizing response',
];

/** How long a log line keeps standing in for live activity. Past this the
 *  rotating phrase takes over, so a task that stops logging mid-run doesn't
 *  leave the indicator frozen on a line from a minute ago. */
export const ACTIVITY_STALE_MS = 8000;

/** One log line squeezed onto a single row — whitespace collapsed, capped so
 *  a long shell command can't push the elapsed timer off the card. */
export function cleanLogLine(line: string): string {
  const flat = (line || '').replace(/\s+/g, ' ').trim();
  return flat.length <= 72 ? flat : flat.slice(0, 71) + '…';
}

/** What the indicator says right now: the real log line while it is fresh,
 *  the rotating phrase once the stream goes quiet. A timestamp in the future
 *  (clock skew between server events and the browser) counts as fresh. */
export function thinkingText(
  activity: { line: string; ts: number } | undefined,
  fallback: string,
  now: number,
): string {
  if (!activity || now - activity.ts >= ACTIVITY_STALE_MS) return fallback;
  return cleanLogLine(activity.line) || fallback;
}

export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

interface ClaudeThinkingIndicatorProps {
  /** Unix *seconds* the work started. Supplied, the indicator grows a live
   *  elapsed timer; omitted, it stays exactly the streaming-reply indicator
   *  the chat panes have always rendered. */
  since?: number;
  /** Newest real log line for this task, straight off the SSE stream. */
  activity?: { line: string; ts: number };
  /** Tighter variant for dense rows (the Office work feed). */
  dim?: boolean;
}

/** The glyph cycle Claude Code animates while it works, in capture order. */
const THINKING_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function ClaudeThinkingIndicator({ since, activity, dim }: ClaudeThinkingIndicatorProps = {}) {
  const [phraseIndex, setPhraseIndex] = useState(() => Math.floor(Math.random() * THINKING_PHRASES.length));
  const [fade, setFade] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [glyph, setGlyph] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  // The glyph spins far faster than the words — that cadence is most of what
  // makes the line read as "busy" rather than "stuck". CSS cannot stop a JS
  // interval, so reduced motion is honoured here rather than in the sheet.
  useEffect(() => {
    if (reducedMotion) return;
    const tick = window.setInterval(
      () => setGlyph((g) => (g + 1) % THINKING_GLYPHS.length), 110);
    return () => window.clearInterval(tick);
  }, [reducedMotion]);

  useEffect(() => {
    // Slow on purpose: the real thing changes verb every few seconds, and a
    // word swapping once a second reads as a stutter.
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setPhraseIndex((prev) => (prev + 1 + Math.floor(Math.random() * (THINKING_PHRASES.length - 1))) % THINKING_PHRASES.length);
        setFade(true);
      }, 200);
    }, 5200);

    return () => clearInterval(interval);
  }, []);

  // Tick only when something on screen reads the clock — the elapsed timer or
  // the staleness cutoff. Plain chat-streaming callers pass neither and keep
  // their old, timer-free render.
  const needsClock = since !== undefined || activity !== undefined;
  useEffect(() => {
    if (!needsClock) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [needsClock]);

  const phrase = THINKING_PHRASES[phraseIndex];
  const text = thinkingText(activity, phrase, now);
  const live = text !== phrase;
  const elapsed = since === undefined ? null : formatElapsed(now / 1000 - since);

  return (
    <div
      className={`claude-plain-thinking${dim ? ' claude-plain-thinking-dim' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="claude-thinking-sparkle" aria-hidden="true">
        {reducedMotion ? '✳' : THINKING_GLYPHS[glyph]}
      </span>
      <span className={`claude-thinking-text ${live || fade ? 'fade-in' : 'fade-out'}`}>
        {text}…
      </span>
      {/* Hidden from the live region: a per-second timer would make a screen
          reader announce the whole status every tick. */}
      {elapsed && <span className="claude-thinking-meta" aria-hidden="true">({elapsed})</span>}
    </div>
  );
}

interface InlineTaskCardProps {
  taskId: string;
  tasks: any[];
  confirming: boolean;
  onConfirm: (approved: boolean) => void;
}

export function InlineTaskCard({ taskId, tasks, confirming, onConfirm }: InlineTaskCardProps) {
  // Read straight from the provider rather than threading a prop through all
  // three chat panes — `TasksProvider` wraps the whole app shell, so Office's
  // chats sit inside it exactly like the main dashboard does.
  const { activity } = useTasksContext();
  const task = tasks.find((t) => t.task_id === taskId);

  if (!task) {
    return (
      <div style={{
        marginTop: '8px',
        padding: '8px 12px',
        backgroundColor: 'rgba(6,10,15,0.7)',
        border: '1px dashed var(--err)',
        borderRadius: 'var(--r-sm)',
        alignSelf: 'stretch',
        fontSize: '11px',
        color: 'var(--text-dim)',
      }}>
        <span style={{ color: 'var(--err)', fontWeight: 'bold' }}>⚠️ TASK NOT FOUND</span>
        {' — '}
        <span style={{ fontFamily: 'var(--font-mono)' }}>{taskId}</span>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    queued: '#888',
    running: 'var(--accent)',
    done: 'var(--ok)',
    failed: 'var(--err)',
    cancelled: '#888',
    interrupted: 'var(--warn)',
    awaiting_confirm: 'var(--warn)',
  };

  return (
    <div style={{
      marginTop: '8px',
      padding: '10px 12px',
      backgroundColor: 'rgba(6, 10, 15, 0.75)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-sm)',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      fontSize: '12px',
      alignSelf: 'stretch',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
          ⚙️ TASK: {taskId.substring(0, 8)}...
        </span>
        <span style={{
          padding: '1px 6px',
          borderRadius: 'var(--r-sm)',
          fontSize: '9px',
          fontFamily: 'var(--font-mono)',
          fontWeight: 'bold',
          backgroundColor: 'rgba(255,255,255,0.03)',
          color: statusColors[task.status] || 'var(--text)',
          border: `1px solid ${statusColors[task.status] || 'var(--border)'}`,
        }}>
          {task.status.toUpperCase()}
        </span>
      </div>

      <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '11px' }}>
        "{task.text}"
      </div>

      {task.status === 'running' && (
        <ClaudeThinkingIndicator since={task.created} activity={activity[task.task_id]} dim />
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '2px', alignItems: 'center', flexWrap: 'wrap' }}>
        <a
          href={`#/task/${taskId}`}
          style={{
            color: 'var(--accent)',
            textDecoration: 'underline',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          VIEW LOGS ↗
        </a>

        {task.status === 'awaiting_confirm' && (
          <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
            <Button
              variant="primary"
              size="small"
              onClick={() => onConfirm(true)}
              disabled={confirming}
              style={{ padding: '2px 8px', fontSize: '9px', minHeight: '20px' }}
            >
              Run
            </Button>
            <Button
              variant="danger"
              size="small"
              onClick={() => onConfirm(false)}
              disabled={confirming}
              style={{ padding: '2px 8px', fontSize: '9px', minHeight: '20px' }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Approve/decline a real orchestration task (awaiting_confirm), the same
 *  `/api/tasks/{id}/confirm` endpoint the main dashboard uses — global and
 *  task-id-scoped, so an Office employee's auto-started task resolves the
 *  same way a main-chat one does. */
export async function confirmTask(taskId: string, approved: boolean): Promise<boolean> {
  const res = await fetch(`/api/tasks/${taskId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved }),
  });
  return res.ok;
}
