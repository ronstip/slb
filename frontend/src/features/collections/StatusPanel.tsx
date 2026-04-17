import { useMemo } from 'react';
import { Activity, TrendingUp, TrendingDown, Minus, Heart, AlertTriangle, Clock } from 'lucide-react';
import { formatNumber, timeAgo } from '../../lib/format.ts';
import type { AnalyticsStats } from './AnalyticsStrip.tsx';
import { cn } from '../../lib/utils.ts';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface StatusData {
  /** Daily volume: array of { date, count } sorted chronologically */
  dailyVolume: { date: string; count: number }[];
  /** Negative sentiment percentage (0-100) */
  negativePct: number;
  /** Enrichment coverage percentage (0-100) */
  enrichedPct: number;
  /** ISO date of most recent post */
  latestDate: string | null;
  /** Total posts */
  totalPosts: number;
  /** Average engagement (views + likes + comments per post) */
  avgEngagement: number;
}

/* ------------------------------------------------------------------ */
/* Compute status data from analytics stats                            */
/* ------------------------------------------------------------------ */

export function computeStatusData(stats: AnalyticsStats): StatusData {
  const avgEngagement = stats.totalPosts > 0
    ? Math.round((stats.totalViews + stats.totalLikes + stats.totalComments) / stats.totalPosts)
    : 0;

  // Negative sentiment percentage
  const negativeEntry = stats.sentiments.find((s) => s.name === 'negative');
  const negativePct = stats.totalPosts > 0 && negativeEntry
    ? Math.round((negativeEntry.count / stats.totalPosts) * 100)
    : 0;

  return {
    dailyVolume: [],
    negativePct,
    enrichedPct: 100, // Placeholder — real value needs collection stats
    latestDate: null,  // Placeholder — real value needs collection stats
    totalPosts: stats.totalPosts,
    avgEngagement,
  };
}

/* ------------------------------------------------------------------ */
/* Mini sparkline — pure SVG                                           */
/* ------------------------------------------------------------------ */

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 28;
  const pad = 2;

  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const trending = data[data.length - 1] >= data[0];

  return (
    <svg width={w} height={h} className={className} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={points}
        fill="none"
        stroke={trending ? '#5FB88A' : '#C75A62'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Trend indicator                                                     */
/* ------------------------------------------------------------------ */

function TrendBadge({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null) return null;
  const isUp = value > 0;
  const isFlat = value === 0;

  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums",
      isUp ? "text-green-600" : isFlat ? "text-muted-foreground" : "text-red-500",
    )}>
      {isUp ? <TrendingUp className="h-3 w-3" /> : isFlat ? <Minus className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isUp ? '+' : ''}{value}{suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface StatusPanelProps {
  stats: AnalyticsStats | null;
  statusData?: StatusData;
}

export function StatusPanel({ stats, statusData }: StatusPanelProps) {
  if (!stats) return null;

  const data = statusData ?? computeStatusData(stats);

  return (
    <div className="flex items-stretch border-b border-border/40 bg-muted/10 shrink-0">
      {/* Volume Pulse */}
      <StatusCard
        icon={<Activity className="h-3.5 w-3.5 text-blue-500" />}
        label="Volume"
        value={`${formatNumber(data.totalPosts)} posts`}
      />

      <div className="w-px bg-border/30 my-2" />

      {/* Engagement Health */}
      <StatusCard
        icon={<Heart className="h-3.5 w-3.5 text-rose-500" />}
        label="Avg Engagement"
        value={formatNumber(data.avgEngagement)}
      />

      <div className="w-px bg-border/30 my-2" />

      {/* Sentiment Shift */}
      <StatusCard
        icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
        label="Negative"
        value={`${data.negativePct}%`}
        alert={data.negativePct > 30}
      />

      <div className="w-px bg-border/30 my-2" />

      {/* Data Freshness */}
      <StatusCard
        icon={<Clock className="h-3.5 w-3.5 text-emerald-500" />}
        label="Freshness"
        value={data.latestDate ? timeAgo(data.latestDate) : 'N/A'}
        sub={`${data.enrichedPct}% enriched`}
      />

      {/* Mini sparkline */}
      {data.dailyVolume.length > 1 && (
        <>
          <div className="w-px bg-border/30 my-2" />
          <div className="flex items-center px-4 py-2">
            <Sparkline data={data.dailyVolume.map((d) => d.count)} />
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status Card                                                         */
/* ------------------------------------------------------------------ */

function StatusCard({
  icon,
  label,
  value,
  sub,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-4 py-2",
      alert && "bg-red-500/5",
    )}>
      {icon}
      <div className="flex flex-col">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">{label}</span>
        <span className={cn(
          "text-xs font-bold tabular-nums leading-tight mt-0.5",
          alert ? "text-red-600" : "text-foreground",
        )}>{value}</span>
        {sub && <span className="text-[9px] text-muted-foreground leading-none mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}
