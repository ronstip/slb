import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Database, LayoutGrid, Search, Table2, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { getMultiCollectionPosts } from '../../api/endpoints/feed.ts';
import { getCollectionStats } from '../../api/endpoints/collections.ts';
import { DataTable } from '../../components/DataTable/DataTable.tsx';
import { ExpandedPostRow } from '../../components/DataTable/ExpandedPostRow.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { Button } from '../../components/ui/button.tsx';
import { PostsFeedGrid } from '../agents/detail/tabs/overview/LivePostStream.tsx';
import { cn } from '../../lib/utils.ts';
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
import { DateTimeRangeFilter, type DateTimeRange } from './DateTimeRangeFilter.tsx';

interface PostsDataPanelProps {
  selectedCollectionIds: string[];
  collectionNames: Map<string, string>;
  collections?: Source[];
  globalSearch: string;
  dedup?: boolean;
  /** Default lower bound on `posted_at` (the agent's search-window start). User-picked dateRange overrides it. */
  startDate?: string;
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
  startDate,
}: PostsDataPanelProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(createEmptyFilters);

  // View toggle: table (default) or feed
  const [view, setView] = useState<'table' | 'feed'>('table');

  // Top filter bar state
  const [sourceFilter, setSourceFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [relevantFilter, setRelevantFilter] = useState('true');
  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set());
  const [channelSearch, setChannelSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateTimeRange>({ from: null, to: null });

  // Compute effective collection IDs based on source filter
  const effectiveCollectionIds = useMemo(() => {
    if (sourceFilter === 'all') return selectedCollectionIds;
    return selectedCollectionIds.filter((id) => id === sourceFilter);
  }, [selectedCollectionIds, sourceFilter]);

  const hasSelection = effectiveCollectionIds.length > 0;

  // User-picked range wins; otherwise fall back to the agent's search window so
  // this view stays aligned with the overview's Live feed counter.
  const effectiveStartDate = dateRange.from ?? startDate;

  const { data, isLoading } = useQuery({
    queryKey: ['collection-posts', effectiveCollectionIds, dedup, platformFilter, sentimentFilter, relevantFilter, effectiveStartDate, dateRange.to],
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
        start_date: effectiveStartDate ?? undefined,
        end_date: dateRange.to ?? undefined,
      }),
    enabled: hasSelection,
    staleTime: 30_000,
  });

  const allPosts = data?.posts ?? [];

  // Separate query for the relevance metric — must ignore the relevant_to_task
  // filter, otherwise the metric is circular (e.g. 100% under "Relevant only").
  // Only fires when a relevance filter is active; otherwise we reuse allPosts.
  const { data: relevanceData } = useQuery({
    queryKey: ['collection-posts-relevance', effectiveCollectionIds, dedup, platformFilter, sentimentFilter, effectiveStartDate, dateRange.to],
    queryFn: () =>
      getMultiCollectionPosts({
        collection_ids: effectiveCollectionIds,
        sort: 'views',
        limit: 5_000,
        offset: 0,
        dedup,
        platform: platformFilter !== 'all' ? platformFilter : undefined,
        sentiment: sentimentFilter !== 'all' ? sentimentFilter : undefined,
        relevant_to_task: 'all',
        start_date: effectiveStartDate ?? undefined,
        end_date: dateRange.to ?? undefined,
      }),
    enabled: hasSelection && relevantFilter !== 'all',
    staleTime: 30_000,
  });

  const relevancePool = relevantFilter === 'all' ? allPosts : (relevanceData?.posts ?? allPosts);

  // Apply top-level channel filter + column-level filters (both client-side)
  const afterColumnFilters = useMemo(() => {
    const base = channelFilter.size === 0
      ? allPosts
      : allPosts.filter((p) => channelFilter.has(p.channel_handle));
    return applyColumnFilters(base, columnFilters);
  }, [allPosts, columnFilters, channelFilter]);

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
    setChannelFilter(new Set());
    setChannelSearch('');
    setDateRange({ from: null, to: null });
  }, []);

  const hasAnyTopFilter =
    sourceFilter !== 'all' ||
    platformFilter !== 'all' ||
    sentimentFilter !== 'all' ||
    relevantFilter !== 'true' ||
    channelFilter.size > 0 ||
    dateRange.from !== null ||
    dateRange.to !== null;
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

    // Relevance: count posts marked as relevant + deduped unique post_ids.
    // Uses relevancePool (unfiltered by relevant_to_task) so the ratio isn't
    // circular when the user has "Relevant only" / "Not relevant only" applied.
    const uniquePostIds = new Set(relevancePool.map((p) => p.post_id));
    base.dedupedCount = uniquePostIds.size;
    base.relevantCount = relevancePool.filter((p) => p.is_related_to_task === true).length;

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
  }, [filteredPosts, relevancePool, allStats]);

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

        {/* Date range filter */}
        <DateTimeRangeFilter value={dateRange} onChange={setDateRange} />

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

        {/* Channel filter (channel_handle, multi-select with search + counts) */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs',
                'hover:bg-accent/50 transition-colors min-w-[140px]',
              )}
            >
              <span className="text-muted-foreground font-medium mr-1">Channel:</span>
              <span className="truncate">
                {channelFilter.size === 0
                  ? 'All'
                  : channelFilter.size === 1
                    ? `@${[...channelFilter][0]}`
                    : `${channelFilter.size} selected`}
              </span>
              <ChevronDown className="ml-auto h-3.5 w-3.5 opacity-50 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex w-64 max-h-80 flex-col overflow-hidden p-0"
            onClick={(e) => e.stopPropagation()}
          >
            {filterOptions.handles.length > 5 && (
              <div className="shrink-0 border-b border-border/40 p-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={channelSearch}
                    onChange={(e) => setChannelSearch(e.target.value)}
                    placeholder="Search channels..."
                    className="h-7 pl-7 text-xs"
                  />
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="p-1.5 space-y-0.5">
                {(() => {
                  const q = channelSearch.trim().toLowerCase();
                  const filtered = q
                    ? filterOptions.handles.filter((o) => o.value.toLowerCase().includes(q))
                    : filterOptions.handles;
                  if (filtered.length === 0) {
                    return <div className="py-4 text-center text-xs text-muted-foreground">No matches</div>;
                  }
                  return filtered.map((opt) => {
                    const isChecked = channelFilter.has(opt.value);
                    return (
                      <label
                        key={opt.value}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors',
                          isChecked
                            ? 'bg-primary/8 text-foreground'
                            : 'hover:bg-accent text-foreground/80',
                        )}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => {
                            const next = new Set(channelFilter);
                            if (next.has(opt.value)) next.delete(opt.value);
                            else next.add(opt.value);
                            setChannelFilter(next);
                          }}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="flex-1 min-w-0 truncate">@{opt.value}</span>
                        <span className="shrink-0 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                          {opt.count.toLocaleString()}
                        </span>
                      </label>
                    );
                  });
                })()}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1.5 border-t border-border/40 px-2 py-1.5 bg-muted/20">
              <Button
                variant="outline"
                size="sm"
                className="h-6 flex-1 text-[10px] font-semibold"
                onClick={() => {
                  const q = channelSearch.trim().toLowerCase();
                  const filtered = q
                    ? filterOptions.handles.filter((o) => o.value.toLowerCase().includes(q))
                    : filterOptions.handles;
                  setChannelFilter(new Set(filtered.map((o) => o.value)));
                }}
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 flex-1 text-[10px] font-semibold text-muted-foreground"
                onClick={() => setChannelFilter(new Set())}
                disabled={channelFilter.size === 0}
              >
                Clear
              </Button>
            </div>
          </PopoverContent>
        </Popover>

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

        {/* Right-side controls: clear-all + view toggle */}
        <div className="ml-auto flex items-center gap-2">
          {hasAnyFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-primary hover:text-primary/80"
              onClick={clearAllFilters}
            >
              Clear all
              <X className="h-3 w-3" />
            </Button>
          )}
          <div className="flex items-center rounded-md border border-border/60 bg-background overflow-hidden">
            <button
              type="button"
              onClick={() => setView('table')}
              className={cn(
                'flex h-7 items-center gap-1.5 px-2 text-xs transition-colors',
                view === 'table'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={view === 'table'}
            >
              <Table2 className="h-3.5 w-3.5" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setView('feed')}
              className={cn(
                'flex h-7 items-center gap-1.5 px-2 text-xs transition-colors border-l border-border/60',
                view === 'feed'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={view === 'feed'}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Feed
            </button>
          </div>
        </div>
      </div>

      {/* Analytics metrics strip */}
      <AnalyticsStrip stats={analyticsStats} />

      {/* View body: table or feed */}
      {view === 'table' ? (
        isLoading ? (
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
            density="comfortable"
            renderExpandedRow={(row) => <ExpandedPostRow row={row} />}
          />
        )
      ) : (
        <div className="flex flex-1 flex-col min-h-0 p-4">
          <PostsFeedGrid
            collectionIds={effectiveCollectionIds}
            platform={platformFilter !== 'all' ? platformFilter : undefined}
            sentiment={sentimentFilter !== 'all' ? sentimentFilter : undefined}
            relevantToTask={relevantFilter}
            dedup={dedup}
            startDate={effectiveStartDate ?? undefined}
            variant="wide"
          />
        </div>
      )}
    </div>
  );
}
