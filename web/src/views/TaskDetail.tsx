import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRoute } from '../router';
import { useTask } from '../hooks/useTask';
import { parseLogsToMessages, TimelineMessage } from '../api/parser';
import { Markdown } from '../components/Markdown';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { useToast } from '../components/Toast';
import { ClaudeThinkingIndicator } from '../components/TaskCard';
import { PlanList, TraceHeader, TraceSummary, TraceTimeline } from '../components/TraceTimeline';
import { planTodos, sessionInfo } from '../api/trace';
import { ArrowLeft } from 'lucide-react';
import { useTasksContext } from '../api/events';

interface CollapsibleLogsProps {
  logs: string[];
}

function CollapsibleLogs({ logs }: CollapsibleLogsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const getLineStyle = (line: string) => {
    const l = line.toLowerCase();
    if (l.includes('error') || l.includes('fail') || l.startsWith('error:')) {
      return { color: 'var(--err)' };
    }
    if (line.startsWith('[')) {
      return { color: 'var(--accent)' };
    }
    return {};
  };

  return (
    <div style={{ backgroundColor: '#05070a', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', margin: '8px 0' }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: 'var(--t-xs)',
          color: 'var(--text-dim)',
          userSelect: 'none',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <span>⚙️ System Logs ({logs.length} baris)</span>
        <span style={{ display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s ease' }}>▶</span>
      </div>
      {isOpen && (
        <div
          style={{
            maxHeight: '300px',
            overflowY: 'auto',
            background: '#010204',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-xs)',
            color: 'hsl(120, 60%, 75%)',
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            whiteSpace: 'pre-wrap',
            textAlign: 'left',
          }}
        >
          {logs.map((line, idx) => (
            <div key={idx} style={{ marginBottom: '2px', ...getLineStyle(line) }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskDetail() {
  const { taskId, navigate } = useRoute();
  const { task: taskData, loading, error, refresh } = useTask(taskId);
  const { refresh: refreshGlobalTasks, activity, trace, watchTrace } = useTasksContext();

  // Only the open task's trace is accumulated, so the subscription is tied to
  // this view's lifetime rather than the session's.
  useEffect(() => {
    if (!taskId) return;
    watchTrace(taskId);
    return () => watchTrace(null);
  }, [taskId, watchTrace]);
  const { toast } = useToast();

  const [confirming, setConfirming] = useState(false);
  const [answering, setAnswering] = useState(false);
  
  // State for ask choices
  const [selectedAskOptions, setSelectedAskOptions] = useState<number[]>([]);
  const [askText, setAskText] = useState('');

  const chatFlowRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Scroll logic
  useEffect(() => {
    if (autoScroll && chatFlowRef.current) {
      chatFlowRef.current.scrollTop = chatFlowRef.current.scrollHeight;
    }
  }, [taskData, autoScroll]);

  /** Return to wherever this task was opened from.
   *
   * History first, because a task is reached from several places — the main
   * chat, an Office employee's chat, the session list — and only the history
   * knows which. `length > 1` is the guard for the other case: a `#/task/<id>`
   * link opened cold in a new tab has nothing to go back to, and calling
   * back() there would leave the app entirely.
   *
   * Declared above the early returns so the error state gets it too: a task
   * that fails to load otherwise leaves no way out but the browser chrome.
   */
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    const task = taskData?.task;
    if (task?.origin === 'office') return navigate('#/office');
    navigate(task?.session_id ? `#/session/${task.session_id}` : '#/');
  };

  if (loading && !taskData) {
    return <div style={{ color: 'var(--text-dim)' }}>Memuat detail tugas...</div>;
  }

  if (error || !taskData) {
    return (
      <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: 'var(--r-md)', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
        <span>{error || 'Tugas tidak ditemukan.'}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="danger" type="button" onClick={refresh}>Coba Lagi</Button>
          <Button variant="secondary" type="button" onClick={goBack}>Kembali</Button>
        </div>
      </div>
    );
  }

  const { task, logs, artifacts, steps, pending_confirm, pending_ask } = taskData;
  const { engine, project } = sessionInfo(logs || []);
  const timeline = parseLogsToMessages(task, logs || [], artifacts || []);

  const handleConfirm = async (approved: boolean) => {
    if (!taskId) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      if (res.ok) {
        toast(approved ? 'Tugas disetujui dan dilanjutkan!' : 'Tugas dibatalkan.', 'ok');
        refresh();
        refreshGlobalTasks();
      } else {
        toast('Gagal mengirim konfirmasi.', 'err');
      }
    } catch (err) {
      toast('Terjadi kesalahan jaringan.', 'err');
    } finally {
      setConfirming(false);
    }
  };

  const handleToggleAskOption = (idx: number, isMulti: boolean) => {
    if (!isMulti) {
      // Submit single select immediately
      submitAskResponse([idx], null);
    } else {
      // Multi select: toggle state
      setSelectedAskOptions((prev) => {
        if (prev.includes(idx)) {
          return prev.filter((i) => i !== idx);
        }
        return [...prev, idx];
      });
    }
  };

  const handleAskTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!askText.trim()) return;
    submitAskResponse(null, askText.trim());
  };

  const submitAskResponse = async (options: number[] | null, text: string | null) => {
    if (!taskId || !pending_ask) return;
    setAnswering(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ask_id: pending_ask.ask_id,
          options,
          text,
        }),
      });
      if (res.ok) {
        toast('Tanggapan berhasil dikirim.', 'ok');
        setSelectedAskOptions([]);
        setAskText('');
        refresh();
        refreshGlobalTasks();
      } else {
        toast('Gagal mengirim tanggapan.', 'err');
      }
    } catch (err) {
      toast('Terjadi kesalahan jaringan.', 'err');
    } finally {
      setAnswering(false);
    }
  };

  const isImage = (path: string) => {
    const p = path.toLowerCase();
    return p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>
      
      {/* Task Header */}
      <header className="page-header" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0 }}>
            <button
              type="button"
              onClick={goBack}
              aria-label="Back"
              title="Back"
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px',
                padding: '4px 8px', flexShrink: 0, cursor: 'pointer',
                background: 'transparent', color: 'var(--text-dim)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
              }}
            >
              <ArrowLeft size={13} />
              Back
            </button>
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-lg)' }}>
              Task: {task.task_id}
            </h1>
            <p className="page-subtitle" style={{ fontSize: 'var(--t-base)', color: 'var(--text)', marginTop: '4px' }}>
              {task.text}
            </p>
          </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span
              style={{
                fontSize: 'var(--t-xs)',
                fontWeight: '600',
                padding: '4px 10px',
                borderRadius: 'var(--r-sm)',
                backgroundColor:
                  task.status === 'done'
                    ? 'rgba(34, 197, 94, 0.15)'
                    : task.status === 'failed'
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(59, 130, 246, 0.15)',
                color:
                  task.status === 'done'
                    ? 'var(--ok)'
                    : task.status === 'failed'
                    ? 'var(--err)'
                    : 'var(--accent)',
                border: `1px solid ${
                  task.status === 'done'
                    ? 'var(--ok)'
                    : task.status === 'failed'
                    ? 'var(--err)'
                    : 'var(--accent)'
                }`,
              }}
            >
              {task.status.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Long tasks can go minutes without emitting a log line — this is the
            only thing on the page that keeps moving while that happens. */}
        {(task.status === 'running' || task.status === 'queued') && (
          <div style={{ marginTop: '8px' }}>
            <ClaudeThinkingIndicator since={task.created} activity={activity[task.task_id]} />
          </div>
        )}

        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <TraceHeader events={trace} engine={engine} project={project} />
          {/* The planner's steps, as the CLI's checklist — the one part of the
              timeline that says where the run is going, not where it has been. */}
          <PlanList todos={planTodos(steps || [])} />
          <TraceSummary events={trace} />
        </div>
      </header>

      {/* Confirmation Widget Banner */}
      {pending_confirm && pending_confirm.length > 0 && (
        <div
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid var(--warn)',
            borderRadius: 'var(--r-lg)',
            padding: '16px',
            flexShrink: 0,
          }}
        >
          <h4 style={{ color: 'var(--warn)', fontWeight: '600', marginBottom: '8px' }}>
            ⚠️ Persetujuan Tindakan Berisiko
          </h4>
          <p style={{ fontSize: 'var(--t-sm)', color: 'var(--text-dim)', marginBottom: '8px' }}>
            Tugas ini membutuhkan izin Anda karena melakukan tindakan sensitif:
          </p>
          <ul style={{ paddingLeft: '20px', fontSize: 'var(--t-sm)', color: 'var(--text)', marginBottom: '16px' }}>
            {pending_confirm.map((reason: string, idx: number) => (
              <li key={idx} style={{ marginBottom: '4px' }}>{reason}</li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="primary" onClick={() => handleConfirm(true)} loading={confirming}>
              Run / Izinkan
            </Button>
            <Button variant="danger" onClick={() => handleConfirm(false)} loading={confirming}>
              Cancel / Tolak
            </Button>
          </div>
        </div>
      )}

      {/* Ask Widget Banner */}
      {pending_ask && (
        <div
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--r-lg)',
            padding: '16px',
            flexShrink: 0,
          }}
        >
          <h4 style={{ color: 'var(--accent)', fontWeight: '600', marginBottom: '8px' }}>
            ❓ Pertanyaan dari Runner
          </h4>
          <p style={{ fontSize: 'var(--t-sm)', color: 'var(--text)', marginBottom: '12px' }}>
            {pending_ask.question}
          </p>

          {pending_ask.options && pending_ask.options.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {pending_ask.options.map((opt: string | { label?: string }, idx: number) => {
                  const label = typeof opt === 'string' ? opt : (opt.label || '');
                  const isSelected = selectedAskOptions.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleToggleAskOption(idx, pending_ask.multi)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 'var(--r-md)',
                        backgroundColor: isSelected ? 'var(--accent)' : 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        color: isSelected ? 'var(--text)' : 'var(--text-dim)',
                        fontWeight: '600',
                        fontSize: 'var(--t-sm)',
                        cursor: 'pointer',
                      }}
                      disabled={answering}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {pending_ask.multi && (
                <Button
                  variant="primary"
                  onClick={() => submitAskResponse(selectedAskOptions, null)}
                  disabled={selectedAskOptions.length === 0}
                  loading={answering}
                  style={{ marginTop: '8px' }}
                >
                  Submit Selection
                </Button>
              )}
            </div>
          ) : (
            <form onSubmit={handleAskTextSubmit} style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="field-input"
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                placeholder="Ketik jawaban Anda..."
                required
                disabled={answering}
              />
              <Button variant="primary" type="submit" loading={answering}>
                Send Reply
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Auto scroll control */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <input
          type="checkbox"
          id="auto-scroll-logs"
          checked={autoScroll}
          onChange={(e) => setAutoScroll(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <label htmlFor="auto-scroll-logs" style={{ fontSize: 'var(--t-xs)', color: 'var(--text-faint)', userSelect: 'none', cursor: 'pointer' }}>
          Auto-scroll timeline
        </label>
      </div>

      {/* Task Chat timeline flow */}
      <div
        ref={chatFlowRef}
        className="chat-thread"
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          padding: '16px',
          backgroundColor: 'rgba(6, 10, 15, 0.4)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)',
          minHeight: '200px',
        }}
      >
        {/* The engine's own run first — reasoning, tool calls, answer. Empty
            for an engine that emits no stream (antigravity) and for tasks that
            ran before traces existed, which is why the log timeline below
            stays exactly as it was rather than being replaced by this. */}
        <TraceTimeline events={trace} />

        {timeline.length === 0 && trace.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', textAlign: 'center', margin: 'auto', fontFamily: 'var(--font-mono)' }}>
            NO ACTIVITY LOGS DETECTED.
          </div>
        ) : (
          timeline.map((msg, idx) => (
            <div
              key={idx}
              style={{
                alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: msg.type === 'logs' ? '100%' : '80%',
                width: msg.type === 'logs' ? '100%' : 'auto',
                backgroundColor: msg.sender === 'user' ? 'rgba(180, 100, 50, 0.06)' : 'transparent',
                border: msg.sender === 'user' ? '1px solid var(--accent)' : 'none',
                borderRadius: 'var(--r-sm)',
                padding: msg.sender === 'user' ? '12px 16px' : '0',
                color: 'var(--text)',
                boxShadow: msg.sender === 'user' ? '0 0 10px rgba(180, 100, 50, 0.1)' : 'none',
              }}
            >
              {msg.type === 'prompt' || msg.type === 'answer' ? (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.08em', marginBottom: '4px', opacity: 0.8 }}>
                    [OPERATOR DIRECTIVE]
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{msg.text}</div>
                </div>
              ) : msg.type === 'ask' ? (
                <div style={{ backgroundColor: 'rgba(6, 10, 15, 0.75)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '16px' }}>
                  <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.1em', borderBottom: '1px dashed var(--border)', paddingBottom: '4px', marginBottom: '8px' }}>
                    [SYSTEM QUERY]
                  </div>
                  <Markdown content={`**Hermes asks:** "${msg.text}"`} />
                </div>
              ) : msg.type === 'logs' ? (
                <CollapsibleLogs logs={msg.logs || []} />
              ) : msg.type === 'artifacts' ? (
                <div style={{ backgroundColor: 'rgba(6, 10, 15, 0.75)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '16px' }}>
                  <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.1em', borderBottom: '1px dashed var(--border)', paddingBottom: '4px', marginBottom: '12px' }}>
                    [SYSTEM ARTIFACT GENERATION]
                  </div>
                  <p style={{ fontWeight: 'bold', marginBottom: '12px', fontSize: 'var(--t-sm)' }}>
                    📂 Hermes memproduksi artefak berikut:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {msg.artifacts?.map((a, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: 'var(--t-xs)', textTransform: 'uppercase', padding: '2px 6px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', color: 'var(--text-faint)' }}>
                            {a.kind}
                          </span>
                          <a
                            href={`/api/artifacts/download?path=${encodeURIComponent(a.path)}`}
                            target="_blank"
                            rel="noopener"
                            style={{
                              color: 'var(--accent)',
                              fontSize: 'var(--t-sm)',
                              textDecoration: 'underline',
                              fontWeight: 'bold',
                            }}
                          >
                            {a.path.split(/[/\\]/).pop()}
                          </a>
                        </div>
                        {isImage(a.path) && (
                          <div style={{ marginTop: '4px', maxWidth: '300px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                            <img
                              src={`/api/artifacts/view?path=${encodeURIComponent(a.path)}`}
                              alt={a.path}
                              style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
