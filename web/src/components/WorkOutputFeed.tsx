import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useTasksContext } from '../api/events';
import { ClaudeThinkingIndicator } from './TaskCard';
import { WorkItem } from '../api/types';
import { FileText, MessageSquare, Users2, Crown, Gavel, Loader2, CheckCircle2, XCircle, Clock, ChevronRight, ChevronDown } from 'lucide-react';

const KIND_ICON: Record<WorkItem['kind'], React.ReactNode> = {
  code_task: <FileText size={13} />,
  chat_output: <MessageSquare size={13} />,
  meeting_transcript: <Users2 size={13} />,
  delegation: <Crown size={13} />,
  decision_made: <Gavel size={13} />,
};

const STATUS_ICON: Record<WorkItem['status'], React.ReactNode> = {
  queued: <Clock size={12} style={{ color: 'var(--text-faint)' }} />,
  running: <Loader2 size={12} className="spin" style={{ color: 'var(--accent)' }} />,
  done: <CheckCircle2 size={12} style={{ color: '#22c55e' }} />,
  failed: <XCircle size={12} style={{ color: 'var(--err)' }} />,
};

function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toLocaleString();
}

/** A delegation's subtasks — collapsed by default, lazy-loaded on first
 * expand so a feed full of delegations doesn't fire N extra requests up
 * front for items nobody looks at. */
function DelegationSubtasks({ workId }: { workId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<WorkItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && children === null && !loading) {
      setLoading(true);
      try {
        setChildren(await api.getWorkItems({ parentWorkId: workId, limit: 50 }));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div style={{ marginTop: '6px' }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px',
          color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Subtasks
      </button>
      {expanded && (
        loading ? (
          <div style={{ fontSize: '11px', color: 'var(--text-faint)', padding: '4px 0' }}>Loading subtasks…</div>
        ) : !children || children.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic', padding: '4px 0' }}>
            No subtasks yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px', paddingLeft: '16px', borderLeft: '2px solid var(--border)' }}>
            {children.map((c) => (
              <div key={c.work_id} style={{ fontSize: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {STATUS_ICON[c.status]}
                  <span style={{ fontWeight: 600 }}>{c.prompt}</span>
                </div>
                {c.output_text && (
                  <div style={{ color: 'var(--text-faint)', whiteSpace: 'pre-wrap', marginTop: '2px' }}>
                    {c.output_text}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/** Newest-first feed of what employees have actually produced. Polls while
 * anything is still in flight — Phase 3 replaces this with the SSE live
 * feed; a short poll is the simplest correct thing until then. */
export function WorkOutputFeed({ employeeId, teamId }: { employeeId?: string; teamId?: string }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  // A work item only has live activity once it has spawned a real task run;
  // chat/meeting kinds fall back to the rotating phrase.
  const { activity } = useTasksContext();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const rows = await api.getWorkItems({ employeeId, teamId, limit: 30 });
        if (cancelled) return;
        setItems(rows);
        const stillRunning = rows.some((r) => r.status === 'queued' || r.status === 'running');
        timer = setTimeout(load, stillRunning ? 2500 : 8000);
      } catch {
        if (!cancelled) timer = setTimeout(load, 8000);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [employeeId, teamId]);

  if (loading) {
    return <div style={{ padding: '12px', color: 'var(--text-faint)', fontSize: '11px' }}>Loading work output…</div>;
  }
  if (items.length === 0) {
    return (
      <div style={{ padding: '12px', color: 'var(--text-faint)', fontSize: '11px', fontStyle: 'italic' }}>
        No work assigned yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {items.map((item) => (
        <div
          key={item.work_id}
          style={{
            padding: '10px 12px',
            background: 'var(--surface-card)',
            border: item.kind === 'decision_made' ? '1px solid #8b5cf6' : '1px solid var(--border)',
            borderRadius: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            {KIND_ICON[item.kind]}
            <span style={{ fontSize: '11px', color: 'var(--text-faint)', flex: 1 }}>{formatTime(item.created)}</span>
            {STATUS_ICON[item.status]}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>{item.prompt}</div>
          {item.status === 'running' && (
            <ClaudeThinkingIndicator
              since={item.created}
              activity={item.task_id ? activity[item.task_id] : undefined}
              dim
            />
          )}
          {item.kind === 'code_task' && item.task_id ? (
            <a href={`#/task/${item.task_id}`} style={{ fontSize: '11px', color: 'var(--accent)' }}>
              View task run →
            </a>
          ) : item.output_text ? (
            <div style={{ fontSize: '12px', color: 'var(--text)', whiteSpace: 'pre-wrap', opacity: 0.9 }}>
              {item.output_text}
            </div>
          ) : item.status === 'failed' ? (
            <div style={{ fontSize: '11px', color: 'var(--err)' }}>Failed — no output.</div>
          ) : item.status === 'running' ? null : (
            <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic' }}>Working…</div>
          )}
          {(item.kind === 'delegation' || item.kind === 'meeting_transcript') && (
            <DelegationSubtasks workId={item.work_id} />
          )}
        </div>
      ))}
    </div>
  );
}
