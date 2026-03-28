import { useQuery } from '@tanstack/react-query';
import { getCollectionStats } from '../../../api/endpoints/collections.ts';
import { formatNumber } from '../../../lib/format.ts';

interface MetricItem {
  label: string;
  value: string | number;
}

interface MetricsSectionCardProps {
  data: Record<string, unknown>;
}

function MetricCell({ label, value }: MetricItem) {
  const isNumeric = typeof value === 'number';
  const displayValue = isNumeric ? formatNumber(value) : String(value);

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-card px-3 py-2 min-w-[100px]">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      <span className="text-lg font-bold tabular-nums text-foreground leading-tight">
        {displayValue}
      </span>
    </div>
  );
}

function statsToItems(stats: Awaited<ReturnType<typeof getCollectionStats>>): MetricItem[] {
  const items: MetricItem[] = [
    { label: 'Total Posts', value: stats.total_posts },
  ];
  if (stats.engagement_summary.total_views > 0) {
    items.push({ label: 'Views', value: stats.engagement_summary.total_views });
  }
  if (stats.engagement_summary.total_likes > 0) {
    items.push({ label: 'Likes', value: stats.engagement_summary.total_likes });
  }
  if (stats.engagement_summary.total_comments > 0) {
    items.push({ label: 'Comments', value: stats.engagement_summary.total_comments });
  }
  if (stats.engagement_summary.total_shares > 0) {
    items.push({ label: 'Shares', value: stats.engagement_summary.total_shares });
  }
  if (stats.total_unique_channels > 0) {
    items.push({ label: 'Channels', value: stats.total_unique_channels });
  }
  return items;
}

export function MetricsSectionCard({ data }: MetricsSectionCardProps) {
  const collectionId = data.collection_id as string | undefined;
  const customItems = data.items as MetricItem[] | undefined;

  const { data: stats, isLoading } = useQuery({
    queryKey: ['collection-stats', collectionId],
    queryFn: () => getCollectionStats(collectionId!),
    enabled: !!collectionId && !customItems,
  });

  const items = customItems ?? (stats ? statsToItems(stats) : null);

  if (!customItems && isLoading) {
    return (
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 w-[100px] shrink-0 animate-pulse rounded-lg bg-secondary" />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <MetricCell key={item.label} label={item.label} value={item.value} />
      ))}
    </div>
  );
}
