import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { ChatMessage, ChatModels, EngineModels, OfficeSession, PendingAction, Project } from '../api/types';
import { parseStreamBuffer } from '../api/stream';
import { confirmTask } from '../components/TaskCard';
import { useToast } from '../components/Toast';
import {
  loadTtsSettings, TtsMode, TtsPersonality,
  ttsRequest, TtsIntent, TtsRequestOptions,
  hasGreeted, markGreeted,
  loadVoiceSettings, VoiceSettings, VOICE_SETTINGS_DEFAULT,
} from '../tts';
import { SpeechQueue, HtmlAudioSink, sharedAudioSink, sharedSpeechQueue } from '../audio';
import { splitSentences, flushSentence } from '../sentences';
import { useVoiceLoop } from './useVoiceLoop';
import { STOP_ACK, matchLocalCommand } from '../commands';
import { VoiceTagExtractor } from '../voicetag';

export interface OfficeChatMessage extends ChatMessage {
  images?: string[];
  docNames?: string[];
}

/** What the operator is currently replying to, captured off a rendered
 *  bubble (role + snippet, not a message id — a message that just streamed
 *  in this session has no server id to key off of yet). Cleared once sent. */
export interface ReplyTarget {
  role: 'user' | 'assistant';
  snippet: string;
}

const REPLY_SNIPPET_MAX = 300;

export function truncateReplySnippet(text: string, max: number = REPLY_SNIPPET_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '...' : flat;
}

// Mirrors hermes/uploads.py's _DOCUMENT_EXTENSIONS (see Dashboard.tsx's own copy).
const DOCUMENT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml',
  'xml', 'ini', 'toml', 'py', 'js', 'ts', 'tsx', 'jsx', 'html', 'css',
  'sh', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'sql',
  'pdf', 'docx', 'xlsx',
]);
const docExt = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 120; // ~5 minutes

export interface UseOfficeChatSessionOptions {
  /** The session this pane talks to. Owned by the caller — how it's obtained
   *  (a fixed id vs. looked-up/created per selected employee) is the one
   *  thing that legitimately differs between OfficeSessionChat and
   *  OfficeUnifiedChat, so it stays outside this hook. */
  session: OfficeSession | null;
  employeeName: string;
  onStreamingChange?: (employeeId: string | null) => void;
  /** Reported to `onStreamingChange` while this pane is the active speaker. */
  employeeId: string | null;
  /** Called by `sendTurn` when there's no session yet (OfficeUnifiedChat can
   *  create one lazily on first message). Omit when the caller always
   *  guarantees a session exists first (OfficeSessionChat). */
  ensureSession?: () => Promise<OfficeSession | null>;
  /** Load /projects and /engine-models on mount instead of waiting for the
   *  caller to trigger `loadCatalog()` on demand (OfficeUnifiedChat wants its
   *  model picker populated immediately; OfficeSessionChat only opens on
   *  request from its settings drawer). */
  eagerLoadCatalog?: boolean;
}

/** All the state and wiring a single office chat pane needs that isn't the
 *  JSX itself: session-scoped messages, the SSE token stream + TTS/voice
 *  loop bolted onto it, attachments, and pending-action approval polling.
 *  Was duplicated near-verbatim between OfficeSessionChat and
 *  OfficeUnifiedChat (~300 lines each) before being pulled out here — same
 *  ChatEngine.stream() twin, same voice input/output, same attachment
 *  upload, just two different ways of picking which session to point it at. */
export function useOfficeChatSession({
  session, employeeName, onStreamingChange, employeeId, ensureSession, eagerLoadCatalog,
}: UseOfficeChatSessionOptions) {
  const { toast } = useToast();

  const [messages, setMessages] = useState<OfficeChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [waitingOnTask, setWaitingOnTask] = useState(false);
  const [confirmingMap, setConfirmingMap] = useState<Record<string, boolean>>({});

  const [projects, setProjects] = useState<Project[]>([]);
  const [engineModels, setEngineModels] = useState<EngineModels | null>(null);
  // Live catalog for the CASUAL-chat model picker — distinct from
  // engineModels above, which is the claude/agy CLI used by a project-bound
  // session's background task. '' picked from this list means "use
  // Settings' default", same convention as the main chat pane.
  const [chatModels, setChatModels] = useState<ChatModels | null>(null);

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

  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  // sendTurn is memoized without `replyingTo` in its deps (same reasoning as
  // messagesRef below) — read the current target through this ref instead.
  const replyingToRef = useRef(replyingTo);
  replyingToRef.current = replyingTo;

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttempts = useRef(0);

  // sendTurn/pollForTaskReply read the *current* session through this ref
  // rather than closing over the `session` prop directly, so a settings
  // change (project/model) mid-turn or a session swap doesn't require every
  // callback below to be rebuilt.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const ensureSessionRef = useRef(ensureSession);
  ensureSessionRef.current = ensureSession;
  // sendTurn is memoized without `messages` in its deps (it changes on every
  // token), so it reads the current message count through this ref instead
  // of risking a stale closure.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const activeSpeakerId = (streaming || speaking || waitingOnTask) && employeeId ? employeeId : null;

  useEffect(() => {
    onStreamingChange?.(activeSpeakerId);
  }, [activeSpeakerId, onStreamingChange]);

  useEffect(() => {
    // Clears the cue when this pane closes (e.g. the office chat modal is
    // dismissed), independent of whatever streaming/speaking was mid-flight.
    return () => { onStreamingChange?.(null); };
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

  const loadCatalog = useCallback(() => {
    api.getProjects().then(setProjects).catch(() => {});
    api.getEngineModels().then(setEngineModels).catch(() => {});
    api.getChatModels().then(setChatModels).catch(() => {});
  }, []);

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
    if (eagerLoadCatalog) loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollForTaskReply = useCallback((sid: string, countBefore: number) => {
    pollAttempts.current = 0;
    const tick = async () => {
      pollAttempts.current += 1;
      try {
        const fresh = await api.getOfficeSessionMessages(sid);
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
  }, [toast]);

  // Loads this session's messages whenever the session identity changes —
  // covers both a fixed session mounting once (OfficeSessionChat) and the
  // operator switching employees, which swaps to a different session
  // (OfficeUnifiedChat). A project-bound session with an unanswered last
  // user message means a real Orchestrator task is still working
  // server-side (see OfficeManager._run_session_task) — pick that back up
  // with the same poll WorkOutputFeed uses rather than a new SSE event type.
  useEffect(() => {
    const sid = session?.session_id;
    if (!sid) { setMessages([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const msgs = await api.getOfficeSessionMessages(sid);
        if (cancelled) return;
        setMessages(msgs);
        if (session?.project && msgs.length > 0 && msgs[msgs.length - 1].role === 'user') {
          setWaitingOnTask(true);
          pollForTaskReply(sid, msgs.length);
        }
      } catch (err) {
        if (!cancelled) toast(errorMessage(err, 'Failed to load chat'), 'err');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      pollAttempts.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session_id]);

  // Greet once per session on first open, same as the main chat pane.
  useEffect(() => {
    const sid = session?.session_id;
    if (!sid || !ttsEnabled || !ttsGreeting || hasGreeted(sid) || loading || messages.length > 0) return;
    markGreeted(sid);
    speak('greeting');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsEnabled, ttsGreeting, loading, messages.length, session?.session_id]);

  // A write action the persona proposed (delete/write/send — never a read)
  // parks here awaiting approval, same PendingStore the main chat pane polls.
  useEffect(() => {
    const sid = session?.session_id;
    if (!sid) { setPending([]); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await api.getChatPending(sid);
        if (!cancelled) setPending(list);
      } catch {
        // transient — next poll retries
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { cancelled = true; clearInterval(id); };
  }, [session?.session_id]);

  const resolvePending = useCallback(async (id: string, approved: boolean) => {
    const sid = sessionRef.current?.session_id;
    if (!sid) return;
    setResolving(true);
    try {
      const res = await api.resolveChatPending(sid, id, approved);
      if (!res.ok) {
        toast('No pending action found', 'warn');
        return;
      }
      const fresh = await api.getOfficeSessionMessages(sid);
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
  }, [toast]);

  /** Stage image and document files chosen or pasted. Anything neither an
   *  image nor a known document extension is ignored rather than refused
   *  loudly — a paste often carries several flavours of the same clipboard
   *  entry, only one of which is the actual attachment. */
  const addFiles = useCallback((files: Iterable<File>) => {
    const picked = Array.from(files).flatMap((file): { file: File; kind: 'image' | 'document' }[] => {
      if (file.type.startsWith('image/')) return [{ file, kind: 'image' }];
      if (DOCUMENT_EXTENSIONS.has(docExt(file.name))) return [{ file, kind: 'document' }];
      return [];
    });
    if (picked.length === 0) return;
    setAttached((prev) => [...prev, ...picked.map(({ file, kind }) => ({ file, url: URL.createObjectURL(file), kind }))]);
  }, []);

  const removeAttached = useCallback((idx: number) => {
    setAttached((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const uploadFiles = async (files: File[], sid: string): Promise<string[]> => {
    const ids: string[] = [];
    for (const file of files) {
      try {
        const res = await fetch(`/api/uploads?session_id=${sid}`, { method: 'POST', body: file });
        if (!res.ok) { toast(`Failed to upload ${file.name}`, 'err'); continue; }
        ids.push((await res.json()).id);
      } catch {
        toast(`Failed to upload ${file.name}`, 'err');
      }
    }
    return ids;
  };

  const uploadDocuments = async (files: File[], sid: string): Promise<{ file: File; id: string }[]> => {
    const out: { file: File; id: string }[] = [];
    for (const file of files) {
      try {
        const params = new URLSearchParams({ filename: file.name, session_id: sid });
        const res = await fetch(`/api/uploads/document?${params}`, { method: 'POST', body: file });
        if (!res.ok) { toast(`Failed to upload ${file.name}`, 'err'); continue; }
        out.push({ file, id: (await res.json()).id });
      } catch {
        toast(`Failed to upload ${file.name}`, 'err');
      }
    }
    return out;
  };

  const handleConfirmTask = useCallback(async (tid: string, approved: boolean) => {
    setConfirmingMap((prev) => ({ ...prev, [tid]: true }));
    try {
      const ok = await confirmTask(tid, approved);
      toast(ok ? (approved ? 'Task approved' : 'Task cancelled') : 'Failed to send confirmation', ok ? 'ok' : 'err');
    } catch {
      toast('Network error', 'err');
    } finally {
      setConfirmingMap((prev) => ({ ...prev, [tid]: false }));
    }
  }, [toast]);

  /** `resume` is the continuation turn fired after an approved action ran: no
   *  operator typed it, so it carries no text and shows no user bubble.
   *  A project-bound session has no streaming reply to speak of — the
   *  "reply" is a background task's outcome — so it keeps using the
   *  original non-streaming task flow (see the /api/office/sessions
   *  POST .../messages endpoint) instead of the SSE stream below. */
  const sendTurn = useCallback(async (text: string, opts?: { resume?: boolean }) => {
    let sess = sessionRef.current;
    if (!sess && ensureSessionRef.current) sess = await ensureSessionRef.current();
    if (!sess) return;
    const sid = sess.session_id;

    const resume = opts?.resume === true;
    const hasAttachments = attached.length > 0;
    if ((!text.trim() && !hasAttachments && !resume) || streaming) return;

    if (sess.project && !resume) {
      const trimmed = text.trim();
      const countBefore = messagesRef.current.length;
      const reply = replyingToRef.current;
      setInputText('');
      setReplyingTo(null);
      setMessages((prev) => [...prev, {
        role: 'user', content: trimmed,
        reply_snippet: reply?.snippet ?? null, reply_role: reply?.role ?? null,
      }]);
      try {
        const res = await api.sendOfficeSessionMessage(sid, trimmed, reply ?? undefined);
        if (res.kind === 'task') {
          setWaitingOnTask(true);
          pollForTaskReply(sid, countBefore + 1);
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
      const [imgIds, docResults] = await Promise.all([uploadFiles(images, sid), uploadDocuments(docs, sid)]);
      return { imageIds: imgIds, docIds: docResults.map((d) => d.id), docNames: docResults.map((d) => d.file.name) };
    })();
    setAttached([]);
    const reply = resume ? null : replyingToRef.current;
    if (!resume) setReplyingTo(null);

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
        reply_snippet: reply?.snippet ?? null, reply_role: reply?.role ?? null,
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
      const res = await fetch(`/api/office/sessions/${sid}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, images: imageIds, documents: docIds, resume,
          reply_snippet: reply?.snippet, reply_role: reply?.role,
        }),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached, streaming, ttsEnabled, ttsMode, pollForTaskReply, shutUp, speak, speakLine, toast]);

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

  const handleSend = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    void sendTurn(inputText.trim());
  }, [inputText, sendTurn]);

  const handleStop = useCallback(() => {
    shutUp();
    if (abortControllerRef.current) abortControllerRef.current.abort();
  }, [shutUp]);

  return {
    messages, setMessages, loading, waitingOnTask,
    inputText, setInputText, handleSend, handleStop, sendTurn,
    replyingTo, setReplyingTo,
    streaming, streamContent,
    pending, resolving, resolvePending,
    confirmingMap, handleConfirmTask,
    attached, addFiles, removeAttached, fileInputRef,
    ttsEnabled, setTtsEnabled, speaking, shutUp,
    micState, pushToTalkStart, pushToTalkStop,
    projects, engineModels, chatModels, loadCatalog,
  };
}
