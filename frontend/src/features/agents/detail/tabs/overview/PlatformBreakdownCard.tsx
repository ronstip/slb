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

  const maxPosts = Math.max(1, ...platforms.map((p) => p.post_count));
  const maxEngagements = Math.max(1, ...platforms.map((p) => p.engagement_count));
  const totalPosts = platforms.reduce((sum, p) => sum + p.post_count, 0);
  const totalEngagements = platforms.reduce((sum, p) => sum + p.engagement_count, 0);

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
          <div className="space-y-2">
            {platforms.map((p) => {
              const postsPct = (p.post_count / maxPosts) * 100;
              const engagementsPct = (p.engagement_count / maxEngagements) * 100;
              const postsShare = totalPosts > 0 ? (p.post_count / totalPosts) * 100 : 0;
              const engagementsShare =
                totalEngagements > 0 ? (p.engagement_count / totalEngagements) * 100 : 0;
              const color = PLATFORM_COLORS[p.platform] ?? '#94999F';
              const label = PLATFORM_LABELS[p.platform] ?? p.platform;
              return (
                <Tooltip key={p.platform}>
                  <TooltipTrigger asChild>
                    <div className="-mx-2 cursor-default rounded-md px-2 py-1 transition-colors hover:bg-muted/40">
                      <div className="mb-1 flex min-w-0 items-center gap-1.5">
                        <PlatformIcon platform={p.platform} className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate text-xs font-medium text-foreground">{label}</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                            <div
                              className="h-full transition-all duration-500"
                              style={{ width: `${postsPct}%`, backgroundColor: color }}
                            />
                          </div>
                          <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-foreground">
                            {formatNumber(p.post_count)}
                            <span className="ml-1 text-muted-foreground">posts</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                            <div
                              className="h-full transition-all duration-500"
                              style={{ width: `${engagementsPct}%`, backgroundColor: color, opacity: 0.4 }}
                            />
                          </div>
                          <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-foreground">
                            {formatNumber(p.engagement_count)}
                            <span className="ml-1 text-muted-foreground">engagements</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="px-3 py-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 border-b border-background/20 pb-1">
                        <PlatformIcon platform={p.platform} className="h-3 w-3 shrink-0" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider">
                          {label}
                        </span>
                      </div>
                      <div className="space-y-0.5 text-[11px]">
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="opacity-80">Posts</span>
                          <span className="font-semibold tabular-nums">
                            {formatNumber(p.post_count)}
                            <span className="ml-1 font-normal opacity-60">
                              ({postsShare.toFixed(1)}%)
                            </span>
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="opacity-80">Engagements</span>
                          <span className="font-semibold tabular-nums">
                            {formatNumber(p.engagement_count)}
                            <span className="ml-1 font-normal opacity-60">
                              ({engagementsShare.toFixed(1)}%)
                            </span>
                          </span>
                        </div>
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
