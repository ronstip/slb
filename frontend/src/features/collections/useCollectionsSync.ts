import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCollections } from '../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { mapCollectionToSource } from './utils.ts';

/**
 * Eagerly fetches all collections on mount and syncs them into the sources store.
 * This ensures collection state is available immediately on app load and session restore,
 * not just when the user manually opens a popover or drawer.
 *
 * Also updates existing sources with fresh server data (status, config, metrics)
 * so that monitoring state changes are reflected without a page reload.
 */
export function useCollectionsSync() {
  const setSources = useSourcesStore((s) => s.setSources);

  const { data: allCollections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => listCollections(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!allCollections || allCollections.length === 0) return;
    const currentSources = useSourcesStore.getState().sources;
    const existingIds = new Set(currentSources.map((s) => s.collectionId));

    // Add new collections
    const newSources = allCollections
      .filter((c) => !existingIds.has(c.collection_id))
      .map(mapCollectionToSource);

    // Update existing collections with fresh server-driven fields
    const updatedSources = currentSources.map((src) => {
      const fresh = allCollections.find((c) => c.collection_id === src.collectionId);
      if (!fresh) return src;
      return {
        ...src,
        status: fresh.status,
        config: fresh.config ?? src.config,
        postsCollected: fresh.posts_collected,
        totalViews: fresh.total_views,
        positivePct: fresh.positive_pct,
        errorMessage: fresh.error_message ?? undefined,
        lastRunAt: fresh.last_run_at,
        nextRunAt: fresh.next_run_at,
        totalRuns: fresh.total_runs,
        visibility: (fresh.visibility as 'private' | 'org') ?? src.visibility,
        userId: fresh.user_id ?? src.userId,
      };
    });

    setSources([...updatedSources, ...newSources]);
  }, [allCollections, setSources]);
}
