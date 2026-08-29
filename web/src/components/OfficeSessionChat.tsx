import React, { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Employee, OfficeSession } from '../api/types';
import { useTasksContext } from '../api/events';
import { Button } from '../components/Button';
import { Markdown } from '../components/Markdown';
import { findTaskIds, InlineTaskCard, ClaudeThinkingIndicator } from '../components/TaskCard';
import { useToast } from '../components/Toast';
import { useOfficeChatSession } from '../hooks/useOfficeChatSession';
import {
  ArrowLeft, Settings as SettingsIcon, Trash2, ShieldAlert,
  Mic, Volume2, VolumeX, Volume1, Square, Activity,
} from 'lucide-react';

interface OfficeSessionChatProps {
  sessionId: string;
  employees: Employee[];
  onBack: () => void;
  onDeleted: () => void;
  onStreamingChange?: (employeeId: string | null) => void;
}

/** A continuing task in this session (project set) can take minutes to run in
 * the background — the outcome lands as a new assistant message once the
 * real Orchestrator task finishes (see OfficeManager._run_session_task).
 * Polling here mirrors WorkOutputFeed's existing pattern rather than adding
 * a new SSE event type just for this.
 *
 * A casual (project-less) session instead streams token-by-token through
 * /api/office/sessions/{id}/stream — the same ChatEngine.stream() twin the
 * main chat pane's /api/chat/stream uses, just under the employee's persona
 * — with the same voice input (push-to-talk / handsfree), TTS output, and
 * attachment upload the main pane offers, for real input-bar parity rather
 * than a lookalike box that behaves differently underneath. Everything
 * session-scoped (streaming, TTS, attachments, pending approvals) lives in
 * useOfficeChatSession, shared with OfficeUnifiedChat — this component only
 * owns resolving `sessionId` into a session object and its own settings
 * drawer. */
export function OfficeSessionChat({ sessionId, employees, onBack, onDeleted, onStreamingChange }: OfficeSessionChatProps) {
  const { toast } = useToast();
  const { tasks } = useTasksContext();
  const [session, setSession] = useState<OfficeSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const threadRef = useRef<HTMLDivElement | null>(null);

  const employee = employees.find((e) => e.employee_id === session?.employee_id) || null;
  const employeeName = employee?.name || 'Employee';

  useEffect(() => {
    let cancelled = false;
    setSessionLoading(true);
    api.getOfficeSession(sessionId)
      .then((s) => { if (!cancelled) setSession(s); })
      .catch((err) => { if (!cancelled) toast(errorMessage(err, 'Failed to load session'), 'err'); })
      .finally(() => { if (!cancelled) setSessionLoading(false); });
    setSettingsOpen(false);
    return () => { cancelled = true; };
  }, [sessionId, toast]);

  const {
    messages, loading: messagesLoading, waitingOnTask,
    inputText, setInputText, handleSend, handleStop, sendTurn,
    streaming, streamContent,
    pending, resolving, resolvePending,
    confirmingMap, handleConfirmTask,
    attached, addFiles, removeAttached, fileInputRef,
    ttsEnabled, setTtsEnabled, speaking, shutUp,
    micState, pushToTalkStart, pushToTalkStop,
    projects, engineModels, loadCatalog,
  } = useOfficeChatSession({
    session, employeeName, onStreamingChange, employeeId: employee?.employee_id ?? null,
  });

  const loading = sessionLoading || messagesLoading;

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, streamContent, streaming]);

  const openSettings = () => {
    setSettingsOpen((v) => !v);
    if (!projects.length || !engineModels) loadCatalog();
  };

  const saveSettings = async (fields: { title?: string; project?: string; model?: string; engine?: string }) => {
    if (!session) return;
    setSavingSettings(true);
    try {
      const updated = await api.updateOfficeSession(session.session_id, fields);
      setSession(updated);
    } catch (err) {
      toast(errorMessage(err, 'Failed to update session'), 'err');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteSession = async () => {
    try {
      await api.deleteOfficeSession(sessionId);
      toast('Session deleted', 'ok');
      onDeleted();
    } catch (err) {
      toast(errorMessage(err, 'Failed to delete session'), 'err');
    }
  };

  if (loading || !session) {
    return <div style={{ padding: '24px', color: 'var(--text-faint)', fontSize: '12px' }}>Loading chat…</div>;
  }

  const showStream = streaming;

  return (
    <div className="office-view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <button type="button" className="session-action-btn" onClick={onBack} title="Back to roster">
          <ArrowLeft size={16} />
        </button>
        <div style={{ fontSize: '22px' }}>{employee?.avatar || '🧑‍💻'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '14px' }}>{session.title}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
            {employee?.name || 'Unknown employee'}
            {session.project ? ` · @${session.project}` : ' · casual chat'}
            {session.model ? ` · ${session.model}` : ''}
          </div>
        </div>
        <button type="button" className="session-action-btn" onClick={openSettings} title="Session settings">
          <SettingsIcon size={14} />
        </button>
        <button type="button" className="session-action-btn" onClick={handleDeleteSession} title="Delete session">
          <Trash2 size={14} />
        </button>
      </div>

      {settingsOpen && (
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end',
            padding: '12px', marginBottom: '14px', background: 'var(--surface-card)',
            border: '1px solid var(--border)', borderRadius: '8px',
          }}
        >
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-faint)', display: 'block', marginBottom: '4px' }}>PROJECT</label>
            <select
              className="field-select"
              value={session.project || ''}
              onChange={(e) => saveSettings({ project: e.target.value })}
              disabled={savingSettings}
              style={{ width: '100%' }}
            >
              <option value="">(none — casual chat)</option>
              {projects.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          {session.project && (
            <div style={{ flex: '1 1 140px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-faint)', display: 'block', marginBottom: '4px' }}>ENGINE</label>
              <select
                className="field-select"
                value={session.engine || 'auto'}
                onChange={(e) => saveSettings({ engine: e.target.value === 'auto' ? '' : e.target.value })}
                disabled={savingSettings}
                style={{ width: '100%' }}
              >
                <option value="auto">Auto</option>
                <option value="claude">Claude</option>
                <option value="antigravity">Antigravity</option>
              </select>
            </div>
          )}

          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-faint)', display: 'block', marginBottom: '4px' }}>AI MODEL</label>
            <select
              className="field-select"
              value={session.model || ''}
              onChange={(e) => saveSettings({ model: e.target.value })}
              disabled={savingSettings}
              style={{ width: '100%' }}
            >
              <option value="">(employee default)</option>
              {engineModels?.claude?.length ? (
                <optgroup label="Claude">
                  {engineModels.claude.map((m) => <option key={`c-${m}`} value={m}>{m}</option>)}
                </optgroup>
              ) : null}
              {engineModels?.agy?.length ? (
                <optgroup label="Antigravity">
                  {engineModels.agy.map((m) => <option key={`a-${m}`} value={m}>{m}</option>)}
                </optgroup>
              ) : null}
            </select>
          </div>
        </div>
      )}

      {pending.map((p) => (
        <div
          key={p.id}
          style={{
            display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px',
            marginBottom: '10px', background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid #f59e0b', borderRadius: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600 }}>
            <ShieldAlert size={14} color="#f59e0b" />
            Needs your approval: {p.summary}
          </div>
          {p.risk_note && (
            <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{p.risk_note}</div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="primary" size="small" disabled={resolving} onClick={() => resolvePending(p.id, true)}>Approve</Button>
            <Button variant="secondary" size="small" disabled={resolving} onClick={() => resolvePending(p.id, false)}>Reject</Button>
          </div>
        </div>
      ))}

      <div ref={threadRef} className="chat-thread-container office-chat-thread" style={{ flex: 1, minHeight: '260px' }}>
        {messages.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: '12px', fontStyle: 'italic', padding: '12px' }}>
            No messages yet — say hi to {employeeName}.
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
                            style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }} />
                        ))}
                      </div>
                    )}
                    {m.docNames && m.docNames.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                        {m.docNames.map((n) => (
                          <span key={n} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
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
                        tasks={tasks}
                        taskId={tid}
                        confirming={!!confirmingMap[tid]}
                        onConfirm={(approved) => handleConfirmTask(tid, approved)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {showStream && (
          <div className="chat-message-row assistant">
            <div className="chat-author-line">
              <span>{employeeName.toUpperCase()}</span>
              <span style={{ color: 'var(--accent)', fontSize: '10px' }}>(replying...)</span>
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
                      onConfirm={(approved) => handleConfirmTask(tid, approved)}
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
          <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic', padding: '4px 12px' }}>
            Working on it — this may take a while…
          </div>
        )}
      </div>

      {attached.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', marginTop: '10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface-card)' }}>
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.08em' }}>ATTACHED:</span>
          {attached.map((a, idx) => (
            <div key={a.url} style={{ position: 'relative' }}>
              {a.kind === 'image' ? (
                <img src={a.url} alt={a.file.name} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }} />
              ) : (
                <div title={a.file.name} style={{ width: '40px', height: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface-0)', padding: '2px', overflow: 'hidden' }}>
                  <span style={{ fontSize: '14px' }}>📄</span>
                </div>
              )}
              <button type="button" onClick={() => removeAttached(idx)} title="Remove"
                style={{ position: 'absolute', top: '-4px', right: '-4px', width: '14px', height: '14px', borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-0)', color: 'var(--text)', lineHeight: 1, fontSize: '9px', cursor: 'pointer' }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSend} className="ask-prompt-floating-card office-input-bar" style={{ marginTop: '12px' }}>
        <button
          type="button"
          className="ask-left-action-btn"
          disabled={streaming}
          title="Attach a file or image"
          onClick={() => fileInputRef.current?.click()}
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,.txt,.md,.csv,.json,.log,.pdf,.docx,.xlsx,.py,.js,.ts,.tsx,.jsx,.html,.css,.yaml,.yml,.xml,.java,.c,.cpp,.go,.rs,.rb,.php,.sql"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
        />

        <input
          type="text"
          className="ask-main-input-field"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onPaste={(e) => addFiles(e.clipboardData.files)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendTurn(inputText.trim());
            }
          }}
          placeholder={session.project ? `Continue work on @${session.project}…` : `Message ${employeeName}…`}
          disabled={streaming || waitingOnTask}
        />

        <div className="ask-right-actions-group">
          <button
            type="button"
            className={`ask-tool-icon-btn ${micState === 'recording' ? 'active-rec' : ''}`}
            disabled={streaming || micState === 'working'}
            title={
              micState === 'listening' ? 'Listening...'
              : micState === 'recording' ? 'Recording... click to stop'
              : micState === 'working' ? 'Transcribing...'
              : 'Speak (push-to-talk)'
            }
            onClick={() => (micState === 'recording' ? pushToTalkStop() : pushToTalkStart())}
          >
            <Mic size={14} />
          </button>

          <button
            type="button"
            className={`ask-tool-icon-btn ${speaking ? 'active-speaking' : ''}`}
            title={speaking ? 'Stop voice' : ttsEnabled ? 'Voice on' : 'Voice off'}
            onClick={speaking ? shutUp : () => setTtsEnabled(!ttsEnabled)}
          >
            {speaking ? <VolumeX size={14} /> : ttsEnabled ? <Volume2 size={14} /> : <Volume1 size={14} />}
          </button>

          {streaming ? (
            <button type="button" className="hermes-circle-action-btn stop" onClick={handleStop} title="Stop">
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              className="hermes-circle-action-btn"
              disabled={(!inputText.trim() && attached.length === 0) || waitingOnTask}
              title="Send (Enter)"
            >
              <Activity size={13} style={{ strokeWidth: 2.5 }} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
