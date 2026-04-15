import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { getMultiCollectionPosts } from '../../api/endpoints/feed.ts';
import { DataTable } from '../../components/DataTable/DataTable.tsx';
import { ExpandedPostRow } from '../../components/DataTable/ExpandedPostRow.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { AnalyticsStrip, computeAnalyticsStats } from './AnalyticsStrip.tsx';
import {
  collectionsPostColumns,
  createEmptyFilters,
  applyColumnFilters,
  extractFilterOptions,
  hasActiveFilters,
  type ColumnFilters,
} from './collectionsPostColumns.tsx';

interface PostsDataPanelProps {
  selectedCollectionIds: string[];
  collectionNames: Map<string, string>;
  globalSearch: string;
  onActiveFiltersChange: (active: boolean) => void;
  onClearFiltersCallbackChange: (cb: (() => void) | null) => void;
}

export function PostsDataPanel({
  selectedCollectionIds,
  collectionNames,
  globalSearch,
  onActiveFiltersChange,
  onClearFiltersCallbackChange,
}: PostsDataPanelProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(createEmptyFilters);

  const hasSelection = selectedCollectionIds.length > 0;

  const { data, isLoading } = useQuery({
    queryKey: ['collection-posts', selectedCollectionIds],
    queryFn: () =>
      getMultiCollectionPosts({
        collection_ids: selectedCollectionIds,
        sort: 'views',
        limit: 500,
        offset: 0,
      }),
    enabled: hasSelection,
    staleTime: 30_000,
  });

  const allPosts = data?.posts ?? [];

  // Apply column-level filters
  const afterColumnFilters = useMemo(
    () => applyColumnFilters(allPosts, columnFilters),
    [allPosts, columnFilters],
  );

  // Apply global search on top
  const filteredPosts = useMemo(() => {
    if (!globalSearch.trim()) return afterColumnFilters;
    const q = globalSearch.toLowerCase();
    return afterColumnFilters.filter((p) => {
      const text = [p.title, p.content, p.ai_summary, p.channel_handle, p.platform]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [afterColumnFilters, globalSearch]);

  // Extract unique values for filter dropdowns from ALL posts (before filtering)
  const filterOptions = useMemo(() => extractFilterOptions(allPosts), [allPosts]);

  // Notify parent about active filters state
  const isFiltered = hasActiveFilters(columnFilters);
  const clearFilters = useCallback(() => setColumnFilters(createEmptyFilters()), []);

  useEffect(() => {
    onActiveFiltersChange(isFiltered);
  }, [isFiltered, onActiveFiltersChange]);

  useEffect(() => {
    onClearFiltersCallbackChange(clearFilters);
  }, [clearFilters, onClearFiltersCallbackChange]);

  // Build columns with filter headers
  const columns = useMemo(
    () =>
      collectionsPostColumns({
        collectionNames,
        showCollectionColumn: selectedCollectionIds.length > 1,
        filters: columnFilters,
        onFiltersChange: setColumnFilters,
        filterOptions,
      }),
    [collectionNames, selectedCollectionIds.length, columnFilters, filterOptions],
  );

  // Analytics stats for the strip
  const analyticsStats = useMemo(() => computeAnalyticsStats(filteredPosts), [filteredPosts]);

  if (!hasSelection) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-background text-muted-foreground">
        <Database className="h-12 w-12 opacity-20 mb-4" />
        <p className="text-sm font-medium">No collections selected</p>
        <p className="text-xs mt-1">Select one or more collections from the sidebar to view their data.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-white dark:bg-background">
      {/* Analytics metrics strip */}
      <AnalyticsStrip stats={analyticsStats} />

      {/* Data table */}
      {isLoading ? (
        <div className="space-y-2 p-4 flex-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <DataTable
          data={filteredPosts}
          columns={columns}
          getRowKey={(p) => p.post_id}
          defaultSortKey="views"
          pageSize={50}
          className="bg-white dark:bg-background"
          striped={false}
          renderExpandedRow={(row) => <ExpandedPostRow row={row} />}
        />
      )}
    </div>
  );
}
