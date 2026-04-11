import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { useAgentStore } from '../../stores/agent-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { getDashboardData } from '../../api/endpoints/dashboard.ts';
import { formatNumber } from '../../lib/format.ts';
import {
  computeKpis,
  aggregateSentiment,
  aggregateVolume,
  aggregatePlatforms,
  aggregateEntities,
  aggregateEmotions,
  aggregateThemes,
} from './dashboard/dashboard-aggregations.ts';
import { SentimentBar } from './charts/SentimentBar.tsx';
import { VolumeChart } from './charts/VolumeChart.tsx';
import { PlatformBar } from './charts/PlatformBar.tsx';
import { EntityTable } from './charts/EntityTable.tsx';
import { EmotionChart } from './charts/EmotionChart.tsx';
import { ThemeBar } from './charts/ThemeBar.tsx';
import { SENTIMENT_COLORS } from '../../lib/constants.ts';
import type { DashboardPost } from '../../api/types.ts';

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

const SENT_KEYS = ['positive', 'neutral', 'mixed', 'negative'] as const;

/** Aggregate views by channel_type, broken down by sentiment. */
function aggregateChannelTypeViews(posts: DashboardPost[]) {
  const map = new Map<string, { total: number; positive: number; negative: number; neutral: number; mixed: number }>();
  for (const p of posts) {
    const ct = p.channel_type || 'unknown';
    const cur = map.get(ct) ?? { total: 0, positive: 0, negative: 0, neutral: 0, mixed: 0 };
    cur.total += p.view_count;
    const s = (p.sentiment ?? 'neutral').toLowerCase() as keyof typeof cur;
    if (s in cur && s !== 'total') cur[s] += p.view_count;
    else cur.neutral += p.view_count;
    map.set(ct, cur);
  }
  return [...map.entries()]
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.total - a.total);
}

/** Filter volume data to only the last 7 days. */
function filterLast7Days(volume: ReturnType<typeof aggregateVolume>) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return volume.filter((v) => v.post_date >= cutoffStr);
}

export function StatsTab() {
  const activeTask = useAgentStore((s) => s.activeAgent);
  const sources = useSourcesStore((s) => s.sources);
  const taskCollectionIds = activeTask?.collection_ids ?? [];

  // Collection filter state — empty means "all"
  const [collectionFilter, setCollectionFilter] = useState<string[]>([]);

  const { data: response, isLoading } = useQuery({
    queryKey: ['stats-tab', ...taskCollectionIds],
    queryFn: () => getDashboardData(taskCollectionIds),
    enabled: taskCollectionIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // Apply collection filter client-side
  const posts: DashboardPost[] = useMemo(() => {
    const all = response?.posts ?? [];
    if (collectionFilter.length === 0) return all;
    return all.filter((p) => collectionFilter.includes(p.collection_id));
  }, [response?.posts, collectionFilter]);

  // Aggregations
  const kpis = useMemo(() => computeKpis(posts), [posts]);
  const sentiment = useMemo(() => aggregateSentiment(posts), [posts]);
  const volume = useMemo(() => filterLast7Days(aggregateVolume(posts)), [posts]);
  const platforms = useMemo(() => aggregatePlatforms(posts), [posts]);
  const entities = useMemo(() => aggregateEntities(posts).slice(0, 5), [posts]);
  const emotions = useMemo(() => aggregateEmotions(posts), [posts]);
  const themes = useMemo(() => aggregateThemes(posts).slice(0, 5), [posts]);
  const channelTypes = useMemo(() => aggregateChannelTypeViews(posts), [posts]);

  // Collection names for filter chips
  const collectionOptions = useMemo(() => {
    return taskCollectionIds.map((id) => {
      const src = sources.find((s) => s.collectionId === id);
      return { id, name: src?.title ?? id.slice(0, 8) };
    });
  }, [taskCollectionIds, sources]);

  const toggleCollection = (id: string) => {
    setCollectionFilter((prev) => {
      if (prev.length === 0) {
        // Currently showing all — switch to all except this one
        return taskCollectionIds.filter((c) => c !== id);
      }
      if (prev.includes(id)) {
        const next = prev.filter((c) => c !== id);
        // If removing would leave empty (all deselected) or all selected, reset to "all"
        return next.length === 0 || next.length === taskCollectionIds.length ? [] : next;
      }
      const next = [...prev, id];
      return next.length === taskCollectionIds.length ? [] : next;
    });
  };

  // --- Empty / loading states ---

  if (taskCollectionIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Select a task to see stats</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 px-3 py-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-muted/50" />
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No data available</p>
      </div>
    );
  }

  const postsKpi = kpis[0]; // Total Posts
  const viewsKpi = kpis[1]; // Total Views
  const likesKpi = kpis[2]; // Total Likes

  return (
    <div className="space-y-5 px-3 py-3">
      {/* Collection filter chips */}
      {collectionOptions.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {collectionOptions.map((col) => {
            const isActive = collectionFilter.length === 0 || collectionFilter.includes(col.id);
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => toggleCollection(col.id)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/10 text-foreground'
                    : 'border-border bg-transparent text-muted-foreground/50'
                }`}
              >
                {col.name}
              </button>
            );
          })}
        </div>
      )}

      {/* A. KPI Row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border bg-card p-2.5">
          <div className="text-lg font-bold tabular-nums text-foreground">{formatNumber(postsKpi.value)}</div>
          <div className="text-[10px] font-medium text-muted-foreground">Posts</div>
        </div>
        <div className="rounded-lg border bg-card p-2.5">
          <div className="text-lg font-bold tabular-nums text-foreground">{formatNumber(viewsKpi.value)}</div>
          <div className="text-[10px] font-medium text-muted-foreground">Views</div>
        </div>
        <div className="rounded-lg border bg-card p-2.5">
          <div className="text-lg font-bold tabular-nums text-foreground">{formatNumber(likesKpi.value)}</div>
          <div className="text-[10px] font-medium text-muted-foreground">Likes</div>
        </div>
      </div>

      {/* B. Sentiment */}
      {sentiment.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader>Sentiment</SectionHeader>
          <SentimentBar data={sentiment} overrides={{ showValues: true }} />
        </div>
      )}

      {/* C. Volume — last 7 days */}
      {volume.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader>Volume (last 7 days)</SectionHeader>
          <div className="[&_.recharts-responsive-container]:!h-[160px]">
            <VolumeChart data={volume} />
          </div>
        </div>
      )}

      {/* D. Platform Breakdown */}
      {platforms.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader>Platforms</SectionHeader>
          <PlatformBar data={platforms} />
        </div>
      )}

      {/* Channel Type by Views */}
      {channelTypes.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader>Channel Type by Views</SectionHeader>
          <div className="space-y-2">
            {channelTypes.map((ct) => {
              const maxTotal = channelTypes[0].total || 1;
              const pct = (ct.total / maxTotal) * 100;
              return (
                <div key={ct.type}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium capitalize text-foreground">{ct.type}</span>
                    <span className="text-xs font-semibold tabular-nums text-foreground">{formatNumber(ct.total)}</span>
                  </div>
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/50" style={{ width: `${pct}%` }}>
                    {SENT_KEYS.map((s) => {
                      const segPct = ct.total > 0 ? (ct[s] / ct.total) * 100 : 0;
                      if (segPct === 0) return null;
                      return (
                        <div
                          key={s}
                          className="h-full transition-all duration-500"
                          style={{ width: `${segPct}%`, backgroundColor: SENTIMENT_COLORS[s] }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* E. Entities */}
      {entities.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader>Top Entities</SectionHeader>
          <EntityTable data={entities} />
        </div>
      )}

      {/* Top Themes */}
      {themes.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader>Top Themes</SectionHeader>
          <ThemeBar data={themes} />
        </div>
      )}

      {/* F. Emotion */}
      {emotions.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeader>Emotions</SectionHeader>
          <EmotionChart data={emotions} />
        </div>
      )}
    </div>
  );
}
