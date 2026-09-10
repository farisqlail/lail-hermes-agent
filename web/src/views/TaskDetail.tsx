import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useRoute } from '../router';
import { useTask } from '../hooks/useTask';
import { parseLogsToMessages, TimelineMessage } from '../api/parser';
import { Markdown } from '../components/Markdown';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { ClaudeThinkingIndicator } from '../components/TaskCard';
import { TraceTimeline } from '../components/TraceTimeline';
import { planTodos, sessionInfo, traceTotals, editedFiles, formatTokens } from '../api/trace';
import {
  ArrowLeft,
  Copy,
  Check,
  ExternalLink,
  Clock,
  Folder,
  Cpu,
  Terminal,
  FileText,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Activity,
  Download,
  RefreshCw,
  Sparkles,
  Layers,
  ListTodo,
  Eye,
  Search,
  WrapText,
  FileCode,
  Image as ImageIcon,
  File as FileIcon,
  X,
  ShieldAlert,
  MessageSquare,
  Hash,
  Database,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useTasksContext } from '../api/events';

type DetailTab = 'timeline' | 'logs' | 'artifacts' | 'messages';

export function TaskDetail() {
  const { taskId, navigate } = useRoute();
  const { task: taskData, loading, error, refresh } = useTask(taskId);
  const { refresh: refreshGlobalTasks, activity, trace, watchTrace } = useTasksContext();
  const { toast } = useToast();

  // Watch trace for live streaming events
  useEffect(() => {
    if (!taskId) return;
    watchTrace(taskId);
    return () => watchTrace(null);
  }, [taskId, watchTrace]);

  // Tab & UI state
  const [activeTab, setActiveTab] = useState<DetailTab>('timeline');
  const [logFilter, setLogFilter] = useState('');
  const [wrapLogs, setWrapLogs] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Actions state
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [selectedAskOptions, setSelectedAskOptions] = useState<number[]>([]);
  const [askText, setAskText] = useState('');

  const terminalScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll effect
  useEffect(() => {
    if (!autoScroll) return;
    if (activeTab === 'logs' && terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    } else if (activeTab === 'timeline' && timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = timelineScrollRef.current.scrollHeight;
    }
  }, [taskData, trace, activeTab, autoScroll]);

  const logs = taskData?.logs || [];
  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs;
    const q = logFilter.toLowerCase();
    return logs.filter((l) => l.toLowerCase().includes(q));
  }, [logs, logFilter]);

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    const task = taskData?.task;
    if (task?.origin === 'office') return navigate('#/office');
    navigate(task?.session_id ? `#/session/${task.session_id}` : '#/');
  };

  const copyToClipboard = async (text: string, type: 'id' | 'logs' | 'prompt') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'id') {
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
        toast('Task ID copied to clipboard', 'ok');
      } else if (type === 'logs') {
        setCopiedLogs(true);
        setTimeout(() => setCopiedLogs(false), 2000);
        toast('All logs copied to clipboard', 'ok');
      } else if (type === 'prompt') {
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
        toast('Prompt directive copied to clipboard', 'ok');
      }
    } catch {
      toast('Failed to copy to clipboard', 'err');
    }
  };

  if (loading && !taskData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '14px', color: 'var(--text-dim)' }}>
        <RefreshCw size={24} className="spin" style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 'var(--t-sm)' }}>Loading task details for {taskId}...</span>
      </div>
    );
  }

  if (error || !taskData) {
    return (
      <div style={{ padding: '24px', backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid var(--err)', borderRadius: 'var(--r-md)', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '600px', margin: '40px auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
          <AlertTriangle size={18} />
          <span>Failed to Load Task Details</span>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--t-sm)', color: 'var(--text-dim)' }}>{error || 'Task not found or has been deleted.'}</p>
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          <Button variant="danger" type="button" onClick={refresh}>Try Again</Button>
          <Button variant="secondary" type="button" onClick={goBack}>Back</Button>
        </div>
      </div>
    );
  }

  const { task, artifacts = [], steps = [], pending_confirm, pending_ask } = taskData;
  const { engine, project } = sessionInfo(logs);
  const timeline = parseLogsToMessages(task, logs, artifacts);
  const todos = planTodos(steps);
  const completedTodos = todos.filter((t) => t.status === 'done').length;
  const totals = traceTotals(trace);
  const filesEdited = editedFiles(trace);

  const formattedDate = task.created
    ? new Date(task.created * 1000).toLocaleString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '-';

  const isImageFile = (path: string) => {
    const p = path.toLowerCase();
    return p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.webp') || p.endsWith('.gif');
  };

  const getFileIconComponent = (path: string) => {
    const p = path.toLowerCase();
    if (isImageFile(p)) return <ImageIcon size={18} style={{ color: '#ec4899' }} />;
    if (p.endsWith('.py') || p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.json')) {
      return <FileCode size={18} style={{ color: '#38bdf8' }} />;
    }
    if (p.endsWith('.md') || p.endsWith('.txt') || p.endsWith('.log')) {
      return <FileText size={18} style={{ color: '#fbbf24' }} />;
    }
    return <FileIcon size={18} style={{ color: 'var(--text-dim)' }} />;
  };

  const getLogLineStyle = (line: string) => {
    const l = line.toLowerCase();
    if (l.includes('error') || l.includes('fail') || l.startsWith('error:') || l.includes('exception') || l.includes('traceback')) {
      return { color: 'var(--err)', fontWeight: 500 };
    }
    if (l.includes('warn') || l.includes('warning:')) {
      return { color: 'var(--warn)' };
    }
    if (line.startsWith('[') || line.startsWith('engine:') || line.startsWith('project:')) {
      return { color: '#38bdf8' };
    }
    if (l.includes('success') || l.includes('ok') || l.includes('completed') || l.startsWith('done:')) {
      return { color: 'var(--ok)' };
    }
    return { color: '#d1d5db' };
  };

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
        toast(approved ? 'Task approved and resumed!' : 'Task cancelled.', 'ok');
        refresh();
        refreshGlobalTasks();
      } else {
        toast('Failed to send confirmation.', 'err');
      }
    } catch (err) {
      toast('A network error occurred.', 'err');
    } finally {
      setConfirming(false);
    }
  };

  const handleCancelTask = async () => {
    if (!taskId) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        toast('Task stopped/cancelled.', 'ok');
        refresh();
        refreshGlobalTasks();
      } else {
        toast('Failed to cancel task.', 'err');
      }
    } catch {
      toast('A network error occurred.', 'err');
    } finally {
      setCancelling(false);
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
        toast('Response submitted successfully.', 'ok');
        setSelectedAskOptions([]);
        setAskText('');
        refresh();
        refreshGlobalTasks();
      } else {
        toast('Failed to submit response.', 'err');
      }
    } catch (err) {
      toast('A network error occurred.', 'err');
    } finally {
      setAnswering(false);
    }
  };

  return (
    <div className="task-detail-wrapper">
      {/* 1. Top Navigation & Quick Actions Bar */}
      <div className="task-nav-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flexWrap: 'wrap' }}>
          <button type="button" onClick={goBack} className="task-back-btn">
            <ArrowLeft size={13} />
            <span>
              {task.origin === 'office'
                ? 'Back to Office'
                : task.session_id
                ? 'Back to Session'
                : 'Back'}
            </span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--t-xs)', color: 'var(--text-faint)' }}>
            <span>/</span>
            <span style={{ color: 'var(--text-dim)' }}>Tasks</span>
            <span>/</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>
              {task.task_id}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="task-action-btn"
            onClick={() => copyToClipboard(task.task_id, 'id')}
            title="Copy Task ID"
          >
            {copiedId ? <Check size={13} style={{ color: 'var(--ok)' }} /> : <Copy size={13} />}
            <span>{copiedId ? 'Copied' : 'Copy ID'}</span>
          </button>

          {task.session_id && (
            <button
              type="button"
              className="task-action-btn"
              onClick={() => navigate(`#/session/${task.session_id}`)}
              title="Open Associated Chat Session"
            >
              <ExternalLink size={13} />
              <span>Open Chat Session</span>
            </button>
          )}

          <button
            type="button"
            className="task-action-btn"
            onClick={refresh}
            title="Refresh Task Data"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>

          {(task.status === 'running' || task.status === 'queued' || task.status === 'awaiting_confirm') && (
            <button
              type="button"
              className="task-action-btn"
              onClick={handleCancelTask}
              disabled={cancelling}
              style={{ color: 'var(--err)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
              title="Stop / Cancel Task"
            >
              <XCircle size={13} style={{ color: 'var(--err)' }} />
              <span>{cancelling ? 'Stopping...' : 'Stop Task'}</span>
            </button>
          )}

          {/* Status Badge */}
          <span
            className={`task-status-badge ${
              task.status === 'done'
                ? 'task-status-done'
                : task.status === 'running'
                ? 'task-status-running'
                : task.status === 'failed'
                ? 'task-status-failed'
                : task.status === 'cancelled'
                ? 'task-status-cancelled'
                : 'task-status-queued'
            }`}
          >
            {task.status === 'running' && <span className="pulsing-dot" />}
            {task.status === 'done' && <CheckCircle2 size={12} />}
            {task.status === 'failed' && <AlertTriangle size={12} />}
            {task.status === 'cancelled' && <XCircle size={12} />}
            {task.status === 'queued' && <Clock size={12} />}
            <span>{task.status.toUpperCase()}</span>
          </span>
        </div>
      </div>

      {/* 2. Hero Header Card */}
      <div className="task-hero-card">
        {/* Prompt Directive Header */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              <Terminal size={12} />
              <span>Operator Directive</span>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(task.text, 'prompt')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--t-xs)', color: 'var(--text-faint)', cursor: 'pointer' }}
              title="Copy Prompt"
            >
              {copiedPrompt ? <Check size={12} style={{ color: 'var(--ok)' }} /> : <Copy size={12} />}
              <span>{copiedPrompt ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <div style={{ fontSize: '15px', color: 'var(--text)', fontWeight: 500, lineHeight: 1.5, wordBreak: 'break-word' }}>
            {task.text}
          </div>
        </div>

        {/* Meta Info Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          {engine && (
            <span className="task-meta-pill">
              <Cpu size={12} style={{ color: 'var(--accent)' }} />
              <span>Engine: <code>{engine}</code></span>
            </span>
          )}

          {project && (
            <span className="task-meta-pill" title={project}>
              <Folder size={12} style={{ color: '#fbbf24' }} />
              <span>Project: <code>{project.split(/[/\\]/).pop() || project}</code></span>
            </span>
          )}

          <span className="task-meta-pill">
            <Layers size={12} style={{ color: '#a78bfa' }} />
            <span>Origin: <code>{task.origin || 'Chat'}</code></span>
          </span>

          <span className="task-meta-pill">
            <Clock size={12} style={{ color: 'var(--text-faint)' }} />
            <span>Created: {formattedDate}</span>
          </span>

          {todos.length > 0 && (
            <span className="task-meta-pill">
              <ListTodo size={12} style={{ color: 'var(--ok)' }} />
              <span>Steps: <code>{completedTodos}/{todos.length} completed</code></span>
            </span>
          )}
        </div>

        {/* Live Thinking Indicator when running */}
        {(task.status === 'running' || task.status === 'queued') && (
          <div style={{ marginTop: '2px', padding: '10px 14px', backgroundColor: 'rgba(59, 130, 246, 0.05)', borderRadius: 'var(--r-sm)', border: '1px solid rgba(59, 130, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <ClaudeThinkingIndicator since={task.created} activity={activity[task.task_id]} />
            </div>
            <Button
              variant="danger"
              size="small"
              onClick={handleCancelTask}
              loading={cancelling}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '4px 10px' }}
            >
              <XCircle size={13} />
              <span>Stop Task</span>
            </Button>
          </div>
        )}
      </div>

      {/* 3. Pending Confirmation Widget */}
      {pending_confirm && pending_confirm.length > 0 && (
        <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)', border: '1px solid var(--warn)', borderRadius: 'var(--r-md)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 0 15px rgba(245, 158, 11, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warn)', fontWeight: 600, fontSize: '14px' }}>
            <ShieldAlert size={18} />
            <span>High-Risk Action Authorization Required</span>
          </div>
          <p style={{ margin: 0, fontSize: 'var(--t-sm)', color: 'var(--text-dim)', lineHeight: 1.5 }}>
            This task requires your direct authorization because it will execute sensitive operations on the system:
          </p>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: 'var(--t-sm)', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {pending_confirm.map((reason, idx) => (
              <li key={idx} style={{ fontFamily: 'var(--font-mono)' }}>{reason}</li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <Button variant="primary" onClick={() => handleConfirm(true)} loading={confirming} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle size={14} />
              <span>Authorize & Continue</span>
            </Button>
            <Button variant="danger" onClick={() => handleConfirm(false)} loading={confirming} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <XCircle size={14} />
              <span>Reject & Cancel</span>
            </Button>
          </div>
        </div>
      )}

      {/* 4. Pending Ask Widget */}
      {pending_ask && (
        <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.08)', border: '1px solid var(--accent)', borderRadius: 'var(--r-md)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 0 15px rgba(59, 130, 246, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)', fontWeight: 600, fontSize: '14px' }}>
            <HelpCircle size={18} />
            <span>Runner Clarification Required</span>
          </div>
          <p style={{ margin: 0, fontSize: 'var(--t-sm)', color: 'var(--text)', lineHeight: 1.5 }}>
            {pending_ask.question}
          </p>

          {pending_ask.options && pending_ask.options.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {pending_ask.options.map((opt, idx) => {
                  const label = typeof opt === 'string' ? opt : opt.label || '';
                  const isSelected = selectedAskOptions.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleToggleAskOption(idx, pending_ask.multi)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 'var(--r-sm)',
                        backgroundColor: isSelected ? 'var(--accent)' : 'var(--surface-2)',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        color: isSelected ? '#fff' : 'var(--text-dim)',
                        fontWeight: 600,
                        fontSize: 'var(--t-xs)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                      }}
                      disabled={answering}
                    >
                      {isSelected && <Check size={12} />}
                      <span>{label}</span>
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
                  style={{ alignSelf: 'flex-start' }}
                >
                  Submit Selection ({selectedAskOptions.length})
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
                placeholder="Type your response or clarification..."
                required
                disabled={answering}
                style={{ flex: 1 }}
              />
              <Button variant="primary" type="submit" loading={answering}>
                Submit
              </Button>
            </form>
          )}
        </div>
      )}

      {/* 5. Main 2-Column Responsive Workspace Grid */}
      <div className="task-workspace-grid">
        {/* Left Column: Tabbed Activity & Console */}
        <div className="task-main-pane">
          {/* Tab Switcher */}
          <div className="task-tabs-header">
            <button
              type="button"
              className={`task-tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('timeline')}
            >
              <Activity size={14} />
              <span>Timeline & Trace</span>
              {trace.length > 0 && <span className="task-tab-badge">{trace.length}</span>}
            </button>

            <button
              type="button"
              className={`task-tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <Terminal size={14} />
              <span>Terminal Logs</span>
              <span className="task-tab-badge">{logs.length}</span>
            </button>

            <button
              type="button"
              className={`task-tab-btn ${activeTab === 'artifacts' ? 'active' : ''}`}
              onClick={() => setActiveTab('artifacts')}
            >
              <Folder size={14} />
              <span>Artifacts & Files</span>
              {artifacts.length > 0 && <span className="task-tab-badge">{artifacts.length}</span>}
            </button>

            <button
              type="button"
              className={`task-tab-btn ${activeTab === 'messages' ? 'active' : ''}`}
              onClick={() => setActiveTab('messages')}
            >
              <MessageSquare size={14} />
              <span>Conversation</span>
              <span className="task-tab-badge">{timeline.length}</span>
            </button>
          </div>

          {/* Tab Content Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* TAB 1: Timeline & Trace */}
            {activeTab === 'timeline' && (
              <div
                ref={timelineScrollRef}
                style={{
                  backgroundColor: '#05070a',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '16px',
                  overflowY: 'auto',
                  flex: 1,
                  minHeight: '400px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {trace.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: 'auto', gap: '10px', color: 'var(--text-faint)', padding: '40px 0' }}>
                    <Activity size={28} style={{ opacity: 0.4 }} />
                    <span style={{ fontSize: 'var(--t-sm)', fontFamily: 'var(--font-mono)' }}>
                      No trace events streamed yet for this task.
                    </span>
                    <Button variant="secondary" onClick={() => setActiveTab('logs')} style={{ fontSize: 'var(--t-xs)' }}>
                      View Terminal Logs ({logs.length} lines)
                    </Button>
                  </div>
                ) : (
                  <TraceTimeline events={trace} />
                )}
              </div>
            )}

            {/* TAB 2: Supercharged Terminal Log Viewer */}
            {activeTab === 'logs' && (
              <div className="task-terminal-box">
                {/* Terminal Toolbar */}
                <div className="task-terminal-toolbar">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
                    <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
                      <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
                      <input
                        type="text"
                        value={logFilter}
                        onChange={(e) => setLogFilter(e.target.value)}
                        placeholder="Filter logs (keyword)..."
                        style={{
                          width: '100%',
                          padding: '5px 10px 5px 28px',
                          borderRadius: 'var(--r-sm)',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                          outline: 'none',
                        }}
                      />
                      {logFilter && (
                        <button
                          type="button"
                          onClick={() => setLogFilter('')}
                          style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', cursor: 'pointer' }}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    <span style={{ fontSize: '11px', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                      {filteredLogs.length} / {logs.length} lines
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={() => setWrapLogs(!wrapLogs)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 8px',
                        borderRadius: 'var(--r-sm)',
                        backgroundColor: wrapLogs ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                        border: `1px solid ${wrapLogs ? 'var(--accent)' : 'var(--border)'}`,
                        color: wrapLogs ? 'var(--accent)' : 'var(--text-dim)',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                      title="Toggle Word Wrap"
                    >
                      <WrapText size={12} />
                      <span>Wrap</span>
                    </button>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-faint)', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={autoScroll}
                        onChange={(e) => setAutoScroll(e.target.checked)}
                        style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                      />
                      <span>Auto-scroll</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => copyToClipboard(logs.join('\n'), 'logs')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 8px',
                        borderRadius: 'var(--r-sm)',
                        backgroundColor: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-dim)',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedLogs ? <Check size={12} style={{ color: 'var(--ok)' }} /> : <Copy size={12} />}
                      <span>{copiedLogs ? 'Copied' : 'Copy All'}</span>
                    </button>
                  </div>
                </div>

                {/* Terminal Lines Console */}
                <div ref={terminalScrollRef} className="task-terminal-lines">
                  {filteredLogs.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '30px', fontStyle: 'italic' }}>
                      {logFilter ? 'No log lines match the active filter.' : 'No logs recorded yet.'}
                    </div>
                  ) : (
                    filteredLogs.map((line, idx) => (
                      <div key={idx} className="task-terminal-row">
                        <span className="task-terminal-lineno">{idx + 1}</span>
                        <span className={`task-terminal-text ${wrapLogs ? '' : 'nowrap'}`} style={getLogLineStyle(line)}>
                          {line}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: Artifacts & Generated Files */}
            {activeTab === 'artifacts' && (
              <div style={{ flex: 1, overflowY: 'auto', minHeight: '380px' }}>
                {artifacts.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', backgroundColor: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-faint)', gap: '10px' }}>
                    <Folder size={32} style={{ opacity: 0.3 }} />
                    <span style={{ fontSize: 'var(--t-sm)' }}>This task did not produce any standalone artifact files.</span>
                  </div>
                ) : (
                  <div className="task-artifacts-grid">
                    {artifacts.map((a, i) => {
                      const filename = a.path.split(/[/\\]/).pop() || a.path;
                      const isImg = isImageFile(a.path);
                      return (
                        <div key={i} className="task-artifact-card">
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                              {getFileIconComponent(a.path)}
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={filename}>
                                  {filename}
                                </div>
                                <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
                                  {a.kind}
                                </span>
                              </div>
                            </div>

                            <a
                              href={`/api/artifacts/download?path=${encodeURIComponent(a.path)}`}
                              download
                              className="task-action-btn"
                              style={{ padding: '4px 8px', fontSize: '11px', flexShrink: 0 }}
                              title="Download File"
                            >
                              <Download size={12} />
                              <span>Download</span>
                            </a>
                          </div>

                          {/* Image preview thumbnail if applicable */}
                          {isImg && (
                            <div
                              onClick={() => setLightboxImage(`/api/artifacts/view?path=${encodeURIComponent(a.path)}`)}
                              style={{
                                width: '100%',
                                height: '140px',
                                borderRadius: 'var(--r-sm)',
                                overflow: 'hidden',
                                border: '1px solid var(--border)',
                                cursor: 'zoom-in',
                                position: 'relative',
                                backgroundColor: '#000',
                              }}
                            >
                              <img
                                src={`/api/artifacts/view?path=${encodeURIComponent(a.path)}`}
                                alt={filename}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                              <div style={{ position: 'absolute', bottom: '6px', right: '6px', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 'var(--r-xs)', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#fff' }}>
                                <Eye size={10} />
                                <span>View</span>
                              </div>
                            </div>
                          )}

                          <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.path}>
                            {a.path}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: Conversation & Directives Flow */}
            {activeTab === 'messages' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  backgroundColor: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '18px',
                  overflowY: 'auto',
                  flex: 1,
                  minHeight: '400px',
                }}
              >
                {timeline.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: msg.type === 'logs' ? '100%' : '85%',
                      width: msg.type === 'logs' ? '100%' : 'auto',
                      backgroundColor:
                        msg.sender === 'user'
                          ? 'rgba(59, 130, 246, 0.08)'
                          : 'var(--surface-2)',
                      border: `1px solid ${
                        msg.sender === 'user' ? 'rgba(59, 130, 246, 0.3)' : 'var(--border)'
                      }`,
                      borderRadius: 'var(--r-md)',
                      padding: '12px 16px',
                      color: 'var(--text)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontFamily: 'var(--font-mono)', color: msg.sender === 'user' ? 'var(--accent)' : 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>
                      {msg.sender === 'user' ? <Terminal size={11} /> : <Sparkles size={11} />}
                      <span>{msg.sender === 'user' ? 'Operator' : 'Hermes Assistant'}</span>
                      {msg.type && <span>· [{msg.type}]</span>}
                    </div>

                    {msg.text && (
                      <div style={{ fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {msg.text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Inspector Sidebar */}
        <div className="task-side-pane">
          {/* Card 1: Execution Plan Checklist */}
          <div className="task-inspector-card">
            <div className="task-inspector-title">
              <ListTodo size={15} style={{ color: 'var(--ok)' }} />
              <span>Execution Plan ({completedTodos}/{todos.length})</span>
            </div>

            {todos.length === 0 ? (
              <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-faint)', fontStyle: 'italic' }}>
                No structured step checklist registered by planner.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Progress bar */}
                <div style={{ width: '100%', height: '6px', backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${todos.length > 0 ? (completedTodos / todos.length) * 100 : 0}%`,
                      backgroundColor: 'var(--ok)',
                      borderRadius: 'var(--r-full)',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                {/* Steps List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                  {todos.map((todo) => (
                    <div
                      key={todo.key}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        fontSize: '12px',
                        lineHeight: 1.4,
                      }}
                    >
                      <span style={{ flexShrink: 0, marginTop: '2px' }}>
                        {todo.status === 'done' && <CheckCircle2 size={13} style={{ color: 'var(--ok)' }} />}
                        {todo.status === 'active' && <RefreshCw size={13} className="spin" style={{ color: 'var(--accent)' }} />}
                        {todo.status === 'failed' && <XCircle size={13} style={{ color: 'var(--err)' }} />}
                        {todo.status === 'todo' && (
                          <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '1px solid var(--text-faint)' }} />
                        )}
                      </span>
                      <span
                        style={{
                          color: todo.status === 'done' ? 'var(--text-faint)' : 'var(--text)',
                          textDecoration: todo.status === 'done' ? 'line-through' : 'none',
                          fontWeight: todo.status === 'active' ? 600 : 400,
                          wordBreak: 'break-word',
                        }}
                      >
                        {todo.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Resource & Token Metrics */}
          <div className="task-inspector-card">
            <div className="task-inspector-title">
              <Database size={15} style={{ color: 'var(--accent)' }} />
              <span>Resource Usage & Metrics</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ padding: '8px 10px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase' }}>Tokens In</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {totals.hasUsage ? formatTokens(totals.tokensIn) : '-'}
                </div>
              </div>

              <div style={{ padding: '8px 10px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase' }}>Tokens Out</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {totals.hasUsage ? formatTokens(totals.tokensOut) : '-'}
                </div>
              </div>

              <div style={{ padding: '8px 10px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase' }}>Tool Calls</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {totals.toolCalls || 0}
                </div>
              </div>

              <div style={{ padding: '8px 10px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase' }}>Estimated Cost</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {totals.costUsd > 0 ? `$${totals.costUsd.toFixed(4)}` : '$0.00'}
                </div>
              </div>
            </div>

            {/* Edited files list */}
            {filesEdited.length > 0 && (
              <div style={{ marginTop: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '6px', fontWeight: 500 }}>
                  Modified Files ({filesEdited.length}):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                  {filesEdited.map((file) => (
                    <div
                      key={file}
                      style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#38bdf8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={file}
                    >
                      • {file}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Task Context Metadata */}
          <div className="task-inspector-card">
            <div className="task-inspector-title">
              <Hash size={15} style={{ color: '#a78bfa' }} />
              <span>Task Metadata & Context</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div>
                <span style={{ color: 'var(--text-faint)' }}>Task ID: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{task.task_id}</span>
              </div>

              {task.session_id && (
                <div>
                  <span style={{ color: 'var(--text-faint)' }}>Session ID: </span>
                  <a
                    href={`#/session/${task.session_id}`}
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', textDecoration: 'underline' }}
                  >
                    {task.session_id}
                  </a>
                </div>
              )}

              <div>
                <span style={{ color: 'var(--text-faint)' }}>Origin: </span>
                <span style={{ color: 'var(--text)' }}>{task.origin || 'Chat'}</span>
              </div>

              {project && (
                <div>
                  <span style={{ color: 'var(--text-faint)' }}>Working Directory: </span>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)', fontSize: '11px', wordBreak: 'break-all', marginTop: '2px' }}>
                    {project}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 6. Image Lightbox Modal */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              backgroundColor: 'var(--surface-1)',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)' }}>Image Artifact Preview</span>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                style={{ padding: '4px', cursor: 'pointer', color: 'var(--text-dim)' }}
              >
                <X size={16} />
              </button>
            </div>
            <img
              src={lightboxImage}
              alt="Preview"
              style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 'var(--r-xs)' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
