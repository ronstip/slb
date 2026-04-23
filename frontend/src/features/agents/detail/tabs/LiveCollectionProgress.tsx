import { memo } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getCollectionStatus } from '../../../../api/endpoints/collections.ts';
import { formatNumber } from '../../../../lib/format.ts';

interface LiveCollectionProgressProps {
  collectionIds: string[];
}

function LiveCollectionProgressImpl({ collectionIds }: LiveCollectionProgressProps) {
  const latestId = collectionIds[collectionIds.length - 1];
  const { data: status } = useQuery({
    queryKey: ['collection-status', latestId],
    queryFn: () => getCollectionStatus(latestId),
    enabled: !!latestId,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'success' || s === 'failed' ? false : 10_000;
    },
  });

  if (!status) return null;

  const isCollecting = status.status === 'running';
  const isDone = status.status === 'success';
  const posts = status.posts_collected ?? 0;
  const enriched = status.posts_enriched ?? 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          {isCollecting ? (
            <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
          ) : isDone ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          <span className="text-xs font-medium">
            {isCollecting ? 'Collecting data…' : isDone ? 'Data ready' : status.status}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
            <p className="text-sm font-bold tabular-nums">{formatNumber(posts)}</p>
            <p className="text-[9px] text-muted-foreground">Collected</p>
          </div>
          <div className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
            <p className="text-sm font-bold tabular-nums">{formatNumber(enriched)}</p>
            <p className="text-[9px] text-muted-foreground">Enriched</p>
          </div>
          <div className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
            <p className="text-sm font-bold tabular-nums">
              {posts > 0 ? `${Math.round((enriched / posts) * 100)}%` : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground">Progress</p>
          </div>
        </div>

        {isCollecting && (
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
          </div>
        )}
        {isDone && posts > 0 && enriched < posts && (
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${Math.round((enriched / posts) * 100)}%` }}
            />
          </div>
        )}
        {isDone && enriched >= posts && posts > 0 && (
          <div className="h-1 w-full rounded-full bg-emerald-500/20">
            <div className="h-full w-full rounded-full bg-emerald-500" />
          </div>
        )}
      </div>
    </div>
  );
}

export const LiveCollectionProgress = memo(LiveCollectionProgressImpl);
