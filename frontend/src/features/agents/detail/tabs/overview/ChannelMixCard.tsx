import { useMemo } from 'react';
import { Radio } from 'lucide-react';
import {
  aggregateChannelTypeViews,
  SENT_KEYS,
} from '../../../../studio/dashboard/dashboard-aggregations.ts';
import { SENTIMENT_COLORS } from '../../../../../lib/constants.ts';
import { formatNumber } from '../../../../../lib/format.ts';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../../components/ui/tooltip.tsx';
import type { SearchDef } from '../../../../../api/endpoints/agents.ts';
import { useOverviewDashboardData } from './useOverviewDashboardData.ts';

interface ChannelMixCardProps {
  collectionIds: string[];
  isAgentRunning: boolean;
  searches?: SearchDef[];
  onOpenData: () => void;
}

export function ChannelMixCard({
  collectionIds,
  isAgentRunning,
  searches,
  onOpenData,
}: ChannelMixCardProps) {
  const { posts, isLoading } = useOverviewDashboardData(collectionIds, searches, isAgentRunning);

  const channelTypes = useMemo(() => aggregateChannelTypeViews(posts), [posts]);

  const maxTotal = channelTypes[0]?.total || 1;
  const totalViews = channelTypes.reduce((sum, ct) => sum + ct.total, 0);

  return (
    <section className="rounded-2xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-sm font-semibold text-foreground">Channel mix</h3>
          {channelTypes.length > 0 && (
            <span className="text-xs text-muted-foreground">{channelTypes.length} types</span>
          )}
        </div>
        {channelTypes.length > 0 && (
          <button
            onClick={onOpenData}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            Explore →
          </button>
        )}
      </header>

      {isLoading && channelTypes.length === 0 ? (
        <ChannelMixSkeleton />
      ) : channelTypes.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <Radio className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            {isAgentRunning
              ? 'Channel types will appear as posts are analyzed…'
              : 'No posts enriched yet.'}
          </p>
        </div>
      ) : (
        <TooltipProvider delayDuration={150}>
          <div className="space-y-1">
            {channelTypes.map((ct) => {
              const pct = (ct.total / maxTotal) * 100;
              const sharePct = totalViews > 0 ? (ct.total / totalViews) * 100 : 0;
              return (
                <Tooltip key={ct.type}>
                  <TooltipTrigger asChild>
                    <div className="-mx-2 cursor-default rounded-md px-2 py-1 transition-colors hover:bg-muted/40">
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="text-xs font-medium capitalize text-foreground">{ct.type}</span>
                        <span className="text-xs font-semibold tabular-nums text-foreground">
                          {formatNumber(ct.total)}
                        </span>
                      </div>
                      <div
                        className="flex h-1.5 overflow-hidden rounded-full bg-muted/50 transition-[width] duration-500"
                        style={{ width: `${pct}%` }}
                      >
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
                  </TooltipTrigger>
                  <TooltipContent side="left" className="px-3 py-2">
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-4 border-b border-background/20 pb-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider capitalize">
                          {ct.type}
                        </span>
                        <span className="text-[10px] opacity-70">{sharePct.toFixed(1)}% of views</span>
                      </div>
                      {SENT_KEYS.map((s) => (
                        <div key={s} className="flex items-center gap-2 text-[11px]">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ backgroundColor: SENTIMENT_COLORS[s] }}
                          />
                          <span className="flex-1 capitalize opacity-80">{s}</span>
                          <span className="font-semibold tabular-nums">{formatNumber(ct[s])}</span>
                        </div>
                      ))}
                      <div className="flex items-baseline justify-between gap-4 border-t border-background/20 pt-1 text-[11px]">
                        <span className="opacity-80">Total views</span>
                        <span className="font-semibold tabular-nums">{formatNumber(ct.total)}</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      )}
    </section>
  );
}

function ChannelMixSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="relative h-7 overflow-hidden rounded-md bg-muted/40"
        >
          <div
            className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-muted/60 to-transparent"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        </div>
      ))}
    </div>
  );
}
