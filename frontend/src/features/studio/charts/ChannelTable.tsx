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
        <tr className="border-b border-border-default text-left">
          <th className="py-1.5 font-medium text-text-secondary">Channel</th>
          <th className="py-1.5 font-medium text-text-secondary">Platform</th>
          <th className="py-1.5 text-right font-medium text-text-secondary">Posts</th>
          <th className="py-1.5 text-right font-medium text-text-secondary">Engagement</th>
        </tr>
      </thead>
      <tbody>
        {top10.map((ch) => (
          <tr key={`${ch.platform}-${ch.channel_handle}`} className="border-b border-border-default/50">
            <td className="py-1.5 text-text-primary">@{ch.channel_handle}</td>
            <td className="py-1.5 text-text-secondary">
              {PLATFORM_LABELS[ch.platform] || ch.platform}
            </td>
            <td className="py-1.5 text-right font-mono text-text-primary">{ch.post_count}</td>
            <td className="py-1.5 text-right font-mono text-text-primary">
              {formatNumber(ch.total_engagement)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
