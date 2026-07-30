import { useState, useEffect, useCallback } from 'react';
import { useTasksContext } from '../api/events';
import { TaskDetailResponse } from '../api/types';

export function useTask(taskId: string | undefined) {
  const { tasks, lastEventTimestamp } = useTasksContext();
  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTaskDetail = useCallback(async (showLoading = true) => {
    if (!taskId) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) throw new Error('Gagal memuat detail tugas');
      const data = await res.json() as TaskDetailResponse;
      setTaskDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail tugas');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTaskDetail(true);
  }, [fetchTaskDetail]);

  // Silently re-fetch when task updates or any new SSE event arrives
  const currentTask = tasks.find((t) => t.task_id === taskId);
  const taskStateFingerprint = currentTask 
    ? `${currentTask.status}-${currentTask.task_id}-${lastEventTimestamp}` 
    : `${taskId}-${lastEventTimestamp}`;

  useEffect(() => {
    if (taskId && taskStateFingerprint) {
      fetchTaskDetail(false);
    }
  }, [taskStateFingerprint, taskId, fetchTaskDetail]);

  return { task: taskDetail, loading, error, refresh: () => fetchTaskDetail(true) };
}
