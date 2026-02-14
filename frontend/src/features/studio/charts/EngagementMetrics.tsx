import type { EngagementSummary } from '../../../api/types.ts';
import { formatNumber } from '../../../lib/format.ts';

interface EngagementMetricsProps {
  data: EngagementSummary[];
}

export function EngagementMetrics({ data }: EngagementMetricsProps) {
  // Aggregate across platforms
  const totals = data.reduce(
    (acc, d) => ({
      likes: acc.likes + d.total_likes,
      views: acc.views + d.total_views,
      comments: acc.comments + d.total_comments,
      shares: acc.shares + d.total_shares,
    }),
    { likes: 0, views: 0, comments: 0, shares: 0 },
  );

  const metrics = [
    { label: 'Likes', value: totals.likes, emoji: '👍' },
    { label: 'Views', value: totals.views, emoji: '👁' },
    { label: 'Comments', value: totals.comments, emoji: '💬' },
    { label: 'Shares', value: totals.shares, emoji: '↗️' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {metrics.map(({ label, value, emoji }) => (
        <div
          key={label}
          className="rounded-lg border border-border bg-card p-3"
        >
          <span className="text-xs text-muted-foreground">
            {emoji} {label}
          </span>
          <p className="mt-1 font-mono text-lg font-medium text-foreground">
            {formatNumber(value)}
          </p>
        </div>
      ))}
    </div>
  );
}
