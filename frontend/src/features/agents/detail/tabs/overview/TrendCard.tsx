import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, ChevronDown, Heart, Settings2, TrendingUp } from 'lucide-react';
import {
  aggregateEngagementRate,
  aggregateSentimentOverTime,
  aggregateVolume,
} from '../../../../studio/dashboard/dashboard-aggregations.ts';
import { VolumeChart } from '../../../../studio/charts/VolumeChart.tsx';
import { SentimentLineChart } from '../../../../studio/charts/SentimentLineChart.tsx';
import { EngagementRateChart } from '../../../../studio/charts/EngagementRateChart.tsx';
import { ChartDialog } from '../../../../studio/ChartDialog.tsx';
import { useSSEChat } from '../../../../chat/hooks/useSSEChat.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../../../components/ui/dropdown-menu.tsx';
import type { CustomFieldDef } from '../../../../../api/types.ts';
import type { SearchDef } from '../../../../../api/endpoints/agents.ts';
import { useOverviewDashboardData } from './useOverviewDashboardData.ts';

type TrendMetric = 'volume' | 'sentiment' | 'engagement';

interface MetricSpec {
  key: TrendMetric;
  label: string;
  title: string;
  icon: typeof TrendingUp;
}

const METRICS: MetricSpec[] = [
  { key: 'sentiment',  label: 'Sentiment',       title: 'Sentiment over time',       icon: Heart },
  { key: 'volume',     label: 'Volume',          title: 'Posts over time',           icon: BarChart3 },
  { key: 'engagement', label: 'Engagement rate', title: 'Engagement rate over time', icon: Activity },
];

const STORAGE_KEY_PREFIX = 'overview-trend-metric:';

function loadMetric(agentId: string): TrendMetric {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + agentId);
    if (raw === 'volume' || raw === 'sentiment' || raw === 'engagement') return raw;
  } catch {
    /* ignore */
  }
  return 'sentiment';
}

interface TrendCardProps {
  agentId: string;
  collectionIds: string[];
  isAgentRunning: boolean;
  customFields?: CustomFieldDef[] | null;
  searches?: SearchDef[];
  agentCreatedAt: string | undefined;
}

export function TrendCard({
  agentId,
  collectionIds,
  isAgentRunning,
  customFields,
  searches,
  agentCreatedAt,
}: TrendCardProps) {
  const [metric, setMetric] = useState<TrendMetric>(() => loadMetric(agentId));
  const [chartOpen, setChartOpen] = useState(false);
  const { sendMessage } = useSSEChat();

  useEffect(() => {
    setMetric(loadMetric(agentId));
  }, [agentId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PREFIX + agentId, metric);
    } catch {
      /* ignore */
    }
  }, [agentId, metric]);

  const { posts, window, isLoading } = useOverviewDashboardData(
    collectionIds,
    searches,
    isAgentRunning,
    agentCreatedAt,
  );

  const granularity: 'day' | 'hour' = useMemo(() => {
    if (window.days != null && window.days <= 1) return 'hour';
    const days = new Set<string>();
    for (const p of posts) {
      if (!p.posted_at) continue;
      const d = new Date(p.posted_at);
      if (Number.isNaN(d.getTime())) continue;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      days.add(`${y}-${m}-${day}`);
      if (days.size > 1) break;
    }
    return days.size <= 1 ? 'hour' : 'day';
  }, [window.days, posts]);

  const chartData = useMemo(() => {
    if (metric === 'volume') return aggregateVolume(posts, granularity);
    if (metric === 'sentiment') return aggregateSentimentOverTime(posts, granularity);
    return aggregateEngagementRate(posts, granularity);
  }, [metric, posts, granularity]);

  const hourTickFormatter = (d: string) => {
    // d = "YYYY-MM-DDTHH"
    const hour = d.slice(11, 13);
    return hour ? `${hour}:00` : d;
  };

  const active = METRICS.find((m) => m.key === metric)!;
  const ActiveIcon = active.icon;
  const hasData = chartData.length > 0;

  return (
    <section className="rounded-2xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-sm font-semibold text-foreground">{active.title}</h3>
          {window.days != null ? (
            <span className="text-xs text-muted-foreground">
              Last {window.days} day{window.days === 1 ? '' : 's'}
              {granularity === 'hour' ? ' · hourly' : ''}
            </span>
          ) : window.startDate ? (
            <span className="text-xs text-muted-foreground">
              Since {window.startDate}
              {granularity === 'hour' ? ' · hourly' : ''}
            </span>
          ) : hasData ? (
            <span className="text-xs text-muted-foreground">
              {chartData.length} {granularity === 'hour' ? 'hour' : 'day'}
              {chartData.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              <ActiveIcon className="h-3.5 w-3.5" />
              {active.label}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {METRICS.map((m) => {
              const Icon = m.icon;
              return (
                <DropdownMenuItem
                  key={m.key}
                  onClick={() => setMetric(m.key)}
                  className="text-xs"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                  {m.key === metric && (
                    <span className="ml-auto text-[10px] text-muted-foreground">active</span>
                  )}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setChartOpen(true)} className="text-xs">
              <Settings2 className="h-3.5 w-3.5" />
              Customize…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {isLoading && !hasData ? (
        <TrendSkeleton />
      ) : !hasData ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <TrendingUp className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            {isAgentRunning
              ? 'Trend will appear as posts arrive…'
              : 'Not enough data yet.'}
          </p>
        </div>
      ) : metric === 'volume' ? (
        <VolumeChart
          data={chartData as ReturnType<typeof aggregateVolume>}
          tickFormatter={granularity === 'hour' ? hourTickFormatter : undefined}
        />
      ) : metric === 'sentiment' ? (
        <SentimentLineChart
          data={chartData as ReturnType<typeof aggregateSentimentOverTime>}
          tickFormatter={granularity === 'hour' ? hourTickFormatter : undefined}
        />
      ) : (
        <EngagementRateChart
          data={chartData as ReturnType<typeof aggregateEngagementRate>}
          tickFormatter={granularity === 'hour' ? hourTickFormatter : undefined}
        />
      )}

      <ChartDialog
        open={chartOpen}
        onOpenChange={setChartOpen}
        onSubmit={sendMessage}
        customFields={customFields}
      />
    </section>
  );
}

function TrendSkeleton() {
  return (
    <div className="relative h-[220px] overflow-hidden rounded-md bg-muted/30">
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-muted/60 to-transparent" />
    </div>
  );
}
