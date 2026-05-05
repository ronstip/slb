import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import { aggregatePlatforms } from '../../../../studio/dashboard/dashboard-aggregations.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '../../../../../lib/constants.ts';
import { formatNumber } from '../../../../../lib/format.ts';
import { PlatformIcon } from '../../../../../components/PlatformIcon.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../../components/ui/tooltip.tsx';
import type { Source } from '../../../../../api/endpoints/agents.ts';
import { useOverviewDashboardData } from './useOverviewDashboardData.ts';

interface PlatformBreakdownCardProps {
  agentId: string;
  collectionIds: string[];
  isAgentRunning: boolean;
  sources?: Source[];
  agentCreatedAt: string | undefined;
  dataStartDate?: string | null;
  dataEndDate?: string | null;
  onOpenData: () => void;
}

export function PlatformBreakdownCard({
  agentId,
  collectionIds,
  isAgentRunning,
  sources,
  agentCreatedAt,
  dataStartDate,
  dataEndDate,
  onOpenData,
}: PlatformBreakdownCardProps) {
  const { posts, isLoading } = useOverviewDashboardData(
    collectionIds,
    sources,
    isAgentRunning,
    agentCreatedAt,
    dataStartDate,
    dataEndDate,
    agentId,
  );

  const platforms = useMemo(() => aggregatePlatforms(posts), [posts]);

  const maxCount = platforms[0]?.post_count || 1;
  const totalPosts = platforms.reduce((sum, p) => sum + p.post_count, 0);

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-sm font-semibold text-foreground">Platform breakdown</h3>
          {platforms.length > 0 && (
            <span className="text-xs text-muted-foreground">{platforms.length} platforms</span>
          )}
        </div>
        {platforms.length > 0 && (
          <button
            onClick={onOpenData}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            Explore →
          </button>
        )}
      </header>

      {isLoading && platforms.length === 0 ? (
        <PlatformBreakdownSkeleton />
      ) : platforms.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <Layers className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            {isAgentRunning
              ? 'Platforms will appear as posts are collected…'
              : 'No posts collected yet.'}
          </p>
        </div>
      ) : (
        <TooltipProvider delayDuration={150}>
          <div className="space-y-1">
            {platforms.map((p) => {
              const pct = (p.post_count / maxCount) * 100;
              const sharePct = totalPosts > 0 ? (p.post_count / totalPosts) * 100 : 0;
              const color = PLATFORM_COLORS[p.platform] ?? '#94999F';
              const label = PLATFORM_LABELS[p.platform] ?? p.platform;
              return (
                <Tooltip key={p.platform}>
                  <TooltipTrigger asChild>
                    <div className="-mx-2 cursor-default rounded-md px-2 py-1 transition-colors hover:bg-muted/40">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <PlatformIcon platform={p.platform} className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-xs font-medium text-foreground">{label}</span>
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-foreground">
                          {formatNumber(p.post_count)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
                        <div
                          className="h-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="px-3 py-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-4 border-b border-background/20 pb-1">
                        <div className="flex items-center gap-1.5">
                          <PlatformIcon platform={p.platform} className="h-3 w-3 shrink-0" />
                          <span className="text-[11px] font-semibold uppercase tracking-wider">
                            {label}
                          </span>
                        </div>
                        <span className="text-[10px] opacity-70">{sharePct.toFixed(1)}% of posts</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-4 text-[11px]">
                        <span className="opacity-80">Posts</span>
                        <span className="font-semibold tabular-nums">{formatNumber(p.post_count)}</span>
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

function PlatformBreakdownSkeleton() {
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
