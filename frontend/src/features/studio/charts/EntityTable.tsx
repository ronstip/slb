import type { EntitySummary } from '../../../api/types.ts';
import { formatNumber } from '../../../lib/format.ts';
import { useChartColors } from './use-chart-colors.ts';

interface EntityTableProps {
  data: EntitySummary[];
  onRowClick?: (entity: string) => void;
}

export function EntityTable({ data, onRowClick }: EntityTableProps) {
  const top10 = data.slice(0, 10);
  const maxMentions = top10.length > 0 ? top10[0].mentions : 1;
  const chartColors = useChartColors();
  const barColor = chartColors[0];

  return (
    <div className="overflow-hidden rounded-lg">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border/50 bg-muted/30">
            <th className="w-8 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">#</th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Entity</th>
            <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mentions</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Views</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Likes</th>
          </tr>
        </thead>
        <tbody>
          {top10.map((e, idx) => (
            <tr
              key={e.entity}
              className={`border-b border-border/20 last:border-b-0 transition-colors hover:bg-muted/40 ${onRowClick ? 'cursor-pointer' : ''}`}
              onClick={() => onRowClick?.(e.entity)}
            >
              <td className="px-4 py-2.5 text-[11px] tabular-nums text-muted-foreground/50">{idx + 1}</td>
              <td className="px-4 py-2.5 text-[12px] font-medium text-foreground">{e.entity}</td>
              <td className="px-4 py-2.5 w-[140px]">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(e.mentions / maxMentions) * 100}%`,
                        backgroundColor: barColor,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums font-medium text-foreground shrink-0">
                    {formatNumber(e.mentions)}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-right text-[11px] tabular-nums text-muted-foreground">
                {formatNumber(e.total_views)}
              </td>
              <td className="px-4 py-2.5 text-right text-[11px] tabular-nums text-muted-foreground">
                {formatNumber(e.total_likes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
