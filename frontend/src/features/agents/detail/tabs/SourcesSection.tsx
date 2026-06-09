import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Globe,
  Link2,
  Loader2,
  Play,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Agent, Source } from '../../../../api/endpoints/agents.ts';
import { runAgentSources } from '../../../../api/endpoints/agents.ts';
import { refreshCollectionStats } from '../../../../api/endpoints/collections.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '../../../../lib/constants.ts';
import { formatNumber } from '../../../../lib/format.ts';
import { Badge } from '../../../../components/ui/badge.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../../components/ui/alert-dialog.tsx';
import { PlatformIcon } from '../../../../components/PlatformIcon.tsx';
import { cn } from '../../../../lib/utils.ts';
import { AddPostByUrlDrawer } from '../AddPostByUrlDrawer.tsx';

interface SourceRow {
  source: Source;
  sourceIdx: number;
  key: string;
}

interface PlatformRollup {
  platform: string;
  sourceCount: number;
  targetPosts: number;
  combinedKeywords: string[];
  combinedChannels: string[];
  isAnyChannelBased: boolean;
  maxTimeRangeDays: number;
}

type PendingRun =
  | { kind: 'one'; sourceIdx: number; label: string }
  | { kind: 'platform'; platform: string; label: string }
  | { kind: 'all' }
  | null;

type SourceTab = 'summary' | 'files' | string;

function previewList(items: string[], cap: number): string {
  if (items.length === 0) return '-';
  if (items.length <= cap) return items.join(', ');
  return `${items.slice(0, cap).join(', ')}, +${items.length - cap}`;
}

function SourcesSectionImpl({ task, onAddPlatforms }: { task: Agent; onAddPlatforms?: () => void }) {
  const [activeTab, setActiveTab] = useState<SourceTab>('summary');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<PendingRun>(null);
  const [isRunning, setIsRunning] = useState(false);
  // Which run target is currently collecting (post-confirm). Drives the
  // per-platform spinner + "Collecting…" status until the collection finishes.
  const [activeRun, setActiveRun] = useState<
    | { kind: 'platform'; platform: string }
    | { kind: 'one'; platform: string; sourceIdx: number }
    | { kind: 'all' }
    | null
  >(null);
  const sawRunningRef = useRef(false);
  const [addByUrlOpen, setAddByUrlOpen] = useState(false);
  const queryClient = useQueryClient();
  const sources = task.data_scope?.sources ?? [];

  // Stable per-source rows for the platform-tab drill-down view.
  const sourceRows = useMemo<SourceRow[]>(
    () =>
      sources.map((source, idx) => ({
        source,
        sourceIdx: idx,
        key: `${idx}-${source.platform}`,
      })),
    [sources],
  );

  // Per-platform aggregates for the summary table (sums quotas, merges keywords).
  const platformRollups = useMemo<PlatformRollup[]>(() => {
    const byPlatform = new Map<string, PlatformRollup>();
    for (const { source } of sourceRows) {
      const existing = byPlatform.get(source.platform);
      const keywords = source.keywords ?? [];
      const channels = source.channels ?? [];
      if (!existing) {
        byPlatform.set(source.platform, {
          platform: source.platform,
          sourceCount: 1,
          targetPosts: source.n_posts || 0,
          combinedKeywords: [...new Set(keywords)],
          combinedChannels: [...new Set(channels)],
          isAnyChannelBased: channels.length > 0,
          maxTimeRangeDays: source.time_range_days || 0,
        });
      } else {
        existing.sourceCount += 1;
        existing.targetPosts += source.n_posts || 0;
        for (const k of keywords) {
          if (!existing.combinedKeywords.includes(k)) existing.combinedKeywords.push(k);
        }
        for (const c of channels) {
          if (!existing.combinedChannels.includes(c)) existing.combinedChannels.push(c);
        }
        if (channels.length > 0) existing.isAnyChannelBased = true;
        if ((source.time_range_days || 0) > existing.maxTimeRangeDays) {
          existing.maxTimeRangeDays = source.time_range_days || 0;
        }
      }
    }
    return Array.from(byPlatform.values());
  }, [sourceRows]);

  const handleConfirmRun = async () => {
    if (!pendingRun) return;
    setIsRunning(true);
    try {
      const target =
        pendingRun.kind === 'one'
          ? { source_idx: pendingRun.sourceIdx }
          : pendingRun.kind === 'platform'
            ? { platform: pendingRun.platform }
            : undefined;
      const result = await runAgentSources(task.agent_id, target);
      const n = result.collection_ids.length;
      toast.success(
        n === 1 ? 'Source refresh started' : `Refreshing ${n} source${n === 1 ? '' : 's'}`,
      );
      // Mark the targeted platform(s) as collecting so the row shows a spinner
      // + "Collecting…" until the new collection's stats flip off 'running'.
      sawRunningRef.current = false;
      if (pendingRun.kind === 'all') {
        setActiveRun({ kind: 'all' });
      } else if (pendingRun.kind === 'platform') {
        setActiveRun({ kind: 'platform', platform: pendingRun.platform });
      } else {
        const plat = sources[pendingRun.sourceIdx]?.platform;
        if (plat) setActiveRun({ kind: 'one', platform: plat, sourceIdx: pendingRun.sourceIdx });
      }
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.agent_id] });
      queryClient.invalidateQueries({ queryKey: ['agent-source-stats', task.agent_id] });
    } catch {
      toast.error('Could not start source refresh. Please try again.');
    } finally {
      setIsRunning(false);
      setPendingRun(null);
    }
  };

  const pendingRunLabel = (() => {
    if (!pendingRun) return '';
    if (pendingRun.kind === 'all') {
      const n = sourceRows.length;
      return `all ${n} source${n === 1 ? '' : 's'}`;
    }
    return pendingRun.label;
  })();

  const handleRunPlatform = (platform: string) => {
    const rollup = platformRollups.find((r) => r.platform === platform);
    if (!rollup) return;
    const platformLabel = PLATFORM_LABELS[platform] || platform;
    const label = rollup.sourceCount > 1
      ? `${platformLabel} (${rollup.sourceCount} sources)`
      : platformLabel;
    setPendingRun({ kind: 'platform', platform, label });
  };

  const fallbackTotalPosts = useMemo(
    () => platformRollups.reduce((acc, r) => acc + r.targetPosts, 0),
    [platformRollups],
  );

  // Always force-recompute. The cached Firestore signature can race with the
  // agent's status flip - when status transitions to 'success' before the
  // pipeline's final signature write lands, a cached read returns the old
  // snapshot and the 5-min staleTime then locks it in. Recomputing keeps
  // Posts / Posts last 3d in sync with what's actually in BigQuery.
  const collectionIds = task.collection_ids ?? [];
  const taskIsRunning = task.status === 'running';
  // Poll aggressively while a refresh is in flight so the spinner clears
  // promptly when the collection lands; otherwise fall back to the slow cadence.
  const liveStats = taskIsRunning || activeRun !== null;
  const { data: allStats } = useQuery({
    queryKey: ['agent-source-stats', task.agent_id, collectionIds],
    queryFn: () => Promise.all(collectionIds.map((id) => refreshCollectionStats(id))),
    enabled: collectionIds.length > 0,
    staleTime: liveStats ? 0 : 30_000,
    refetchInterval: activeRun ? 8_000 : taskIsRunning ? 30_000 : false,
    refetchOnMount: 'always',
  });

  // A collection is mid-run when its last-computed status was 'running'. Use it
  // both to surface per-platform progress and to clear `activeRun` on landing.
  const anyCollectionRunning = useMemo(
    () => (allStats ?? []).some((s) => s.collection_status_at_compute === 'running'),
    [allStats],
  );
  const runningBreakdownPlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const s of allStats ?? []) {
      if (s.collection_status_at_compute === 'running') {
        for (const b of s.platform_breakdown ?? []) set.add(b.value);
      }
    }
    return set;
  }, [allStats]);

  // Clear the active-run marker once the collection we kicked off has finished
  // (we observed it running, then stop seeing any running collection). A 3-min
  // safety timeout covers collections that land before we ever poll 'running'.
  useEffect(() => {
    if (!activeRun) return;
    if (anyCollectionRunning) {
      sawRunningRef.current = true;
      return;
    }
    if (sawRunningRef.current) {
      setActiveRun(null);
      sawRunningRef.current = false;
    }
  }, [anyCollectionRunning, activeRun]);
  useEffect(() => {
    if (!activeRun) return;
    const t = setTimeout(() => {
      setActiveRun(null);
      sawRunningRef.current = false;
    }, 180_000);
    return () => clearTimeout(t);
  }, [activeRun]);

  const { platformPostTotals, platformPostsLast3d, totalPosts } = useMemo(() => {
    const totals: Record<string, number> = {};
    const last3d: Record<string, number> = {};
    if (!allStats) {
      return { platformPostTotals: totals, platformPostsLast3d: last3d, totalPosts: fallbackTotalPosts };
    }
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const cutoff = threeDaysAgo.toISOString().slice(0, 10);

    for (const stats of allStats) {
      for (const b of stats.platform_breakdown ?? []) {
        totals[b.value] = (totals[b.value] || 0) + b.post_count;
      }
      for (const d of stats.daily_volume ?? []) {
        if (d.post_date >= cutoff) {
          last3d[d.platform] = (last3d[d.platform] || 0) + d.post_count;
        }
      }
    }
    const total = Object.values(totals).reduce((a, b) => a + b, 0);
    return { platformPostTotals: totals, platformPostsLast3d: last3d, totalPosts: total };
  }, [allStats, fallbackTotalPosts]);

  // Platforms to render as "Collecting…" with a spinner: those in a running
  // collection's breakdown, plus the just-clicked target (covers the window
  // before the new collection's stats have been polled).
  const collectingPlatforms = useMemo(() => {
    const set = new Set(runningBreakdownPlatforms);
    if (activeRun) {
      if (activeRun.kind === 'all') {
        platformRollups.forEach((r) => set.add(r.platform));
      } else {
        set.add(activeRun.platform);
      }
    }
    return set;
  }, [runningBreakdownPlatforms, activeRun, platformRollups]);

  // Per-source-row collecting state. A single-source run (kind:'one') spins ONLY
  // the targeted row - not every row sharing its platform. Without this, running
  // one of two Twitter/X sources lights up a spinner on BOTH rows (the backend
  // correctly collects just one). Platform/all runs, and stats-derived running
  // (which is only platform-granular), still fall back to platform-level.
  const isRowCollecting = (sourceIdx: number, platform: string): boolean => {
    if (activeRun?.kind === 'one') {
      if (activeRun.sourceIdx === sourceIdx) return true;
      // Same-platform sibling of the single targeted run: don't spin it.
      if (platform === activeRun.platform) return false;
      // A genuinely-separate platform still mid-run elsewhere: surface it.
      return runningBreakdownPlatforms.has(platform);
    }
    return collectingPlatforms.has(platform);
  };

  const visibleRows = useMemo(
    () =>
      activeTab === 'summary'
        ? sourceRows
        : sourceRows.filter((r) => r.source.platform === activeTab),
    [sourceRows, activeTab],
  );

  const autoExpand = activeTab !== 'summary' && visibleRows.length === 1;

  if (sourceRows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm h-full flex flex-col">
        <div className="px-3 py-2 bg-primary/[0.06] border-b border-primary/10 rounded-t-xl">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources</h3>
        </div>
        <p className="px-3 py-4 text-sm text-muted-foreground">No sources defined</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card shadow-sm flex flex-col">
        <div className="px-3 py-2 bg-primary/[0.06] border-b border-primary/10 rounded-t-xl shrink-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources</h3>
        </div>

        {/* Tab chips */}
        <div className="px-3 pt-2 pb-1 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => { setActiveTab('summary'); setExpandedKey(null); }}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-all',
                activeTab === 'summary'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/50 text-muted-foreground hover:border-border hover:bg-muted/30',
              )}
            >
              Summary
            </button>

            {platformRollups.map(({ platform, sourceCount }) => {
              const isActive = activeTab === platform;
              const color = PLATFORM_COLORS[platform] || '#6B7294';
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => { setActiveTab(platform); setExpandedKey(null); }}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-all',
                    isActive
                      ? 'border-current/40'
                      : 'border-border/50 hover:border-border hover:bg-muted/30',
                  )}
                  style={isActive
                    ? { backgroundColor: `${color}15`, color, borderColor: `${color}40` }
                    : undefined
                  }
                >
                  <PlatformIcon platform={platform} className="h-3.5 w-3.5" />
                  <span style={isActive ? { color } : undefined}>
                    {PLATFORM_LABELS[platform] || platform}
                  </span>
                  {sourceCount > 1 && (
                    <span className={isActive ? 'opacity-70' : 'text-muted-foreground'}>{sourceCount}</span>
                  )}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => { setActiveTab('files'); setExpandedKey(null); }}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-all',
                activeTab === 'files'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/50 text-muted-foreground hover:border-border hover:bg-muted/30',
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              Files
            </button>

            {onAddPlatforms && (
              <button
                type="button"
                onClick={onAddPlatforms}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
              >
                <Plus className="h-3 w-3" />
                Add Sources
              </button>
            )}

            <button
              type="button"
              onClick={() => setAddByUrlOpen(true)}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
            >
              <Link2 className="h-3 w-3" />
              Add post by URL
            </button>
          </div>
        </div>

        <div className="px-3 py-2 flex-1">
          {activeTab === 'summary' && (
            <SourcesSummaryView
              rollups={platformRollups}
              isActive={task.status === 'running' || (task.status === 'success' && !task.paused)}
              platformPostTotals={platformPostTotals}
              platformPostsLast3d={platformPostsLast3d}
              totalPosts={totalPosts}
              onJumpToPlatform={(platform) => { setActiveTab(platform); setExpandedKey(null); }}
              onRunPlatform={handleRunPlatform}
              isRunning={isRunning}
              collectingPlatforms={collectingPlatforms}
            />
          )}

          {activeTab === 'files' && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50 mb-3">
                <Upload className="h-5 w-5 text-muted-foreground/60" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">No files uploaded yet</p>
              <p className="text-[11px] text-muted-foreground/60 mb-3">Upload PDFs, documents, or images to add context</p>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled>
                <Upload className="h-3 w-3" />
                Upload file
              </Button>
            </div>
          )}

          {activeTab !== 'summary' && activeTab !== 'files' && visibleRows.map(({ source, sourceIdx, key }) => {
            const isExpanded = autoExpand || expandedKey === key;
            const platformLabel = PLATFORM_LABELS[source.platform] || source.platform;
            const keywordsPreview = source.keywords?.length
              ? previewList(source.keywords, 3)
              : null;
            const channelsPreview = source.channels?.length
              ? previewList(source.channels, 2)
              : null;
            const isChannelSearch = !!source.channels?.length;
            const rowCollecting = isRowCollecting(sourceIdx, source.platform);

            return (
              <div key={key} className="border-b border-border/30 last:border-b-0">
                <button
                  type="button"
                  onClick={() => !autoExpand && setExpandedKey(isExpanded ? null : key)}
                  className={cn(
                    'flex items-center gap-2 w-full px-1 py-2 text-left hover:bg-muted/30 transition-colors rounded-sm',
                    autoExpand && 'cursor-default',
                  )}
                >
                  {!autoExpand && (
                    isExpanded
                      ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                      : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  )}
                  <PlatformIcon platform={source.platform} className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-xs font-medium text-foreground shrink-0">{platformLabel}</span>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                    {isChannelSearch && channelsPreview && <span>{channelsPreview}</span>}
                    {isChannelSearch && keywordsPreview && ' · '}
                    {keywordsPreview && <span>{keywordsPreview}</span>}
                    {!keywordsPreview && !channelsPreview && <span className="italic">No keywords</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                    {source.n_posts || 0} · {source.time_range_days}d
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingRun({
                        kind: 'one',
                        sourceIdx,
                        label: `${platformLabel} (${keywordsPreview ?? channelsPreview ?? 'source'})`,
                      });
                    }}
                    disabled={isRunning || rowCollecting}
                    aria-label={
                      rowCollecting
                        ? `${platformLabel} source collecting`
                        : `Run ${platformLabel} source`
                    }
                    title={rowCollecting ? 'Collecting…' : undefined}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/5 disabled:opacity-40"
                  >
                    {rowCollecting ? (
                      <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </button>
                </button>

                {isExpanded && (
                  <div className={cn('mb-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 space-y-2', !autoExpand && 'ml-5 mr-1')}>
                    {source.keywords?.length > 0 && (
                      <div>
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Keywords</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {source.keywords.map((kw) => (
                            <Badge key={kw} variant="secondary" className="text-[10px] py-0">{kw}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {source.channels?.length ? (
                      <div>
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Channels</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {source.channels.map((ch) => (
                            <Badge key={ch} variant="secondary" className="text-[10px] py-0">{ch}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Search className="h-2.5 w-2.5" />
                        {source.n_posts || 0} posts
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {source.time_range_days} days
                      </span>
                      <span className="flex items-center gap-1">
                        <Globe className="h-2.5 w-2.5" />
                        {source.geo_scope || 'Global'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {activeTab === 'summary' && sourceRows.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setPendingRun({ kind: 'all' })}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            <Play className="h-3 w-3" />
            Run all sources
          </button>
          <DataWindowReadOnly
            startDate={task.data_start_date}
            endDate={task.data_end_date}
          />
        </div>
      )}

      <AlertDialog open={!!pendingRun} onOpenChange={(open) => { if (!open) setPendingRun(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading tracking-tight">
              Refresh data for {pendingRunLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will start a new collection for {pendingRunLabel} using the configured keywords and post target. The agent's analysis won't be re-run - only the underlying data is refreshed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRun} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                'Start refresh'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddPostByUrlDrawer
        open={addByUrlOpen}
        onOpenChange={setAddByUrlOpen}
        agentId={task.agent_id}
      />
    </div>
  );
}

interface SourcesSummaryViewProps {
  rollups: PlatformRollup[];
  isActive: boolean;
  platformPostTotals: Record<string, number>;
  platformPostsLast3d: Record<string, number>;
  totalPosts: number;
  onJumpToPlatform?: (platform: string) => void;
  onRunPlatform?: (platform: string) => void;
  isRunning?: boolean;
  collectingPlatforms?: Set<string>;
}

// One row per platform - aggregated across all source cards for that platform.
// Per-source detail is one click away via the platform tab. Play refreshes
// every source on that platform in a single backend call.
function SourcesSummaryViewImpl({
  rollups,
  isActive,
  platformPostTotals,
  platformPostsLast3d,
  onJumpToPlatform,
  onRunPlatform,
  isRunning,
  collectingPlatforms,
}: SourcesSummaryViewProps) {
  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            <th className="text-left py-1.5 pr-2">Source</th>
            <th className="text-left py-1.5 pr-2">Query</th>
            <th className="text-left py-1.5 pr-2">Activity</th>
            <th className="text-right py-1.5 pr-2">Target / run</th>
            <th className="text-right py-1.5 pr-2">Posts</th>
            <th className="text-right py-1.5 pr-2">Posts last 3d</th>
            <th className="py-1.5 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {rollups.map((r) => {
            const query = r.isAnyChannelBased && r.combinedChannels.length > 0
              ? previewList(r.combinedChannels, 2)
              : previewList(r.combinedKeywords, 3);
            const posts = platformPostTotals[r.platform] ?? 0;
            const last3d = platformPostsLast3d[r.platform] ?? 0;
            const platformLabel = PLATFORM_LABELS[r.platform] || r.platform;
            const isCollecting = collectingPlatforms?.has(r.platform) ?? false;
            return (
              <tr key={r.platform} className="border-b border-border/20 last:border-b-0">
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-1.5">
                    <PlatformIcon platform={r.platform} className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium text-foreground">{platformLabel}</span>
                    {r.sourceCount > 1 && onJumpToPlatform ? (
                      <button
                        type="button"
                        onClick={() => onJumpToPlatform(r.platform)}
                        aria-label={`View ${r.platform} sources`}
                        className="text-[10px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
                      >
                        ×{r.sourceCount}
                      </button>
                    ) : r.sourceCount > 1 ? (
                      <span className="text-[10px] text-muted-foreground">×{r.sourceCount}</span>
                    ) : null}
                  </span>
                </td>
                <td className="py-1.5 pr-2 text-muted-foreground max-w-[160px] truncate">{query}</td>
                <td className="py-1.5 pr-2">
                  {isCollecting ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      Collecting…
                    </span>
                  ) : (
                    <span className={cn(
                      'inline-flex items-center gap-1 text-[10px] font-medium',
                      isActive ? 'text-emerald-600' : 'text-muted-foreground',
                    )}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right text-foreground/80 tabular-nums">{formatNumber(r.targetPosts)}</td>
                <td className="py-1.5 pr-2 text-right text-muted-foreground tabular-nums">{formatNumber(posts)}</td>
                <td className="py-1.5 pr-2 text-right text-muted-foreground tabular-nums">{formatNumber(last3d)}</td>
                <td className="py-1.5 pl-1 text-right">
                  {onRunPlatform && (
                    <button
                      type="button"
                      onClick={() => onRunPlatform(r.platform)}
                      disabled={isRunning || isCollecting}
                      aria-label={
                        isCollecting
                          ? `${platformLabel} collecting`
                          : r.sourceCount > 1
                            ? `Run all ${r.sourceCount} ${platformLabel} sources`
                            : `Run ${platformLabel} source`
                      }
                      title={
                        isCollecting
                          ? 'Collecting…'
                          : r.sourceCount > 1
                            ? `Refresh all ${r.sourceCount} ${platformLabel} sources`
                            : `Refresh ${platformLabel}`
                      }
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/5 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      {isCollecting ? (
                        <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SourcesSummaryView = memo(SourcesSummaryViewImpl);

function formatDateLabel(value?: string | null): string {
  if (!value) return '-';
  // value is YYYY-MM-DD; render as a short locale label without timezone shift.
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function DataWindowReadOnly({
  startDate,
  endDate,
}: {
  startDate?: string | null;
  endDate?: string | null;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Clock className="h-3 w-3" />
        Data window
      </div>
      <div className="flex items-baseline gap-2 text-sm text-foreground">
        <span>{formatDateLabel(startDate)}</span>
        <span className="text-muted-foreground">→</span>
        <span>{endDate ? formatDateLabel(endDate) : <span className="text-muted-foreground italic">no end</span>}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Posts outside this window are excluded from the agent's view. Edit via the pencil icon above.
      </p>
    </div>
  );
}

export const SourcesSection = memo(SourcesSectionImpl);
