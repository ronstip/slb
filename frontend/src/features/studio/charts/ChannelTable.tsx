import type { ChannelSummary } from '../../../api/types.ts';
import { PLATFORM_LABELS } from '../../../lib/constants.ts';
import { formatNumber } from '../../../lib/format.ts';

interface ChannelTableProps {
  data: ChannelSummary[];
}

export function ChannelTable({ data }: ChannelTableProps) {
  const top10 = data.slice(0, 10);

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="py-1.5 font-medium text-muted-foreground">Channel</th>
          <th className="py-1.5 font-medium text-muted-foreground">Platform</th>
          <th className="py-1.5 text-right font-medium text-muted-foreground">Posts</th>
          <th className="py-1.5 text-right font-medium text-muted-foreground">Engagement</th>
        </tr>
      </thead>
      <tbody>
        {top10.map((ch) => (
          <tr key={`${ch.platform}-${ch.channel_handle}`} className="border-b border-border/50">
            <td className="py-1.5 text-foreground">@{ch.channel_handle}</td>
            <td className="py-1.5 text-muted-foreground">
              {PLATFORM_LABELS[ch.platform] || ch.platform}
            </td>
            <td className="py-1.5 text-right font-mono text-foreground">{ch.post_count}</td>
            <td className="py-1.5 text-right font-mono text-foreground">
              {formatNumber(ch.total_engagement)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
