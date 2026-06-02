import type { WidgetData } from './types-social-dashboard.ts';
import { useTheme } from '../../../components/theme-provider.tsx';
import { generateChartPalette } from '../../../lib/accent-colors.ts';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';

function fmt(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1);
}

function resolveColor(label: string, fallback: string, overrides?: Record<string, string>): string {
  if (overrides?.[label]) return overrides[label];
  const key = label.toLowerCase();
  if (key in SENTIMENT_COLORS) return SENTIMENT_COLORS[key];
  return fallback;
}

function resolveLabel(raw: string, overrides?: Record<string, string>): string {
  const renamed = overrides?.[raw];
  return renamed != null && renamed !== '' ? renamed : raw;
}

interface SocialProgressListWidgetProps {
  data: WidgetData | undefined;
  accent?: string;
  seriesColorOverrides?: Record<string, string>;
  seriesLabelOverrides?: Record<string, string>;
}

export function SocialProgressListWidget({
  data,
  accent,
  seriesColorOverrides,
  seriesLabelOverrides,
}: SocialProgressListWidgetProps) {
  const { accentColor, theme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const palette = generateChartPalette(accent ?? accentColor, isDark);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-7 w-7 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  // ── Breakdown mode (groupedCategorical) - segmented bars like Channel Mix ──
  if (
    data.groupedCategorical &&
    data.groupedCategorical.labels.length > 0 &&
    data.groupedCategorical.datasets.length > 0
  ) {
    const { labels, datasets } = data.groupedCategorical;

    // Spread breakdown colors across the 5-color palette for max contrast
    const basePaletteSize = 5;
    const stride =
      datasets.length > 1 ? Math.max(1, Math.floor(basePaletteSize / datasets.length)) : 1;
    const segmentColors = datasets.map((ds, i) =>
      resolveColor(ds.label, palette[(i * stride) % basePaletteSize], seriesColorOverrides),
    );

    const rowTotals = labels.map((_, rowIdx) =>
      datasets.reduce((sum, ds) => sum + (ds.values[rowIdx] ?? 0), 0),
    );
    const maxTotal = Math.max(...rowTotals, 1);
    const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex flex-col gap-2.5 overflow-y-auto flex-1 pr-1">
          {labels.map((label, rowIdx) => {
            const total = rowTotals[rowIdx];
            const barPct = (total / maxTotal) * 100;
            const sharePct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
            return (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[11px] text-muted-foreground w-5 text-right tabular-nums shrink-0 font-medium">
                      {rowIdx + 1}.
                    </span>
                    <span className="text-sm font-medium text-foreground truncate">{resolveLabel(label, seriesLabelOverrides)}</span>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className="text-sm font-semibold text-foreground tabular-nums">{fmt(total)}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums w-10 text-right">
                      {sharePct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div
                  className="flex h-2 overflow-hidden rounded-full bg-muted/50 transition-[width] duration-500"
                  style={{ width: `${barPct}%` }}
                >
                  {datasets.map((ds, segIdx) => {
                    const segVal = ds.values[rowIdx] ?? 0;
                    const segPct = total > 0 ? (segVal / total) * 100 : 0;
                    if (segPct === 0) return null;
                    return (
                      <div
                        key={ds.label}
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${segPct}%`,
                          backgroundColor: segmentColors[segIdx],
                          opacity: 0.85,
                        }}
                        title={`${resolveLabel(ds.label, seriesLabelOverrides)}: ${fmt(segVal)}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 mt-2 border-t border-border/60 shrink-0">
          {datasets.map((ds, i) => (
            <div key={ds.label} className="flex items-center gap-1.5 min-w-0">
              <div
                className="h-2 w-2 rounded-sm shrink-0"
                style={{ backgroundColor: segmentColors[i] }}
              />
              <span
                className="text-[11px] text-muted-foreground truncate max-w-[140px]"
                title={resolveLabel(ds.label, seriesLabelOverrides)}
              >
                {resolveLabel(ds.label, seriesLabelOverrides)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Single-dimension mode ────────────────────────────────────────────────
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
  const getColor = (label: string, index: number): string =>
    resolveColor(label, palette[index % palette.length], seriesColorOverrides);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto h-full pr-1">
      {labels.map((label, index) => {
        const value = values![index];
        const barPct = (value / maxValue) * 100;
        const totalPct = total > 0 ? (value / total) * 100 : 0;
        const color = getColor(label, index);
        return (
          <div key={label}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[11px] text-muted-foreground w-5 text-right tabular-nums shrink-0 font-medium">
                  {index + 1}.
                </span>
                <div className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm font-medium text-foreground truncate">{resolveLabel(label, seriesLabelOverrides)}</span>
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
