import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Task } from './types';

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
  }, [fetchTasksDebounced]);

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
