import { useState, useRef, useEffect } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getCollectionStatus } from '../../../api/endpoints/collections.ts';
import { formatNumber } from '../../../lib/format.ts';

interface CollectionProgressCardProps {
  collectionId: string;
  /** 'inline' = used inside ResearchDesignCard (border-t only), 'standalone' = own card wrapper */
  variant?: 'inline' | 'standalone';
  /** Called when the collection transitions to completed/monitoring */
  onCompleted?: (message: string) => void;
}

export function CollectionProgressCard({ collectionId, variant = 'standalone', onCompleted }: CollectionProgressCardProps) {
  const [statsOpen, setStatsOpen] = useState(true);
  const completedFiredRef = useRef(false);

  const { data: statusData } = useQuery({
    queryKey: ['collection-status', collectionId],
    queryFn: () => getCollectionStatus(collectionId),
    enabled: !!collectionId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === 'completed' || s === 'failed' || s === 'monitoring') return false;
      return 5000;
    },
  });

  const isActive = !statusData || !['completed', 'failed', 'monitoring'].includes(statusData.status);
  const isDone = statusData && ['completed', 'monitoring'].includes(statusData.status);

  // Fire completion message once when status transitions to done
  useEffect(() => {
    if (isDone && !completedFiredRef.current && onCompleted) {
      completedFiredRef.current = true;
      const posts = statusData?.posts_collected ?? 0;
      const views = statusData?.total_views ?? 0;
      const viewsPart = views > 0 ? ` with ${formatNumber(views)} total views` : '';
      onCompleted(
        `Collection ${collectionId} just finished — ${formatNumber(posts)} posts collected${viewsPart}.`,
      );
    }
  }, [isDone, onCompleted, collectionId, statusData]);

  const statusLabel = !statusData
    ? 'Starting…'
    : statusData.status === 'collecting'
      ? 'Collecting posts'
      : statusData.status === 'enriching'
        ? 'Enriching data'
        : statusData.status === 'completed'
          ? 'Complete'
          : statusData.status === 'monitoring'
            ? 'Monitoring'
            : statusData.status === 'failed'
              ? 'Failed'
              : statusData.status === 'pending'
                ? 'Queued'
                : statusData.status;

  const inner = (
    <div className={variant === 'inline' ? 'border-t border-border/30' : ''}>
      {/* Status header — always visible */}
      <button
        onClick={() => setStatsOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left transition-colors hover:bg-accent/20"
      >
        {/* Status indicator */}
        {isActive ? (
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-vibrant opacity-50" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-vibrant" />
          </span>
        ) : isDone ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : statusData?.status === 'failed' ? (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
        ) : (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground animate-pulse" />
        )}

        <span className="flex-1 text-[13px] font-medium text-foreground">
          {statusLabel}
        </span>

        {statusData && statusData.posts_collected > 0 && (
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
            {formatNumber(statusData.posts_collected)} posts
          </span>
        )}

        {statsOpen ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Stats body */}
      {statsOpen && (
        <div className="px-5 pb-4 space-y-3">
          {/* Metric cards */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
              <p className="text-base font-bold tabular-nums text-foreground">
                {formatNumber(statusData?.posts_collected ?? 0)}
              </p>
              <p className="text-[10px] text-muted-foreground">Collected</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
              <p className="text-base font-bold tabular-nums text-foreground">
                {isActive && (statusData?.total_views ?? 0) === 0 ? '—' : formatNumber(statusData?.total_views ?? 0)}
              </p>
              <p className="text-[10px] text-muted-foreground">Views</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2 text-center">
              <p className="text-base font-bold tabular-nums text-foreground">
                {statusData?.positive_pct != null ? `${statusData.positive_pct}%` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground">Positive</p>
            </div>
          </div>

          {/* Progress bar */}
          {isActive && (
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-accent-vibrant transition-all duration-700 ease-out"
                style={{
                  width: statusData?.status === 'enriching'
                    ? '80%'
                    : (statusData?.posts_collected ?? 0) > 0
                      ? '50%'
                      : '15%',
                }}
              />
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
          )}

          {isDone && (
            <div className="h-1.5 w-full rounded-full bg-emerald-500/20">
              <div className="h-full w-full rounded-full bg-emerald-500 transition-all duration-500" />
            </div>
          )}

          {statusData?.status === 'failed' && statusData.error_message && (
            <p className="rounded-lg bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {statusData.error_message}
            </p>
          )}
        </div>
      )}
    </div>
  );

  if (variant === 'standalone') {
    return (
      <div className="mt-3 overflow-hidden rounded-2xl border border-accent-vibrant/20 bg-gradient-to-b from-accent-vibrant/5 to-background shadow-sm">
        {inner}
      </div>
    );
  }

  return inner;
}
