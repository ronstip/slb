import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, X } from 'lucide-react';
import { getMultiCollectionPosts } from '../../api/endpoints/feed.ts';
import { getCollectionStats } from '../../api/endpoints/collections.ts';
import { DataTable } from '../../components/DataTable/DataTable.tsx';
import { ExpandedPostRow } from '../../components/DataTable/ExpandedPostRow.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { AnalyticsStrip, computeAnalyticsStats } from './AnalyticsStrip.tsx';
import {
  collectionsPostColumns,
  createEmptyFilters,
  applyColumnFilters,
  extractFilterOptions,
  hasActiveFilters,
  type ColumnFilters,
} from './collectionsPostColumns.tsx';
import { PLATFORMS, PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import type { Source } from '../../stores/sources-store.ts';

interface PostsDataPanelProps {
  selectedCollectionIds: string[];
  collectionNames: Map<string, string>;
  collections?: Source[];
  globalSearch: string;
  dedup?: boolean;
  /** Legacy callback props — still accepted but optional */
  onActiveFiltersChange?: (active: boolean) => void;
  onClearFiltersCallbackChange?: (cb: (() => void) | null) => void;
}

export function PostsDataPanel({
  selectedCollectionIds,
  collectionNames: _collectionNames,
  collections,
  globalSearch,
  dedup,
}: PostsDataPanelProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(createEmptyFilters);

  // Top filter bar state
  const [sourceFilter, setSourceFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [relevantFilter, setRelevantFilter] = useState('true');

  // Compute effective collection IDs based on source filter
  const effectiveCollectionIds = useMemo(() => {
    if (sourceFilter === 'all') return selectedCollectionIds;
    return selectedCollectionIds.filter((id) => id === sourceFilter);
  }, [selectedCollectionIds, sourceFilter]);

  const hasSelection = effectiveCollectionIds.length > 0;

  const { data, isLoading } = useQuery({
    queryKey: ['collection-posts', effectiveCollectionIds, dedup, platformFilter, sentimentFilter, relevantFilter],
    queryFn: () =>
      getMultiCollectionPosts({
        collection_ids: effectiveCollectionIds,
        sort: 'views',
        limit: 5_000,
        offset: 0,
        dedup,
        platform: platformFilter !== 'all' ? platformFilter : undefined,
        sentiment: sentimentFilter !== 'all' ? sentimentFilter : undefined,
        relevant_to_task: relevantFilter,
      }),
    enabled: hasSelection,
    staleTime: 30_000,
  });

  const allPosts = data?.posts ?? [];

  // Apply column-level filters (client-side)
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

  // Extract unique values for filter dropdowns from ALL posts
  const filterOptions = useMemo(() => extractFilterOptions(allPosts), [allPosts]);

  const clearAllFilters = useCallback(() => {
    setColumnFilters(createEmptyFilters());
    setSourceFilter('all');
    setPlatformFilter('all');
    setSentimentFilter('all');
    setRelevantFilter('true');
  }, []);

  const hasAnyTopFilter =
    sourceFilter !== 'all' ||
    platformFilter !== 'all' ||
    sentimentFilter !== 'all' ||
    relevantFilter !== 'true';
  const hasAnyFilter = hasAnyTopFilter || hasActiveFilters(columnFilters);

  // Build columns
  const columns = useMemo(
    () =>
      collectionsPostColumns({
        filters: columnFilters,
        onFiltersChange: setColumnFilters,
        filterOptions,
      }),
    [columnFilters, filterOptions],
  );

  // Fetch collection stats for status panel data (daily_volume, enrichment, freshness)
  const { data: allStats } = useQuery({
    queryKey: ['collection-stats-multi', effectiveCollectionIds],
    queryFn: () => Promise.all(effectiveCollectionIds.map((id) => getCollectionStats(id))),
    enabled: hasSelection,
    staleTime: 5 * 60_000,
  });

  // Analytics stats — computed from posts, then enriched with collection stats for status fields
  const analyticsStats = useMemo(() => {
    const base = computeAnalyticsStats(filteredPosts);
    if (!base) return base;

    // Relevance: count posts marked as relevant + deduped unique post_ids
    const uniquePostIds = new Set(allPosts.map((p) => p.post_id));
    base.dedupedCount = uniquePostIds.size;
    base.relevantCount = allPosts.filter((p) => p.is_related_to_task === true).length;

    if (!allStats) return base;

    // Merge daily_volume across all collections (aggregate by date)
    const dailyMap = new Map<string, number>();
    for (const s of allStats) {
      for (const d of s.daily_volume ?? []) {
        dailyMap.set(d.post_date, (dailyMap.get(d.post_date) ?? 0) + d.post_count);
      }
    }
    base.dailyVolume = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // Enrichment count
    base.enrichedCount = allStats.reduce((sum, s) => sum + s.total_posts_enriched, 0);

    // Latest date across all collections
    const dates = allStats
      .map((s) => s.date_range?.latest)
      .filter((d): d is string => d !== null && d !== undefined);
    base.latestDate = dates.length > 0 ? dates.sort().pop()! : null;

    return base;
  }, [filteredPosts, allPosts, allStats]);

  // Build source options from collections prop
  const sourceOptions = useMemo(() => {
    if (!collections) return [];
    return collections.map((c) => ({
      id: c.collectionId,
      label: c.title,
      platform: c.config?.platforms?.[0] as string | undefined,
    }));
  }, [collections]);

  if (!hasSelection && sourceFilter === 'all') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-background text-muted-foreground">
        <Database className="h-12 w-12 opacity-20 mb-4" />
        <p className="text-sm font-medium">No data available</p>
        <p className="text-xs mt-1">Data will appear here once the agent collects posts.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-white dark:bg-background">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/40 bg-muted/20 shrink-0">
        {/* Source filter */}
        {sourceOptions.length > 1 && (
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-7 w-auto min-w-[140px] text-xs gap-1.5 bg-background">
              <span className="text-muted-foreground font-medium mr-1">Source:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sourceOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-1.5">
                    {s.platform && <PlatformIcon platform={s.platform} className="h-3 w-3" />}
                    <span className="truncate max-w-[160px]">{s.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Platform filter */}
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="h-7 w-auto min-w-[120px] text-xs gap-1.5 bg-background">
            <span className="text-muted-foreground font-medium mr-1">Platform:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {PLATFORMS.map((p) => (
              <SelectItem key={p} value={p}>
                <span className="flex items-center gap-1.5">
                  <PlatformIcon platform={p} className="h-3 w-3" />
                  {PLATFORM_LABELS[p] || p}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sentiment filter */}
        <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
          <SelectTrigger className="h-7 w-auto min-w-[120px] text-xs gap-1.5 bg-background">
            <span className="text-muted-foreground font-medium mr-1">Sentiment:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {Object.entries(SENTIMENT_COLORS).map(([name, color]) => (
              <SelectItem key={name} value={name}>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="capitalize">{name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Relevant to task filter */}
        <Select value={relevantFilter} onValueChange={setRelevantFilter}>
          <SelectTrigger className="h-7 w-auto min-w-[140px] text-xs gap-1.5 bg-background">
            <span className="text-muted-foreground font-medium mr-1">Relevant:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Relevant only</SelectItem>
            <SelectItem value="false">Not relevant only</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear all */}
        {hasAnyFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-primary hover:text-primary/80 ml-auto"
            onClick={clearAllFilters}
          >
            Clear all
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

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
