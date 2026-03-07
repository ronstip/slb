import type { EntitySummary } from '../../../api/types.ts';
import { formatNumber } from '../../../lib/format.ts';

interface EntityTableProps {
  data: EntitySummary[];
}

export function EntityTable({ data }: EntityTableProps) {
  const top10 = data.slice(0, 10);

  return (
    <div className="overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border/50 bg-muted/30">
            <th className="w-8 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">#</th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Entity</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mentions</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Views</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Likes</th>
          </tr>
        </thead>
        <tbody>
          {top10.map((e, idx) => (
            <tr
              key={e.entity}
              className={`border-b border-border/30 last:border-b-0 transition-colors hover:bg-muted/50 ${idx % 2 === 1 ? 'bg-muted/10' : ''}`}
            >
              <td className="px-4 py-2.5 text-[11px] tabular-nums text-muted-foreground/60">{idx + 1}</td>
              <td className="px-4 py-2.5 text-[12px] font-medium text-foreground">{e.entity}</td>
              <td className="px-4 py-2.5 text-right text-[12px] tabular-nums font-medium text-foreground">
                {formatNumber(e.mentions)}
              </td>
              <td className="px-4 py-2.5 text-right text-[12px] tabular-nums text-muted-foreground">
                {formatNumber(e.total_views)}
              </td>
              <td className="px-4 py-2.5 text-right text-[12px] tabular-nums text-muted-foreground">
                {formatNumber(e.total_likes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
