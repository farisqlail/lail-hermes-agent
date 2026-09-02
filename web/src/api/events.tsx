import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Task } from './types';
import type { TraceEvent } from './trace';
import { sharedSpeechQueue } from '../audio';
import { loadTtsSettings, speechRequestFor, TTS_VOICE_DEFAULT } from '../tts';
import type { SpeakEvent, TtsSettings } from '../tts';
import { api } from './client';

/** Newest log line seen for one task, stamped with the browser clock on
 *  arrival — the server's `log_appended` carries no timestamp, and comparing
 *  against `Date.now()` in the indicator keeps both ends on one clock. */
export interface TaskActivity {
  line: string;
  ts: number;
}

interface TasksContextType {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isConnected: boolean;
  lastEventTimestamp: number;
  /** Live "what is it doing right now", keyed by task id. Feeds the running
   *  indicator so it shows real output instead of a canned phrase. */
  activity: Record<string, TaskActivity>;
  /** Distilled engine trace for the one task a detail view is watching. */
  trace: TraceEvent[];
  /** Point the trace subscription at a task, or null to stop. Deliberately one
   *  task at a time: a session-wide map would accumulate thousands of rows per
   *  task visited and never let them go. */
  watchTrace: (taskId: string | null) => void;
}

const TasksContext = createContext<TasksContextType | undefined>(undefined);

export function useTasksContext() {
  const context = useContext(TasksContext);
  if (!context) {
    throw new Error('useTasksContext must be used within a TasksProvider');
  }
  return context;
}

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEventTimestamp, setLastEventTimestamp] = useState<number>(0);
  const [activity, setActivity] = useState<Record<string, TaskActivity>>({});
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [traceTaskId, setTraceTaskId] = useState<string | null>(null);
  // The SSE handler is built once, so it reads the watched id from a ref
  // rather than closing over the first render's value.
  const traceTaskIdRef = useRef<string | null>(null);

  const watchTrace = useCallback((taskId: string | null) => {
    traceTaskIdRef.current = taskId;
    setTraceTaskId(taskId);
    setTrace([]);
  }, []);
  
  // Voice settings for server-driven speech. Read once on mount and kept in a
  // ref: the SSE handler is created once, so reading state there would pin the
  // first render's values forever.
  const ttsRef = useRef<TtsSettings | null>(null);
  const agentRef = useRef('Lail Agent');

  const reconnectTimeoutRef = useRef<number | null>(null);
  const debounceTimeoutRef = useRef<number | null>(null);
  const backoffRef = useRef(1000); // starts at 1s
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) throw new Error('Gagal memuat daftar tugas');
      const data = await res.json() as Task[];
      setTasks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar tugas');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTasksDebounced = useCallback(() => {
    if (debounceTimeoutRef.current) {
      window.clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = window.setTimeout(() => {
      setLastEventTimestamp(Date.now());
      fetchTasks();
    }, 300);
  }, [fetchTasks]);

  /** Speak what the server asked for. The decision (and its settings gates)
   *  lives in hermes/brain.speech_for — this only renders it, so a task that
   *  finishes while the operator sits on the Configure page is still
   *  announced. That was the whole bug: the old notify effect was inside the
   *  Dashboard component. */
  const handleSpeak = useCallback((ev: SpeakEvent) => {
    const s = ttsRef.current;
    if (!s || !s.tts_enabled) return;
    const req = speechRequestFor(ev, s.tts_mode, {
      voice: s.tts_voice || TTS_VOICE_DEFAULT,
      agentName: agentRef.current,
      maxWords: s.tts_max_words,
      personality: s.tts_personality,
    });
    if (req) sharedSpeechQueue().enqueue(req.endpoint, req.payload);
  }, []);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const source = new EventSource('/api/tasks/events');
    eventSourceRef.current = source;

    source.onopen = () => {
      setIsConnected(true);
      backoffRef.current = 1000; // reset backoff on success
    };

    source.onmessage = (event) => {
      if (!event.data) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'keep-alive') return;
        if (data.type === 'speak') { handleSpeak(data as SpeakEvent); return; }
        // `log_appended` already carries the line, so record it as this task's
        // current activity rather than making the running indicator poll for
        // it. Still falls through to the refetch below: detail views watch
        // `lastEventTimestamp` to pull fresh logs.
        // Returns early on purpose: a trace event changes neither the task
        // list nor its logs, and these arrive per tool call — falling through
        // to the refetch below would put the whole task list on the wire
        // hundreds of times per run.
        if (data.type === 'trace_event') {
          if (data.task_id === traceTaskIdRef.current && data.event) {
            setTrace((prev) => {
              const last = prev.length > 0 ? prev[prev.length - 1].id : 0;
              // Ids only grow, so anything at or below the tail is a duplicate
              // of what the post-reconnect refetch already pulled in.
              return data.event.id <= last ? prev : [...prev, data.event];
            });
          }
          return;
        }
        if (data.type === 'log_appended' && typeof data.task_id === 'string') {
          setActivity((prev) => ({
            ...prev,
            [data.task_id]: { line: typeof data.line === 'string' ? data.line : '', ts: Date.now() },
          }));
        }
        fetchTasksDebounced();
      } catch (e) {
        console.error('[SSE] Failed to parse event data:', e);
      }
    };

    source.onerror = () => {
      setIsConnected(false);
      source.close();
      
      // Reconnect with backoff
      const nextBackoff = Math.min(backoffRef.current * 2, 30000); // cap at 30s
      backoffRef.current = nextBackoff;
      
      console.warn(`[SSE] Disconnected. Reconnecting in ${nextBackoff}ms...`);
      
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectSSE();
      }, nextBackoff);
    };
  }, [fetchTasksDebounced, handleSpeak]);

  useEffect(() => {
    loadTtsSettings().then((s) => { ttsRef.current = s; }).catch(() => {});
    api.getSettings()
      .then((s) => { if (s.agent_name) agentRef.current = s.agent_name; })
      .catch(() => {});
  }, []);

  // Initial load, and the gap-fill after a dropped SSE connection: rows that
  // arrived while the stream was down are only reachable over HTTP.
  useEffect(() => {
    if (!traceTaskId) return;
    let cancelled = false;
    fetch(`/api/tasks/${traceTaskId}/trace`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: TraceEvent[]) => { if (!cancelled) setTrace(rows); })
      .catch(() => { /* a missing trace is an empty timeline, not an error */ });
    return () => { cancelled = true; };
  }, [traceTaskId, isConnected]);

  useEffect(() => {
    fetchTasks();
    connectSSE();

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      if (debounceTimeoutRef.current) window.clearTimeout(debounceTimeoutRef.current);
    };
  }, [fetchTasks, connectSSE]);

  return (
    <TasksContext.Provider value={{ tasks, loading, error, refresh: fetchTasks, isConnected, lastEventTimestamp, activity, trace, watchTrace }}>
      {children}
    </TasksContext.Provider>
  );
}
