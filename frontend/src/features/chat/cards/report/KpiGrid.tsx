import { FileText, Eye, Heart, MessageCircle, Share2, type LucideIcon } from 'lucide-react';
import type { KpiItem } from '../../../../api/types.ts';
import { formatNumber } from '../../../../lib/format.ts';
import { cn } from '../../../../lib/utils.ts';

const KPI_ICONS: Record<string, LucideIcon> = {
  'total posts': FileText,
  'total views': Eye,
  'total likes': Heart,
  'total comments': MessageCircle,
  'total shares': Share2,
  posts: FileText,
  views: Eye,
  likes: Heart,
  comments: MessageCircle,
  shares: Share2,
};

function getKpiIcon(label: string): LucideIcon | null {
  return KPI_ICONS[label.toLowerCase()] ?? null;
}

interface KpiGridProps {
  data: Record<string, unknown>;
}

export function KpiGrid({ data }: KpiGridProps) {
  const items = (data.items ?? []) as KpiItem[];
  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
      {items.map((item) => {
        const isNumeric = typeof item.value === 'number';
        const displayValue = isNumeric ? formatNumber(item.value as number) : String(item.value);
        const Icon = getKpiIcon(item.label);

        return (
          <div
            key={item.label}
            className="rounded-xl border border-border bg-card px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none"
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {item.label}
              </p>
              {Icon && (
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-foreground">
              {displayValue}
            </p>
            {item.change && (
              <p className={cn(
                'mt-1.5 text-[11px] font-medium',
                item.sentiment === 'positive' ? 'text-sentiment-positive' :
                item.sentiment === 'negative' ? 'text-sentiment-negative' :
                'text-muted-foreground',
              )}>
                {item.change}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
