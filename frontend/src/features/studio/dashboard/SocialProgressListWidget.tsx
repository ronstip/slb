import type { WidgetData } from './types-social-dashboard.ts';
import { useTheme } from '../../../components/theme-provider.tsx';
import { generateChartPalette } from '../../../lib/accent-colors.ts';

function fmt(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1);
}

interface SocialProgressListWidgetProps {
  data: WidgetData | undefined;
}

export function SocialProgressListWidget({ data }: SocialProgressListWidgetProps) {
  const { accentColor, theme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const palette = generateChartPalette(accentColor, isDark);
  const getColor = (index: number): string => palette[index % palette.length];

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-7 w-7 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  // Normalise to labels/values
  let labels = data.labels;
  let values = data.values;
  if ((!labels || !values) && data.timeSeries?.length) {
    labels = data.timeSeries.map((p) => p.date);
    values = data.timeSeries.map((p) => p.value);
  }
  if ((!labels || !values) && data.groupedTimeSeries) {
    const entries = Object.entries(data.groupedTimeSeries);
    if (entries.length > 0) {
      labels = entries.map(([name]) => name);
      values = entries.map(([, series]) => series.reduce((sum, p) => sum + p.value, 0));
    }
  }

  if (!labels || !values || labels.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No data available
      </div>
    );
  }

  const maxValue = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto h-full pr-1">
      {labels.map((label, index) => {
        const value = values![index];
        const barPct = (value / maxValue) * 100;
        const totalPct = total > 0 ? (value / total) * 100 : 0;
        const color = getColor(index);
        return (
          <div key={label}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[11px] text-muted-foreground w-5 text-right tabular-nums shrink-0 font-medium">
                  {index + 1}.
                </span>
                <div className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm font-medium text-foreground truncate">{label}</span>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <span className="text-sm font-semibold text-foreground tabular-nums">{fmt(value)}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums w-10 text-right">
                  {totalPct.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.85 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
