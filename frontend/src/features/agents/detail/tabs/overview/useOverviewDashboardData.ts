import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDashboardData } from '../../../../../api/endpoints/dashboard.ts';
import type { Source } from '../../../../../api/endpoints/agents.ts';
import { applyOverviewFilters, computeWindowStart, type OverviewWindow } from './overview-filters.ts';

export function useOverviewDashboardData(
  collectionIds: string[],
  sources: Source[] | undefined,
  isAgentRunning: boolean,
  agentCreatedAt: string | undefined,
  dataStartDate?: string | null,
  dataEndDate?: string | null,
  agentId?: string,
) {
  // Prefer the agent's stored data window; fall back to per-source computation
  // for legacy agents whose window hasn't been backfilled yet.
  const window: OverviewWindow = useMemo(() => {
    if (dataStartDate) return { startDate: dataStartDate, days: null };
    return computeWindowStart(sources, agentCreatedAt);
  }, [dataStartDate, sources, agentCreatedAt]);

  const query = useQuery({
    queryKey: ['dashboard-data', agentId ?? '', ...collectionIds],
    queryFn: () => getDashboardData(collectionIds, agentId),
    enabled: collectionIds.length > 0,
    staleTime: 60_000,
    refetchInterval: isAgentRunning ? 30_000 : false,
  });

  const posts = useMemo(
    () =>
      applyOverviewFilters(query.data?.posts ?? [], {
        startDate: window.startDate,
        endDate: dataEndDate ?? null,
      }),
    [query.data?.posts, window.startDate, dataEndDate],
  );

  return {
    posts,
    window,
    isLoading: query.isLoading,
    raw: query.data,
  };
}
