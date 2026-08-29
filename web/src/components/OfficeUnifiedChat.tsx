import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Employee, OfficeSession } from '../api/types';
import { useTasksContext } from '../api/events';
import { Button } from './Button';
import { Markdown } from './Markdown';
import { findTaskIds, InlineTaskCard, ClaudeThinkingIndicator } from './TaskCard';
import { useToast } from './Toast';
import { useOfficeChatSession } from '../hooks/useOfficeChatSession';
import {
  Crosshair, Settings as SettingsIcon, Trash2, ShieldAlert,
  Mic, Volume2, VolumeX, Volume1, Square, ChevronDown, Wrench,
  Paperclip, Crown,
} from 'lucide-react';

interface OfficeUnifiedChatProps {
  employees: Employee[];
  selectedEmployeeId: string | null;
  onSelectEmployee: (emp: Employee) => void;
  onFocusEmployee?: (employeeId: string) => void;
  onStreamingChange?: (employeeId: string | null) => void;
  onClose?: () => void;
}

const STATUS_COLOR_DOT: Record<Employee['status'], string> = {
  idle: '#94a3b8',
  working: '#38bdf8',
  in_meeting: '#a855f7',
  on_break: '#f59e0b',
};

/** Session-scoped chat (streaming, TTS/voice, attachments, pending
 *  approvals) all lives in useOfficeChatSession, shared with
 *  OfficeSessionChat. This component only owns the roster sidebar and
 *  per-employee session lookup/creation — the one part that legitimately
 *  differs: it swaps to a different session whenever the selected employee
 *  changes, creating one on first contact rather than opening a fixed,
 *  already-existing session by id. */
export function OfficeUnifiedChat({
  employees,
  selectedEmployeeId,
  onSelectEmployee,
  onFocusEmployee,
  onStreamingChange,
  onClose,
}: OfficeUnifiedChatProps) {
  const { toast } = useToast();
  const { tasks } = useTasksContext();

  const activeEmployee = employees.find((e) => e.employee_id === selectedEmployeeId) || employees[0] || null;
  const activeEmployeeId = activeEmployee?.employee_id || '';
  const employeeName = activeEmployee?.name || 'Employee';

  const [session, setSession] = useState<OfficeSession | null>(null);
  const [confirmingMap, setConfirmingMap] = useState<Record<string, boolean>>({});
  const [toolsOpen, setToolsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesAreaRef = useRef<HTMLDivElement | null>(null);

  // Load (or create, if the employee has none yet) the session to chat in
  // whenever the selected employee changes.
  const loadEmployeeSession = useCallback(async (empId: string) => {
    if (!empId) return;
    try {
      const existing = await api.getOfficeSessions(empId);
      const sess = existing.length > 0 ? existing[0] : await api.createOfficeSession({ employee_id: empId });
      setSession(sess);
    } catch (err) {
      toast(errorMessage(err, 'Failed to load agent chat'), 'err');
    }
  }, [toast]);

  const prevEmployeeIdRef = useRef<string>('');
  useEffect(() => {
    if (activeEmployeeId && activeEmployeeId !== prevEmployeeIdRef.current) {
      prevEmployeeIdRef.current = activeEmployeeId;
      void loadEmployeeSession(activeEmployeeId);
    }
  }, [activeEmployeeId, loadEmployeeSession]);

  // Fallback for sendTurn firing before loadEmployeeSession's fetch/create
  // above has resolved — same lazy-create the session lookup does, just
  // inline so a fast first message never has to wait on a render cycle.
  const ensureSession = useCallback(async (): Promise<OfficeSession | null> => {
    if (session) return session;
    if (!activeEmployee) return null;
    const created = await api.createOfficeSession({ employee_id: activeEmployee.employee_id });
    setSession(created);
    return created;
  }, [session, activeEmployee]);

  const {
    messages, setMessages, waitingOnTask,
    inputText, setInputText, handleSend, handleStop, sendTurn,
    streaming, streamContent,
    pending, resolving, resolvePending,
    handleConfirmTask,
    attached, addFiles, removeAttached, fileInputRef,
    ttsEnabled, setTtsEnabled, speaking, shutUp,
    micState, pushToTalkStart, pushToTalkStop,
    projects, engineModels,
  } = useOfficeChatSession({
    session, employeeName, onStreamingChange, employeeId: activeEmployee?.employee_id ?? null,
    ensureSession, eagerLoadCatalog: true,
  });

  useEffect(() => {
    if (messagesAreaRef.current) {
      messagesAreaRef.current.scrollTop = messagesAreaRef.current.scrollHeight;
    }
  }, [messages, streamContent, streaming]);

  const handleConfirmTaskWrapped = async (tid: string, approved: boolean) => {
    setConfirmingMap((prev) => ({ ...prev, [tid]: true }));
    try {
      await handleConfirmTask(tid, approved);
    } finally {
      setConfirmingMap((prev) => ({ ...prev, [tid]: false }));
    }
  };

  const handleCreateNewSession = async () => {
    if (!activeEmployee) return;
    try {
      const newSess = await api.createOfficeSession({ employee_id: activeEmployee.employee_id });
      setSession(newSess);
      setMessages([]);
      toast(`Started new session with ${activeEmployee.name}`, 'ok');
    } catch (err) {
      toast(errorMessage(err, 'Failed to create new session'), 'err');
    }
  };

  const handleDeleteSession = async () => {
    if (!session || !activeEmployee) return;
    try {
      await api.deleteOfficeSession(session.session_id);
      toast('Session deleted', 'ok');
      await loadEmployeeSession(activeEmployee.employee_id);
    } catch (err) {
      toast(errorMessage(err, 'Failed to delete session'), 'err');
    }
  };

  const handleUpdateModel = async (model: string) => {
    if (!session) return;
    setSavingSettings(true);
    try {
      const updated = await api.updateOfficeSession(session.session_id, { model });
      setSession(updated);
      toast(`Model set to ${model || 'default'}`, 'ok');
    } catch (err) {
      toast(errorMessage(err, 'Failed to update model'), 'err');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleUpdateProject = async (project: string) => {
    if (!session) return;
    setSavingSettings(true);
    try {
      const updated = await api.updateOfficeSession(session.session_id, { project });
      setSession(updated);
    } catch (err) {
      toast(errorMessage(err, 'Failed to update project'), 'err');
    } finally {
      setSavingSettings(false);
    }
  };

  // Available models list — sourced entirely from the configured engines,
  // no hardcoded defaults (those go stale the moment a provider's lineup changes).
  const availableModels = [
    ...(engineModels?.claude || []).map((m) => ({ label: `Claude (${m})`, value: m })),
    ...(engineModels?.agy || []).map((m) => ({ label: `Antigravity (${m})`, value: m })),
  ];

  const currentModel = session?.model || availableModels[0]?.value || '';

  return (
    <div className="office-unified-chat-card">
      {/* ── LEFT COLUMN: AGENTS LIST ── */}
      <div className="office-chat-agents-sidebar">
        <div className="office-agents-header">
          <span className="agents-title">AGENTS</span>
          <span className="agents-count-badge">{employees.length}</span>
        </div>
        <div className="office-agents-list">
          {employees.map((emp) => {
            const isSelected = activeEmployee?.employee_id === emp.employee_id;
            return (
              <button
                key={emp.employee_id}
                type="button"
                className={`office-agent-list-item ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  onSelectEmployee(emp);
                }}
                title={`${emp.name} (${emp.status.replace('_', ' ')})`}
              >
                <span
                  className="office-agent-status-dot"
                  style={{ backgroundColor: STATUS_COLOR_DOT[emp.status] || '#94a3b8' }}
                />
                <span className="office-agent-name">{emp.name}</span>
                {emp.is_lead && (
                  <Crown size={11} style={{ color: '#f59e0b', marginLeft: 'auto', flexShrink: 0 }} />
                )}
              </button>
            );
          })}
          {employees.length === 0 && (
            <div style={{ padding: '12px', fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic' }}>
              No agents hired yet.
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT COLUMN: ACTIVE CHAT PANE ── */}
      <div className="office-chat-main-pane">
        {/* Header */}
        <div className="office-chat-header">
          <div className="agent-profile-group">
            <div className="agent-avatar-circle">
              {activeEmployee?.avatar ? (
                <span style={{ fontSize: '24px' }}>{activeEmployee.avatar}</span>
              ) : (
                <span style={{ fontSize: '24px' }}>🧑‍💻</span>
              )}
            </div>
            <div className="agent-info-meta">
              <div className="agent-display-name">
                {employeeName}
                {activeEmployee?.is_lead && (
                  <span className="lead-tag" title="Team Lead">Lead</span>
                )}
              </div>
              <div className="agent-sub-role">
                {activeEmployee?.role || 'AI Employee'}
                {session?.project ? ` · @${session.project}` : ''}
              </div>
            </div>
          </div>

          <div className="chat-header-actions">
            <button
              type="button"
              className="btn-new-session-cyan"
              onClick={handleCreateNewSession}
              title="Start a fresh chat session"
            >
              New session
            </button>

            {onFocusEmployee && activeEmployee && (
              <button
                type="button"
                className="header-icon-action-btn"
                onClick={() => onFocusEmployee(activeEmployee.employee_id)}
                title={`Focus 3D camera on ${employeeName}`}
              >
                <Crosshair size={15} />
              </button>
            )}

            <button
              type="button"
              className={`header-icon-action-btn ${toolsOpen ? 'active' : ''}`}
              onClick={() => setToolsOpen(!toolsOpen)}
              title="Project & Tool settings"
            >
              <SettingsIcon size={14} />
            </button>

            <button
              type="button"
              className="header-icon-action-btn"
              onClick={handleDeleteSession}
              title="Delete session"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Collapsible Tools / Session Settings */}
        {toolsOpen && (
          <div className="office-tools-drawer">
            <div style={{ flex: '1 1 180px' }}>
              <label className="tools-field-label">BOUND PROJECT</label>
              <select
                className="field-select"
                value={session?.project || ''}
                onChange={(e) => handleUpdateProject(e.target.value)}
                disabled={savingSettings}
                style={{ width: '100%', fontSize: '11px', padding: '4px 8px' }}
              >
                <option value="">(none — casual chat)</option>
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label className="tools-field-label">AGENT MODEL</label>
              <select
                className="field-select"
                value={session?.model || ''}
                onChange={(e) => handleUpdateModel(e.target.value)}
                disabled={savingSettings}
                style={{ width: '100%', fontSize: '11px', padding: '4px 8px' }}
              >
                <option value="">(employee default)</option>
                {availableModels.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Pending approvals */}
        {pending.map((p) => (
          <div key={p.id} className="pending-approval-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600 }}>
              <ShieldAlert size={14} color="#f59e0b" />
              Approval required: {p.summary}
            </div>
            {p.risk_note && (
              <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{p.risk_note}</div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <Button variant="primary" size="small" disabled={resolving} onClick={() => resolvePending(p.id, true)}>Approve</Button>
              <Button variant="secondary" size="small" disabled={resolving} onClick={() => resolvePending(p.id, false)}>Reject</Button>
            </div>
          </div>
        ))}

        {/* Chat Feed */}
        <div ref={messagesAreaRef} className="office-chat-messages-area">
          {messages.length === 0 && !streaming ? (
            <div className="office-chat-welcome-bubble">
              <div className="welcome-author-row">
                <span className="welcome-avatar-mini">{activeEmployee?.avatar || '🧑‍💻'}</span>
                <span className="welcome-author-name">{employeeName}</span>
              </div>
              <div className="welcome-message-card">
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc', marginBottom: '4px' }}>
                  Ready when you are. What do you want to tackle?
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-dim)' }}>
                  Try describing a task, bug, or question to get started.
                </div>
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`chat-message-row ${m.role}`}>
                <div className="chat-author-line">
                  <span>{m.role === 'user' ? 'YOU' : employeeName.toUpperCase()}</span>
                </div>
                <div className={`chat-bubble ${m.role}`}>
                  {m.role === 'user' ? (
                    <div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                      {m.images && m.images.length > 0 && (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {m.images.map((src) => (
                            <img key={src} src={src} alt="attachment"
                              style={{ width: '70px', height: '70px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)' }} />
                          ))}
                        </div>
                      )}
                      {m.docNames && m.docNames.length > 0 && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {m.docNames.map((n) => (
                            <span key={n} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                              📄 {n}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <Markdown content={m.content} />
                      {findTaskIds(m.content).map((tid) => (
                        <InlineTaskCard
                          key={tid}
                          taskId={tid}
                          tasks={tasks}
                          confirming={!!confirmingMap[tid]}
                          onConfirm={(approved) => handleConfirmTaskWrapped(tid, approved)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {streaming && (
            <div className="chat-message-row assistant">
              <div className="chat-author-line">
                <span>{employeeName.toUpperCase()}</span>
                <span style={{ color: '#38bdf8', fontSize: '10px' }}>(replying...)</span>
              </div>
              <div className="chat-bubble assistant">
                {streamContent ? (
                  <div>
                    <Markdown content={streamContent} />
                    {findTaskIds(streamContent).map((tid) => (
                      <InlineTaskCard
                        key={tid}
                        taskId={tid}
                        tasks={tasks}
                        confirming={!!confirmingMap[tid]}
                        onConfirm={(approved) => handleConfirmTaskWrapped(tid, approved)}
                      />
                    ))}
                  </div>
                ) : (
                  <ClaudeThinkingIndicator />
                )}
              </div>
            </div>
          )}

          {waitingOnTask && (
            <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic', padding: '6px 12px' }}>
              Working on it in the background…
            </div>
          )}
        </div>

        {/* Attached files preview */}
        {attached.length > 0 && (
          <div className="attached-files-bar">
            {attached.map((a, idx) => (
              <div key={a.url} style={{ position: 'relative' }}>
                {a.kind === 'image' ? (
                  <img src={a.url} alt={a.file.name} style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border)' }} />
                ) : (
                  <div title={a.file.name} style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid var(--border)', background: '#1e293b' }}>
                    <span style={{ fontSize: '14px' }}>📄</span>
                  </div>
                )}
                <button type="button" onClick={() => removeAttached(idx)} title="Remove"
                  style={{ position: 'absolute', top: '-4px', right: '-4px', width: '14px', height: '14px', borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', lineHeight: 1, fontSize: '9px', cursor: 'pointer' }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input Bar */}
        <form onSubmit={handleSend} className="office-chat-input-container">
          <textarea
            ref={textareaRef}
            rows={1}
            className="office-chat-textarea"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onPaste={(e) => addFiles(e.clipboardData.files)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={session?.project ? `Continue work on @${session.project}…` : 'What are you doing?'}
            disabled={streaming || waitingOnTask}
          />

          <div className="office-chat-input-controls">
            <div className="controls-left">
              {/* Model selector dropdown */}
              <div className="model-select-wrapper">
                <select
                  className="model-select-dropdown"
                  value={currentModel}
                  onChange={(e) => handleUpdateModel(e.target.value)}
                  disabled={streaming}
                >
                  {availableModels.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="model-select-arrow" />
              </div>

              {/* Show Tools toggle */}
              <button
                type="button"
                className={`btn-control-toggle ${toolsOpen ? 'active' : ''}`}
                onClick={() => setToolsOpen(!toolsOpen)}
                title="Show Tools / Settings"
              >
                <Wrench size={11} />
                <span>Tools</span>
              </button>

              {/* Attachments */}
              <button
                type="button"
                className="btn-control-icon"
                disabled={streaming}
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={13} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
              />

              {/* Voice mic */}
              <button
                type="button"
                className={`btn-control-icon ${micState === 'recording' ? 'active-rec' : ''}`}
                disabled={streaming || micState === 'working'}
                title={micState === 'recording' ? 'Recording...' : 'Push to talk'}
                onClick={() => (micState === 'recording' ? pushToTalkStop() : pushToTalkStart())}
              >
                <Mic size={13} />
              </button>

              {/* TTS Speaker */}
              <button
                type="button"
                className={`btn-control-icon ${speaking ? 'active-speaking' : ''}`}
                title={speaking ? 'Stop voice' : ttsEnabled ? 'Voice on' : 'Voice off'}
                onClick={speaking ? shutUp : () => setTtsEnabled(!ttsEnabled)}
              >
                {speaking ? <VolumeX size={13} /> : ttsEnabled ? <Volume2 size={13} /> : <Volume1 size={13} />}
              </button>
            </div>

            <div className="controls-right">
              {streaming ? (
                <button type="button" className="btn-send-cyan stop" onClick={handleStop} title="Stop">
                  <Square size={11} fill="currentColor" /> Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn-send-cyan"
                  disabled={(!inputText.trim() && attached.length === 0) || waitingOnTask}
                  title="Send message (Enter)"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
