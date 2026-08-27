import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { WorkItem } from '../api/types';
import { FileText, MessageSquare, Users2, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

const KIND_ICON: Record<WorkItem['kind'], React.ReactNode> = {
  code_task: <FileText size={13} />,
  chat_output: <MessageSquare size={13} />,
  meeting_transcript: <Users2 size={13} />,
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

/** Newest-first feed of what employees have actually produced. Polls while
 * anything is still in flight — Phase 3 replaces this with the SSE live
 * feed; a short poll is the simplest correct thing until then. */
export function WorkOutputFeed({ employeeId, teamId }: { employeeId?: string; teamId?: string }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);

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
            border: '1px solid var(--border)',
            borderRadius: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            {KIND_ICON[item.kind]}
            <span style={{ fontSize: '11px', color: 'var(--text-faint)', flex: 1 }}>{formatTime(item.created)}</span>
            {STATUS_ICON[item.status]}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>{item.prompt}</div>
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
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic' }}>Working…</div>
          )}
        </div>
      ))}
    </div>
  );
}
