import type { EntitySummary } from '../../../api/types.ts';
import { formatNumber } from '../../../lib/format.ts';

interface EntityTableProps {
  data: EntitySummary[];
}

export function EntityTable({ data }: EntityTableProps) {
  const top10 = data.slice(0, 10);

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="py-1.5 font-medium text-muted-foreground">Entity</th>
          <th className="py-1.5 text-right font-medium text-muted-foreground">Mentions</th>
          <th className="py-1.5 text-right font-medium text-muted-foreground">Total Views</th>
          <th className="py-1.5 text-right font-medium text-muted-foreground">Total Likes</th>
        </tr>
      </thead>
      <tbody>
        {top10.map((e) => (
          <tr key={e.entity} className="border-b border-border/50">
            <td className="py-1.5 text-foreground">{e.entity}</td>
            <td className="py-1.5 text-right font-mono text-foreground">{e.mentions}</td>
            <td className="py-1.5 text-right font-mono text-foreground">
              {formatNumber(e.total_views)}
            </td>
            <td className="py-1.5 text-right font-mono text-foreground">
              {formatNumber(e.total_likes)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
