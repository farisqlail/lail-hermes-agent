import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ChatMessage, Employee, EngineModels, OfficeSession, PendingAction, Project } from '../api/types';
import { useTasksContext } from '../api/events';
import { parseStreamBuffer } from '../api/stream';
import { Button } from '../components/Button';
import { Markdown } from '../components/Markdown';
import { findTaskIds, InlineTaskCard, ClaudeThinkingIndicator, confirmTask } from '../components/TaskCard';
import { useToast } from '../components/Toast';
import {
  loadTtsSettings, TtsMode, TtsPersonality,
  ttsRequest, TtsIntent, TtsRequestOptions,
  hasGreeted, markGreeted,
  loadVoiceSettings, VoiceSettings, VOICE_SETTINGS_DEFAULT,
} from '../tts';
import { SpeechQueue, HtmlAudioSink, sharedAudioSink, sharedSpeechQueue } from '../audio';
import { splitSentences, flushSentence } from '../sentences';
import { useVoiceLoop } from '../hooks/useVoiceLoop';
import { STOP_ACK, matchLocalCommand } from '../commands';
import { VoiceTagExtractor } from '../voicetag';
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

interface Message extends ChatMessage {
  images?: string[];
  docNames?: string[];
}

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 120; // ~5 minutes

// Mirrors hermes/uploads.py's _DOCUMENT_EXTENSIONS (see Dashboard.tsx's own copy).
const DOCUMENT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml',
  'xml', 'ini', 'toml', 'py', 'js', 'ts', 'tsx', 'jsx', 'html', 'css',
  'sh', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'sql',
  'pdf', 'docx', 'xlsx',
]);
const docExt = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

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
 * than a lookalike box that behaves differently underneath. */
export function OfficeSessionChat({ sessionId, employees, onBack, onDeleted, onStreamingChange }: OfficeSessionChatProps) {
  const { toast } = useToast();
  const { tasks } = useTasksContext();
  const [session, setSession] = useState<OfficeSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [waitingOnTask, setWaitingOnTask] = useState(false);
  const [confirmingMap, setConfirmingMap] = useState<Record<string, boolean>>({});

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [engineModels, setEngineModels] = useState<EngineModels | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [pending, setPending] = useState<PendingAction[]>([]);
  const [resolving, setResolving] = useState(false);

  const [attached, setAttached] = useState<{ file: File; url: string; kind: 'image' | 'document' }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── voice/TTS, same building blocks and shared queue the main chat pane
  // uses (see Dashboard.tsx) — one speech queue for the whole app so a task
  // notification and this pane's own reply never talk over each other.
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsMode, setTtsMode] = useState<TtsMode>('smart');
  const [ttsMaxWords, setTtsMaxWords] = useState(40);
  const [ttsGreeting, setTtsGreeting] = useState(true);
  const [ttsPersonality, setTtsPersonality] = useState<TtsPersonality>('professional');
  const [sttEnabled, setSttEnabled] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(VOICE_SETTINGS_DEFAULT);
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const sinkRef = useRef<HtmlAudioSink | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const sendTurnRef = useRef<(text: string, opts?: { resume?: boolean }) => Promise<void>>(async () => {});

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttempts = useRef(0);

  const employee = employees.find((e) => e.employee_id === session?.employee_id) || null;
  const employeeName = employee?.name || 'Employee';

  const activeSpeakerId = (streaming || speaking || waitingOnTask) && employee ? employee.employee_id : null;

  useEffect(() => {
    onStreamingChange?.(activeSpeakerId);
  }, [activeSpeakerId, onStreamingChange]);

  useEffect(() => {
    return () => { onStreamingChange?.(null); };
    // Clears the cue when this pane closes (e.g. the office chat modal is
    // dismissed), independent of whatever streaming/speaking was mid-flight.
  }, [onStreamingChange]);

  if (queueRef.current === null && typeof window !== 'undefined') {
    sinkRef.current = sharedAudioSink();
    queueRef.current = sharedSpeechQueue();
    queueRef.current.observe({
      onSpeakingChange: (v) => { speakingRef.current = v; setSpeaking(v); },
      onFirstAudio: () => {},
    });
  }

  const speak = useCallback((intent: TtsIntent, opts: Partial<TtsRequestOptions> = {}) => {
    if (!ttsEnabled) return;
    const { endpoint, payload } = ttsRequest(ttsMode, intent, {
      voice: ttsVoice, agentName: employeeName, maxWords: ttsMaxWords, personality: ttsPersonality, ...opts,
    });
    queueRef.current?.enqueue(endpoint, payload);
  }, [ttsEnabled, ttsMode, ttsVoice, employeeName, ttsMaxWords, ttsPersonality]);

  const speakLine = useCallback((text: string) => {
    if (!ttsEnabled) return;
    const { endpoint, payload } = ttsRequest('verbatim', 'summary', {
      voice: ttsVoice, agentName: employeeName, maxWords: ttsMaxWords, personality: ttsPersonality, text,
    });
    queueRef.current?.enqueue(endpoint, payload);
  }, [ttsEnabled, ttsVoice, employeeName, ttsMaxWords, ttsPersonality]);

  const shutUp = useCallback(() => { queueRef.current?.stop(); }, []);

  useEffect(() => {
    loadTtsSettings().then((s) => {
      setTtsEnabled(s.tts_enabled);
      setTtsVoice(s.tts_voice);
      setTtsMode(s.tts_mode);
      setTtsMaxWords(s.tts_max_words);
      setTtsGreeting(s.tts_greeting);
      setTtsPersonality(s.tts_personality);
    }).catch(() => {});
    loadVoiceSettings().then(setVoiceSettings).catch(() => {});
    api.getSettings().then((s) => setSttEnabled(s.stt_enabled ?? false)).catch(() => {});
  }, []);

  // Declared before `load` (which calls it on reopen) rather than where the
  // task-flow send path uses it below — a project-bound task runs as a real
  // fire-and-forget background task on the server (office.py's
  // asyncio.create_task), so closing this modal never stops it; only the
  // frontend's own poll for the reply gets torn down on unmount. Resuming it
  // here means reopening a chat with a task still in flight picks the
  // "Working on it…" state back up instead of looking dead until you send a
  // new message.
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, msgs] = await Promise.all([
        api.getOfficeSession(sessionId),
        api.getOfficeSessionMessages(sessionId),
      ]);
      setSession(s);
      setMessages(msgs);
      // Last message with no reply yet + this session runs real tasks
      // (a project bound to it) = a task is still working server-side.
      if (s.project && msgs.length > 0 && msgs[msgs.length - 1].role === 'user') {
        setWaitingOnTask(true);
        pollForTaskReply(msgs.length);
      }
    } catch (err) {
      toast(errorMessage(err, 'Failed to load session'), 'err');
    } finally {
      setLoading(false);
    }
  }, [sessionId, toast, pollForTaskReply]);

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
  }, [messages, streamContent, streaming]);

  // Greet once per session on first open, same as the main chat pane.
  useEffect(() => {
    if (!ttsEnabled || !ttsGreeting || hasGreeted(sessionId) || loading || messages.length > 0) return;
    markGreeted(sessionId);
    speak('greeting');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsEnabled, ttsGreeting, loading, messages.length, sessionId]);

  // A write action the persona proposed (delete/write/send — never a read)
  // parks here awaiting approval, same PendingStore the main chat pane polls.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await api.getChatPending(sessionId);
        if (!cancelled) setPending(list);
      } catch {
        // transient — next poll retries
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId]);

  const resolvePending = async (id: string, approved: boolean) => {
    setResolving(true);
    try {
      const res = await api.resolveChatPending(sessionId, id, approved);
      if (!res.ok) {
        toast('No pending action found', 'warn');
        return;
      }
      const fresh = await api.getOfficeSessionMessages(sessionId);
      setMessages(fresh);
      setPending((prev) => prev.filter((p) => p.id !== id));
      // The turn ended when the action was parked — a resume streams the
      // model picking its plan back up, same as approving in the main pane.
      if (res.resume) await sendTurnRef.current('', { resume: true });
    } catch (err) {
      toast(errorMessage(err, 'Failed to resolve action'), 'err');
    } finally {
      setResolving(false);
    }
  };

  /** Stage image and document files chosen or pasted. Anything neither an
   *  image nor a known document extension is ignored rather than refused
   *  loudly — a paste often carries several flavours of the same clipboard
   *  entry, only one of which is the actual attachment. */
  const addFiles = (files: Iterable<File>) => {
    const picked = Array.from(files).flatMap((file): { file: File; kind: 'image' | 'document' }[] => {
      if (file.type.startsWith('image/')) return [{ file, kind: 'image' }];
      if (DOCUMENT_EXTENSIONS.has(docExt(file.name))) return [{ file, kind: 'document' }];
      return [];
    });
    if (picked.length === 0) return;
    setAttached((prev) => [...prev, ...picked.map(({ file, kind }) => ({ file, url: URL.createObjectURL(file), kind }))]);
  };

  const removeAttached = (idx: number) => {
    setAttached((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    const ids: string[] = [];
    for (const file of files) {
      try {
        const res = await fetch(`/api/uploads?session_id=${sessionId}`, { method: 'POST', body: file });
        if (!res.ok) { toast(`Failed to upload ${file.name}`, 'err'); continue; }
        ids.push((await res.json()).id);
      } catch {
        toast(`Failed to upload ${file.name}`, 'err');
      }
    }
    return ids;
  };

  const uploadDocuments = async (files: File[]): Promise<{ file: File; id: string }[]> => {
    const out: { file: File; id: string }[] = [];
    for (const file of files) {
      try {
        const params = new URLSearchParams({ filename: file.name, session_id: sessionId });
        const res = await fetch(`/api/uploads/document?${params}`, { method: 'POST', body: file });
        if (!res.ok) { toast(`Failed to upload ${file.name}`, 'err'); continue; }
        out.push({ file, id: (await res.json()).id });
      } catch {
        toast(`Failed to upload ${file.name}`, 'err');
      }
    }
    return out;
  };

  const handleConfirmTask = async (tid: string, approved: boolean) => {
    setConfirmingMap((prev) => ({ ...prev, [tid]: true }));
    try {
      const ok = await confirmTask(tid, approved);
      toast(ok ? (approved ? 'Task approved' : 'Task cancelled') : 'Failed to send confirmation', ok ? 'ok' : 'err');
    } catch {
      toast('Network error', 'err');
    } finally {
      setConfirmingMap((prev) => ({ ...prev, [tid]: false }));
    }
  };

  /** `resume` is the continuation turn fired after an approved action ran: no
   *  operator typed it, so it carries no text and shows no user bubble.
   *  A project-bound session has no streaming reply to speak of — the
   *  "reply" is a background task's outcome — so it keeps using the
   *  original non-streaming task flow (see the /api/office/sessions
   *  POST .../messages endpoint) instead of the SSE stream below. */
  const sendTurn = async (text: string, opts?: { resume?: boolean }) => {
    const resume = opts?.resume === true;
    const hasAttachments = attached.length > 0;
    if ((!text.trim() && !hasAttachments && !resume) || streaming) return;

    if (session?.project && !resume) {
      const trimmed = text.trim();
      setInputText('');
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
      try {
        const countBefore = messages.length;
        const res = await api.sendOfficeSessionMessage(sessionId, trimmed);
        if (res.kind === 'task') {
          setWaitingOnTask(true);
          pollForTaskReply(countBefore + 1);
        } else if (res.kind === 'chat' && res.reply) {
          setMessages((prev) => [...prev, { role: 'assistant', content: res.reply as string }]);
        }
      } catch (err) {
        toast(errorMessage(err, 'Failed to send message'), 'err');
        setMessages((prev) => prev.slice(0, -1));
      }
      return;
    }

    const staged = attached;
    const { imageIds, docIds, docNames } = await (async () => {
      const images = staged.filter((a) => a.kind === 'image').map((a) => a.file);
      const docs = staged.filter((a) => a.kind === 'document').map((a) => a.file);
      const [imgIds, docResults] = await Promise.all([uploadFiles(images), uploadDocuments(docs)]);
      return { imageIds: imgIds, docIds: docResults.map((d) => d.id), docNames: docResults.map((d) => d.file.name) };
    })();
    setAttached([]);

    setInputText('');
    setStreaming(true);
    setStreamContent('');
    shutUp();
    queueRef.current?.markTurnStart();
    if (ttsEnabled) sinkRef.current?.unlock();

    if (!resume) {
      setMessages((prev) => [...prev, {
        role: 'user', content: text,
        images: staged.filter((a) => a.kind === 'image').map((a) => a.url),
        docNames,
      }]);
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulatedText = '';
    let speechBuffer = '';
    const extractor = new VoiceTagExtractor();
    const streamSpeech = ttsEnabled && ttsMode === 'verbatim';
    const wantsVoiceTag = ttsEnabled && ttsMode === 'smart';
    let spokeOpener = false;
    let earlyVerbatim = false;

    try {
      const res = await fetch(`/api/office/sessions/${sessionId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, images: imageIds, documents: docIds, resume }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('Stream unavailable');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseStreamBuffer(buffer);
        buffer = remaining;
        for (const ev of events) {
          if (ev.delta) {
            const { display, voice: spoken } = extractor.push(ev.delta);
            if (spoken && wantsVoiceTag && !earlyVerbatim) {
              speakLine(spoken);
              spokeOpener = true;
            }
            if (display) {
              accumulatedText += display;
              setStreamContent(accumulatedText);
              if (streamSpeech) {
                speechBuffer += display;
                const { sentences, remainder } = splitSentences(speechBuffer);
                speechBuffer = remainder;
                for (const s of sentences) speak('summary', { text: s });
              } else if (wantsVoiceTag && !spokeOpener) {
                earlyVerbatim = true;
                speechBuffer += display;
                const { sentences, remainder } = splitSentences(speechBuffer);
                speechBuffer = remainder;
                for (const s of sentences) speakLine(s);
              }
            }
          }
          if (ev.error) throw new Error(ev.error);
        }
      }

      const tail = extractor.flush();
      if (tail.display) {
        accumulatedText += tail.display;
        setStreamContent(accumulatedText);
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: accumulatedText || '(no reply)' }]);
      if (resume) toast('Action done, picking back up', 'ok');
      if (streamSpeech) {
        if (tail.display) {
          speechBuffer += tail.display;
          const { sentences, remainder } = splitSentences(speechBuffer);
          speechBuffer = remainder;
          for (const s of sentences) speak('summary', { text: s });
        }
        for (const s of flushSentence(speechBuffer)) speak('summary', { text: s });
      } else if (earlyVerbatim) {
        if (tail.display) speechBuffer += tail.display;
        for (const s of flushSentence(speechBuffer)) speakLine(s);
      } else if (!spokeOpener && !extractor.sawTag) {
        speak('summary', { text: accumulatedText });
      }
    } catch (err) {
      shutUp();
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages((prev) => [...prev, { role: 'assistant', content: accumulatedText || '(stopped by operator)' }]);
        toast('Chat stream stopped', 'warn');
      } else {
        toast(errorMessage(err, 'Failed to send message'), 'err');
        setMessages((prev) => [...prev, { role: 'assistant', content: `**Error:** ${errorMessage(err, 'Connection failed.')}` }]);
      }
    } finally {
      setStreaming(false);
      setStreamContent('');
      abortControllerRef.current = null;
    }
  };

  sendTurnRef.current = sendTurn;

  const { micState, pushToTalkStart, pushToTalkStop } = useVoiceLoop({
    enabled: sttEnabled,
    handsfree: voiceSettings.voice_handsfree,
    bargeIn: voiceSettings.voice_barge_in,
    silenceMs: voiceSettings.voice_silence_ms,
    sensitivity: voiceSettings.voice_sensitivity,
    isSpeaking: () => speakingRef.current,
    onBargeIn: shutUp,
    onCommand: (cmd) => {
      if (cmd === 'stop') { shutUp(); toast(STOP_ACK, 'ok'); return; }
      if (pending.length === 0) return;
      void resolvePending(pending[0].id, cmd === 'confirm');
    },
    onTranscript: (text) => {
      if (streaming) {
        setInputText((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        return;
      }
      void sendTurn(text);
    },
    onError: (message) => toast(message, 'err'),
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    void sendTurn(inputText.trim());
  };

  const handleStop = () => {
    shutUp();
    if (abortControllerRef.current) abortControllerRef.current.abort();
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

      <div className="chat-thread-container office-chat-thread" style={{ flex: 1, minHeight: '260px' }}>
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
                        taskId={tid}
                        tasks={tasks}
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
        <div ref={bottomRef} />
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
