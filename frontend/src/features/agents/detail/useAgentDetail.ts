import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAgent,
  getAgentArtifacts,
  getAgentLogs,
  updateAgent,
  type Agent,
  type AgentOutput,
} from '../../../api/endpoints/agents.ts';
import { useAgentStore } from '../../../stores/agent-store.ts';

export function useAgentDetail(taskId: string | undefined) {
  const taskQuery = useQuery({
    queryKey: ['agent-detail', taskId],
    queryFn: () => getAgent(taskId!),
    enabled: !!taskId,
    staleTime: 5 * 60_000,
    // Show the list-cached agent immediately while the detail call resolves —
    // avoids a full-screen spinner when the user navigates from /agents or any
    // surface that already populated the agent store.
    placeholderData: () =>
      taskId ? useAgentStore.getState().agents.find((a) => a.agent_id === taskId) : undefined,
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

/** Optimistic update for an agent's outputs.
 *
 * Outputs are directly editable in the Settings → Outputs sub-tab without going
 * through the page-level edit/save flow, so they need their own mutation with
 * optimistic cache updates. The backend rebuilds the deliver phase of the
 * workflow plan; we invalidate the agent-detail query on settle to pick that up.
 */
export function useUpdateAgentOutputs(agentId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (outputs: AgentOutput[]) => {
      if (!agentId) throw new Error('agentId required');
      return updateAgent(agentId, { outputs });
    },
    onMutate: async (outputs) => {
      if (!agentId) return { previous: undefined };
      await qc.cancelQueries({ queryKey: ['agent-detail', agentId] });
      const previous = qc.getQueryData<Agent>(['agent-detail', agentId]);
      if (previous) {
        qc.setQueryData<Agent>(['agent-detail', agentId], { ...previous, outputs });
      }
      return { previous };
    },
    onError: (_err, _outputs, context) => {
      if (agentId && context?.previous) {
        qc.setQueryData(['agent-detail', agentId], context.previous);
      }
    },
    onSettled: () => {
      if (agentId) qc.invalidateQueries({ queryKey: ['agent-detail', agentId] });
    },
  });
}
