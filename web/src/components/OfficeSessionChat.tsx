import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ChatMessage, Employee, EngineModels, OfficeSession, Project } from '../api/types';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { ArrowLeft, Settings as SettingsIcon, Send, Trash2 } from 'lucide-react';

interface OfficeSessionChatProps {
  sessionId: string;
  employees: Employee[];
  onBack: () => void;
  onDeleted: () => void;
}

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 120; // ~5 minutes

/** A continuing task in this session (project set) can take minutes to run in
 * the background — the outcome lands as a new assistant message once the
 * real Orchestrator task finishes (see OfficeManager._run_session_task).
 * Polling here mirrors WorkOutputFeed's existing pattern rather than adding
 * a new SSE event type just for this. */
export function OfficeSessionChat({ sessionId, employees, onBack, onDeleted }: OfficeSessionChatProps) {
  const { toast } = useToast();
  const [session, setSession] = useState<OfficeSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [waitingOnTask, setWaitingOnTask] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [engineModels, setEngineModels] = useState<EngineModels | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttempts = useRef(0);

  const employee = employees.find((e) => e.employee_id === session?.employee_id) || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, msgs] = await Promise.all([
        api.getOfficeSession(sessionId),
        api.getOfficeSessionMessages(sessionId),
      ]);
      setSession(s);
      setMessages(msgs);
    } catch (err) {
      toast(errorMessage(err, 'Failed to load session'), 'err');
    } finally {
      setLoading(false);
    }
  }, [sessionId, toast]);

  useEffect(() => {
    load();
    setSettingsOpen(false);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      pollAttempts.current = 0;
    };
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const pollForTaskReply = useCallback((countBefore: number) => {
    pollAttempts.current = 0;
    const tick = async () => {
      pollAttempts.current += 1;
      try {
        const fresh = await api.getOfficeSessionMessages(sessionId);
        if (fresh.length > countBefore) {
          setMessages(fresh);
          setWaitingOnTask(false);
          return;
        }
      } catch {
        // transient — keep polling until the attempt cap
      }
      if (pollAttempts.current >= POLL_MAX_ATTEMPTS) {
        setWaitingOnTask(false);
        toast('Still running — check back or reload this chat', 'warn');
        return;
      }
      pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
  }, [sessionId, toast]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || waitingOnTask) return;
    setInput('');
    const countBefore = messages.length;
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setSending(true);
    try {
      const res = await api.sendOfficeSessionMessage(sessionId, text);
      if (res.kind === 'chat' && res.reply) {
        setMessages((prev) => [...prev, { role: 'assistant', content: res.reply as string }]);
      } else if (res.kind === 'task') {
        setWaitingOnTask(true);
        pollForTaskReply(countBefore + 1);
      }
    } catch (err) {
      toast(errorMessage(err, 'Failed to send message'), 'err');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  };

  const openSettings = () => {
    setSettingsOpen((v) => !v);
    if (!projects.length) api.getProjects().then(setProjects).catch(() => {});
    if (!engineModels) api.getEngineModels().then(setEngineModels).catch(() => {});
  };

  const saveSettings = async (fields: { title?: string; project?: string; model?: string; engine?: string }) => {
    setSavingSettings(true);
    try {
      const updated = await api.updateOfficeSession(sessionId, fields);
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

      <div
        style={{
          flex: 1, display: 'flex', flexDirection: 'column', gap: '10px',
          padding: '4px 2px', overflowY: 'auto', minHeight: '260px',
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: '12px', fontStyle: 'italic', padding: '12px' }}>
            No messages yet — say hi{employee ? ` to ${employee.name}` : ''}.
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '75%',
                padding: '10px 14px',
                borderRadius: '10px',
                fontSize: '13px',
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-card)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              }}
            >
              {m.content}
            </div>
          ))
        )}
        {(sending || waitingOnTask) && (
          <div style={{ alignSelf: 'flex-start', fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic', padding: '4px 12px' }}>
            {waitingOnTask ? 'Working on it — this may take a while…' : `${employee?.name || 'They'} is typing…`}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'flex-end' }}>
        <textarea
          className="field-input"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={session.project ? `Continue work on @${session.project}…` : `Message ${employee?.name || 'them'}…`}
          style={{ flex: 1, resize: 'none' }}
        />
        <Button
          variant="primary"
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || sending || waitingOnTask}
          loading={sending}
        >
          <Send size={14} />
        </Button>
      </div>
    </div>
  );
}
