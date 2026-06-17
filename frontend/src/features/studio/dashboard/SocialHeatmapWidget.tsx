import { useMemo } from 'react';
import { cn } from '../../../lib/utils.ts';
import { useTheme } from '../../../components/theme-provider.tsx';
import { DEFAULT_ACCENT, hexToHsl, hslToHex } from '../../../lib/accent-colors.ts';
import type { WidgetData } from './types-social-dashboard.ts';

interface SocialHeatmapWidgetProps {
  /** Aggregated 2D pivot - `groupedCategorical.labels` are the X columns,
   *  `datasets` are the Y rows (each with values aligned to the columns). */
  data?: WidgetData;
  /** Base accent color for the intensity ramp. Undefined → the app accent. */
  accent?: string;
  /** Per-label display-name overrides (shared with the chart widgets). Renames
   *  row and column labels in place. */
  seriesLabelOverrides?: Record<string, string>;
}

/** Map a normalized value [0,1] to a cell background on the accent's hue. Low
 *  values stay pale (light mode) / faint (dark mode); high values saturate
 *  toward the accent. A square-root ease spreads the low end so a long tail of
 *  small values stays distinguishable. */
function heatColor(t: number, hue: number, sat: number, isDark: boolean): string {
  const e = Math.sqrt(Math.max(0, Math.min(1, t)));
  if (isDark) {
    const l = 0.15 + e * 0.45; // faint → bright
    return hslToHex(hue, Math.max(sat, 0.35), l);
  }
  const l = 0.95 - e * 0.5; // pale tint → saturated
  return hslToHex(hue, Math.min(Math.max(sat, 0.45), 0.85), l);
}

/**
 * Heatmap chart widget - a grid of intensity-shaded cells (e.g. posting
 * activity by hour × weekday). Consumes the `groupedCategorical` shape produced
 * by `aggregateHeatmap`: columns = X labels, rows = Y datasets. Matches the
 * other widgets' look via the shared accent system and lives inside the
 * standard `SocialWidgetFrame`.
 */
export function SocialHeatmapWidget({ data, accent, seriesLabelOverrides }: SocialHeatmapWidgetProps) {
  const { accentColor: appAccent, theme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const effectiveAccent = accent ?? appAccent ?? DEFAULT_ACCENT;
  const { h: hue, s: sat } = useMemo(() => hexToHsl(effectiveAccent), [effectiveAccent]);

  const gc = data?.groupedCategorical;
  const columns = gc?.labels ?? [];
  const rows = gc?.datasets ?? [];
  // A breakdown-less heatmap is a single unlabeled row strip.
  const singleRow = rows.length === 1 && rows[0].label === '';

  const max = useMemo(() => {
    let m = 0;
    for (const ds of gc?.datasets ?? []) for (const v of ds.values) if (v > m) m = v;
    return m;
  }, [gc]);

  const display = (raw: string): string => seriesLabelOverrides?.[raw] ?? raw;

  // Sparse column labels: with many columns (e.g. 24 hours), label ~6 evenly so
  // the axis reads cleanly instead of cramming all of them.
  const colEvery = columns.length > 14 ? Math.max(1, Math.round(columns.length / 6)) : 1;

  if (columns.length === 0 || rows.length === 0 || (data?.value ?? 0) === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No data for this range
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div
        className="grid h-full w-full gap-[3px]"
        style={{
          gridTemplateColumns: `auto repeat(${columns.length}, minmax(0, 1fr))`,
          gridTemplateRows: `auto repeat(${rows.length}, minmax(0, 1fr))`,
        }}
      >
        {/* Header row: empty corner + column axis labels */}
        <div aria-hidden />
        {columns.map((col, ci) => (
          <div
            key={`col-${col}-${ci}`}
            className="flex items-end justify-center pb-1 text-[10px] font-medium leading-none text-muted-foreground/70 tabular-nums"
          >
            {ci % colEvery === 0 ? display(col) : ''}
          </div>
        ))}

        {/* Body rows: row label + cells */}
        {rows.map((row, ri) => (
          <Row
            key={`row-${row.label}-${ri}`}
            label={singleRow ? '' : display(row.label)}
            values={row.values}
            columns={columns}
            rowRaw={row.label}
            colDisplay={display}
            max={max}
            hue={hue}
            sat={sat}
            isDark={isDark}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  label: string;
  rowRaw: string;
  values: number[];
  columns: string[];
  colDisplay: (raw: string) => string;
  max: number;
  hue: number;
  sat: number;
  isDark: boolean;
}

function Row({ label, rowRaw, values, columns, colDisplay, max, hue, sat, isDark }: RowProps) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-[11px] font-medium leading-none text-muted-foreground tabular-nums">
        {label}
      </div>
      {columns.map((col, ci) => {
        const v = values[ci] ?? 0;
        const t = max > 0 ? v / max : 0;
        const labelText = `${label ? `${label} · ` : ''}${colDisplay(col)}: ${v.toLocaleString()}`;
        return (
          <div
            key={`cell-${rowRaw}-${col}-${ci}`}
            title={labelText}
            aria-label={labelText}
            className={cn('rounded-[3px] transition-colors duration-150 hover:ring-2 hover:ring-foreground/20')}
            style={{ backgroundColor: heatColor(t, hue, sat, isDark) }}
          />
        );
      })}
    </>
  );
}
