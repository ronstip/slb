import { useQuery } from '@tanstack/react-query';
import { getAgent, getAgentArtifacts, getAgentLogs } from '../../../api/endpoints/agents.ts';

export function useAgentDetail(taskId: string | undefined) {
  const taskQuery = useQuery({
    queryKey: ['agent-detail', taskId],
    queryFn: () => getAgent(taskId!),
    enabled: !!taskId,
    staleTime: 5 * 60_000,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'running' ? 20_000 : false;
    },
  });

  const artifactsQuery = useQuery({
    queryKey: ['agent-artifacts', taskId],
    queryFn: () => getAgentArtifacts(taskId!),
    enabled: !!taskId,
    staleTime: 5 * 60_000,
  });

  const logsQuery = useQuery({
    queryKey: ['agent-logs', taskId],
    queryFn: () => getAgentLogs(taskId!),
    enabled: !!taskId,
    staleTime: 5 * 60_000,
    refetchInterval: () => {
      const s = taskQuery.data?.status;
      return s === 'running' ? 15_000 : false;
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
