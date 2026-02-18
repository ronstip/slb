import { ThumbsUp, Eye, MessageCircle, Share2 } from 'lucide-react';
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
    { label: 'Likes', value: totals.likes, icon: ThumbsUp },
    { label: 'Views', value: totals.views, icon: Eye },
    { label: 'Comments', value: totals.comments, icon: MessageCircle },
    { label: 'Shares', value: totals.shares, icon: Share2 },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {metrics.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className="rounded-md border border-border bg-card p-3"
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="h-3 w-3" />
            {label}
          </div>
          <p className="mt-1 font-mono text-lg font-medium text-foreground">
            {formatNumber(value)}
          </p>
        </div>
      ))}
    </div>
  );
}
