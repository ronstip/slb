import { TrendingUp, TrendingDown } from 'lucide-react';
import type { KpiItem } from '../../../../api/types.ts';
import { formatNumber } from '../../../../lib/format.ts';

interface KpiGridProps {
  data: Record<string, unknown>;
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'text-emerald-500',
  negative: 'text-red-500',
  neutral: 'text-muted-foreground',
};

export function KpiGrid({ data }: KpiGridProps) {
  const items = (data.items ?? []) as KpiItem[];
  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => {
        const isNumeric = typeof item.value === 'number';
        const displayValue = isNumeric ? formatNumber(item.value as number) : String(item.value);
        const changeColor = item.sentiment ? SENTIMENT_COLORS[item.sentiment] : 'text-muted-foreground';

        return (
          <div
            key={item.label}
            className="rounded-lg border border-border bg-card p-3"
          >
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-1 font-mono text-lg font-semibold text-foreground">
              {displayValue}
            </p>
            {item.change && (
              <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${changeColor}`}>
                {item.change.startsWith('+') ? (
                  <TrendingUp className="h-3 w-3" />
                ) : item.change.startsWith('-') ? (
                  <TrendingDown className="h-3 w-3" />
                ) : null}
                {item.change}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
