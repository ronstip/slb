import {
  Eye,
  Heart,
  MessageCircle,
  BarChart3,
  Users,
} from 'lucide-react';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { PLATFORM_COLORS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber } from '../../lib/format.ts';
import type { FeedPost } from '../../api/types.ts';

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
}

export function computeAnalyticsStats(posts: FeedPost[]): AnalyticsStats | null {
  if (posts.length === 0) return null;

  const platforms = new Map<string, number>();
  const sentiments = new Map<string, number>();
  const themes = new Map<string, number>();
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
      .slice(0, 6)
      .map(([name, count]) => ({ name, count })),
  };
}

/* ------------------------------------------------------------------ */
/* Component — Metrics-only strip                                      */
/* ------------------------------------------------------------------ */

interface AnalyticsStripProps {
  stats: AnalyticsStats | null;
}

export function AnalyticsStrip({ stats }: AnalyticsStripProps) {
  if (!stats) return null;

  return (
    <div className="flex items-stretch border-b border-border/40 bg-gradient-to-r from-card via-card to-primary/[0.02] shrink-0">
      {/* KPI Cards */}
      <div className="flex items-center divide-x divide-border/30">
        <KpiCard
          icon={<BarChart3 className="h-4 w-4 text-blue-500" />}
          label="Total Posts"
          value={formatNumber(stats.totalPosts)}
          iconBg="bg-blue-500/10"
        />
        <KpiCard
          icon={<Eye className="h-4 w-4 text-emerald-500" />}
          label="Avg Views"
          value={formatNumber(stats.avgViews)}
          sub={`${formatNumber(stats.totalViews)} total`}
          iconBg="bg-emerald-500/10"
        />
        <KpiCard
          icon={<Heart className="h-4 w-4 text-rose-500" />}
          label="Avg Likes"
          value={formatNumber(stats.avgLikes)}
          sub={`${formatNumber(stats.totalLikes)} total`}
          iconBg="bg-rose-500/10"
        />
        <KpiCard
          icon={<MessageCircle className="h-4 w-4 text-amber-500" />}
          label="Comments"
          value={formatNumber(stats.totalComments)}
          sub={`${formatNumber(stats.avgComments)} avg`}
          iconBg="bg-amber-500/10"
        />
        <KpiCard
          icon={<Users className="h-4 w-4 text-violet-500" />}
          label="Creators"
          value={stats.uniqueHandles.toLocaleString()}
          iconBg="bg-violet-500/10"
        />
      </div>

      {/* Vertical divider */}
      <div className="w-px bg-border/30 my-2.5" />

      {/* Platform distribution */}
      <div className="flex items-center gap-2.5 px-5 py-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Platforms</span>
          <div className="flex items-center gap-1.5">
            {stats.platforms.map((p) => {
              const pct = stats.totalPosts > 0 ? Math.round((p.count / stats.totalPosts) * 100) : 0;
              return (
                <div
                  key={p.name}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1"
                  style={{ backgroundColor: `${p.color}12` }}
                  title={`${p.name}: ${p.count} posts (${pct}%)`}
                >
                  <PlatformIcon platform={p.name} className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: p.color }}>
                    {p.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Vertical divider */}
      <div className="w-px bg-border/30 my-2.5" />

      {/* Sentiment — horizontal stacked bar */}
      <div className="flex items-center px-5 py-3">
        <div className="flex flex-col gap-1.5 min-w-[160px]">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sentiment</span>
          {/* Stacked bar */}
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
            {stats.sentiments.map((s) => {
              const pct = stats.totalPosts > 0 ? (s.count / stats.totalPosts) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={s.name}
                  className="h-full transition-all first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${pct}%`, backgroundColor: s.color }}
                  title={`${s.name}: ${s.count} (${Math.round(pct)}%)`}
                />
              );
            })}
          </div>
          {/* Legend */}
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
      </div>

      {/* Vertical divider */}
      <div className="w-px bg-border/30 my-2.5" />

      {/* Top themes */}
      {stats.topThemes.length > 0 && (
        <div className="flex items-center px-5 py-3 min-w-0 overflow-hidden">
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Top Themes</span>
            <div className="flex flex-wrap gap-1">
              {stats.topThemes.slice(0, 5).map((t) => (
                <span
                  key={t.name}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary/80 truncate max-w-[120px]"
                  title={`${t.name}: ${t.count} posts`}
                >
                  {t.name}
                  <span className="text-primary/40 font-bold">{t.count}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
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
    <div className="flex items-center gap-2.5 px-5 py-3">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        {icon}
      </div>
      <div className="flex flex-col justify-center h-[42px]">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">{label}</span>
        <span className="text-base font-bold tabular-nums text-foreground leading-tight mt-0.5">{value}</span>
        {/* Always reserve space for sub line so all cards align */}
        <span className="text-[10px] text-muted-foreground leading-none mt-0.5 h-3">
          {sub ?? '\u00A0'}
        </span>
      </div>
    </div>
  );
}
