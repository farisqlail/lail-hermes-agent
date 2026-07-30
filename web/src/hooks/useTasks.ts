import { useTasksContext } from '../api/events';

export function useTasks() {
  return useTasksContext();
}
