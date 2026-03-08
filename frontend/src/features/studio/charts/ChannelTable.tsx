import type { ChannelSummary } from '../../../api/types.ts';
import { formatNumber } from '../../../lib/format.ts';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';

interface ChannelTableProps {
  data: ChannelSummary[];
  onRowClick?: (channel: string) => void;
}

export function ChannelTable({ data, onRowClick }: ChannelTableProps) {
  const top10 = data.slice(0, 10);

  return (
    <div className="overflow-hidden rounded-lg">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border/50 bg-muted/30">
            <th className="w-8 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">#</th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Channel</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Posts</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avg Likes</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avg Views</th>
          </tr>
        </thead>
        <tbody>
          {top10.map((ch, idx) => (
            <tr
              key={`${ch.platform}-${ch.channel_handle}`}
              className={`border-b border-border/20 last:border-b-0 transition-colors hover:bg-muted/40 ${onRowClick ? 'cursor-pointer' : ''}`}
              onClick={() => onRowClick?.(ch.channel_handle)}
            >
              <td className="px-4 py-2.5 text-[11px] tabular-nums text-muted-foreground/50">{idx + 1}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={ch.platform} className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-[12px] font-medium text-foreground truncate">@{ch.channel_handle}</span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-right text-[12px] tabular-nums font-medium text-foreground">
                {ch.collected_posts}
              </td>
              <td className="px-4 py-2.5 text-right text-[11px] tabular-nums text-muted-foreground">
                {formatNumber(ch.avg_likes)}
              </td>
              <td className="px-4 py-2.5 text-right text-[11px] tabular-nums text-muted-foreground">
                {formatNumber(ch.avg_views)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
