import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRoute } from '../router';
import { useTasks } from '../hooks/useTasks';
import { parseStreamBuffer, StreamEvent } from '../api/stream';
import { errorMessage, api } from '../api/client';
import { PendingAction } from '../api/types';
import { Markdown } from '../components/Markdown';
import { findTaskIds, InlineTaskCard, ClaudeThinkingIndicator, confirmTask } from '../components/TaskCard';
import { CopyButton } from '../components/CopyButton';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { CameraCapture, CameraHandle } from '../components/CameraCapture';
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
import { STOP_ACK, CAMERA_ACK, matchLocalCommand } from '../commands';
import { VoiceTagExtractor } from '../voicetag';
import { WaveConstellationGraph } from '../components/WaveConstellationGraph';
import { taskLinkTarget } from '../graph';
import {
  Plus,
  Mic,
  Volume2,
  VolumeX,
  Volume1,
  Zap,
  Square,
  X,
  Activity,
  AlertTriangle,
  CornerUpLeft,
} from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Object URLs for images sent with this turn. Display only, and only for
   *  this page load: the server deletes the files once it has answered. */
  images?: string[];
  /** Filenames of documents sent with this turn. Display only. */
  docNames?: string[];
  usage?: {
    total: number;
  };
  /** Set when this turn was sent as a reply — the quoted snippet + whose
   *  message it quoted, rendered as a small quote box above the bubble. */
  reply_snippet?: string | null;
  reply_role?: 'user' | 'assistant' | null;
}

/** What the operator is currently replying to, captured off a rendered
 *  bubble — not a message id, so it works even for a message that streamed
 *  in this session and has no server id yet. Cleared once sent. */
interface ReplyTarget {
  role: 'user' | 'assistant';
  snippet: string;
}

const REPLY_SNIPPET_MAX = 300;

function truncateSnippet(text: string, max: number = REPLY_SNIPPET_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '...' : flat;
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
  isDrawerOpen?: boolean;
  onToggleDrawer?: () => void;
}

export function Dashboard({ sessionId, onRefreshSessions, onSelectNode, isDrawerOpen, onToggleDrawer }: DashboardProps) {
  const { isConnected } = useTasks();
  const { tasks } = useTasksContext();
  const { toast } = useToast();
  const { navigate } = useRoute();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
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
  // resolvePending fires the continuation turn, but submitText is declared far
  // below it and is rebuilt every render. A ref keeps the callback pointed at
  // the current one without dragging it into the dependency list.
  const submitTextRef = useRef<(text: string, opts?: { resume?: boolean }) => Promise<void>>(
    async () => {},
  );
  const sinkRef = useRef<HtmlAudioSink | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null);

  const [sessions, setSessions] = useState<{ session_id: string; title: string; created: number; project?: string; engine?: string; chat_model?: string }[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  // '' = use Settings' default chat model. A non-empty value is an explicit
  // per-session override, picked from the live catalog /api/chat-models
  // pulls off whatever provider Settings.nvidia_base_url points at (NVIDIA,
  // DeepSeek, a local 9Router gateway, ...).
  const [plannerModel, setPlannerModel] = useState<string>('');
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [defaultChatModel, setDefaultChatModel] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [selectedEngine, setSelectedEngine] = useState<string>('auto');

  const currentSession = useMemo(() => sessions.find((s) => s.session_id === sessionId), [sessions, sessionId]);

  useEffect(() => {
    if (currentSession) {
      setSelectedProject(currentSession.project || '');
      setSelectedEngine(currentSession.engine || 'auto');
      setPlannerModel(currentSession.chat_model || '');
    } else {
      setSelectedProject('');
      setSelectedEngine('auto');
      setPlannerModel('');
    }
  }, [currentSession]);

  useEffect(() => {
    api.getChatModels()
      .then((res) => { setChatModels(res.models); setDefaultChatModel(res.default); })
      .catch(() => {});
  }, []);

  const handleProjectChange = async (proj: string) => {
    setSelectedProject(proj);
    const activeSid = sessionId || 'web';
    try {
      await fetch(`/api/sessions/${activeSid}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: proj }),
      });
      fetchSessions();
    } catch (e) {
      console.error('Gagal memperbarui proyek session:', e);
    }
  };

  const handleEngineChange = async (eng: string) => {
    setSelectedEngine(eng);
    const activeSid = sessionId || 'web';
    try {
      await fetch(`/api/sessions/${activeSid}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: eng }),
      });
      fetchSessions();
    } catch (e) {
      console.error('Gagal memperbarui engine session:', e);
    }
  };

  const handleModelChange = async (model: string) => {
    setPlannerModel(model);
    const activeSid = sessionId || 'web';
    try {
      await fetch(`/api/sessions/${activeSid}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_model: model }),
      });
      fetchSessions();
    } catch (e) {
      console.error('Gagal memperbarui model chat session:', e);
    }
  };

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
      if (s.projects) {
        setProjects(Object.keys(s.projects).sort());
      }
      if (s.model) {
        setPlannerModel(s.model);
      }
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
  // Images and documents staged for the next turn. Held as Files until send:
  // uploading on pick would leave orphans on the server every time the
  // operator changes their mind.
  const [attached, setAttached] = useState<
    { file: File; url: string; kind: 'image' | 'document' }[]
  >([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  // "Auto-jelaskan": while on and the camera is open, every spoken turn grabs
  // the current frame and asks the agent what is in view. Held in a ref too, so
  // the voice-loop transcript handler reads the live value without being
  // rebuilt (which would tear down the mic) on every toggle.
  const [narrate, setNarrate] = useState(false);
  const narrateRef = useRef(false);
  narrateRef.current = narrate;
  const cameraRef = useRef<CameraHandle>(null);
  const cameraOpenRef = useRef(false);
  cameraOpenRef.current = cameraOpen;
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
      if (cmd === 'camera') {
        setCameraOpen(true);
        toast(CAMERA_ACK, 'ok');
        return;
      }
      // confirm / decline: only act when something is actually parked. With
      // nothing pending, a bare "ya" is ordinary speech — send it to the chat.
      if (pendingRef.current.length === 0) { void submitText(text); return; }
      void resolvePending(undefined, cmd === 'confirm');
    },
    onTranscript: (text) => {
      // Auto-jelaskan: the operator is holding something up and talking about
      // it. Snap the frame and let the vision model answer over the picture,
      // instead of sending the words alone.
      if (narrateRef.current && cameraOpenRef.current) {
        void narrateTurn(text);
        return;
      }
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
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [streamUsage, setStreamUsage] = useState<{ total: number } | null>(null);
  const [confirmingMap, setConfirmingMap] = useState<Record<string, boolean>>({});
  // Which conversation the in-flight stream belongs to. This component survives
  // a session switch (only the prop changes), so without it the live readout and
  // the finished reply both followed the operator into whatever session they
  // opened next — an answer to a question that thread never asked.
  const [streamSession, setStreamSession] = useState<string | undefined>(undefined);
  // The session as of *now*, readable from inside a stream closure that captured
  // the session it started in.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // The stream is still running in the background when it belongs elsewhere; it
  // is only drawn on its own thread. Its reply is stored server-side either way,
  // so switching back re-reads it from the history.
  const showStream = streaming && streamSession === sessionId;

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
      const url = sessionId ? `/api/chat/pending?session_id=${sessionId}` : '/api/chat/pending';
      const res = await fetch(url);
      if (!res.ok) return;
      const list: PendingAction[] = await res.json();
      setPending(list);
      // Drop ids that no longer exist, so a future action with a recycled id
      // cannot arrive already dismissed.
      setDismissedPending((prev) => prev.filter((id) => list.some((p) => p.id === id)));
    } catch { /* transient; next poll retries */ }
  }, [sessionId]);

  // Poll parked write actions so cards appear and voice "konfirmasi" knows
  // whether anything is pending.
  useEffect(() => {
    fetchPending();
    const id = setInterval(fetchPending, 1500);
    return () => clearInterval(id);
  }, [fetchPending]);

  /** Approve or decline a parked action. `id` omitted resolves the oldest — the
   *  shape a voice command uses, since speech carries no id. The backend appends
   *  the outcome to the thread, so refetch both.
   *
   *  Approving is not the end of the turn: the agent's turn ended when the action
   *  was parked, so a `resume` flag comes back and we drive one more model turn.
   *  Without it the tool ran, its result sat in the thread unread, and the agent
   *  looked like it had stopped dead. The history refetch is awaited first so the
   *  outcome is on screen before the continuation streams under it. */
  const resolvePending = useCallback(async (id: string | undefined, approved: boolean) => {
    let shouldResume = false;
    try {
      const res = await fetch('/api/chat/pending/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, ...(id ? { id } : {}), ...(sessionId ? { session_id: sessionId } : {}) }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.ok === false) toast('Tidak ada aksi tertunda', 'warn');
      else {
        toast(approved ? 'Aksi dijalankan' : 'Aksi dibatalkan', approved ? 'ok' : 'warn');
        shouldResume = data?.resume === true;
      }
    } catch {
      toast('Gagal memproses aksi', 'err');
    } finally {
      void fetchPending();
      await fetchChatHistory();
    }
    // Outside the try: a resume failure is the stream's own to report, and must
    // not be swallowed as "Gagal memproses aksi".
    if (shouldResume) await submitTextRef.current('', { resume: true });
  }, [fetchPending, fetchChatHistory, toast, sessionId]);

  const handleConfirmTask = async (tid: string, approved: boolean) => {
    setConfirmingMap(prev => ({ ...prev, [tid]: true }));
    try {
      const ok = await confirmTask(tid, approved);
      toast(ok ? (approved ? 'Tugas disetujui!' : 'Tugas dibatalkan.') : 'Gagal mengirim konfirmasi.', ok ? 'ok' : 'err');
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
  }, [messages, streamContent, showStream, scrollToBottom]);

  // Mirrors hermes/uploads.py's _DOCUMENT_EXTENSIONS — kept in sync by hand,
  // there being no shared schema between the Python backend and this file.
  const DOCUMENT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml',
    'xml', 'ini', 'toml', 'py', 'js', 'ts', 'tsx', 'jsx', 'html', 'css',
    'sh', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'sql',
    'pdf', 'docx', 'xlsx',
  ]);
  const docExt = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

  /** Stage image and document files chosen, pasted or dropped. Anything
   *  neither an image nor a known document extension is ignored rather than
   *  refused loudly: a paste often carries several flavours of the same
   *  clipboard entry, only one of which is the actual attachment. */
  const addFiles = (files: Iterable<File>) => {
    const picked = Array.from(files).flatMap((file): { file: File; kind: 'image' | 'document' }[] => {
      if (file.type.startsWith('image/')) return [{ file, kind: 'image' }];
      if (DOCUMENT_EXTENSIONS.has(docExt(file.name))) return [{ file, kind: 'document' }];
      return [];
    });
    if (picked.length === 0) return;
    setAttached((prev) => [
      ...prev,
      ...picked.map(({ file, kind }) => ({ file, url: URL.createObjectURL(file), kind })),
    ]);
  };

  const removeAttached = (idx: number) => {
    setAttached((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  /** Upload a list of image files, returning the names the server gave them.
   *  A file the server rejects is reported and skipped — the rest of the turn
   *  still goes, rather than failing on one bad picture. */
  const uploadFiles = async (files: File[]): Promise<string[]> => {
    const ids: string[] = [];
    for (const file of files) {
      try {
        const url = sessionId ? `/api/uploads?session_id=${sessionId}` : '/api/uploads';
        const res = await fetch(url, { method: 'POST', body: file });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          toast(detail.detail || `Gagal mengunggah ${file.name}`, 'err');
          continue;
        }
        ids.push((await res.json()).id);
      } catch {
        toast(`Gagal mengunggah ${file.name}`, 'err');
      }
    }
    return ids;
  };

  /** Same shape as `uploadFiles`, but for non-image documents — the server
   *  needs the original filename to know how to read the bytes. Returns only
   *  the files that actually made it, paired with their server id, so a
   *  rejected upload doesn't get shown as "sent" alongside ones that were. */
  const uploadDocuments = async (files: File[]): Promise<{ file: File; id: string }[]> => {
    const out: { file: File; id: string }[] = [];
    for (const file of files) {
      try {
        const params = new URLSearchParams({ filename: file.name });
        if (sessionId) params.set('session_id', sessionId);
        const res = await fetch(`/api/uploads/document?${params}`, {
          method: 'POST', body: file,
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          toast(detail.detail || `Gagal mengunggah ${file.name}`, 'err');
          continue;
        }
        out.push({ file, id: (await res.json()).id });
      } catch {
        toast(`Gagal mengunggah ${file.name}`, 'err');
      }
    }
    return out;
  };

  const uploadAttached = async (): Promise<
    { imageIds: string[]; docIds: string[]; docNames: string[] }
  > => {
    const images = attached.filter((a) => a.kind === 'image').map((a) => a.file);
    const docs = attached.filter((a) => a.kind === 'document').map((a) => a.file);
    const [imageIds, docResults] = await Promise.all([uploadFiles(images), uploadDocuments(docs)]);
    return { imageIds, docIds: docResults.map((d) => d.id), docNames: docResults.map((d) => d.file.name) };
  };

  /** The "explain what I'm holding" turn: grab the current camera frame plus the
   *  detector's labels and send them with the operator's words, so the vision
   *  model answers over the picture rather than the words alone. Sends the frame
   *  directly (submitText's `images`) instead of staging it, so there is no
   *  setState race between snapping and sending. */
  const narrateTurn = async (spoken: string) => {
    const cam = cameraRef.current;
    const file = cam ? await cam.captureFrame() : null;
    if (!file) {
      void submitText(spoken);   // no frame yet — the words still deserve a turn
      return;
    }
    const seen = cam!.detections().map((d) => d.class);
    const uniq = [...new Set(seen)].slice(0, 6);
    const base = spoken.trim() || 'Jelaskan objek yang saya pegang di kamera.';
    const hint = uniq.length ? `\n\n(Objek terdeteksi kamera: ${uniq.join(', ')})` : '';
    await submitText(base + hint, { images: [file] });
  };

  /** `resume` is the continuation turn fired after an approved action ran: no
   *  operator typed it, so it carries no text and shows no user bubble — the
   *  agent simply picks the work back up where the confirmation interrupted it. */
  const submitText = async (
    text: string,
    opts?: { resume?: boolean; images?: File[] },
  ) => {
    const resume = opts?.resume === true;
    // Files passed for THIS turn (the auto-jelaskan frame), uploaded directly
    // rather than through the `attached` state — no snap→send setState race.
    const direct = opts?.images ?? [];
    const hasImages = attached.some((a) => a.kind === 'image') || direct.length > 0;
    const hasAttachments = attached.length > 0 || direct.length > 0;
    if ((!text && !hasAttachments && !resume) || streaming) return;
    // "buka kamera" typed (or auto-sent from a voice transcript) opens the
    // webcam locally instead of going to the chat model — the same whole-
    // utterance match the voice loop uses, so the two paths behave alike.
    // Skipped when a picture is already staged or sent: then the words are its
    // caption.
    if (!hasAttachments && !resume && matchLocalCommand(text) === 'camera') {
      setCameraOpen(true);
      toast(CAMERA_ACK, 'ok');
      setInputText('');
      return;
    }
    // An image with no caption still needs words: an empty text part is
    // rejected by some providers, and the operator should see exactly what
    // was asked on their behalf.
    if (!text && !resume) {
      text = hasImages ? 'Tolong analisa gambar ini.' : 'Tolong jelaskan berkas ini.';
    }
    const staged = attached;
    const directUrls = direct.map((f) => URL.createObjectURL(f));
    const { imageIds: stagedImageIds, docIds, docNames } = await uploadAttached();
    const imageIds = [...stagedImageIds, ...(await uploadFiles(direct))];
    setAttached([]);
    // Captured once, cleared right away — a resume turn or a slow upload must
    // not leave a stale reply preview attached to whatever gets sent next.
    const reply = resume ? null : replyingTo;
    if (!resume) setReplyingTo(null);

    // Captured once: every later update belongs to THIS conversation, whatever
    // the operator has open by the time the stream ends.
    const turnSession = sessionId;
    const isStillOpen = () => sessionIdRef.current === turnSession;

    setInputText('');
    setStreaming(true);
    setStreamSession(turnSession);
    setStreamContent('');
    setStreamUsage(null);

    shutUp();
    setFirstAudioMs(null);
    queueRef.current?.markTurnStart();
    if (ttsEnabled) sinkRef.current?.unlock();

    if (!resume) {
      const userMsg: Message = {
        role: 'user', content: text,
        images: [...staged.filter((a) => a.kind === 'image').map((a) => a.url), ...directUrls],
        docNames,
        reply_snippet: reply?.snippet ?? null,
        reply_role: reply?.role ?? null,
      };
      setMessages((prev) => [...prev, userMsg]);
    }

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
        body: JSON.stringify({
          text,
          session_id: turnSession,
          images: imageIds,
          documents: docIds,
          resume,
          reply_snippet: reply?.snippet,
          reply_role: reply?.role,
          chat_model: plannerModel || undefined,
          project: selectedProject || undefined,
          engine: selectedEngine !== 'auto' ? selectedEngine : undefined,
        }),
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
      // Only onto the thread that asked. The operator may have moved on; the
      // reply is already stored, so their old thread shows it on the way back.
      if (isStillOpen()) setMessages((prev) => [...prev, assistantMsg]);
      // The resume turn is silent by design, so the one thing the operator gets
      // is this: the confirmed action is done and the agent has moved on.
      if (resume) toast('Aksi selesai, agent melanjutkan', 'ok');
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
        if (isStillOpen()) setMessages((prev) => [...prev, assistantMsg]);
        toast('Aliran chat dihentikan', 'warn');
      } else {
        toast(errorMessage(err, 'Gagal mengirim pesan'), 'err');
        if (isStillOpen()) setMessages((prev) => [
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

  submitTextRef.current = submitText;

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

  const handleReset = () => {
    shutUp();
    setShowClearConfirm(true);
  };

  const confirmResetMessages = async () => {
    try {
      const url = sessionId ? `/api/chat/reset?session_id=${sessionId}` : '/api/chat/reset';
      const res = await fetch(url, { method: 'POST' });
      if (res.ok) {
        setMessages([]);
        toast('Percakapan telah di-reset', 'ok');
      }
    } catch (err) {
      toast('Gagal me-reset percakapan', 'err');
    } finally {
      setShowClearConfirm(false);
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

    // Task nodes connected to the session that owns them — see taskLinkTarget
    // for why an unknown session falls back to the core and not to the open one.
    const known = new Set(sessions.map((s) => s.session_id));
    tasks.forEach((t) => {
      const targetSessionId = taskLinkTarget((t as any).session_id, known);
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
    <div className="page-container" style={{ position: 'relative' }}>
      {/* Cognitive Server Disconnection Bar */}
      {!isConnected && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            backgroundColor: 'var(--err)',
            color: '#ffffff',
            padding: '4px 16px',
            textAlign: 'center',
            fontWeight: 'bold',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            zIndex: 40,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={12} />
            COGNITIVE SERVER DISCONNECTED. RECONNECTING...
          </span>
        </div>
      )}

      {/* Main Center Area: Hero Screen (Empty) OR Chat Thread */}
      <div className="chat-and-hero-view">
        {loadingHistory ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: '13px' }}>
            Memuat riwayat percakapan...
          </div>
        ) : messages.length === 0 && !showStream ? (
          /* Empty Session — Hero Display */
          <div className="hermes-hero-container">
            <h1 className="hermes-hero-title">
              LAIL HERMES
            </h1>
            <p className="hermes-hero-subtitle">
              Type a task, question, or snippet. I remember the session, cite my sources, and stop to ask when I'm unsure.
            </p>
          </div>
        ) : (
          /* Active Chat Thread */
          <div className="chat-thread-container" ref={chatThreadRef}>
            {messages.map((m, idx) => (
              <div key={idx} className={`chat-message-row ${m.role}`}>
                <div className="chat-author-line">
                  <span>{m.role === 'user' ? 'OPERATOR' : agentName.toUpperCase()}</span>
                  <button
                    type="button"
                    title="Balas pesan ini"
                    onClick={() => setReplyingTo({ role: m.role, snippet: truncateSnippet(m.content) })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                  >
                    <CornerUpLeft size={12} />
                  </button>
                  <CopyButton text={m.content} />
                </div>
                <div className={`chat-bubble ${m.role}`}>
                  {m.reply_snippet && (
                    <div
                      style={{
                        borderLeft: '2px solid var(--accent)',
                        paddingLeft: '8px',
                        marginBottom: '8px',
                        fontSize: '12px',
                        color: 'var(--text-faint)',
                        opacity: 0.85,
                      }}
                    >
                      <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
                        Membalas {m.reply_role === 'assistant' ? agentName : 'Operator'}
                      </div>
                      {m.reply_snippet}
                    </div>
                  )}
                  {m.role === 'user' ? (
                    <div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                      {m.images && m.images.length > 0 && (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {m.images.map((src) => (
                            <img
                              key={src}
                              src={src}
                              alt="lampiran"
                              style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}
                            />
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
            ))}

            {/* Live Streaming Response Bubble */}
            {showStream && (
              <div className="chat-message-row assistant">
                <div className="chat-author-line">
                  <span>{agentName.toUpperCase()}</span>
                  <span style={{ color: 'var(--accent)', fontSize: '10px' }}>(menjawab...)</span>
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
          </div>
        )}

        {/* Reply-to preview, cancellable, sits above the attachments bar */}
        {replyingTo && (
          <div
            style={{
              position: 'absolute',
              bottom: attached.length > 0 ? '148px' : '80px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'calc(100% - 48px)',
              maxWidth: '840px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderLeft: '2px solid var(--accent)',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-card)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              zIndex: 35,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)' }}>
                Membalas {replyingTo.role === 'assistant' ? agentName : 'Operator'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {replyingTo.snippet}
              </div>
            </div>
            <button
              type="button"
              title="Batalkan balasan"
              onClick={() => setReplyingTo(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex' }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Staged attachments preview above bottom input */}
        {attached.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '80px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'calc(100% - 48px)',
              maxWidth: '840px',
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              alignItems: 'center',
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-card)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              zIndex: 35,
            }}
          >
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.08em' }}>
              LAMPIRAN:
            </span>
            {attached.map((a, idx) => (
              <div key={a.url} style={{ position: 'relative' }}>
                {a.kind === 'image' ? (
                  <img
                    src={a.url}
                    alt={a.file.name}
                    style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}
                  />
                ) : (
                  <div
                    title={a.file.name}
                    style={{ width: '48px', height: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface-0)', padding: '2px', overflow: 'hidden' }}
                  >
                    <span style={{ fontSize: '16px' }}>📄</span>
                    <span style={{ fontSize: '8px', textAlign: 'center', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.file.name}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeAttached(idx)}
                  title="Hapus"
                  style={{ position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px', borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-0)', color: 'var(--text)', lineHeight: 1, fontSize: '10px', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Floating Bottom Prompt Bar (Matching Screenshot Reference) */}
        <form onSubmit={handleSend} className="ask-prompt-floating-card">
          {/* + Attachment Button */}
          <button
            type="button"
            className="ask-left-action-btn"
            disabled={streaming}
            title="Lampirkan berkas atau foto"
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
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {/* Main Input Text Box */}
          <input
            ref={inputRef}
            type="text"
            className="ask-main-input-field"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onPaste={(e) => addFiles(e.clipboardData.files)}
            placeholder="Give Lail Hermes a task"
            disabled={streaming}
          />

          {/* Right Toolbar Actions */}
          <div className="ask-right-actions-group">
            {/* Model Selector Pill */}
            <div className="ask-model-pill" title="Pilih model chat (live dari provider yang terhubung)">
              <span className="ask-model-pill-text">{plannerModel || defaultChatModel || 'Model'}</span>
              <span className="ask-model-pill-arrow">▾</span>
              <select
                className="ask-model-select-native"
                value={plannerModel}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={streaming}
              >
                <option value="">Default ({defaultChatModel || 'Settings'})</option>
                {chatModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Microphone Button */}
            <button
              type="button"
              className={`ask-tool-icon-btn ${micState === 'recording' ? 'active-rec' : ''}`}
              disabled={streaming || micState === 'working'}
              title={
                micState === 'listening' ? 'Mendengarkan...'
                : micState === 'recording' ? 'Merekam... klik untuk berhenti'
                : micState === 'working' ? 'Mentranskripsi...'
                : 'Bicara (Push-to-talk)'
              }
              onClick={() => {
                holdingRef.current = false;
                if (micState === 'recording') pushToTalkStop();
                else pushToTalkStart();
              }}
            >
              <Mic size={14} />
            </button>

            {/* Speaker / Mute Button */}
            <button
              type="button"
              className={`ask-tool-icon-btn ${speaking ? 'active-speaking' : ''}`}
              title={speaking ? 'Hentikan Suara' : ttsEnabled ? 'Suara Aktif' : 'Suara Nonaktif'}
              onClick={speaking ? shutUp : () => setTtsEnabled(!ttsEnabled)}
            >
              {speaking ? <VolumeX size={14} /> : ttsEnabled ? <Volume2 size={14} /> : <Volume1 size={14} />}
            </button>

            {/* Engine Mode Action Button */}
            <button
              type="button"
              className="ask-tool-icon-btn"
              title={`Engine: ${selectedEngine.toUpperCase()} (Klik untuk ganti)`}
              onClick={() => {
                const nextEng = selectedEngine === 'auto' ? 'claude' : selectedEngine === 'claude' ? 'antigravity' : 'auto';
                handleEngineChange(nextEng);
              }}
            >
              <Zap size={14} />
            </button>

            {/* White Circular Action Button */}
            {streaming ? (
              <button type="button" className="hermes-circle-action-btn stop" onClick={handleStop} title="Hentikan">
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="hermes-circle-action-btn"
                disabled={!inputText.trim() && attached.length === 0}
                title="Kirim (Enter)"
              >
                <Activity size={13} style={{ strokeWidth: 2.5 }} />
              </button>
            )}
          </div>
        </form>

        {/* Bottom Right version badge (Matching Reference Screenshot) */}
        <div style={{ position: 'absolute', bottom: '8px', right: '20px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', opacity: 0.8, pointerEvents: 'none', zIndex: 10 }}>
          # v0.0.2
        </div>
      </div>

      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={confirmResetMessages}
        title="Bersihkan Percakapan"
        message="Apakah Anda yakin ingin me-reset seluruh pesan pada sesi percakapan ini?"
        confirmText="Reset Percakapan"
      />

      {/* Confirmation Modal for Parked Actions */}
      <Modal
        isOpen={!!reviewPending}
        onClose={() => reviewPending && setDismissedPending((prev) => [...prev, reviewPending.id])}
        title="⚠️ Perlu konfirmasi"
      >
        {reviewPending && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontWeight: 600 }}>{reviewPending.summary}</div>
            {reviewPending.risk_note && (
              <div style={{
                fontSize: '12px', color: 'var(--text-dim)', padding: '8px',
                border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                background: 'var(--surface-1)',
              }}>
                {reviewPending.risk_note}
              </div>
            )}
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
            </div>
          </div>
        )}
      </Modal>

      {/* Side HUD Drawer (Inspector, Constellation Graph, Camera) */}
      <aside className={`side-hud-drawer ${isDrawerOpen ? '' : 'closed'}`}>
        <div className="side-hud-header">
          <span>Constellation & Telemetry</span>
          <button
            type="button"
            className="hermes-modal-close-btn"
            onClick={onToggleDrawer}
            title="Tutup side panel"
          >
            ✕
          </button>
        </div>
        <div className="side-hud-content">
          <div style={{ height: '240px', position: 'relative' }}>
            <WaveConstellationGraph
              systemNodes={graphNodes}
              systemLinks={graphLinks}
              sessionId={sessionId}
              onSelectNode={onSelectNode}
              onNavigateSession={(sId) => navigate(`#/session/${sId}`)}
            />
          </div>

          <CameraCapture
            ref={cameraRef}
            isOpen={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onCapture={(file) => addFiles([file])}
            narrate={narrate}
            onToggleNarrate={(next) => setNarrate(next)}
          />

          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)' }}>TASK TELEMETRY</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: '11px' }}>
                <span style={{ color: 'var(--accent)' }}>● Active:</span> {taskCounts.running}
              </div>
              <div style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: '11px' }}>
                <span style={{ color: 'var(--ok)' }}>● Done:</span> {taskCounts.done}
              </div>
              <div style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: '11px' }}>
                <span style={{ color: 'var(--err)' }}>● Failed:</span> {taskCounts.failed}
              </div>
              <div style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: '11px' }}>
                <span style={{ color: 'var(--text-faint)' }}>● Queued:</span> {taskCounts.queued}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

