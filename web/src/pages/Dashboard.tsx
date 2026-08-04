import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRoute } from '../router';
import { useTasks } from '../hooks/useTasks';
import { parseStreamBuffer, StreamEvent } from '../api/stream';
import { errorMessage, api } from '../api/client';
import { Markdown } from '../components/Markdown';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useTasksContext } from '../api/events';
import {
  loadTtsSettings, TtsMode, TtsPersonality,
  ttsRequest, TtsIntent, TtsRequestOptions,
  hasGreeted, markGreeted,
  loadVoiceSettings, VoiceSettings, VOICE_SETTINGS_DEFAULT,
} from '../tts';
import { SpeechQueue, HtmlAudioSink, sharedAudioSink, sharedSpeechQueue } from '../audio';
import { splitSentences, flushSentence } from '../sentences';
import { useVoiceLoop } from '../hooks/useVoiceLoop';
import { VoiceStateIndicator, deriveVoiceState } from '../components/VoiceStateIndicator';
import { STOP_ACK } from '../commands';
import { VoiceTagExtractor } from '../voicetag';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Object URLs for images sent with this turn. Display only, and only for
   *  this page load: the server deletes the files once it has answered. */
  images?: string[];
  usage?: {
    total: number;
  };
}

/** A write action (send email, delete file, …) the chat agent proposed and the
 *  operator must approve — by button or by voice ("konfirmasi" / "batal"). */
interface PendingAction {
  id: string;
  tool: string;
  summary: string;
  args: Record<string, unknown>;
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

interface GraphNode {
  id: string;
  label: string;
  type: 'core' | 'session' | 'task';
  status?: string;
  details?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphLink {
  source: string;
  target: string;
}

interface DashboardProps {
  sessionId?: string;
  onRefreshSessions?: () => void;
  onSelectNode?: (node: { id: string; label: string; type: string; details?: string; status?: string } | null) => void;
}

export function Dashboard({ sessionId, onRefreshSessions, onSelectNode }: DashboardProps) {
  const { isConnected } = useTasks();
  const { tasks } = useTasksContext();
  const { toast } = useToast();
  const { navigate } = useRoute();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [agentName, setAgentName] = useState('Lail Agent');

  const [ttsEnabled, setTtsEnabled] = useState<boolean>(false);
  const [ttsVoice, setTtsVoice] = useState<string>('en-US-AndrewMultilingualNeural');
  const [ttsMode, setTtsMode] = useState<TtsMode>('smart');
  const [ttsMaxWords, setTtsMaxWords] = useState<number>(40);
  const [ttsGreeting, setTtsGreeting] = useState<boolean>(true);
  const [ttsPersonality, setTtsPersonality] = useState<TtsPersonality>('professional');
  const [sttEnabled, setSttEnabled] = useState<boolean>(false);

  const [voice, setVoice] = useState<VoiceSettings>(VOICE_SETTINGS_DEFAULT);
  const [speaking, setSpeaking] = useState(false);
  const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
  const speakingRef = useRef(false);
  // Write actions the chat agent proposed, awaiting approval (button or voice).
  const [pending, setPending] = useState<PendingAction[]>([]);
  // Ids the operator closed without deciding. The action stays parked on the
  // server — this only decides whether the dialog is in their way right now.
  const [dismissedPending, setDismissedPending] = useState<string[]>([]);
  // One decision at a time: the oldest parked action, which is also the one a
  // voice "konfirmasi" resolves, so button and speech can never disagree.
  const reviewPending = pending.find((p) => !dismissedPending.includes(p.id));
  const pendingRef = useRef<PendingAction[]>([]);
  pendingRef.current = pending;
  const sinkRef = useRef<HtmlAudioSink | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null);

  const [sessions, setSessions] = useState<{ session_id: string; title: string; created: number }[]>([]);

  // ── Retrieve active sessions ──
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Gagal memuat sesi:', err);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions, sessionId]);

  if (queueRef.current === null && typeof window !== 'undefined') {
    // Shared with the SSE feed's server-driven speech (see audio.ts): two
    // queues would talk over each other, and barge-in would only silence one.
    sinkRef.current = sharedAudioSink();
    queueRef.current = sharedSpeechQueue();
    queueRef.current.observe({
      onSpeakingChange: (v) => { speakingRef.current = v; setSpeaking(v); },
      onFirstAudio: (ms) => {
        setFirstAudioMs(Math.round(ms));
        console.debug(`[voice] audio pertama: ${Math.round(ms)} ms`);
      },
    });
  }

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

  /** Speak one line straight through the verbatim synth endpoint, skipping the
   *  smart summariser. The <voice> opener and the no-tag fallback are already a
   *  single spoken sentence, so a summariser round trip would only add a whole
   *  LLM call (and its latency) to reword something that is already final. */
  const speakLine = useCallback((text: string) => {
    if (!ttsEnabled) return;
    const { endpoint, payload } = ttsRequest('verbatim', 'summary', {
      voice: ttsVoice,
      agentName,
      maxWords: ttsMaxWords,
      personality: ttsPersonality,
      text,
    });
    queueRef.current?.enqueue(endpoint, payload);
  }, [ttsEnabled, ttsVoice, agentName, ttsMaxWords, ttsPersonality]);

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
      setTtsPersonality(s.tts_personality);
    }).catch(() => {});

    loadVoiceSettings().then(setVoice).catch(() => {});
    // No stop() on unmount: the queue outlives this page now, and a task
    // notification arriving as the operator navigates away should still finish.
  }, []);

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

  // Task notifications are decided by the server and arrive as `speak` frames
  // on the SSE feed (hermes/brain.speech_for, rendered in api/events.tsx).
  // They used to be diffed here, which meant no announcement on any other page.
  
  const [inputText, setInputText] = useState('');
  // Images staged for the next turn. Held as Files until send: uploading on
  // pick would leave orphans on the server every time the operator changes
  // their mind.
  const [attached, setAttached] = useState<{ file: File; url: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const holdingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { micState, pushToTalkStart, pushToTalkStop, startWakeCapture } = useVoiceLoop({
    enabled: sttEnabled,
    handsfree: voice.voice_handsfree,
    bargeIn: voice.voice_barge_in,
    silenceMs: voice.voice_silence_ms,
    sensitivity: voice.voice_sensitivity,
    isSpeaking: () => speakingRef.current,
    onBargeIn: shutUp,
    onCommand: (cmd, text) => {
      if (cmd === 'stop') {
        shutUp();
        toast(STOP_ACK, 'ok');
        return;
      }
      // confirm / decline: only act when something is actually parked. With
      // nothing pending, a bare "ya" is ordinary speech — send it to the chat.
      if (pendingRef.current.length === 0) { void submitText(text); return; }
      void resolvePending(undefined, cmd === 'confirm');
    },
    onTranscript: (text) => {
      if (streaming) {
        setInputText((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        inputRef.current?.focus();
        return;
      }
      void submitText(text);
    },
    onError: (message) => toast(message, 'err'),
  });

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

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/pending');
      if (!res.ok) return;
      const list: PendingAction[] = await res.json();
      setPending(list);
      // Drop ids that no longer exist, so a future action with a recycled id
      // cannot arrive already dismissed.
      setDismissedPending((prev) => prev.filter((id) => list.some((p) => p.id === id)));
    } catch { /* transient; next poll retries */ }
  }, []);

  // Poll parked write actions so cards appear and voice "konfirmasi" knows
  // whether anything is pending.
  useEffect(() => {
    fetchPending();
    const id = setInterval(fetchPending, 1500);
    return () => clearInterval(id);
  }, [fetchPending]);

  /** Approve or decline a parked action. `id` omitted resolves the oldest — the
   *  shape a voice command uses, since speech carries no id. The backend appends
   *  the outcome to the thread, so refetch both. */
  const resolvePending = useCallback(async (id: string | undefined, approved: boolean) => {
    try {
      const res = await fetch('/api/chat/pending/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id, approved } : { approved }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.ok === false) toast('Tidak ada aksi tertunda', 'warn');
      else toast(approved ? 'Aksi dijalankan' : 'Aksi dibatalkan', approved ? 'ok' : 'warn');
    } catch {
      toast('Gagal memproses aksi', 'err');
    } finally {
      void fetchPending();
      void fetchChatHistory();
    }
  }, [fetchPending, fetchChatHistory, toast]);

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

  const scrollToBottom = useCallback(() => {
    if (chatThreadRef.current) {
      chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamContent, streaming, scrollToBottom]);

  /** Stage image files chosen, pasted or dropped. Non-images are ignored
   *  rather than refused loudly: a paste often carries several flavours of the
   *  same clipboard entry, only one of which is the picture. */
  const addFiles = (files: Iterable<File>) => {
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (picked.length === 0) return;
    setAttached((prev) => [
      ...prev,
      ...picked.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
  };

  const removeAttached = (idx: number) => {
    setAttached((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  /** Upload the staged files, returning the names the server gave them.
   *  A file the server rejects is reported and skipped — the rest of the turn
   *  still goes, rather than failing on one bad picture. */
  const uploadAttached = async (): Promise<string[]> => {
    const ids: string[] = [];
    for (const a of attached) {
      try {
        const url = sessionId ? `/api/uploads?session_id=${sessionId}` : '/api/uploads';
        const res = await fetch(url, { method: 'POST', body: a.file });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          toast(detail.detail || `Gagal mengunggah ${a.file.name}`, 'err');
          continue;
        }
        ids.push((await res.json()).id);
      } catch {
        toast(`Gagal mengunggah ${a.file.name}`, 'err');
      }
    }
    return ids;
  };

  const submitText = async (text: string) => {
    if ((!text && attached.length === 0) || streaming) return;
    // An image with no caption still needs words: an empty text part is
    // rejected by some providers, and the operator should see exactly what
    // was asked on their behalf.
    if (!text) text = 'Tolong analisa gambar ini.';
    const staged = attached;
    const imageIds = await uploadAttached();
    setAttached([]);

    setInputText('');
    setStreaming(true);
    setStreamContent('');
    setStreamUsage(null);

    shutUp();
    setFirstAudioMs(null);
    queueRef.current?.markTurnStart();
    if (ttsEnabled) sinkRef.current?.unlock();

    const userMsg: Message = {
      role: 'user', content: text,
      images: staged.map((a) => a.url),
    };
    setMessages((prev) => [...prev, userMsg]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let accumulatedText = '';
    let speechBuffer = '';
    const extractor = new VoiceTagExtractor();
    const streamSpeech = ttsEnabled && ttsMode === 'verbatim';
    const wantsVoiceTag = ttsEnabled && ttsMode === 'smart';
    // Smart-mode turn state: `spokeOpener` once the <voice> line has been sent,
    // `earlyVerbatim` once we gave up on a tag the model never opened and began
    // streaming its prose verbatim instead. Either one means the post-stream
    // summariser fallback must NOT also fire.
    let spokeOpener = false;
    let earlyVerbatim = false;
    let accumulatedUsage: { total: number } | null = null;

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, session_id: sessionId, images: imageIds }),
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
            const { display, voice: spoken } = extractor.push(ev.delta);
            if (spoken && wantsVoiceTag && !earlyVerbatim) {
              // The opener is already the one sentence to speak — synth it
              // directly, no summariser round trip.
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
                // Visible prose arrived with no <voice> tag opened before it, so
                // no opener is coming. Stream the reply verbatim as it lands —
                // audio trails the text by ~1s — rather than waiting for the
                // whole reply plus a summariser round trip.
                earlyVerbatim = true;
                speechBuffer += display;
                const { sentences, remainder } = splitSentences(speechBuffer);
                speechBuffer = remainder;
                for (const s of sentences) speakLine(s);
              }
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

      const tail = extractor.flush();
      if (tail.display) {
        accumulatedText += tail.display;
        setStreamContent(accumulatedText);
      }

      const assistantMsg: Message = {
        role: 'assistant',
        content: accumulatedText || '(tidak ada balasan)',
        usage: accumulatedUsage || undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (streamSpeech) {
        if (tail.display) {
          speechBuffer += tail.display;
          const { sentences, remainder } = splitSentences(speechBuffer);
          speechBuffer = remainder;
          for (const s of sentences) speak('summary', { text: s });
        }
        for (const s of flushSentence(speechBuffer)) speak('summary', { text: s });
      } else if (earlyVerbatim) {
        // No tag: we streamed the prose verbatim. Flush the last, unterminated
        // sentence so nothing is left unspoken.
        if (tail.display) speechBuffer += tail.display;
        for (const s of flushSentence(speechBuffer)) speakLine(s);
      } else if (!spokeOpener && !extractor.sawTag) {
        // Reply too short to have split a sentence and carried no tag — last
        // resort, summarise the whole thing. Rare.
        speak('summary', { text: accumulatedText });
      }
      if (onRefreshSessions) {
        onRefreshSessions();
      }
      // Reload sessions list
      fetchSessions();
    } catch (err) {
      shutUp();
      if (err instanceof Error && err.name === 'AbortError') {
        const assistantMsg: Message = {
          role: 'assistant',
          content: accumulatedText || '(dihentikan oleh operator)',
          usage: { total: 0 },
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

  const voiceState = deriveVoiceState({
    speaking,
    streaming,
    transcribing: micState === 'working',
    micActive: micState === 'listening' || micState === 'recording',
  });

  useEffect(() => {
    const post = () => {
      void fetch('/api/voice/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: voiceState }),
      }).catch(() => {});
    };
    post();
    const id = setInterval(post, 5000);
    return () => clearInterval(id);
  }, [voiceState]);

  useEffect(() => {
    const id = setInterval(() => {
      if (streaming) return;
      void fetch('/api/voice/wake')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.wake) startWakeCapture(); })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [streaming, startWakeCapture]);

  // ── Force-directed Graph Layout Physics Engine ──
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 320, y: 220 });
  const [showLabels, setShowLabels] = useState(true);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const bgRectRef = useRef<SVGRectElement | null>(null);
  const draggedNodeIdRef = useRef<string | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const nodesStateRef = useRef<Record<string, { x: number; y: number; vx: number; vy: number }>>({});

  // Derive graph structure
  const initialGraph = useMemo(() => {
    const nodes: GraphNode[] = [
      { id: 'core', label: 'Hermes Core', type: 'core', status: 'stable', details: 'Cognitive system coordinator core mainframe.', x: 0, y: 0, vx: 0, vy: 0 }
    ];
    const links: GraphLink[] = [];

    // Session nodes
    sessions.forEach((s) => {
      const cached = nodesStateRef.current[s.session_id] || {
        x: (Math.random() - 0.5) * 160,
        y: (Math.random() - 0.5) * 160,
        vx: 0,
        vy: 0
      };
      nodesStateRef.current[s.session_id] = cached;
      nodes.push({
        id: s.session_id,
        label: s.title,
        type: 'session',
        status: sessionId === s.session_id ? 'active' : 'idle',
        details: `Chat logs sequence. Timestamp: ${new Date(s.created * 1000).toLocaleString()}`,
        ...cached
      });
      links.push({ source: 'core', target: s.session_id });
    });

    // Task nodes connected to active session
    tasks.forEach((t) => {
      const targetSessionId = (t as any).session_id || sessionId || 'core';
      const cached = nodesStateRef.current[t.task_id] || {
        x: (Math.random() - 0.5) * 320,
        y: (Math.random() - 0.5) * 320,
        vx: 0,
        vy: 0
      };
      nodesStateRef.current[t.task_id] = cached;
      nodes.push({
        id: t.task_id,
        label: t.text.length > 25 ? t.text.substring(0, 22) + '...' : t.text,
        type: 'task',
        status: t.status,
        details: `Task Instruction: "${t.text}"`,
        ...cached
      });
      links.push({ source: targetSessionId, target: t.task_id });
    });

    return { nodes, links };
  }, [sessions, tasks, sessionId]);

  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphLinks, setGraphLinks] = useState<GraphLink[]>([]);

  // Simulation physics loop
  useEffect(() => {
    let animId: number;
    const runSimulation = () => {
      const { nodes: cNodes, links: cLinks } = initialGraph;
      if (cNodes.length === 0) return;

      const kRepel = 240;
      const kLink = 0.05;
      const linkLen = 80;
      const kGravity = 0.015;
      const damping = 0.8;

      // Charge repulsion
      for (let i = 0; i < cNodes.length; i++) {
        const n1 = cNodes[i];
        for (let j = i + 1; j < cNodes.length; j++) {
          const n2 = cNodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = dx * dx + dy * dy + 1;
          const dist = Math.sqrt(distSq);
          if (dist < 220) {
            const force = kRepel / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            n1.vx -= fx;
            n1.vy -= fy;
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }

      // Link attraction
      cLinks.forEach((link) => {
        const sourceNode = cNodes.find(n => n.id === link.source);
        const targetNode = cNodes.find(n => n.id === link.target);
        if (sourceNode && targetNode) {
          const dx = targetNode.x - sourceNode.x;
          const dy = targetNode.y - sourceNode.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
          const delta = dist - linkLen;
          const force = delta * kLink;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          sourceNode.vx += fx;
          sourceNode.vy += fy;
          targetNode.vx -= fx;
          targetNode.vy -= fy;
        }
      });

      // Update positions
      cNodes.forEach((node) => {
        node.vx -= node.x * kGravity;
        node.vy -= node.y * kGravity;

        if (node.id === draggedNodeIdRef.current) {
          node.vx = 0;
          node.vy = 0;
        } else {
          node.x += node.vx;
          node.y += node.vy;
          node.vx *= damping;
          node.vy *= damping;
        }

        if (nodesStateRef.current[node.id]) {
          nodesStateRef.current[node.id].x = node.x;
          nodesStateRef.current[node.id].y = node.y;
          nodesStateRef.current[node.id].vx = node.vx;
          nodesStateRef.current[node.id].vy = node.vy;
        }
      });

      setGraphNodes([...cNodes]);
      setGraphLinks([...cLinks]);
      animId = requestAnimationFrame(runSimulation);
    };

    animId = requestAnimationFrame(runSimulation);
    return () => cancelAnimationFrame(animId);
  }, [initialGraph]);

  // Pan & Zoom Drag listeners
  const handleSvgMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current || e.target === bgRectRef.current) {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleSvgMouseMove = (e: React.MouseEvent) => {
    if (isPanningRef.current) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y
      });
    } else if (draggedNodeIdRef.current) {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (svgRect) {
        const mx = (e.clientX - svgRect.left - pan.x) / zoom;
        const my = (e.clientY - svgRect.top - pan.y) / zoom;
        const node = graphNodes.find(n => n.id === draggedNodeIdRef.current);
        if (node) {
          node.x = mx;
          node.y = my;
          if (nodesStateRef.current[node.id]) {
            nodesStateRef.current[node.id].x = mx;
            nodesStateRef.current[node.id].y = my;
          }
        }
      }
    }
  };

  const handleSvgMouseUp = () => {
    isPanningRef.current = false;
    draggedNodeIdRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    const scale = e.deltaY < 0 ? 1.05 : 0.95;
    setZoom(z => Math.max(0.3, Math.min(3, z * scale)));
  };

  const handleFit = () => {
    setZoom(1);
    setPan({ x: 320, y: 220 });
  };

  // Node interactivity
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    draggedNodeIdRef.current = nodeId;
  };

  const handleNodeClick = (node: GraphNode) => {
    if (onSelectNode) {
      onSelectNode({
        id: node.id,
        label: node.label,
        type: node.type,
        status: node.status,
        details: node.details
      });
    }
  };

  const handleNodeDoubleClick = (node: GraphNode) => {
    if (node.type === 'session') {
      navigate(`#/session/${node.id}`);
    }
  };

  // Right sidebar counts
  const taskCounts = useMemo(() => {
    const counts = { queued: 0, running: 0, done: 0, failed: 0, pending: 0 };
    tasks.forEach(t => {
      if (t.status === 'queued') counts.queued++;
      else if (t.status === 'running') counts.running++;
      else if (t.status === 'done') counts.done++;
      else if (t.status === 'failed') counts.failed++;
      else counts.pending++;
    });
    return counts;
  }, [tasks]);

  // Readouts showing latest messages
  const lastMessages = useMemo(() => {
    return messages.slice(-3);
  }, [messages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%', position: 'relative' }}>
      
      {/* Reconnect Warning HUD Bar */}
      {!isConnected && (
        <div
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            backgroundColor: 'var(--err)',
            color: 'var(--text)',
            padding: '6px 16px',
            textAlign: 'center',
            fontWeight: 'bold',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            zIndex: 10,
            boxShadow: '0 0 15px var(--err)',
            borderBottom: '1px solid rgba(255, 0, 80, 0.4)',
          }}
        >
          ⚠️ ALERT: INTERFACE COGNITIVE SERVER OFFLINE. CONNECTING...
        </div>
      )}

      {/* Center Viewport */}
      <div className="dashboard-hud-container" style={{ marginTop: !isConnected ? '30px' : '0' }}>
        
        {/* Top Controls Toolbar */}
        <div className="graph-controls">
          <button className="control-btn" onClick={handleFit}>Fit</button>
          <button className={`control-btn ${showLabels ? 'active' : ''}`} onClick={() => setShowLabels(!showLabels)}>Aa</button>
          <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--border)' }}></div>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
            NODE_COUNT: {graphNodes.length}
          </span>
        </div>

        {/* Interactive SVG force graph */}
        <div 
          className="graph-canvas-container"
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onMouseLeave={handleSvgMouseUp}
          onWheel={handleWheel}
        >
          <svg className="graph-svg" ref={svgRef}>
            <rect ref={bgRectRef} width="100%" height="100%" fill="transparent" />
            
            {/* Jarvis HUD Stationary Overlay */}
            <g style={{ pointerEvents: 'none' }}>
              {/* Radar Crosshairs */}
              <line x1="5%" y1="50%" x2="45%" y2="50%" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,6" opacity="0.3" />
              <line x1="55%" y1="50%" x2="95%" y2="50%" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,6" opacity="0.3" />
              <line x1="50%" y1="5%" x2="50%" y2="40%" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,6" opacity="0.3" />
              <line x1="50%" y1="60%" x2="50%" y2="95%" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,6" opacity="0.3" />

              {/* Diagonal Crosshairs ticks */}
              <line x1="48%" y1="48%" x2="49%" y2="49%" stroke="var(--accent)" strokeWidth="1.5" opacity="0.5" />
              <line x1="52%" y1="48%" x2="51%" y2="49%" stroke="var(--accent)" strokeWidth="1.5" opacity="0.5" />
              <line x1="48%" y1="52%" x2="49%" y2="51%" stroke="var(--accent)" strokeWidth="1.5" opacity="0.5" />
              <line x1="52%" y1="52%" x2="51%" y2="51%" stroke="var(--accent)" strokeWidth="1.5" opacity="0.5" />

              {/* Concentric rings centered at (50%, 50%) */}
              <circle cx="50%" cy="50%" r="50" stroke="var(--accent)" strokeWidth="1" fill="none" opacity="0.1" />
              <circle cx="50%" cy="50%" r="90" stroke="var(--accent)" strokeWidth="0.5" fill="none" opacity="0.15" strokeDasharray="5,10" />
              
              {/* Rotating outer rings */}
              <circle cx="50%" cy="50%" r="160" stroke="var(--accent)" strokeWidth="1" fill="none" opacity="0.25" strokeDasharray="90,10,30,10" className="hud-spin-cw" />
              <circle cx="50%" cy="50%" r="165" stroke="var(--accent)" strokeWidth="0.75" fill="none" opacity="0.15" strokeDasharray="6,12" className="hud-spin-ccw" />
              <circle cx="50%" cy="50%" r="240" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.2" strokeDasharray="180,15,40,15" className="hud-spin-ccw" />
              
              {/* Outer boundary bracket lines or ring */}
              <circle cx="50%" cy="50%" r="320" stroke="var(--border)" strokeWidth="0.5" fill="none" opacity="0.15" strokeDasharray="4,8" />
              
              {/* Ring with tick marks (compass style) */}
              <circle cx="50%" cy="50%" r="130" stroke="var(--accent)" strokeWidth="3" fill="none" opacity="0.12" strokeDasharray="2,8" className="hud-spin-ccw" />
            </g>

            {/* HUD Telemetry Labels */}
            <g style={{ pointerEvents: 'none', fontFamily: 'var(--font-mono)', fontSize: '8px', fill: 'var(--text-faint)' }}>
              {/* Center-left readout */}
              <text x="38%" y="45%" opacity="0.45">SYS.LOC: [45.9281, -12.4092]</text>
              <text x="38%" y="47%" opacity="0.45">ALT.REF: 1,024m</text>
              <text x="38%" y="49%" opacity="0.45">RADAR.SYNC: 98.4%</text>

              {/* Center-right readout */}
              <text x="62%" y="45%" opacity="0.45" textAnchor="end">CORE_TEMP: 38.2°C</text>
              <text x="62%" y="47%" opacity="0.45" textAnchor="end">GRID_STATUS: ACTIVE</text>
              <text x="62%" y="49%" opacity="0.45" textAnchor="end">COGNITIVE_SYNC: 1.0</text>
              
              {/* Circular percentage widget status */}
              <text x="44%" y="58%" opacity="0.5">N-LOCK: TRUE</text>
              <text x="56%" y="58%" opacity="0.5" textAnchor="end">DECRYPT: 100%</text>
            </g>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              
              {/* Force Link lines */}
              {graphLinks.map((link, idx) => {
                const sNode = graphNodes.find(n => n.id === link.source);
                const tNode = graphNodes.find(n => n.id === link.target);
                if (!sNode || !tNode) return null;
                return (
                  <line
                    key={idx}
                    className="graph-link"
                    x1={sNode.x}
                    y1={sNode.y}
                    x2={tNode.x}
                    y2={tNode.y}
                  />
                );
              })}

              {/* Force Node circles */}
              {graphNodes.map((node) => {
                const isFocused = sessionId === node.id;
                let fill = 'var(--text-dim)';
                let size = 8;
                let stroke = 'rgba(3,6,10,0.8)';
                let glow = 'none';

                if (node.type === 'core') {
                  fill = 'var(--accent)';
                  size = 18;
                  glow = 'drop-shadow(0 0 8px var(--accent))';
                } else if (node.type === 'session') {
                  fill = isFocused ? 'var(--accent)' : 'rgba(180, 100, 50, 0.45)';
                  size = isFocused ? 14 : 11;
                  glow = isFocused ? 'drop-shadow(0 0 6px var(--accent))' : 'none';
                  stroke = isFocused ? 'var(--text)' : 'rgba(3,6,10,0.8)';
                } else if (node.type === 'task') {
                  size = 7;
                  if (node.status === 'queued') fill = '#888';
                  else if (node.status === 'running') { fill = 'var(--accent)'; glow = 'drop-shadow(0 0 4px var(--accent))'; }
                  else if (node.status === 'done') { fill = 'var(--ok)'; glow = 'drop-shadow(0 0 4px var(--ok))'; }
                  else if (node.status === 'failed') { fill = 'var(--err)'; glow = 'drop-shadow(0 0 4px var(--err))'; }
                }

                return (
                  <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                    <circle
                      className="graph-node"
                      r={size}
                      fill={fill}
                      stroke={stroke}
                      style={{ filter: glow }}
                      onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                      onClick={() => handleNodeClick(node)}
                      onDoubleClick={() => handleNodeDoubleClick(node)}
                    />
                    {showLabels && (
                      <text
                        y={size + 12}
                        className={`graph-label ${isFocused ? 'focused' : ''}`}
                        style={{ fontSize: node.type === 'core' ? '10px' : '9px' }}
                      >
                        {node.label}
                      </text>
                    )}
                  </g>
                );
              })}

            </g>
          </svg>
        </div>

        <Modal
          isOpen={!!reviewPending}
          onClose={() => reviewPending && setDismissedPending((prev) => [...prev, reviewPending.id])}
          title="⚠️ Perlu konfirmasi"
        >
          {reviewPending && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontWeight: 600 }}>{reviewPending.summary}</div>
              <code style={{
                fontSize: '11px', color: 'var(--text-dim)', whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', maxHeight: '160px', overflow: 'auto',
                padding: '8px', border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)', background: 'var(--surface-1)',
              }}>
                {JSON.stringify(reviewPending.args, null, 2)}
              </code>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <Button variant="primary" onClick={() => resolvePending(reviewPending.id, true)}>
                  Jalankan
                </Button>
                <Button variant="danger" onClick={() => resolvePending(reviewPending.id, false)}>
                  Batalkan
                </Button>
                <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>
                  atau ucapkan "konfirmasi" / "batal"
                </span>
              </div>
              {pending.length > 1 && (
                <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>
                  {pending.length - 1} aksi lain menunggu setelah ini.
                </span>
              )}
            </div>
          )}
        </Modal>

        {/* A parked action is a decision, so it interrupts rather than waiting
            to be noticed in the column. Dismissing only hides it — the action
            stays parked, and the chip below brings it back. */}
        {pending.length > 0 && !reviewPending && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 10px',
            padding: '8px 10px', border: '1px solid var(--warn)',
            borderRadius: 'var(--r-sm)', background: 'rgba(240,170,40,0.06)',
          }}>
            <span style={{ color: 'var(--warn)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
              ⚠️ {pending.length} aksi menunggu konfirmasi
            </span>
            <Button variant="secondary" size="small" onClick={() => setDismissedPending([])}>
              Tinjau
            </Button>
          </div>
        )}

        {/* Staged images, directly above the input they will be sent with */}
        {attached.length > 0 && (
          <div style={{
            display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center',
            padding: '8px', margin: '0 0 8px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            background: 'var(--surface-1)',
          }}>
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)',
                           color: 'var(--accent)', letterSpacing: '0.08em' }}>
              AKAN DIKIRIM
            </span>
            {attached.map((a, idx) => (
              <div key={a.url} style={{ position: 'relative' }}>
                <img
                  src={a.url}
                  alt={a.file.name}
                  style={{ width: '56px', height: '56px', objectFit: 'cover',
                           borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}
                />
                <button
                  type="button"
                  onClick={() => removeAttached(idx)}
                  title="Buang gambar"
                  style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px',
                           height: '18px', borderRadius: '50%', border: '1px solid var(--border)',
                           background: 'var(--surface-0)', color: 'var(--text)', lineHeight: 1,
                           fontSize: '11px', cursor: 'pointer' }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Bottom prompt input bar form */}
        <form onSubmit={handleSend} className="ask-prompt-form">
          <input
            ref={inputRef}
            type="text"
            className="ask-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onPaste={(e) => addFiles(e.clipboardData.files)}
            placeholder='Ask Hermes: "plan my day" or directive...'
            disabled={streaming}
          />
          <div className="ask-actions">

            {/* Attach an image for this turn */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';   // same file twice in a row still fires
              }}
            />
            <button
              type="button"
              className="ask-action-btn"
              disabled={streaming}
              title="Lampirkan gambar (bisa juga tempel dari clipboard)"
              onClick={() => fileInputRef.current?.click()}
            >
              📎
            </button>
            
            {/* Audio MUTE feedback */}
            {speaking && (
              <button
                type="button"
                className="ask-action-btn active"
                onClick={shutUp}
                title="Hentikan suara"
              >
                🔇
              </button>
            )}

            {/* Mic push to talk toggling */}
            <button
              type="button"
              className={`ask-action-btn ${micState === 'recording' ? 'active' : ''}`}
              disabled={streaming || micState === 'working'}
              title={
                micState === 'listening' ? 'Mendengarkan — bicara saja'
                : micState === 'recording' ? 'Merekam — klik untuk berhenti'
                : micState === 'working' ? 'Mentranskripsi…'
                : 'Klik untuk bicara'
              }
              onClick={() => {
                holdingRef.current = false;
                if (micState === 'recording') pushToTalkStop();
                else pushToTalkStart();
              }}
              style={{
                borderColor: micState === 'recording' ? 'var(--err)' : 'var(--border)',
                color: micState === 'recording' ? 'var(--err)' : 'inherit'
              }}
            >
              {micState === 'recording' ? '⏹'
                : micState === 'working' ? '⏳'
                : micState === 'listening' ? '👂'
                : '🎤'}
            </button>

            {streaming ? (
              <Button variant="danger" type="button" onClick={handleStop} style={{ height: '32px', padding: '0 12px', minHeight: '32px' }}>
                STOP
              </Button>
            ) : (
              <Button variant="primary" type="submit" disabled={!inputText.trim()} style={{ height: '32px', padding: '0 12px', minHeight: '32px' }}>
                SEND
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* Right Sidebar Column */}
      <div className="right-hud-panel" style={{ marginTop: !isConnected ? '30px' : '0' }}>
        
        {/* Filters Widget */}
        <div>
          <div className="right-section-title">
            <span>Filter</span>
            <span>Tasks</span>
          </div>
          <div className="filter-list">
            <div className="filter-item">
              <div className="filter-item-label">
                <span className="filter-dot" style={{ backgroundColor: 'var(--accent)' }}></span>
                <span>Active / Running</span>
              </div>
              <span className="filter-count">{taskCounts.running}</span>
            </div>
            <div className="filter-item">
              <div className="filter-item-label">
                <span className="filter-dot" style={{ backgroundColor: 'var(--ok)' }}></span>
                <span>Completed</span>
              </div>
              <span className="filter-count">{taskCounts.done}</span>
            </div>
            <div className="filter-item">
              <div className="filter-item-label">
                <span className="filter-dot" style={{ backgroundColor: 'var(--err)' }}></span>
                <span>Failed</span>
              </div>
              <span className="filter-count">{taskCounts.failed}</span>
            </div>
            <div className="filter-item">
              <div className="filter-item-label">
                <span className="filter-dot" style={{ backgroundColor: '#888' }}></span>
                <span>Queued</span>
              </div>
              <span className="filter-count">{taskCounts.queued}</span>
            </div>
          </div>
        </div>

        {/* Current Readout Log */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="right-section-title">
            <span>Current Readout</span>
            <span>Feed</span>
          </div>
          <div className="chat-preview-container" ref={chatThreadRef}>
            {loadingHistory ? (
              <div style={{ color: 'var(--text-faint)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>RETRIEVING READOUTS...</div>
            ) : lastMessages.length === 0 && !streaming ? (
              <div style={{ color: 'var(--text-faint)', fontSize: '11px', fontStyle: 'italic', margin: 'auto' }}>Logs sequence ready. Input command.</div>
            ) : (
              <>
                {lastMessages.map((m, idx) => (
                  <div key={idx} className={`chat-preview-card ${m.role === 'user' ? 'user' : ''}`}>
                    <div className="chat-preview-header">
                      {m.role === 'user' ? 'OPERATOR DIRECTIVE' : `${agentName.toUpperCase()} OUTPUT`}
                    </div>
                    {m.role === 'user' ? (
                      <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                        {m.content}
                        {m.images && m.images.length > 0 && (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                            {m.images.map((src) => (
                              <img
                                key={src}
                                src={src}
                                alt="lampiran"
                                style={{ width: '72px', height: '72px', objectFit: 'cover',
                                         borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
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
                      </div>
                    )}
                  </div>
                ))}

                {/* Streaming in preview */}
                {streaming && (
                  <div className="chat-preview-card">
                    <div className="chat-preview-header" style={{ animation: 'cyber-blink 1s infinite' }}>
                      INCOMING STREAM READOUT...
                    </div>
                    {streamContent ? (
                      <div>
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
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>CONNECTING STREAM</span>
                        <div className="typing-indicator">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pulsing AI avatar orb */}
        <div>
          <div className="right-section-title">
            <span>Hologram Link</span>
            <span>Online</span>
          </div>
          <div className="avatar-stream-container">
            <div className="avatar-stream-overlay">
              AI_COGNITIVE_CORE: ACTIVE
            </div>
            <div className="avatar-glowing-circle" style={{
              animationDuration: voiceState === 'listen' ? '6s'
                : voiceState === 'think' ? '3s'
                : voiceState === 'speak' ? '1.5s'
                : '12s'
            }}></div>
          </div>
        </div>

      </div>

    </div>
  );
}
