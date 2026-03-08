import { FileText, Eye, Zap, TrendingUp, BarChart3, type LucideIcon } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { formatNumber } from '../../../lib/format.ts';
import { useChartColors } from '../charts/use-chart-colors.ts';
import type { EnhancedKpi } from './dashboard-aggregations.ts';

const ICON_MAP: Record<EnhancedKpi['icon'], LucideIcon> = {
  posts: FileText,
  views: Eye,
  engagement: Zap,
  rate: TrendingUp,
  avg: BarChart3,
};

interface EnhancedKpiGridProps {
  data: EnhancedKpi[];
}

export function EnhancedKpiGrid({ data }: EnhancedKpiGridProps) {
  const chartColors = useChartColors();

  if (data.length === 0) return null;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
      {data.map((kpi, idx) => {
        const Icon = ICON_MAP[kpi.icon];
        const color = chartColors[idx % chartColors.length];
        const sparkData = kpi.sparklineData.map((v, i) => ({ v, i }));
        const displayValue = kpi.format === 'percent'
          ? `${kpi.value}%`
          : formatNumber(kpi.value);

        return (
          <div
            key={kpi.label}
            className="group relative overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5 transition-all duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_2px_8px_rgba(255,255,255,0.03)] hover:border-primary/15"
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                {kpi.label}
              </p>
              <div
                className="flex h-6 w-6 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${color}15` }}
              >
                <Icon className="h-3 w-3" style={{ color }} />
              </div>
            </div>

            <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-foreground">
              {displayValue}
            </p>

            {sparkData.length > 1 && (
              <div className="mt-2 h-[28px] w-full opacity-60 group-hover:opacity-100 transition-opacity">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparkData}>
                    <Line
                      type="monotone"
                      dataKey="v"
                      stroke={color}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
