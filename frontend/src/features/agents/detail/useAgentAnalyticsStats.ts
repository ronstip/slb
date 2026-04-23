import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMultiCollectionPosts } from '../../../api/endpoints/feed.ts';
import { getCollectionStats, listCollections } from '../../../api/endpoints/collections.ts';
import { computeAnalyticsStats, type AnalyticsStats } from '../../collections/AnalyticsStrip.tsx';
import type { Agent } from '../../../api/endpoints/agents.ts';

/**
 * Query keys here are kept in exact sync with PostsDataPanel's default-filter
 * state (platform=all, sentiment=all, relevant=true, sourceFilter=all). When
 * both the Data and Topics tabs are open, React Query dedupes these fetches
 * so navigation is cache-hit and instant.
 */
export function useAgentAnalyticsStats(task: Agent): AnalyticsStats | null {
  const taskCollectionIds = useMemo(
    () => new Set(task.collection_ids ?? []),
    [task.collection_ids],
  );

  const { data: rawCollections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: listCollections,
    staleTime: 30_000,
  });

  const collectionIds = useMemo(
    () =>
      rawCollections
        .filter((c) => taskCollectionIds.has(c.collection_id))
        .map((c) => c.collection_id),
    [rawCollections, taskCollectionIds],
  );

  const dedup = collectionIds.length > 1;
  const hasSelection = collectionIds.length > 0;

  const { data: postsData } = useQuery({
    queryKey: ['collection-posts', collectionIds, dedup, 'all', 'all', 'true'],
    queryFn: () =>
      getMultiCollectionPosts({
        collection_ids: collectionIds,
        sort: 'views',
        limit: 5_000,
        offset: 0,
        dedup,
        relevant_to_task: 'true',
      }),
    enabled: hasSelection,
    staleTime: 30_000,
  });

  const { data: relevanceData } = useQuery({
    queryKey: ['collection-posts-relevance', collectionIds, dedup, 'all', 'all'],
    queryFn: () =>
      getMultiCollectionPosts({
        collection_ids: collectionIds,
        sort: 'views',
        limit: 5_000,
        offset: 0,
        dedup,
        relevant_to_task: 'all',
      }),
    enabled: hasSelection,
    staleTime: 30_000,
  });

  const { data: allStats } = useQuery({
    queryKey: ['collection-stats-multi', collectionIds],
    queryFn: () => Promise.all(collectionIds.map((id) => getCollectionStats(id))),
    enabled: hasSelection,
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    const posts = postsData?.posts ?? [];
    const base = computeAnalyticsStats(posts);
    if (!base) return null;

    const pool = relevanceData?.posts ?? posts;
    const uniquePostIds = new Set(pool.map((p) => p.post_id));
    base.dedupedCount = uniquePostIds.size;
    base.relevantCount = pool.filter((p) => p.is_related_to_task === true).length;

    if (allStats) {
      const dailyMap = new Map<string, number>();
      for (const s of allStats) {
        for (const d of s.daily_volume ?? []) {
          dailyMap.set(d.post_date, (dailyMap.get(d.post_date) ?? 0) + d.post_count);
        }
      }
      base.dailyVolume = [...dailyMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));
      base.enrichedCount = allStats.reduce((sum, s) => sum + s.total_posts_enriched, 0);
      const dates = allStats
        .map((s) => s.date_range?.latest)
        .filter((d): d is string => d !== null && d !== undefined);
      base.latestDate = dates.length > 0 ? dates.sort().pop()! : null;
    }

    return base;
  }, [postsData, relevanceData, allStats]);
}
