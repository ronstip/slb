import { useEffect, useMemo, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getCollectionStatus } from '../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';

/**
 * Polls collection status for all active (non-terminal) sources.
 * Updates source status in the store. Auto-opens Studio when a collection completes.
 */
export function useCollectionPolling() {
  const sources = useSourcesStore((s) => s.sources);
  const updateSource = useSourcesStore((s) => s.updateSource);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const setFeedSource = useStudioStore((s) => s.setFeedSource);
  const studioPanelCollapsed = useUIStore((s) => s.studioPanelCollapsed);
  const toggleStudioPanel = useUIStore((s) => s.toggleStudioPanel);

  // Memoize active source IDs to avoid new array references on every render
  const activeSourceIds = useMemo(
    () =>
      sources
        .filter(
          (s) =>
            s.status === 'pending' ||
            s.status === 'collecting' ||
            s.status === 'enriching' ||
            s.status === 'monitoring',
        )
        .map((s) => s.collectionId),
    [sources],
  );

  // Track previous data to skip no-op updates
  const prevDataRef = useRef<Map<string, string>>(new Map());

  const queryResults = useQueries({
    queries: activeSourceIds.map((id) => ({
      queryKey: ['collection-status', id],
      queryFn: () => getCollectionStatus(id),
      refetchInterval: 5000,
    })),
  });

  useEffect(() => {
    for (let i = 0; i < activeSourceIds.length; i++) {
      const collectionId = activeSourceIds[i];
      const result = queryResults[i];
      if (!result?.data) continue;

      const data = result.data;

      // Skip update if data hasn't changed since last time we processed it
      const fingerprint = `${data.status}:${data.posts_collected}:${data.total_views}:${data.positive_pct}`;
      if (prevDataRef.current.get(collectionId) === fingerprint) continue;

      const prevFingerprint = prevDataRef.current.get(collectionId);
      const prevStatus = prevFingerprint?.split(':')[0];
      const prevPostCount = Number(prevFingerprint?.split(':')[1] ?? 0) || 0;
      prevDataRef.current.set(collectionId, fingerprint);

      updateSource(collectionId, {
        status: data.status,
        postsCollected: data.posts_collected,
        totalViews: data.total_views,
        positivePct: data.positive_pct,
        errorMessage: data.error_message ?? undefined,
        lastRunAt: data.last_run_at,
        nextRunAt: data.next_run_at,
        totalRuns: data.total_runs,
      });

      // Auto-open Studio Feed when first posts arrive (not waiting for completion)
      const isNewlyCollecting = prevStatus && ['pending', 'collecting'].includes(prevStatus) && data.posts_collected > 0 && prevPostCount === 0;
      const isNewlyComplete = prevStatus && !['completed', 'monitoring'].includes(prevStatus) && ['completed', 'monitoring'].includes(data.status);

      if (isNewlyCollecting || isNewlyComplete) {
        setFeedSource(collectionId);
        setActiveTab('feed');
        if (studioPanelCollapsed) {
          toggleStudioPanel();
        }
      }
    }

    // Clean up entries for removed/completed sources
    const activeIdSet = new Set(activeSourceIds);
    for (const id of prevDataRef.current.keys()) {
      if (!activeIdSet.has(id)) {
        prevDataRef.current.delete(id);
      }
    }
  }, [queryResults, activeSourceIds, updateSource, setFeedSource, setActiveTab, studioPanelCollapsed, toggleStudioPanel]);
}
