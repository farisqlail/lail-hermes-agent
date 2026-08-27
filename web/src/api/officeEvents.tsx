import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';
import { Employee, Team, WorkItem } from './types';

export interface OfficeEvent {
  type: string;
  [key: string]: unknown;
}

export interface OfficeState {
  employees: Employee[];
  teams: Team[];
  workItems: WorkItem[];
  loading: boolean;
  isConnected: boolean;
  refresh: () => Promise<void>;
  /** The most recent SSE event, e.g. to toast on `office_meeting_done`. Not
   * an event log — just the latest one, since debounced refetch already
   * folds everything else into `employees`/`teams`/`workItems`. */
  lastEvent: OfficeEvent | null;
}

/** Live Office state: fetch-on-mount plus an SSE subscription to
 * `/api/office/events`, near-copy of `events.tsx`'s `TasksProvider` pattern
 * (debounced refetch on event, reconnect with backoff) but scoped to the
 * Office view rather than the whole app — Office isn't mounted until the
 * OFFICE tab is active, so a self-contained hook is simpler here than a
 * provider wrapping both `page.tsx` and `main.tsx` shells. */
export function useOfficeEvents(): OfficeState {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<OfficeEvent | null>(null);

  const reconnectTimeoutRef = useRef<number | null>(null);
  const debounceTimeoutRef = useRef<number | null>(null);
  const backoffRef = useRef(1000);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [emps, tms, work] = await Promise.all([
        api.getEmployees(),
        api.getTeams(),
        api.getWorkItems({ limit: 30 }),
      ]);
      setEmployees(emps);
      setTeams(tms);
      setWorkItems(work);
    } catch {
      // Office is an optional feature (503 when unconfigured) — a failed
      // fetch just means an empty roster, not an app-breaking error.
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAllDebounced = useCallback(() => {
    if (debounceTimeoutRef.current) window.clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = window.setTimeout(fetchAll, 250);
  }, [fetchAll]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();

    const source = new EventSource('/api/office/events');
    eventSourceRef.current = source;

    source.onopen = () => {
      setIsConnected(true);
      backoffRef.current = 1000;
    };

    source.onmessage = (event) => {
      if (!event.data) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'keep-alive') return;
        setLastEvent(data);
        fetchAllDebounced();
      } catch (e) {
        console.error('[office SSE] Failed to parse event data:', e);
      }
    };

    source.onerror = () => {
      setIsConnected(false);
      source.close();
      const nextBackoff = Math.min(backoffRef.current * 2, 30000);
      backoffRef.current = nextBackoff;
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = window.setTimeout(connectSSE, nextBackoff);
    };
  }, [fetchAllDebounced]);

  useEffect(() => {
    fetchAll();
    connectSSE();
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      if (debounceTimeoutRef.current) window.clearTimeout(debounceTimeoutRef.current);
    };
  }, [fetchAll, connectSSE]);

  return { employees, teams, workItems, loading, isConnected, refresh: fetchAll, lastEvent };
}
