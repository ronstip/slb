import { memo, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Globe,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Agent, SearchDef } from '../../../../api/endpoints/agents.ts';
import {
  getCollectionStats,
  refreshCollectionStats,
} from '../../../../api/endpoints/collections.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '../../../../lib/constants.ts';
import { formatNumber } from '../../../../lib/format.ts';
import { Badge } from '../../../../components/ui/badge.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import { PlatformIcon } from '../../../../components/PlatformIcon.tsx';
import { cn } from '../../../../lib/utils.ts';

interface FlatSource {
  platform: string;
  search: SearchDef;
  key: string;
}

type SourceTab = 'summary' | 'files' | string;

function SourcesSectionImpl({ task }: { task: Agent }) {
  const [activeTab, setActiveTab] = useState<SourceTab>('summary');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const searches = task.data_scope?.searches ?? [];

  // Explode SearchDefs into per-platform rows. Reference-stable across renders
  // so downstream memos don't invalidate just because `task` changed elsewhere.
  const flatSources = useMemo<FlatSource[]>(() => {
    const out: FlatSource[] = [];
    for (let i = 0; i < searches.length; i++) {
      const search = searches[i];
      for (const platform of search.platforms) {
        out.push({ platform, search, key: `${i}-${platform}` });
      }
    }
    return out;
  }, [searches]);

  const { platformCounts, uniquePlatforms, fallbackTotalPosts } = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const { platform, search } of flatSources) {
      counts[platform] = (counts[platform] || 0) + 1;
      total += Math.round((search.n_posts || 0) / search.platforms.length);
    }
    return {
      platformCounts: counts,
      uniquePlatforms: Object.keys(counts),
      fallbackTotalPosts: total,
    };
  }, [flatSources]);

  // Fetch real stats from collections.
  // While the agent is running, force-refresh (recomputes from BQ) on a short
  // interval so per-platform counts track live progress. Otherwise use the
  // cached signature for fast, cheap reads.
  const collectionIds = task.collection_ids ?? [];
  const isRunning = task.status === 'running';
  const { data: allStats } = useQuery({
    queryKey: ['agent-source-stats', task.agent_id, collectionIds, isRunning],
    queryFn: () =>
      Promise.all(
        collectionIds.map((id) =>
          isRunning ? refreshCollectionStats(id) : getCollectionStats(id),
        ),
      ),
    enabled: collectionIds.length > 0,
    staleTime: isRunning ? 0 : 5 * 60 * 1000,
    refetchInterval: isRunning ? 30_000 : false,
  });

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

  const visibleSources = useMemo(
    () =>
      activeTab === 'summary'
        ? flatSources
        : flatSources.filter((s) => s.platform === activeTab),
    [flatSources, activeTab],
  );

  const autoExpand = activeTab !== 'summary' && visibleSources.length === 1;

  if (flatSources.length === 0) {
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
    <div className="rounded-xl border border-border bg-card shadow-sm h-full flex flex-col">
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

          {uniquePlatforms.map((platform) => {
            const count = platformCounts[platform];
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
                {count > 1 && (
                  <span className={isActive ? 'opacity-70' : 'text-muted-foreground'}>{count}</span>
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

          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
          >
            <Plus className="h-3 w-3" />
            Add Platforms
          </button>
        </div>
      </div>

      <div className="px-3 py-2 flex-1">
          {activeTab === 'summary' && (
            <SourcesSummaryView
              flatSources={flatSources}
              isActive={task.status === 'running' || (task.status === 'success' && !task.paused)}
              platformPostTotals={platformPostTotals}
              platformPostsLast3d={platformPostsLast3d}
              totalPosts={totalPosts}
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

          {activeTab !== 'summary' && activeTab !== 'files' && visibleSources.map(({ platform, search, key }) => {
            const isExpanded = autoExpand || expandedKey === key;
            const keywordsPreview = search.keywords?.length > 0
              ? search.keywords.length <= 3
                ? search.keywords.join(', ')
                : `${search.keywords.slice(0, 3).join(', ')}, +${search.keywords.length - 3}`
              : null;
            const channelsPreview = search.channels?.length
              ? search.channels.length <= 2
                ? search.channels.join(', ')
                : `${search.channels.slice(0, 2).join(', ')}, +${search.channels.length - 2}`
              : null;
            const isChannelSearch = !!search.channels?.length;
            const sharedWith = search.platforms.length > 1
              ? search.platforms.filter((p) => p !== platform)
              : null;

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
                  <PlatformIcon platform={platform} className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-xs font-medium text-foreground shrink-0">
                    {PLATFORM_LABELS[platform] || platform}
                  </span>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                    {isChannelSearch && channelsPreview && (
                      <span>{channelsPreview}</span>
                    )}
                    {isChannelSearch && keywordsPreview && ' · '}
                    {keywordsPreview && (
                      <span>{keywordsPreview}</span>
                    )}
                    {!keywordsPreview && !channelsPreview && (
                      <span className="italic">No keywords</span>
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                    {search.n_posts || 0} · {search.time_range_days}d
                  </span>
                </button>

                {isExpanded && (
                  <div className={cn('mb-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 space-y-2', !autoExpand && 'ml-5 mr-1')}>
                    {sharedWith && (
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="font-medium">Shared config with:</span>
                        {sharedWith.map((p) => (
                          <span key={p} className="inline-flex items-center gap-0.5">
                            <PlatformIcon platform={p} className="h-3 w-3" />
                            <span>{PLATFORM_LABELS[p] || p}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {search.keywords?.length > 0 && (
                      <div>
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Keywords</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {search.keywords.map((kw) => (
                            <Badge key={kw} variant="secondary" className="text-[10px] py-0">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {search.channels?.length ? (
                      <div>
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Channels</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {search.channels.map((ch) => (
                            <Badge key={ch} variant="secondary" className="text-[10px] py-0">
                              {ch}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Search className="h-2.5 w-2.5" />
                        {search.n_posts || 0} posts
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {search.time_range_days} days
                      </span>
                      <span className="flex items-center gap-1">
                        <Globe className="h-2.5 w-2.5" />
                        {search.geo_scope || 'Global'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

interface SourcesSummaryViewProps {
  flatSources: FlatSource[];
  isActive: boolean;
  platformPostTotals: Record<string, number>;
  platformPostsLast3d: Record<string, number>;
  totalPosts: number;
}

function SourcesSummaryViewImpl({
  flatSources,
  isActive,
  platformPostTotals,
  platformPostsLast3d,
}: SourcesSummaryViewProps) {
  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            <th className="text-left py-1.5 pr-2">Source</th>
            <th className="text-left py-1.5 pr-2">Query</th>
            <th className="text-left py-1.5 pr-2">Activity</th>
            <th className="text-right py-1.5 pr-2">Posts</th>
            <th className="text-right py-1.5">Posts last 3d</th>
          </tr>
        </thead>
        <tbody>
          {flatSources.map(({ platform, search, key }) => {
            const query = search.channels?.length
              ? search.channels.join(', ')
              : search.keywords?.length
                ? search.keywords.length <= 3
                  ? search.keywords.join(', ')
                  : `${search.keywords.slice(0, 3).join(', ')}, +${search.keywords.length - 3}`
                : '—';
            const posts = platformPostTotals[platform] ?? 0;
            const last3d = platformPostsLast3d[platform] ?? 0;
            return (
              <tr key={key} className="border-b border-border/20 last:border-b-0">
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-1.5">
                    <PlatformIcon platform={platform} className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium text-foreground">{PLATFORM_LABELS[platform] || platform}</span>
                  </span>
                </td>
                <td className="py-1.5 pr-2 text-muted-foreground max-w-[160px] truncate">{query}</td>
                <td className="py-1.5 pr-2">
                  <span className={cn(
                    'inline-flex items-center gap-1 text-[10px] font-medium',
                    isActive ? 'text-emerald-600' : 'text-muted-foreground',
                  )}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                    {isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="py-1.5 pr-2 text-right text-muted-foreground tabular-nums">{formatNumber(posts)}</td>
                <td className="py-1.5 text-right text-muted-foreground tabular-nums">{formatNumber(last3d)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SourcesSummaryView = memo(SourcesSummaryViewImpl);

export const SourcesSection = memo(SourcesSectionImpl);
