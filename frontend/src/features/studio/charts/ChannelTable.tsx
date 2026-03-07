import type { ChannelSummary } from '../../../api/types.ts';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '../../../lib/constants.ts';
import { formatNumber } from '../../../lib/format.ts';

interface ChannelTableProps {
  data: ChannelSummary[];
}

export function ChannelTable({ data }: ChannelTableProps) {
  const top10 = data.slice(0, 10);

  return (
    <div className="overflow-hidden">
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
              className={`border-b border-border/30 last:border-b-0 transition-colors hover:bg-muted/50 ${idx % 2 === 1 ? 'bg-muted/10' : ''}`}
            >
              <td className="px-4 py-2.5 text-[11px] tabular-nums text-muted-foreground/60">{idx + 1}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: PLATFORM_COLORS[ch.platform] ?? '#78716C' }}
                  />
                  <span className="text-[12px] font-medium text-foreground">@{ch.channel_handle}</span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {PLATFORM_LABELS[ch.platform] || ch.platform}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-right text-[12px] tabular-nums font-medium text-foreground">
                {ch.collected_posts}
              </td>
              <td className="px-4 py-2.5 text-right text-[12px] tabular-nums text-muted-foreground">
                {formatNumber(ch.avg_likes)}
              </td>
              <td className="px-4 py-2.5 text-right text-[12px] tabular-nums text-muted-foreground">
                {formatNumber(ch.avg_views)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
