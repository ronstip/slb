import { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Database, Download, LayoutGrid, Search, Table2, X } from 'lucide-react';
import { downloadCsv, FEED_POST_CSV_COLUMNS } from '../../lib/download-csv.ts';
import { Input } from '../../components/ui/input.tsx';
import { getMultiCollectionPosts } from '../../api/endpoints/feed.ts';
import { getCollectionStats } from '../../api/endpoints/collections.ts';
import { getAgent } from '../../api/endpoints/agents.ts';
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
import { AnalyticsStrip, computeAnalyticsStats, analyticsStatsFromFeedKpis } from './AnalyticsStrip.tsx';
import {
  collectionsPostColumns,
  createEmptyFilters,
  applyColumnFilters,
  hasActiveFilters,
  type ColumnFilters,
} from './collectionsPostColumns.tsx';
import { PLATFORMS, PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import type { Source } from '../../stores/sources-store.ts';
import { DateTimeRangeFilter, type DateTimeRange } from './DateTimeRangeFilter.tsx';
import { buildFieldRegistry, URL_FIELD } from './fieldRegistry.ts';
import {
  ColumnPicker,
  mergeColumnPrefs,
  defaultPrefsFor,
  loadColumnPrefs,
  saveColumnPrefs,
  clearColumnPrefs,
  type ColumnPref,
} from './ColumnPicker.tsx';

interface PostsDataPanelProps {
  selectedCollectionIds: string[];
  collectionNames: Map<string, string>;
  collections?: Source[];
  globalSearch: string;
  /** When provided, the panel renders its own "Search posts" input in the filter
   *  bar wired to this callback (used when the host has no header search of its own). */
  onGlobalSearchChange?: (value: string) => void;
  /** When provided, the toolbar controls (search, columns, export, view toggle) are
   *  portaled into this element (e.g. the page header) and the inline filter bar -
   *  including the source/platform/date/sentiment/channel filters - is not rendered. */
  toolbarContainer?: HTMLElement | null;
  dedup?: boolean;
  /** Default lower bound on `posted_at` (the agent's search-window start). User-picked dateRange overrides it. */
  startDate?: string;
  /** Default upper bound on `posted_at` (the agent's search-window end). User-picked dateRange overrides it. Null/undefined = no upper bound. */
  endDate?: string | null;
  /** Filename prefix for the CSV export (slugified before use). */
  exportFilenamePrefix?: string;
  /** When provided, the feed scopes posts via the agent's scope_posts TVF - only enrichment
   *  rows belonging to this agent are considered (no cross-agent NULL rows). */
  agentId?: string;
  /** Legacy callback props - still accepted but optional */
  onActiveFiltersChange?: (active: boolean) => void;
  onClearFiltersCallbackChange?: (cb: (() => void) | null) => void;
}

export function PostsDataPanel({
  selectedCollectionIds,
  collectionNames: _collectionNames,
  collections,
  globalSearch,
  onGlobalSearchChange,
  toolbarContainer,
  dedup,
  startDate,
  endDate,
  exportFilenamePrefix,
  agentId,
}: PostsDataPanelProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(createEmptyFilters);

  // View toggle: table (default) or feed
  const [view, setView] = useState<'table' | 'feed'>('table');

  // Top filter bar state
  const [sourceFilter, setSourceFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  // Data source: posts (default), comments, or both (scope_comments union).
  // Agent-scoped only - comments need an agent context.
  const [feedSource, setFeedSource] = useState<'posts' | 'comments' | 'both'>('posts');
  const [dateRange, setDateRange] = useState<DateTimeRange>({ from: null, to: null });

  // Fetch agent doc to read custom_fields schema for the field registry.
  // Only when `agentId` is set - collections viewed without an agent context
  // just get built-in fields (the registry still works, custom fields are
  // simply absent).
  const { data: agentDoc } = useQuery({
    queryKey: ['agent-detail', agentId],
    queryFn: () => getAgent(agentId!),
    enabled: !!agentId,
    staleTime: 5 * 60_000,
  });

  const customFields = agentDoc?.enrichment_config?.custom_fields ?? null;
  const registry = useMemo(() => buildFieldRegistry(customFields), [customFields]);

  // Column visibility / order - persisted per-agent in localStorage. Use
  // 'default' when no agent is in scope (e.g. ad-hoc collection viewing).
  const prefsScope = agentId ?? 'default';
  const [columnPrefs, setColumnPrefs] = useState<ColumnPref[]>(
    () => mergeColumnPrefs(loadColumnPrefs(prefsScope), buildFieldRegistry(null)),
  );

  // Re-merge prefs whenever the registry changes (new custom fields appear, or
  // the user switches between agents with different schemas).
  useEffect(() => {
    setColumnPrefs((prev) => mergeColumnPrefs(prev, registry));
  }, [registry]);

  // Reload from storage when the scope changes (switching agents).
  useEffect(() => {
    setColumnPrefs(mergeColumnPrefs(loadColumnPrefs(prefsScope), registry));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsScope]);

  const updateColumnPrefs = useCallback((next: ColumnPref[]) => {
    setColumnPrefs(next);
    saveColumnPrefs(prefsScope, next);
  }, [prefsScope]);

  const resetColumnPrefs = useCallback(() => {
    clearColumnPrefs(prefsScope);
    setColumnPrefs(defaultPrefsFor(registry));
  }, [prefsScope, registry]);

  // Compute effective collection IDs based on source filter
  const effectiveCollectionIds = useMemo(() => {
    if (sourceFilter === 'all') return selectedCollectionIds;
    return selectedCollectionIds.filter((id) => id === sourceFilter);
  }, [selectedCollectionIds, sourceFilter]);

  const hasSelection = effectiveCollectionIds.length > 0;

  // User-picked range wins; otherwise fall back to the agent's search window so
  // this view stays aligned with the overview's Live feed counter.
  const effectiveStartDate = dateRange.from ?? startDate;
  const effectiveEndDate = dateRange.to ?? endDate ?? undefined;

  // Initial page size. Earlier this was 5_000 - that forced every visit to
  // download 1–10 MB of post JSON before the table could render, even though
  // the table only ever shows 50 rows at a time. Most agents have <500 posts
  // total, so 500 covers them in full; busy agents get a truncation banner +
  // a one-click "Load all" for cases that need the long tail (export, filter).
  const INITIAL_LIMIT = 500;
  const [showAll, setShowAll] = useState(false);
  const fetchLimit = showAll ? 10_000 : INITIAL_LIMIT;

  const { data, isLoading } = useQuery({
    queryKey: ['collection-posts', effectiveCollectionIds, dedup, platformFilter, sentimentFilter, effectiveStartDate, effectiveEndDate, agentId ?? '', fetchLimit, feedSource],
    queryFn: () =>
      getMultiCollectionPosts({
        collection_ids: effectiveCollectionIds,
        sort: 'views',
        limit: fetchLimit,
        offset: 0,
        // Get full-window KPI aggregates so the strip is accurate even when the
        // table only downloads the top `fetchLimit` posts (agent-scoped only).
        include_kpis: !!agentId,
        dedup,
        platform: platformFilter !== 'all' ? platformFilter : undefined,
        sentiment: sentimentFilter !== 'all' ? sentimentFilter : undefined,
        start_date: effectiveStartDate ?? undefined,
        end_date: effectiveEndDate,
        agent_id: agentId,
        // Posts (default), comments (scope_comments), or both. Agent-scoped only.
        source: agentId ? feedSource : undefined,
      }),
    enabled: hasSelection,
    // Bumped from 30 s - posts data rarely changes mid-session; the 30 s window
    // forced a fresh /feed (multi-second BQ query) every tab-switch.
    staleTime: 5 * 60_000,
  });

  const allPosts = data?.posts ?? [];
  const totalAvailable = data?.total ?? allPosts.length;
  const isTruncated = !showAll && totalAvailable > allPosts.length;

  // Apply per-column filters (all client-side, ANDed). Channel filtering now
  // flows through the channel_handle column filter like every other column.
  const afterColumnFilters = useMemo(() => {
    // URL_FIELD isn't in the picker registry; append it so the __link column's
    // paste-a-URL text filter resolves.
    return applyColumnFilters(allPosts, columnFilters, [...registry, URL_FIELD]);
  }, [allPosts, columnFilters, registry]);

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

  const clearAllFilters = useCallback(() => {
    setColumnFilters(createEmptyFilters());
    setSourceFilter('all');
    setPlatformFilter('all');
    setSentimentFilter('all');
    setDateRange({ from: null, to: null });
  }, []);

  const hasAnyTopFilter =
    sourceFilter !== 'all' ||
    platformFilter !== 'all' ||
    sentimentFilter !== 'all' ||
    dateRange.from !== null ||
    dateRange.to !== null;
  const hasAnyFilter = hasAnyTopFilter || hasActiveFilters(columnFilters);

  // Build columns from the registry, filtered + ordered by user prefs.
  const columns = useMemo(
    () =>
      collectionsPostColumns({
        filters: columnFilters,
        onFiltersChange: setColumnFilters,
        registry,
        columnPrefs,
        allPosts,
        agentId,
      }),
    [columnFilters, registry, columnPrefs, allPosts, agentId],
  );

  // Fetch collection stats for status panel data (daily_volume, enrichment, freshness)
  const { data: allStats } = useQuery({
    queryKey: ['collection-stats-multi', effectiveCollectionIds],
    queryFn: () => Promise.all(effectiveCollectionIds.map((id) => getCollectionStats(id))),
    enabled: hasSelection,
    staleTime: 5 * 60_000,
  });

  // The KPI strip must describe whatever the table currently shows. Two filter
  // tiers feed it:
  //  - Server-side (source / platform / sentiment / date): sent with the /feed
  //    request, so they're already baked into `data.kpis` (the full filtered
  //    window - independent of the row cap).
  //  - Client-side (per-column filters + global search): applied locally over
  //    the downloaded rows only.
  // So we use the server KPIs only when no client-side filter is active (the
  // default + server-filtered views) - that keeps the headline numbers correct
  // over the FULL window even when the table is truncated. The moment a column
  // filter or search is active we switch to the client compute so the strip
  // tracks the filter (over the loaded subset, as the truncation banner states).
  const serverKpis = data?.kpis ?? null;
  const hasClientSideFilter = hasActiveFilters(columnFilters) || globalSearch.trim().length > 0;
  const useServerKpis = isTruncated && !!serverKpis && !hasClientSideFilter;
  const analyticsStats = useMemo(() => {
    const base =
      useServerKpis && serverKpis
        ? analyticsStatsFromFeedKpis(serverKpis)
        : computeAnalyticsStats(filteredPosts);
    if (!base) return base;

    // Deduped unique post_ids. The scope_posts TVF already dedups, so the server
    // count is authoritative when we use it; otherwise count the loaded subset.
    base.dedupedCount = useServerKpis && serverKpis
      ? serverKpis.total_posts
      : new Set(allPosts.map((p) => p.post_id)).size;

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
  }, [filteredPosts, allPosts, allStats, useServerKpis, serverKpis]);

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

  const searchBox = onGlobalSearchChange ? (
    <div className="relative w-48 shrink-0">
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={globalSearch}
        onChange={(e) => onGlobalSearchChange(e.target.value)}
        placeholder="Search posts..."
        className="h-7 pl-8 text-xs"
      />
      {globalSearch && (
        <button
          onClick={() => onGlobalSearchChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  ) : null;

  // Right-side controls: columns + clear-all + export + view toggle
  const controls = (
    <>
      {/* Data source: posts | comments | both (scope_comments). Agent-scoped
          only; default posts. */}
      {agentId && (
        <div className="flex items-center gap-1">
          {(['posts', 'comments', 'both'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFeedSource(s)}
              className={`rounded-md border px-2 py-1 text-xs font-medium capitalize transition-colors ${
                feedSource === s
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <ColumnPicker
        registry={registry}
        prefs={columnPrefs}
        onChange={updateColumnPrefs}
        onReset={resetColumnPrefs}
      />
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
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        disabled={filteredPosts.length === 0}
        onClick={() => {
          // Unnest custom_fields one level: each top-level key becomes its own column.
          // Keys are agent-defined and dynamic - discover them from the rows being exported.
          // Skip keys that would collide with built-in columns (the built-in wins; the
          // collision is silent because exposing a custom_fields value under a built-in
          // header would be misleading).
          const builtInKeys = new Set(FEED_POST_CSV_COLUMNS.map((c) => c.key));
          const customKeys = new Set<string>();
          for (const post of filteredPosts) {
            const cf = post.custom_fields;
            if (cf && typeof cf === 'object' && !Array.isArray(cf)) {
              for (const k of Object.keys(cf)) {
                if (!builtInKeys.has(k)) customKeys.add(k);
              }
            }
          }
          const customColumns = [...customKeys]
            .sort()
            .map((k) => ({ key: k, header: k }));
          const cols = FEED_POST_CSV_COLUMNS
            .filter((c) => c.key !== 'custom_fields')
            .concat(customColumns);

          const flatRows = filteredPosts.map((post) => {
            const cf = (post.custom_fields ?? {}) as Record<string, unknown>;
            const row: Record<string, unknown> = { ...post };
            for (const k of customKeys) {
              if (k in cf) row[k] = cf[k];
            }
            return row;
          });

          const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const slug = (exportFilenamePrefix ?? 'posts').slice(0, 40).replace(/[^a-z0-9]+/gi, '_');
          downloadCsv(flatRows, `${slug}_${today}`, cols);
        }}
      >
        <Download className="h-3.5 w-3.5" />
        Export CSV
      </Button>
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
    </>
  );

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-white dark:bg-background">
      {/* Toolbar - portaled into the page header when a container is provided
          (data page); otherwise rendered inline alongside the filters. */}
      {toolbarContainer ? (
        createPortal(
          <div className="flex flex-wrap items-center gap-2">
            {searchBox}
            {controls}
          </div>,
          toolbarContainer,
        )
      ) : (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/40 bg-muted/20 shrink-0">
          {searchBox}

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

          {/* Channel filtering now lives in the data table's channel_handle
              column header (multi-select), so it's no longer duplicated here. */}

          {/* Right-side controls: columns + clear-all + export + view toggle */}
          <div className="ml-auto flex items-center gap-2">{controls}</div>
        </div>
      )}

      {/* Analytics metrics strip */}
      <AnalyticsStrip stats={analyticsStats} />

      {/* Truncation banner: shown when the agent has more posts than we fetched
          in the initial page. Clicking "Load all" refetches with a higher cap. */}
      {isTruncated && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/5 px-4 py-1.5 text-xs">
          <span className="text-amber-900 dark:text-amber-200">
            Showing the top {allPosts.length.toLocaleString()} of {totalAvailable.toLocaleString()} posts
            (sorted by views). Filters and search apply to this subset.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px]"
            onClick={() => setShowAll(true)}
          >
            Load all
          </Button>
        </div>
      )}

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
            dedup={dedup}
            startDate={effectiveStartDate ?? undefined}
            endDate={effectiveEndDate}
            agentId={agentId}
            variant="wide"
          />
        </div>
      )}
    </div>
  );
}
