import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCollections } from '../../api/endpoints/collections.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { mapCollectionToSource } from './utils.ts';

/**
 * Eagerly fetches all collections on mount and syncs them into the sources store.
 * This ensures collection state is available immediately on app load and session restore,
 * not just when the user manually opens a popover or drawer.
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
    const newCollections = allCollections.filter((c) => !existingIds.has(c.collection_id));
    if (newCollections.length === 0) return;

    const newSources = newCollections.map(mapCollectionToSource);
    setSources([...currentSources, ...newSources]);
  }, [allCollections, setSources]);
}
