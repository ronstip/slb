import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDashboardData } from '../../../../../api/endpoints/dashboard.ts';
import type { SearchDef } from '../../../../../api/endpoints/agents.ts';
import { applyOverviewFilters, computeWindowStart, type OverviewWindow } from './overview-filters.ts';

export function useOverviewDashboardData(
  collectionIds: string[],
  searches: SearchDef[] | undefined,
  isAgentRunning: boolean,
) {
  const window: OverviewWindow = useMemo(() => computeWindowStart(searches), [searches]);

  const query = useQuery({
    queryKey: ['dashboard-data', ...collectionIds],
    queryFn: () => getDashboardData(collectionIds),
    enabled: collectionIds.length > 0,
    staleTime: 60_000,
    refetchInterval: isAgentRunning ? 30_000 : false,
  });

  const posts = useMemo(
    () =>
      applyOverviewFilters(query.data?.posts ?? [], {
        relevantOnly: true,
        startDate: window.startDate,
      }),
    [query.data?.posts, window.startDate],
  );

  return {
    posts,
    window,
    isLoading: query.isLoading,
    raw: query.data,
  };
}
