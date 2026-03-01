import type { KpiItem } from '../../../../api/types.ts';
import { formatNumber } from '../../../../lib/format.ts';

interface KpiGridProps {
  data: Record<string, unknown>;
}

export function KpiGrid({ data }: KpiGridProps) {
  const items = (data.items ?? []) as KpiItem[];
  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map((item) => {
        const isNumeric = typeof item.value === 'number';
        const displayValue = isNumeric ? formatNumber(item.value as number) : String(item.value);

        return (
          <div
            key={item.label}
            className="rounded-xl border border-border/60 bg-card/80 px-4 py-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              {item.label}
            </p>
            <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-foreground">
              {displayValue}
            </p>
          </div>
        );
      })}
    </div>
  );
}
