import React, { useEffect, useState } from 'react';
import { Button } from './Button';

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

export function ClaudeThinkingIndicator() {
  const [phraseIndex, setPhraseIndex] = useState(() => Math.floor(Math.random() * THINKING_PHRASES.length));
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setPhraseIndex((prev) => (prev + 1 + Math.floor(Math.random() * (THINKING_PHRASES.length - 1))) % THINKING_PHRASES.length);
        setFade(true);
      }, 200);
    }, 2200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="claude-plain-thinking">
      <span className="claude-thinking-sparkle">✦</span>
      <span className={`claude-thinking-text ${fade ? 'fade-in' : 'fade-out'}`}>
        {THINKING_PHRASES[phraseIndex]}…
      </span>
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
