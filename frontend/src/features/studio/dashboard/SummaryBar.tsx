import type { DashboardPost } from '../../../api/types.ts';
import { formatNumber } from '../../../lib/format.ts';

interface SummaryBarProps {
  posts: DashboardPost[];
  allPostsCount: number;
  activeFilterCount: number;
}

export function SummaryBar({ posts, allPostsCount, activeFilterCount }: SummaryBarProps) {
  const platforms = new Set(posts.map((p) => p.platform)).size;
  const channels = new Set(posts.map((p) => p.channel_handle).filter(Boolean)).size;

  let dateRange = '';
  if (posts.length > 0) {
    const dates = posts
      .map((p) => p.posted_at?.slice(0, 10))
      .filter(Boolean)
      .sort();
    if (dates.length > 0) {
      const fmt = (d: string) => {
        const [, m, day] = d.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[parseInt(m) - 1]} ${parseInt(day)}`;
      };
      const first = dates[0]!;
      const last = dates[dates.length - 1]!;
      dateRange = first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
      <span>
        <span className="font-semibold tabular-nums text-foreground">{formatNumber(posts.length)}</span>
        {' posts'}
        {activeFilterCount > 0 && (
          <span className="text-muted-foreground/60"> of {formatNumber(allPostsCount)}</span>
        )}
      </span>
      {dateRange && (
        <>
          <span className="text-border">|</span>
          <span>{dateRange}</span>
        </>
      )}
      <span className="text-border">|</span>
      <span>{platforms} platform{platforms !== 1 ? 's' : ''}</span>
      <span className="text-border">|</span>
      <span>{formatNumber(channels)} channel{channels !== 1 ? 's' : ''}</span>
    </div>
  );
}
