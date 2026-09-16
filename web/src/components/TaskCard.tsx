import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Button } from './Button';
import { useTasksContext } from '../api/events';
import { useTask } from '../hooks/useTask';
import { TraceTimeline } from './TraceTimeline';
import type { TraceEvent } from '../api/trace';
import {
  ChevronDown,
  ChevronUp,
  Terminal,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  Check,
  Copy,
  RefreshCw,
  Layers,
  ListTodo,
  HelpCircle,
  AlertTriangle,
  FileCode,
  Search,
  ExternalLink,
  Square,
  Activity,
  FileText,
} from 'lucide-react';

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
  tasks?: any[];
  confirming?: boolean;
  onConfirm?: (approved: boolean) => void;
  defaultExpanded?: boolean;
}

export function InlineTaskCard({
  taskId,
  tasks = [],
  confirming = false,
  onConfirm,
  defaultExpanded,
}: InlineTaskCardProps) {
  const { activity, trace: contextTrace, watchTrace, refresh: refreshGlobalTasks } = useTasksContext();
  const { task: taskData, refresh: refreshTask } = useTask(taskId);

  const task = taskData?.task || tasks.find((t) => t.task_id === taskId) || {
    task_id: taskId,
    status: 'queued',
    text: 'Task in progress...',
    created: Math.floor(Date.now() / 1000),
  };

  const isRunning = task.status === 'running' || task.status === 'queued';
  const isAwaitingConfirm = task.status === 'awaiting_confirm';
  const isDone = task.status === 'done';
  const isFailed = task.status === 'failed';
  const isCancelled = task.status === 'cancelled';

  const [expanded, setExpanded] = useState<boolean>(() => defaultExpanded ?? (isAwaitingConfirm || false));
  const [activeTab, setActiveTab] = useState<'steps' | 'logs' | 'artifacts'>('steps');
  const [cancelling, setCancelling] = useState(false);
  const [localConfirming, setLocalConfirming] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [selectedAskOptions, setSelectedAskOptions] = useState<number[]>([]);
  const [askText, setAskText] = useState('');
  const [copiedId, setCopiedId] = useState(false);

  // Terminal state
  const logs = taskData?.logs || [];
  const [logFilter, setLogFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // Auto-expand if awaiting confirmation or question arrives
  useEffect(() => {
    if (isAwaitingConfirm || taskData?.pending_ask) {
      setExpanded(true);
    }
  }, [isAwaitingConfirm, taskData?.pending_ask]);

  // Initial trace loading & live trace watching
  const [initialTrace, setInitialTrace] = useState<TraceEvent[]>([]);
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    fetch(`/api/tasks/${taskId}/trace`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: TraceEvent[]) => {
        if (!cancelled && Array.isArray(data)) setInitialTrace(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expanded, taskId]);

  useEffect(() => {
    if (expanded && isRunning) {
      watchTrace(taskId);
      return () => watchTrace(null);
    }
  }, [expanded, isRunning, taskId, watchTrace]);

  const liveTrace = useMemo(() => {
    const seen = new Set(initialTrace.map((e) => e.id));
    const combined = [...initialTrace];
    for (const e of contextTrace) {
      if (!seen.has(e.id)) {
        combined.push(e);
        seen.add(e.id);
      }
    }
    return combined;
  }, [initialTrace, contextTrace]);

  // Auto scroll terminal logs
  useEffect(() => {
    if (autoScroll && activeTab === 'logs' && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, activeTab, autoScroll]);

  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs;
    const q = logFilter.toLowerCase();
    return logs.filter((l) => l.toLowerCase().includes(q));
  }, [logs, logFilter]);

  const handleConfirmAction = async (approved: boolean) => {
    setLocalConfirming(true);
    try {
      if (onConfirm) {
        onConfirm(approved);
      } else {
        await confirmTask(taskId, approved);
      }
      refreshTask();
      refreshGlobalTasks();
    } finally {
      setLocalConfirming(false);
    }
  };

  const handleCancelAction = async () => {
    setCancelling(true);
    try {
      await cancelTask(taskId);
      refreshTask();
      refreshGlobalTasks();
    } finally {
      setCancelling(false);
    }
  };

  const handleToggleAskOption = (idx: number, isMulti: boolean) => {
    if (!isMulti) {
      submitAskResponse([idx], null);
    } else {
      setSelectedAskOptions((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
      );
    }
  };

  const submitAskResponse = async (options: number[] | null, text: string | null) => {
    if (!taskData?.pending_ask) return;
    setAnswering(true);
    try {
      await answerTask(taskId, taskData.pending_ask.ask_id, options, text);
      setSelectedAskOptions([]);
      setAskText('');
      refreshTask();
      refreshGlobalTasks();
    } finally {
      setAnswering(false);
    }
  };

  const copyTaskId = () => {
    navigator.clipboard.writeText(taskId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const statusColors: Record<string, string> = {
    queued: '#94a3b8',
    running: 'var(--accent)',
    done: 'var(--ok)',
    failed: 'var(--err)',
    cancelled: '#64748b',
    interrupted: 'var(--warn)',
    awaiting_confirm: 'var(--warn)',
  };

  const artifacts = taskData?.artifacts || [];
  const pendingConfirm = taskData?.pending_confirm;
  const pendingAsk = taskData?.pending_ask;

  return (
    <div
      className="antigravity-inline-task-card"
      style={{
        marginTop: '10px',
        marginBottom: '6px',
        backgroundColor: 'rgba(10, 14, 22, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${statusColors[task.status] || 'var(--border)'}`,
        borderRadius: 'var(--r-md)',
        display: 'flex',
        flexDirection: 'column',
        alignSelf: 'stretch',
        overflow: 'hidden',
        boxShadow: isRunning ? '0 0 16px rgba(59, 130, 246, 0.12)' : '0 4px 12px rgba(0,0,0,0.3)',
        transition: 'all 0.2s ease',
      }}
    >
      {/* 1. Header Bar */}
      <div
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--r-sm)',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              letterSpacing: '0.04em',
              backgroundColor: isRunning
                ? 'rgba(59, 130, 246, 0.15)'
                : isDone
                ? 'rgba(78, 169, 111, 0.15)'
                : isFailed
                ? 'rgba(239, 68, 68, 0.15)'
                : isAwaitingConfirm
                ? 'rgba(245, 158, 11, 0.15)'
                : 'rgba(255,255,255,0.05)',
              color: statusColors[task.status] || 'var(--text)',
              border: `1px solid ${statusColors[task.status] || 'var(--border)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            {isRunning && <span className="pulsing-dot" />}
            {isDone && <CheckCircle2 size={11} />}
            {isFailed && <AlertTriangle size={11} />}
            {isAwaitingConfirm && <ShieldAlert size={11} />}
            {task.status.toUpperCase()}
          </span>

          <button
            type="button"
            onClick={copyTaskId}
            title="Click to copy Task ID"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px 4px',
              cursor: 'pointer',
              color: 'var(--text-faint)',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>{taskId.substring(0, 15)}...</span>
            {copiedId ? <Check size={10} style={{ color: 'var(--ok)' }} /> : <Copy size={10} />}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {isRunning && (
            <Button
              variant="danger"
              size="small"
              onClick={handleCancelAction}
              disabled={cancelling}
              style={{ padding: '2px 8px', fontSize: '10px', minHeight: '22px' }}
            >
              {cancelling ? 'Stopping...' : 'Stop'}
            </Button>
          )}

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            style={{
              background: expanded ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${expanded ? 'rgba(59, 130, 246, 0.3)' : 'var(--border)'}`,
              borderRadius: 'var(--r-sm)',
              color: expanded ? 'var(--accent)' : 'var(--text-dim)',
              fontSize: '11px',
              padding: '3px 10px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
          >
            <span>
              {expanded
                ? 'Hide Steps'
                : `Show Steps & Logs (${liveTrace.length || taskData?.steps?.length || logs.length ? `${liveTrace.length || taskData?.steps?.length || logs.length}` : 'Inspect'})`}
            </span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* 2. Directive & Live Progress Subheader */}
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <Terminal size={14} style={{ color: 'var(--accent)', marginTop: '2px', flexShrink: 0 }} />
          <span style={{ fontSize: '12px', color: 'var(--text)', fontWeight: 500, lineHeight: 1.4 }}>
            {task.text}
          </span>
        </div>

        {isRunning && (
          <div style={{ marginTop: '2px' }}>
            <ClaudeThinkingIndicator
              since={task.created}
              activity={activity[task.task_id]}
              dim
            />
          </div>
        )}
      </div>

      {/* 3. Pending Confirmation Banner (Inside Chat) */}
      {(isAwaitingConfirm || (pendingConfirm && pendingConfirm.length > 0)) && (
        <div
          style={{
            margin: '0 14px 12px',
            padding: '12px 14px',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid var(--warn)',
            borderRadius: 'var(--r-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warn)', fontWeight: 600, fontSize: '12px' }}>
            <ShieldAlert size={15} />
            <span>High-Risk Action Authorization Required</span>
          </div>
          {pendingConfirm && pendingConfirm.length > 0 && (
            <ul style={{ margin: '0 0 4px 16px', padding: 0, fontSize: '11px', color: 'var(--text)' }}>
              {pendingConfirm.map((reason, i) => (
                <li key={i} style={{ fontFamily: 'var(--font-mono)' }}>{reason}</li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
            <Button
              variant="primary"
              size="small"
              onClick={() => handleConfirmAction(true)}
              disabled={confirming || localConfirming}
              style={{ padding: '4px 12px', fontSize: '11px' }}
            >
              Authorize & Run
            </Button>
            <Button
              variant="danger"
              size="small"
              onClick={() => handleConfirmAction(false)}
              disabled={confirming || localConfirming}
              style={{ padding: '4px 12px', fontSize: '11px' }}
            >
              Reject & Cancel
            </Button>
          </div>
        </div>
      )}

      {/* 4. Pending Question / Clarification Banner (`ask_user`) */}
      {pendingAsk && (
        <div
          style={{
            margin: '0 14px 12px',
            padding: '12px 14px',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--r-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent)', fontWeight: 600, fontSize: '12px' }}>
            <HelpCircle size={15} />
            <span>Clarification Needed:</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text)' }}>
            {pendingAsk.question}
          </div>

          {pendingAsk.options && pendingAsk.options.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {pendingAsk.options.map((opt, idx) => {
                  const label = typeof opt === 'string' ? opt : opt.label || '';
                  const isSelected = selectedAskOptions.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleToggleAskOption(idx, pendingAsk.multi)}
                      disabled={answering}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 'var(--r-sm)',
                        backgroundColor: isSelected ? 'var(--accent)' : 'var(--surface-2)',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        color: isSelected ? '#fff' : 'var(--text)',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isSelected && <Check size={11} />}
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
              {pendingAsk.multi && (
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => submitAskResponse(selectedAskOptions, null)}
                  disabled={selectedAskOptions.length === 0 || answering}
                  style={{ alignSelf: 'flex-start', padding: '3px 10px', fontSize: '11px' }}
                >
                  {answering ? 'Submitting...' : `Submit (${selectedAskOptions.length})`}
                </Button>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (askText.trim()) submitAskResponse(null, askText.trim());
              }}
              style={{ display: 'flex', gap: '8px' }}
            >
              <input
                type="text"
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                placeholder="Type your response..."
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface-card)',
                  color: 'var(--text)',
                  fontSize: '12px',
                }}
              />
              <Button variant="primary" size="small" type="submit" disabled={!askText.trim() || answering}>
                {answering ? '...' : 'Send'}
              </Button>
            </form>
          )}
        </div>
      )}

      {/* 5. Collapsible Steps & Terminal Drawer */}
      {expanded && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          {/* Sub-tab Switcher */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 12px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('steps')}
              style={{
                background: activeTab === 'steps' ? 'var(--surface-2)' : 'transparent',
                border: activeTab === 'steps' ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 'var(--r-sm)',
                color: activeTab === 'steps' ? 'var(--accent)' : 'var(--text-dim)',
                fontSize: '11px',
                padding: '3px 10px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontWeight: activeTab === 'steps' ? 600 : 400,
              }}
            >
              <Activity size={12} />
              <span>Steps & Tools ({liveTrace.length || taskData?.steps?.length || 0})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              style={{
                background: activeTab === 'logs' ? 'var(--surface-2)' : 'transparent',
                border: activeTab === 'logs' ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 'var(--r-sm)',
                color: activeTab === 'logs' ? 'var(--accent)' : 'var(--text-dim)',
                fontSize: '11px',
                padding: '3px 10px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontWeight: activeTab === 'logs' ? 600 : 400,
              }}
            >
              <Terminal size={12} />
              <span>Terminal ({logs.length})</span>
            </button>

            {artifacts.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('artifacts')}
                style={{
                  background: activeTab === 'artifacts' ? 'var(--surface-2)' : 'transparent',
                  border: activeTab === 'artifacts' ? '1px solid var(--border)' : '1px solid transparent',
                  borderRadius: 'var(--r-sm)',
                  color: activeTab === 'artifacts' ? 'var(--accent)' : 'var(--text-dim)',
                  fontSize: '11px',
                  padding: '3px 10px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontWeight: activeTab === 'artifacts' ? 600 : 400,
                }}
              >
                <FileCode size={12} />
                <span>Artifacts ({artifacts.length})</span>
              </button>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={refreshTask}
                title="Refresh Task Status"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-faint)',
                  display: 'inline-flex',
                  padding: '3px',
                }}
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>

          {/* Sub-tab Content Area */}
          <div
            style={{
              padding: '12px 14px',
              maxHeight: '380px',
              overflowY: 'auto',
              fontSize: '12px',
            }}
          >
            {activeTab === 'steps' && (
              <div>
                {liveTrace.length > 0 ? (
                  <TraceTimeline events={liveTrace} />
                ) : taskData?.steps && taskData.steps.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {taskData.steps.map((st) => (
                      <div
                        key={st.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 10px',
                          background: 'var(--surface-2)',
                          borderRadius: 'var(--r-sm)',
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <span style={{ color: st.status === 'done' ? 'var(--ok)' : 'var(--accent)' }}>
                          {st.status === 'done' ? '✓' : '⚙'}
                        </span>
                        <span style={{ color: 'var(--text)' }}>{st.kind}</span>
                        <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>{st.status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-faint)', fontStyle: 'italic', padding: '10px 0' }}>
                    {isRunning ? 'Synthesizing initial execution steps...' : 'No steps recorded for this task.'}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'logs' && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '3px 8px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)',
                      flex: 1,
                    }}
                  >
                    <Search size={11} style={{ color: 'var(--text-faint)' }} />
                    <input
                      type="text"
                      placeholder="Filter logs..."
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        color: 'var(--text)',
                        fontSize: '11px',
                        width: '100%',
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setAutoScroll((v) => !v)}
                    style={{
                      background: autoScroll ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                      border: `1px solid ${autoScroll ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--r-sm)',
                      color: autoScroll ? 'var(--accent)' : 'var(--text-dim)',
                      fontSize: '10px',
                      padding: '3px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div
                  ref={terminalRef}
                  style={{
                    background: '#090d13',
                    border: '1px solid #1e293b',
                    borderRadius: 'var(--r-sm)',
                    padding: '8px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    lineHeight: '1.6',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {filteredLogs.length === 0 ? (
                    <div style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>
                      {logFilter ? 'No logs match filter.' : isRunning ? 'Waiting for output...' : 'Log stream is empty.'}
                    </div>
                  ) : (
                    filteredLogs.map((l, idx) => (
                      <div
                        key={idx}
                        style={{
                          color: l.includes('ERROR') || l.includes('Error')
                            ? 'var(--err)'
                            : l.includes('WARN') || l.includes('Warning')
                            ? 'var(--warn)'
                            : l.includes('✓') || l.includes('SUCCESS')
                            ? 'var(--ok)'
                            : '#cbd5e1',
                        }}
                      >
                        {l}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'artifacts' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {artifacts.map((a, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)',
                      fontSize: '11px',
                    }}
                  >
                    <FileText size={13} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                      {a.path}
                    </span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        padding: '1px 6px',
                        background: 'rgba(255,255,255,0.05)',
                        borderRadius: '3px',
                        fontSize: '9px',
                        color: 'var(--text-dim)',
                      }}
                    >
                      {a.kind}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
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

/** Cancel/stop a running or queued orchestration task. */
export async function cancelTask(taskId: string): Promise<boolean> {
  const res = await fetch(`/api/tasks/${taskId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return res.ok;
}

/** Answer an interactive ask_user prompt from a running task. */
export async function answerTask(
  taskId: string,
  askId: string,
  options: number[] | null,
  text: string | null
): Promise<boolean> {
  const res = await fetch(`/api/tasks/${taskId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ask_id: askId,
      options,
      text,
    }),
  });
  return res.ok;
}

