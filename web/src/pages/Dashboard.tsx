import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTasks } from '../hooks/useTasks';
import { parseStreamBuffer, StreamEvent } from '../api/stream';
import { errorMessage, api } from '../api/client';
import { Markdown } from '../components/Markdown';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { useTasksContext } from '../api/events';
import {
  loadTtsSettings, TtsMode, TtsPersonality,
  ttsRequest, TtsIntent, TtsRequestOptions,
  hasGreeted, markGreeted,
  loadVoiceSettings, VoiceSettings, VOICE_SETTINGS_DEFAULT,
} from '../tts';
import { SpeechQueue, HtmlAudioSink, fetchSpeech } from '../audio';
import { splitSentences, flushSentence } from '../sentences';
import { useVoiceLoop } from '../hooks/useVoiceLoop';
import { STOP_ACK } from '../commands';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  usage?: {
    total: number;
  };
}

function findTaskIds(text: string): string[] {
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

interface InlineTaskCardProps {
  taskId: string;
  tasks: any[];
  confirming: boolean;
  onConfirm: (approved: boolean) => void;
}

function InlineTaskCard({ taskId, tasks, confirming, onConfirm }: InlineTaskCardProps) {
  const task = tasks.find(t => t.task_id === taskId);

  // An id in the prose with no task behind it. Rendering null here hid the
  // problem: the assistant can quote a task id it never queued, and the reply
  // then reads as if work is waiting while no card, no log link and no Run
  // button appear. Say so instead — an id that resolves to nothing is a
  // failure the operator must see, not a blank space.
  if (!task) {
    return (
      <div style={{
        marginTop: '12px',
        padding: '10px 14px',
        backgroundColor: 'var(--surface-1)',
        border: '1px dashed var(--err)',
        borderRadius: 'var(--r-md)',
        alignSelf: 'stretch',
        fontSize: 'var(--t-sm)',
        color: 'var(--text-dim)',
      }}>
        <span style={{ color: 'var(--err)', fontWeight: '600' }}>⚠️ Task tidak ditemukan</span>
        {' — '}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>{taskId}</span>
        <div style={{ marginTop: '4px', fontSize: 'var(--t-xs)' }}>
          ID ini tidak ada di daftar task, jadi tidak ada tombol Run untuknya.
          Minta asisten memakai <code>recent_tasks</code> untuk menyebut ID yang benar,
          atau antrekan ulang tasknya.
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    queued: 'var(--text-faint)',
    running: 'var(--accent)',
    done: 'var(--ready)',
    failed: 'var(--err)',
    cancelled: 'var(--text-faint)',
    interrupted: 'var(--warn)',
    awaiting_confirm: 'var(--warn)',
  };

  return (
    <div style={{
      marginTop: '12px',
      padding: '12px 16px',
      backgroundColor: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      fontSize: 'var(--t-sm)',
      alignSelf: 'stretch',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: '600', color: 'var(--text)' }}>
          ⚙️ Task: <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>{taskId}</span>
        </span>
        <span style={{
          padding: '2px 8px',
          borderRadius: 'var(--r-sm)',
          fontSize: 'var(--t-xs)',
          fontWeight: '600',
          backgroundColor: 'rgba(255,255,255,0.05)',
          color: statusColors[task.status] || 'var(--text)',
          border: `1px solid ${statusColors[task.status] || 'var(--border)'}`,
        }}>
          {task.status.toUpperCase()}
        </span>
      </div>

      <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
        "{task.text}"
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
        <a
          href={`#/task/${taskId}`}
          style={{
            color: 'var(--accent)',
            textDecoration: 'none',
            fontWeight: '600',
            fontSize: 'var(--t-xs)',
          }}
        >
          Lihat Log & Langkah Lengkap ↗
        </a>

        {task.status === 'awaiting_confirm' && (
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <Button
              variant="primary"
              size="small"
              onClick={() => onConfirm(true)}
              disabled={confirming}
              style={{ padding: '4px 12px', fontSize: 'var(--t-xs)' }}
            >
              Run
            </Button>
            <Button
              variant="danger"
              size="small"
              onClick={() => onConfirm(false)}
              disabled={confirming}
              style={{ padding: '4px 12px', fontSize: 'var(--t-xs)' }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface DashboardProps {
  sessionId?: string;
  onRefreshSessions?: () => void;
}

export function Dashboard({ sessionId, onRefreshSessions }: DashboardProps) {
  const { isConnected } = useTasks();
  const { tasks } = useTasksContext();
  const { toast } = useToast();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [agentName, setAgentName] = useState('Lail Agent');

  const [ttsEnabled, setTtsEnabled] = useState<boolean>(false);
  const [ttsVoice, setTtsVoice] = useState<string>('id-ID-ArdiNeural');
  const [ttsMode, setTtsMode] = useState<TtsMode>('smart');
  const [ttsMaxWords, setTtsMaxWords] = useState<number>(40);
  const [ttsGreeting, setTtsGreeting] = useState<boolean>(true);
  const [ttsTaskNotify, setTtsTaskNotify] = useState<boolean>(false);
  const [ttsPersonality, setTtsPersonality] = useState<TtsPersonality>('professional');
  const [sttEnabled, setSttEnabled] = useState<boolean>(false);

  const [voice, setVoice] = useState<VoiceSettings>(VOICE_SETTINGS_DEFAULT);
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const sinkRef = useRef<HtmlAudioSink | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null);

  if (queueRef.current === null && typeof window !== 'undefined') {
    sinkRef.current = new HtmlAudioSink();
    queueRef.current = new SpeechQueue(fetchSpeech, sinkRef.current, {
      onSpeakingChange: (v) => { speakingRef.current = v; setSpeaking(v); },
    });
  }

  /** Queue one utterance. Everything spoken goes through here, so barge-in has
   *  exactly one thing to stop. */
  const speak = useCallback((intent: TtsIntent, opts: Partial<TtsRequestOptions> = {}) => {
    if (!ttsEnabled) return;
    const { endpoint, payload } = ttsRequest(ttsMode, intent, {
      voice: ttsVoice,
      agentName,
      maxWords: ttsMaxWords,
      personality: ttsPersonality,
      ...opts,
    });
    queueRef.current?.enqueue(endpoint, payload);
  }, [ttsEnabled, ttsMode, ttsVoice, agentName, ttsMaxWords, ttsPersonality]);

  const shutUp = useCallback(() => { queueRef.current?.stop(); }, []);

  useEffect(() => {
    api.getSettings().then(s => {
      if (s.agent_name) {
        setAgentName(s.agent_name);
      }
      setSttEnabled(s.stt_enabled ?? false);
    }).catch(() => {});

    loadTtsSettings().then(s => {
      setTtsEnabled(s.tts_enabled);
      setTtsVoice(s.tts_voice);
      setTtsMode(s.tts_mode);
      setTtsMaxWords(s.tts_max_words);
      setTtsGreeting(s.tts_greeting);
      setTtsTaskNotify(s.tts_task_notify);
      setTtsPersonality(s.tts_personality);
    }).catch(() => {});

    loadVoiceSettings().then(setVoice).catch(() => {});

    return () => {
      queueRef.current?.stop();
    };
  }, []);

  // ── Proactive greeting on fresh session ──
  useEffect(() => {
    if (
      !ttsEnabled ||
      !ttsGreeting ||
      hasGreeted(sessionId || null) ||
      loadingHistory ||
      messages.length > 0
    ) return;
    markGreeted(sessionId || null);
    speak('greeting');
  }, [ttsEnabled, ttsGreeting, loadingHistory, messages.length, sessionId]);

  // ── Voice notification on task completion ──
  const prevTasksRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!ttsEnabled || !ttsTaskNotify) return;
    const prev = prevTasksRef.current;
    for (const t of tasks) {
      const oldStatus = prev.get(t.task_id);
      if (oldStatus && oldStatus !== t.status && (t.status === 'done' || t.status === 'failed')) {
        speak('notify', { taskText: t.text, taskStatus: t.status });
        break; // one notification at a time
      }
    }
    const next = new Map<string, string>();
    for (const t of tasks) next.set(t.task_id, t.status);
    prevTasksRef.current = next;
  }, [tasks, ttsEnabled, ttsTaskNotify]);
  
  const [inputText, setInputText] = useState('');

  // ── Voice input ──
  // Distinguishes a hold (Ctrl+Space) from a click. Without it, releasing
  // Space would also stop a recording the operator started by clicking.
  const holdingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { micState, pushToTalkStart, pushToTalkStop } = useVoiceLoop({
    enabled: sttEnabled,
    handsfree: voice.voice_handsfree,
    bargeIn: voice.voice_barge_in,
    silenceMs: voice.voice_silence_ms,
    sensitivity: voice.voice_sensitivity,
    isSpeaking: () => speakingRef.current,
    onBargeIn: shutUp,
    onCommand: (cmd) => {
      if (cmd !== 'stop') return;
      shutUp();
      // Confirm in the thread: without it the operator cannot tell whether the
      // mic heard "diam" or the assistant simply finished.
      toast(STOP_ACK, 'ok');
    },
    onTranscript: (text) => {
      setInputText((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      inputRef.current?.focus();
      if (voice.voice_handsfree) void submitText(text);
    },
    onError: (message) => toast(message, 'err'),
  });

  // Hold Ctrl+Space to talk. Ctrl rather than Space alone so the shortcut
  // cannot fire while the operator is typing a message.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !e.ctrlKey || e.repeat) return;
      e.preventDefault();
      holdingRef.current = true;
      pushToTalkStart();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !holdingRef.current) return;
      e.preventDefault();
      holdingRef.current = false;
      pushToTalkStop();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [pushToTalkStart, pushToTalkStop]);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [streamUsage, setStreamUsage] = useState<{ total: number } | null>(null);
  const [confirmingMap, setConfirmingMap] = useState<Record<string, boolean>>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);

  const fetchChatHistory = useCallback(async () => {
    try {
      setLoadingHistory(true);
      const url = sessionId ? `/api/chat?session_id=${sessionId}` : '/api/chat';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Gagal memuat riwayat percakapan:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchChatHistory();
  }, [fetchChatHistory]);

  const handleConfirmTask = async (tid: string, approved: boolean) => {
    setConfirmingMap(prev => ({ ...prev, [tid]: true }));
    try {
      const res = await fetch(`/api/tasks/${tid}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      if (res.ok) {
        toast(approved ? 'Tugas disetujui!' : 'Tugas dibatalkan.', 'ok');
      } else {
        toast('Gagal mengirim konfirmasi.', 'err');
      }
    } catch (err) {
      toast('Terjadi kesalahan jaringan.', 'err');
    } finally {
      setConfirmingMap(prev => ({ ...prev, [tid]: false }));
    }
  };

  // Scroll to bottom when messages or streamContent updates
  const scrollToBottom = useCallback(() => {
    if (chatThreadRef.current) {
      chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamContent, streaming, scrollToBottom]);

  const submitText = async (text: string) => {
    if (!text || streaming) return;

    setInputText('');
    setStreaming(true);
    setStreamContent('');
    setStreamUsage(null);

    shutUp();
    if (ttsEnabled) sinkRef.current?.unlock();

    // Append user message immediately
    const userMsg: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulatedText = '';
    let speechBuffer = '';
    const streamSpeech = ttsEnabled && ttsMode === 'verbatim';
    let accumulatedUsage: { total: number } | null = null;

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, session_id: sessionId }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error('Stream tidak tersedia');
      }

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
            accumulatedText += ev.delta;
            setStreamContent(accumulatedText);
            if (streamSpeech) {
              speechBuffer += ev.delta;
              const { sentences, remainder } = splitSentences(speechBuffer);
              speechBuffer = remainder;
              for (const s of sentences) speak('summary', { text: s });
            }
          }
          if (ev.usage) {
            accumulatedUsage = ev.usage;
            setStreamUsage(accumulatedUsage);
          }
          if (ev.error) {
            throw new Error(ev.error);
          }
        }
      }

      // Finish streaming and push assistant message
      const assistantMsg: Message = {
        role: 'assistant',
        content: accumulatedText || '(tidak ada balasan)',
        usage: accumulatedUsage || undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (streamSpeech) {
        for (const s of flushSentence(speechBuffer)) speak('summary', { text: s });
      } else {
        speak('summary', { text: accumulatedText });
      }
      if (onRefreshSessions) {
        onRefreshSessions();
      }
    } catch (err) {
      shutUp();
      if (err instanceof Error && err.name === 'AbortError') {
        const assistantMsg: Message = {
          role: 'assistant',
          content: accumulatedText || '(dihentikan oleh operator)',
          usage: { total: 0 }, // Sentinel for aborted
        };
        setMessages((prev) => [...prev, assistantMsg]);
        toast('Aliran chat dihentikan', 'warn');
      } else {
        toast(errorMessage(err, 'Gagal mengirim pesan'), 'err');
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `**Error:** ${errorMessage(err, 'Koneksi gagal.')}` },
        ]);
      }
    } finally {
      setStreaming(false);
      setStreamContent('');
      setStreamUsage(null);
      abortControllerRef.current = null;
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    void submitText(inputText.trim());
  };

  const handleStop = () => {
    shutUp();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleReset = async () => {
    shutUp();
    if (!window.confirm('Hapus seluruh percakapan?')) return;
    try {
      const url = sessionId ? `/api/chat/reset?session_id=${sessionId}` : '/api/chat/reset';
      const res = await fetch(url, { method: 'POST' });
      if (res.ok) {
        setMessages([]);
        toast('Percakapan telah di-reset', 'ok');
      }
    } catch (err) {
      toast('Gagal me-reset percakapan', 'err');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Reconnect Warning Bar */}
      {!isConnected && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            backgroundColor: 'var(--warn)',
            color: 'var(--surface-0)',
            padding: '8px 16px',
            textAlign: 'center',
            fontWeight: '600',
            fontSize: 'var(--t-sm)',
            zIndex: 10,
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          }}
        >
          ⚠️ Koneksi terputus. Mencoba menghubungkan kembali...
        </div>
      )}

      {/* Main chat layout */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: '80px' }}>
        <header className="page-header" style={{ flexShrink: 0, marginTop: !isConnected ? '40px' : '0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 className="page-title">Live Chat & Dashboard</h1>
              <p className="page-subtitle">Instruksikan asisten AI Hermes untuk melakukan tugas kustom</p>
            </div>
            <Button variant="secondary" onClick={handleReset} disabled={streaming || messages.length === 0}>
              Reset Chat
            </Button>
          </div>
        </header>

        {/* Messages list */}
        <div
          ref={chatThreadRef}
          className="chat-thread"
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '16px',
            backgroundColor: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            minHeight: '200px',
          }}
        >
          {loadingHistory ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', margin: 'auto' }}>Memuat riwayat chat...</div>
          ) : messages.length === 0 && !streaming ? (
            <div style={{ color: 'var(--text-faint)', textAlign: 'center', margin: 'auto', maxWidth: '400px' }}>
              <span style={{ fontSize: '2rem', display: 'block', marginBottom: '8px' }}>🤖</span>
              Halo! Saya adalah <strong>{agentName}</strong>.<br />
              Ketik instruksi di bawah (mis. <code>buat counter app dengan Flutter</code> atau <code>jalankan test</code>) untuk memulai.
            </div>
          ) : (
            <>
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    backgroundColor: m.role === 'user' ? 'var(--surface-2)' : 'transparent',
                    border: m.role === 'user' ? '1px solid var(--border-strong)' : 'none',
                    borderRadius: 'var(--r-lg)',
                    padding: m.role === 'user' ? '12px 16px' : '0',
                    color: 'var(--text)',
                  }}
                >
                  {m.role === 'user' ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  ) : (
                    <div
                      style={{
                        backgroundColor: 'var(--surface-0)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-lg)',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                      }}
                    >
                      <Markdown content={m.content} />
                      {findTaskIds(m.content).map(tid => (
                        <InlineTaskCard
                          key={tid}
                          taskId={tid}
                          tasks={tasks}
                          confirming={!!confirmingMap[tid]}
                          onConfirm={(approved) => handleConfirmTask(tid, approved)}
                        />
                      ))}
                      {m.usage && m.usage.total > 0 && (
                        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-faint)', marginTop: '8px', borderTop: '1px dashed var(--border)', paddingTop: '6px', alignSelf: 'stretch' }}>
                          💡 Total token: {m.usage.total}
                        </div>
                      )}
                      {m.usage && m.usage.total === 0 && (
                        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-faint)', marginTop: '8px', fontStyle: 'italic' }}>
                          (Dihentikan oleh operator)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming Content */}
              {streaming && (
                <div
                  style={{
                    alignSelf: 'flex-start',
                    maxWidth: '85%',
                    backgroundColor: 'var(--surface-0)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                  }}
                >
                  {streamContent ? (
                    <>
                      <Markdown content={streamContent} />
                      {findTaskIds(streamContent).map(tid => (
                        <InlineTaskCard
                          key={tid}
                          taskId={tid}
                          tasks={tasks}
                          confirming={!!confirmingMap[tid]}
                          onConfirm={(approved) => handleConfirmTask(tid, approved)}
                        />
                      ))}
                    </>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ opacity: 0.55, fontSize: 'var(--t-sm)', color: 'var(--text-dim)' }}>Hermes sedang berpikir</span>
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  )}
                  {streamUsage && (
                    <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-faint)', marginTop: '8px', borderTop: '1px dashed var(--border)', paddingTop: '6px', alignSelf: 'stretch' }}>
                      💡 Total token: {streamUsage.total}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Input box bottom bar */}
      <form
        onSubmit={handleSend}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: 'var(--surface-0)',
          padding: '12px 0',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        <Button
          type="button"
          variant={micState === 'recording' ? 'danger' : 'secondary'}
          disabled={streaming || micState === 'working'}
          title={
            micState === 'listening' ? 'Mendengarkan — bicara saja'
            : micState === 'recording' ? 'Merekam — klik untuk berhenti'
            : micState === 'working' ? 'Mentranskripsi…'
            : 'Klik atau tahan Ctrl+Space untuk bicara'
          }
          onClick={() => {
            holdingRef.current = false;
            if (micState === 'recording') pushToTalkStop();
            else pushToTalkStart();
          }}
          style={{ height: '44px', width: '52px' }}
        >
          {micState === 'recording' ? '⏹'
            : micState === 'working' ? '⏳'
            : micState === 'listening' ? '👂'
            : '🎤'}
        </Button>
        {speaking && (
          <Button
            type="button"
            variant="secondary"
            onClick={shutUp}
            title="Hentikan suara"
            style={{ height: '44px', padding: '0 12px' }}
          >
            🔇 Diam
          </Button>
        )}
        <input
          ref={inputRef}
          type="text"
          className="field-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Kirim tugas ke Hermes... (mis. @myproj jalankan test)"
          style={{ flex: 1, minHeight: '44px' }}
          disabled={streaming}
        />
        {streaming ? (
          <Button variant="danger" type="button" onClick={handleStop} style={{ height: '44px', width: '90px' }}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" type="submit" disabled={!inputText.trim()} style={{ height: '44px', width: '90px' }}>
            Send
          </Button>
        )}
      </form>
    </div>
  );
}
