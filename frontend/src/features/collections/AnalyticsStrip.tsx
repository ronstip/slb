import { useState } from 'react';
import {
  Eye,
  Heart,
  MessageCircle,
  BarChart3,
  Users,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { PLATFORM_COLORS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';
import type { FeedPost, CollectionStats } from '../../api/types.ts';
import { cn } from '../../lib/utils.ts';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AnalyticsStats {
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  uniqueHandles: number;
  platforms: { name: string; count: number; color: string }[];
  sentiments: { name: string; count: number; color: string }[];
  topThemes: { name: string; count: number }[];
  topEntities: { name: string; count: number }[];
  /** Number of enriched posts */
  enrichedCount?: number;
  /** ISO date of most recent post */
  latestDate?: string | null;
  /** Daily post volume for time-windowed metrics */
  dailyVolume?: { date: string; count: number }[];
  /** Relevance: posts marked relevant to the task */
  relevantCount?: number;
  /** Deduped post count (unique post_ids across collections) */
  dedupedCount?: number;
}

type Signal = 'green' | 'yellow' | 'red' | 'neutral';

export function computeAnalyticsStats(posts: FeedPost[]): AnalyticsStats | null {
  if (posts.length === 0) return null;

  const platforms = new Map<string, number>();
  const sentiments = new Map<string, number>();
  const themes = new Map<string, number>();
  const entities = new Map<string, number>();
  const handles = new Set<string>();

  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;

  for (const p of posts) {
    platforms.set(p.platform, (platforms.get(p.platform) ?? 0) + 1);
    if (p.sentiment) sentiments.set(p.sentiment, (sentiments.get(p.sentiment) ?? 0) + 1);
    if (p.themes) {
      for (const t of p.themes) {
        themes.set(t, (themes.get(t) ?? 0) + 1);
      }
    }
    if (p.entities) {
      for (const e of p.entities) {
        entities.set(e, (entities.get(e) ?? 0) + 1);
      }
    }
    handles.add(p.channel_handle);
    totalViews += p.views ?? 0;
    totalLikes += p.likes ?? 0;
    totalComments += p.comments_count ?? 0;
  }

  const n = posts.length;

  return {
    totalPosts: n,
    totalViews,
    totalLikes,
    totalComments,
    avgViews: Math.round(totalViews / n),
    avgLikes: Math.round(totalLikes / n),
    avgComments: Math.round(totalComments / n),
    uniqueHandles: handles.size,
    platforms: [...platforms.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, color: PLATFORM_COLORS[name] ?? '#6B7294' })),
    sentiments: [...sentiments.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, color: SENTIMENT_COLORS[name] ?? '#94A3B8' })),
    topThemes: [...themes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
    topEntities: [...entities.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
  };
}

/* ------------------------------------------------------------------ */
/* Compute stats from server-side CollectionStats (aggregated)         */
/* ------------------------------------------------------------------ */

export function computeAnalyticsFromCollectionStats(
  statsArray: CollectionStats[],
): AnalyticsStats | null {
  if (statsArray.length === 0) return null;

  let totalPosts = 0;
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalChannels = 0;
  const platforms = new Map<string, { count: number; views: number; likes: number }>();
  const sentiments = new Map<string, number>();
  const themes = new Map<string, number>();
  const entities = new Map<string, number>();

  for (const stats of statsArray) {
    totalPosts += stats.total_posts;
    totalViews += stats.engagement_summary.total_views;
    totalLikes += stats.engagement_summary.total_likes;
    totalComments += stats.engagement_summary.total_comments;
    totalChannels += stats.total_unique_channels;

    for (const b of stats.platform_breakdown) {
      const existing = platforms.get(b.value) ?? { count: 0, views: 0, likes: 0 };
      existing.count += b.post_count;
      existing.views += b.view_count;
      existing.likes += b.like_count;
      platforms.set(b.value, existing);
    }
    for (const b of stats.sentiment_breakdown) {
      sentiments.set(b.value, (sentiments.get(b.value) ?? 0) + b.post_count);
    }
    for (const b of stats.top_themes) {
      themes.set(b.value, (themes.get(b.value) ?? 0) + b.post_count);
    }
    for (const b of stats.top_entities) {
      entities.set(b.value, (entities.get(b.value) ?? 0) + b.post_count);
    }
  }

  const n = totalPosts || 1;

  return {
    totalPosts,
    totalViews,
    totalLikes,
    totalComments,
    avgViews: Math.round(totalViews / n),
    avgLikes: Math.round(totalLikes / n),
    avgComments: Math.round(totalComments / n),
    uniqueHandles: totalChannels,
    platforms: [...platforms.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, { count }]) => ({ name, count, color: PLATFORM_COLORS[name] ?? '#6B7294' })),
    sentiments: [...sentiments.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, color: SENTIMENT_COLORS[name] ?? '#94A3B8' })),
    topThemes: [...themes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
    topEntities: [...entities.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
  };
}

/* ------------------------------------------------------------------ */
/* Component — Expandable KPI strip                                    */
/* ------------------------------------------------------------------ */

interface AnalyticsStripProps {
  stats: AnalyticsStats | null;
}

export function AnalyticsStrip({ stats }: AnalyticsStripProps) {
  const [expanded, setExpanded] = useState(false);

  if (!stats) return null;

  const sectionLabel = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none";

  // Status: activity pulse — compute volume per time window from daily_volume
  const dv = stats.dailyVolume ?? [];
  const nowMs = Date.now();
  const msInDay = 86_400_000;
  const volForWindow = (days: number) =>
    dv.filter((d: { date: string; count: number }) => (nowMs - new Date(d.date).getTime()) < days * msInDay)
      .reduce((s: number, d: { date: string; count: number }) => s + d.count, 0);
  const vol24h = volForWindow(1);
  const vol7d = volForWindow(7);
  const vol30d = volForWindow(30);
  const activitySignal: Signal = dv.length === 0 ? 'neutral' : vol24h > 0 ? 'green' : vol7d > 0 ? 'yellow' : 'red';

  // Status: last post
  const freshLabel = stats.latestDate ? timeAgo(stats.latestDate) : 'N/A';
  const hoursStale = stats.latestDate ? (Date.now() - new Date(stats.latestDate).getTime()) / 3_600_000 : Infinity;
  const freshSignal: Signal = hoursStale < 24 ? 'green' : hoursStale < 72 ? 'yellow' : 'red';

  // Status: enrichment rate
  const enrichedCount = stats.enrichedCount ?? 0;
  const enrichPct = stats.totalPosts > 0 ? Math.round((enrichedCount / stats.totalPosts) * 100) : 0;
  const enrichSignal: Signal = enrichPct >= 95 ? 'green' : enrichPct >= 70 ? 'yellow' : 'red';

  // Status: relevance rate
  const relevantCount = stats.relevantCount ?? 0;
  const dedupedCount = stats.dedupedCount ?? stats.totalPosts;
  const relevancePct = dedupedCount > 0 ? Math.round((relevantCount / dedupedCount) * 100) : 0;
  const relevanceSignal: Signal = relevancePct >= 70 ? 'green' : relevancePct >= 40 ? 'yellow' : 'red';
  const relevanceTooltip = `${relevantCount} relevant of ${dedupedCount} unique posts (${stats.totalPosts} total across sources)`;

  return (
    <div className="border-b border-border/40 bg-gradient-to-r from-card via-card to-primary/[0.02] shrink-0 overflow-hidden">
      {/* Main strip: KPI grid | Platforms | Sentiment | Status (TBD) | expand toggle */}
      <div className="flex items-stretch">
        {/* KPI grid — 2 rows × 3 columns */}
        <div className="shrink-0 grid grid-cols-[repeat(3,minmax(160px,auto))] grid-rows-2 divide-x divide-border/30">
          <KpiCard icon={<BarChart3 className="h-4 w-4 text-blue-500" />} label="Posts" value={formatNumber(stats.totalPosts)} iconBg="bg-blue-500/10" />
          <KpiCard icon={<Eye className="h-4 w-4 text-cyan-500" />} label="Views" value={formatNumber(stats.totalViews)} iconBg="bg-cyan-500/10" />
          <KpiCard icon={<Eye className="h-4 w-4 text-emerald-500" />} label="Avg Views" value={formatNumber(stats.avgViews)} iconBg="bg-emerald-500/10" />
          <KpiCard icon={<MessageCircle className="h-4 w-4 text-amber-500" />} label="Comments" value={formatNumber(stats.totalComments)} sub={`${formatNumber(stats.avgComments)} avg`} iconBg="bg-amber-500/10" />
          <KpiCard icon={<Heart className="h-4 w-4 text-rose-500" />} label="Avg Likes" value={formatNumber(stats.avgLikes)} sub={`${formatNumber(stats.totalLikes)} total`} iconBg="bg-rose-500/10" />
          <KpiCard icon={<Users className="h-4 w-4 text-violet-500" />} label="Creators" value={stats.uniqueHandles.toLocaleString()} iconBg="bg-violet-500/10" />
        </div>

        <div className="w-px bg-border/30 my-2 shrink-0" />

        {/* Platforms */}
        <Section label="Platforms" className="shrink-0">
          <div className="flex flex-col gap-1">
            {stats.platforms.map((p) => {
              const pct = stats.totalPosts > 0 ? Math.round((p.count / stats.totalPosts) * 100) : 0;
              return (
                <div key={p.name} className="flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ backgroundColor: `${p.color}12` }} title={`${p.name}: ${p.count} posts (${pct}%)`}>
                  <PlatformIcon platform={p.name} className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: p.color }}>{p.count}</span>
                  <span className="text-[10px] text-muted-foreground">{pct}%</span>
                </div>
              );
            })}
          </div>
        </Section>

        <div className="w-px bg-border/30 my-2 shrink-0" />

        {/* Sentiment */}
        <Section label="Sentiment" className="shrink-0">
          <div className="flex flex-col gap-1.5 min-w-[160px]">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
              {stats.sentiments.map((s) => {
                const pct = stats.totalPosts > 0 ? (s.count / stats.totalPosts) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <div key={s.name} className="h-full transition-all first:rounded-l-full last:rounded-r-full" style={{ width: `${pct}%`, backgroundColor: s.color }} title={`${s.name}: ${s.count} (${Math.round(pct)}%)`} />
                );
              })}
            </div>
            <div className="flex items-center gap-2.5">
              {stats.sentiments.map((s) => {
                const pct = stats.totalPosts > 0 ? Math.round((s.count / stats.totalPosts) * 100) : 0;
                return (
                  <div key={s.name} className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-[10px] capitalize text-muted-foreground">{s.name}</span>
                    <span className="text-[10px] font-bold tabular-nums text-foreground/70">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        <div className="w-px bg-border/30 my-2 shrink-0" />

        {/* Status area — pushed to the right */}
        <div className="flex flex-col px-4 py-2 ml-auto shrink-0 justify-center gap-[5px]">
          {/* Activity — volume per time window */}
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', SIGNAL_COLORS[activitySignal])} />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground w-[52px] shrink-0">Activity</span>
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] text-muted-foreground">24h <span className="text-[11px] font-bold tabular-nums text-foreground">{formatNumber(vol24h)}</span></span>
              <span className="text-[10px] text-muted-foreground">7d <span className="text-[11px] font-bold tabular-nums text-foreground">{formatNumber(vol7d)}</span></span>
              <span className="text-[10px] text-muted-foreground">30d <span className="text-[11px] font-bold tabular-nums text-foreground">{formatNumber(vol30d)}</span></span>
            </div>
          </div>

          {/* Last post */}
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', SIGNAL_COLORS[freshSignal])} />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground w-[52px] shrink-0">Last post</span>
            <span className="text-[11px] font-bold tabular-nums text-foreground">{freshLabel}</span>
          </div>

          {/* Enrichment + Relevance on one row */}
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', SIGNAL_COLORS[enrichSignal])} />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground w-[52px] shrink-0">Enriched</span>
            <span className="text-[11px] font-bold tabular-nums text-foreground">{enrichPct}%</span>
            <span className="text-muted-foreground/30 mx-1">|</span>
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', SIGNAL_COLORS[relevanceSignal])} />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Relevant</span>
            <span className="text-[11px] font-bold tabular-nums text-foreground cursor-default" title={relevanceTooltip}>{relevancePct}%</span>
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-center px-3 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          title={expanded ? 'Collapse details' : 'Expand details'}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Expanded: Themes + Entities (push down) */}
      <div className={cn(
        "overflow-hidden transition-all duration-200 ease-in-out",
        expanded ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0",
      )}>
        <div className="flex gap-0 border-t border-border/30">
          {/* Themes */}
          {stats.topThemes.length > 0 && (
            <div className="flex flex-col px-4 py-2.5 flex-1 border-r border-border/30">
              <span className={cn(sectionLabel, "mb-1.5")}>Top Themes</span>
              <div className="flex flex-wrap gap-1 overflow-hidden max-h-[120px]">
                {stats.topThemes.slice(0, 10).map((t) => (
                  <span key={t.name} className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary/80 whitespace-nowrap" title={`${t.name}: ${t.count} posts`}>
                    {t.name}
                    <span className="text-primary/40 font-bold">{t.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Entities */}
          {stats.topEntities.length > 0 && (
            <div className="flex flex-col px-4 py-2.5 flex-1">
              <span className={cn(sectionLabel, "mb-1.5")}>Top Entities</span>
              <div className="flex flex-wrap gap-1 overflow-hidden max-h-[120px]">
                {stats.topEntities.slice(0, 10).map((e) => (
                  <span key={e.name} className="inline-flex items-center gap-1 rounded-full bg-violet-500/8 px-2 py-0.5 text-[10px] font-medium text-violet-600/80 dark:text-violet-400/80 whitespace-nowrap" title={`${e.name}: ${e.count} posts`}>
                    {e.name}
                    <span className="text-violet-400/40 font-bold">{e.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section wrapper                                                     */
/* ------------------------------------------------------------------ */

function Section({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col px-4 py-2.5 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none mb-1.5">{label}</span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI Card                                                            */
/* ------------------------------------------------------------------ */

function KpiCard({
  icon,
  label,
  value,
  sub,
  iconBg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  iconBg: string;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        {icon}
      </div>
      <div className="flex flex-col justify-center">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">{label}</span>
        <span className="text-sm font-bold tabular-nums text-foreground leading-tight mt-0.5">{value}</span>
        {sub && <span className="text-[10px] text-muted-foreground leading-none mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Signal colors                                                       */
/* ------------------------------------------------------------------ */

const SIGNAL_COLORS: Record<Signal, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
  neutral: 'bg-muted-foreground/40',
};
