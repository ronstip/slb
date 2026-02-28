import type { EntitySummary } from '../../../api/types.ts';
import { formatNumber } from '../../../lib/format.ts';

interface EntityTableProps {
  data: EntitySummary[];
}

export function EntityTable({ data }: EntityTableProps) {
  const top10 = data.slice(0, 10);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-3 py-2 font-medium text-muted-foreground">Entity</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Mentions</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Views</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Likes</th>
          </tr>
        </thead>
        <tbody>
          {top10.map((e) => (
            <tr key={e.entity} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors">
              <td className="px-3 py-2.5 text-[12px] font-medium text-foreground">{e.entity}</td>
              <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                {formatNumber(e.mentions)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                {formatNumber(e.total_views)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                {formatNumber(e.total_likes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
