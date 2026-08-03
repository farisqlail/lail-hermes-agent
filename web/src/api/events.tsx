import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Task } from './types';
import { sharedSpeechQueue } from '../audio';
import { loadTtsSettings, speechRequestFor, TTS_VOICE_DEFAULT } from '../tts';
import type { SpeakEvent, TtsSettings } from '../tts';
import { api } from './client';

interface TasksContextType {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isConnected: boolean;
  lastEventTimestamp: number;
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
    <TasksContext.Provider value={{ tasks, loading, error, refresh: fetchTasks, isConnected, lastEventTimestamp }}>
      {children}
    </TasksContext.Provider>
  );
}
