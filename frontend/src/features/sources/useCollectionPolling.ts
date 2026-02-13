import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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

  const activeSources = sources.filter(
    (s) => s.status === 'pending' || s.status === 'collecting' || s.status === 'enriching',
  );

  // Poll each active source
  for (const source of activeSources) {
    useCollectionStatusQuery(
      source.collectionId,
      (data) => {
        const prevStatus = source.status;
        updateSource(source.collectionId, {
          status: data.status as typeof source.status,
          postsCollected: data.posts_collected,
          postsEnriched: data.posts_enriched,
          postsEmbedded: data.posts_embedded,
          errorMessage: data.error_message ?? undefined,
        });

        // Auto-open Studio Feed when collection completes
        if (prevStatus !== 'completed' && data.status === 'completed') {
          setFeedSource(source.collectionId);
          setActiveTab('feed');
          if (studioPanelCollapsed) {
            toggleStudioPanel();
          }
        }
      },
    );
  }
}

function useCollectionStatusQuery(
  collectionId: string,
  onUpdate: (data: { status: string; posts_collected: number; posts_enriched: number; posts_embedded: number; error_message?: string }) => void,
) {
  const { data } = useQuery({
    queryKey: ['collection-status', collectionId],
    queryFn: () => getCollectionStatus(collectionId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (data) {
      onUpdate(data);
    }
  }, [data]);
}
