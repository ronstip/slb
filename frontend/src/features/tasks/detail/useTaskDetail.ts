import { useQuery } from '@tanstack/react-query';
import { getTask, getTaskArtifacts, getTaskLogs } from '../../../api/endpoints/tasks.ts';

export function useTaskDetail(taskId: string | undefined) {
  const taskQuery = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: () => getTask(taskId!),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'executing' ? 10_000 : false;
    },
  });

  const artifactsQuery = useQuery({
    queryKey: ['task-artifacts', taskId],
    queryFn: () => getTaskArtifacts(taskId!),
    enabled: !!taskId && (taskQuery.data?.artifact_ids?.length ?? 0) > 0,
  });

  const logsQuery = useQuery({
    queryKey: ['task-logs', taskId],
    queryFn: () => getTaskLogs(taskId!),
    enabled: !!taskId,
    refetchInterval: () => {
      const s = taskQuery.data?.status;
      return s === 'executing' ? 5_000 : false;
    },
  });

  return {
    task: taskQuery.data ?? null,
    isLoading: taskQuery.isLoading,
    artifacts: artifactsQuery.data ?? [],
    logs: logsQuery.data ?? [],
    refetchTask: taskQuery.refetch,
  };
}
