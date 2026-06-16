import { useRef, useMemo, useEffect, forwardRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { Bar, Doughnut, Pie, Line } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';
import type { ChartAxisStyle, SocialChartType, TableColumnDisplay, WidgetData, SliceLabelContent } from './types-social-dashboard.ts';
import { resolveLabelDisplay, formatPct, composeLabel, formatBucketLabel } from './chart-label-format.ts';
import { useTheme } from '../../../components/theme-provider.tsx';
import { getCategoricalPalette } from '../../../lib/accent-colors.ts';
import { SENTIMENT_COLORS, PLATFORM_COLORS } from '../../../lib/constants.ts';
import { makeOverrideResolver } from './series-overrides.ts';

/** Resolve colors for a set of labels.
 *  Order: user override (exact label, then case/separator-tolerant) → semantic
 *  (sentiment) → platform brand color → provided palette. Tolerant matching
 *  means a near-miss override key ("Fan Vlog" vs the data's "fan vlog") still
 *  colors the slice instead of silently doing nothing. */
function resolveSeriesColors(
  labels: string[],
  accentColors: string[],
  overrides?: Record<string, string>,
): string[] {
  const resolveOverride = makeOverrideResolver(overrides);
  return labels.map((l, i) => {
    const override = resolveOverride(l);
    if (override) return override;
    const key = l.toLowerCase();
    if (key in SENTIMENT_COLORS) return SENTIMENT_COLORS[key];
    if (key in PLATFORM_COLORS) return PLATFORM_COLORS[key];
    return accentColors[i % accentColors.length];
  });
}

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
);

// Perf baseline mixed into every chart's options. On a dashboard with ~10
// canvases these two settings are the dominant lever:
//  - `animation: false` removes the per-frame enter animation that otherwise
//    runs ~1s × every chart on the main thread on each (cold) load.
//  - `resizeDelay` debounces ResizeObserver-driven redraws. Without it, the
//    react-grid-layout transition between the 12-col desktop and stacked mobile
//    layouts fires a redraw on every animation frame for every chart (a redraw
//    storm); with it each chart redraws once after the resize settles.
// Hover/tooltip interactivity is unaffected. Drop `animation: false` if the
// mount fade-in is wanted back.
const BASE_CHART_PERF = {
  animation: false as const,
  resizeDelay: 200,
};

// ── Palettes ──────────────────────────────────────────────────────────────────

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

function getAccentColors(accent: string, count: number): string[] {
  const hex = accent.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  // Monochromatic: same hue, varying lightness and slight saturation shifts
  return Array.from({ length: count }, (_, i) => {
    const lightness = 0.22 + (i / (count - 1)) * 0.50; // range from 0.22 to 0.72
    const satFactor = 1 - (Math.abs(i - count / 2) / count) * 0.4; // slightly desaturate extremes
    return hslToHex(h, Math.max(s * satFactor, 0.2), lightness);
  });
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function resolveThemeColor(varName: string): string {
  const dark = isDarkMode();
  if (varName === '--foreground') return dark ? '#fafafa' : '#1a1a1a';
  if (varName === '--muted-foreground') return dark ? '#a0a0a0' : '#737373';
  if (varName === '--card') return dark ? '#2a2a2a' : '#ffffff';
  return '#808080';
}

function getTooltipStyle() {
  const dark = isDarkMode();
  return {
    backgroundColor: dark ? '#1f1f1f' : '#ffffff',
    titleColor: dark ? '#fafafa' : '#1a1a1a',
    bodyColor: dark ? '#fafafa' : '#1a1a1a',
    borderColor: dark ? '#3a3a3a' : '#e5e5e5',
    borderWidth: 1,
    cornerRadius: 8,
    padding: 12,
    titleFont: { size: 12, weight: 'bold' as const },
    bodyFont: { size: 12 },
    displayColors: true,
    boxPadding: 4,
  };
}

function getAxisStyle() {
  const dark = isDarkMode();
  const gridColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const tickColor = dark ? '#a0a0a0' : '#737373';
  return {
    grid: { color: gridColor, drawBorder: false, borderDash: [3, 3] as number[] },
    ticks: { color: tickColor, font: { size: 11 } },
    border: { display: false },
  };
}

function formatNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  if (Number.isInteger(val)) return val.toLocaleString();
  return val.toFixed(1);
}

// Humanize raw enum-style labels coming from SQL ("pro_bibi", "neutral",
// "key-quote") into display labels ("Pro-Bibi", "Neutral", "Key-Quote").
// Idempotent: already-formatted labels pass through unchanged.
function formatLabel(raw: string): string {
  if (!raw) return raw;
  // Already mixed-case or contains spaces - assume curated, leave alone.
  if (/\s/.test(raw) || /[a-z][A-Z]/.test(raw)) return raw;
  return raw
    .replace(/_/g, '-')
    .split('-')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part)
    .join('-');
}

// User rename override > formatLabel humanisation. Lookup is by the raw label
// as it appears in the data (same key shape as color overrides), exact first
// then case/separator-tolerant so a near-miss rename key still applies.
function displayLabel(raw: string, overrides?: Record<string, string>): string {
  const renamed = makeOverrideResolver(overrides)(raw);
  if (renamed != null && renamed !== '') return renamed;
  return formatLabel(raw);
}

// ── Datalabel plugins ─────────────────────────────────────────────────────────

type BarGetProps = (
  p: ['x', 'y', 'base'],
  a: boolean,
) => { x: number; y: number; base: number };

const barDatalabelsPlugin = {
  id: 'barDatalabels',
  afterDatasetsDraw(chart: ChartJS) {
    const { ctx } = chart;
    const isHorizontalBar = chart.options.indexAxis === 'y';
    const scales = chart.options.scales as
      | { x?: { stacked?: boolean }; y?: { stacked?: boolean } }
      | undefined;
    const isStacked = !!(scales?.x?.stacked || scales?.y?.stacked);
    const datasets = chart.data.datasets;
    const multiDataset = datasets.length > 1;
    const fg = resolveThemeColor('--foreground');
    // Chosen value-label format (abs / pct / abs_pct), stashed on the chart
    // options by the React layer so this static plugin can read it each draw.
    const display: TableColumnDisplay =
      (chart.options.plugins as { barDatalabels?: { display?: TableColumnDisplay } } | undefined)
        ?.barDatalabels?.display ?? 'abs';
    if (display === 'none') return; // value labels off

    // Percent base = "share of total shown". For grouped/stacked bars that is
    // the category's total across all visible datasets (the bars sharing an x);
    // for a single series it is the sum of every bar. Precomputed once.
    const visibleSets = datasets
      .map((ds, di) => ({ ds, di }))
      .filter(({ di }) => chart.isDatasetVisible(di));
    const categoryTotals: number[] = [];
    let singleTotal = 0;
    if (multiDataset) {
      for (const { ds } of visibleSets) {
        (ds.data as number[]).forEach((v, i) => {
          categoryTotals[i] = (categoryTotals[i] ?? 0) + (Number(v) || 0);
        });
      }
    } else if (visibleSets.length === 1) {
      singleTotal = (visibleSets[0].ds.data as number[]).reduce((a, b) => a + (Number(b) || 0), 0);
    }
    const totalFor = (i: number) => (multiDataset ? categoryTotals[i] ?? 0 : singleTotal);

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!chart.isDatasetVisible(datasetIndex)) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      const values = dataset.data as number[];

      meta.data.forEach((bar, i) => {
        const val = values[i];
        if (val == null || val === 0) return;
        const props = (bar as unknown as { getProps: BarGetProps }).getProps(
          ['x', 'y', 'base'],
          true,
        );

        ctx.save();
        ctx.font = '600 10px system-ui, sans-serif';

        if (isStacked && multiDataset) {
          const segSize = isHorizontalBar
            ? Math.abs(props.x - props.base)
            : Math.abs(props.y - props.base);
          if (segSize < 22) {
            ctx.restore();
            return;
          }
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 2;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const cx = isHorizontalBar ? (props.x + props.base) / 2 : props.x;
          const cy = isHorizontalBar ? props.y : (props.y + props.base) / 2;
          ctx.fillText(composeLabel(formatNumber(val), val, totalFor(i), display), cx, cy);
        } else {
          // Declutter: skip the value label when the bar is too thin to hold it
          // without colliding with neighbours (common with grouped/side-by-side
          // bars). The tooltip still surfaces the exact value on hover.
          const barEl = bar as unknown as { width?: number; height?: number };
          const txt = composeLabel(formatNumber(val), val, totalFor(i), display);
          const txtW = ctx.measureText(txt).width;
          ctx.fillStyle = fg;
          if (isHorizontalBar) {
            const slot = barEl.height ?? Infinity;
            if (slot < 10) { ctx.restore(); return; }
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(txt, props.x + 4, props.y);
          } else {
            const slot = barEl.width ?? Infinity;
            if (txtW > slot + 6) { ctx.restore(); return; }
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(txt, props.x, props.y - 4);
          }
        }
        ctx.restore();
      });
    });
  },
};

// Pie/doughnut on-slice value labels - opt-in (attached only when the user
// chooses to draw values on the slices). Draws the value at each arc's centroid
// in white with a soft shadow so it reads on any slice color. Reads `display`
// from chart.options.plugins.sliceDatalabels so this static plugin picks up
// format changes each draw. Skips slivers and hidden slices. Reads the arc's
// geometry off the element directly (post-layout) - more robust than getProps.
type ArcGeometry = {
  x: number;
  y: number;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
};

export const sliceDatalabelsPlugin = {
  id: 'sliceDatalabels',
  afterDatasetsDraw(chart: ChartJS) {
    const content = (chart.options.plugins as { sliceDatalabels?: { display?: SliceLabelContent } } | undefined)
      ?.sliceDatalabels?.display;
    if (!content || content === 'none') return;
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const values = chart.data.datasets[0]?.data as number[] | undefined;
    if (!values) return;
    const labels = chart.data.labels as string[] | undefined;
    // Percent base = sum of the currently-visible slices (legend toggles hide
    // slices), matching the legend/tooltip's "share of total shown".
    let total = 0;
    meta.data.forEach((_, i) => { if (chart.getDataVisibility(i)) total += Number(values[i]) || 0; });
    ctx.save();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    meta.data.forEach((arc, i) => {
      if (!chart.getDataVisibility(i)) return;
      const val = Number(values[i]) || 0;
      if (val === 0) return;
      const a = arc as unknown as ArcGeometry;
      if (!Number.isFinite(a.outerRadius)) return;
      // Skip slivers too narrow to hold a label without overlapping neighbours
      // (~4.8% of the ring); the tooltip still surfaces the exact value.
      if (Math.abs(a.endAngle - a.startAngle) < 0.3) return;
      // 'name' draws the (already-formatted) category label; the rest are
      // numeric formats handled by composeLabel.
      const text = content === 'name'
        ? String(labels?.[i] ?? '')
        : composeLabel(formatNumber(val), val, total, content);
      if (!text) return;
      const mid = (a.startAngle + a.endAngle) / 2;
      const r = (a.innerRadius + a.outerRadius) / 2;
      const x = a.x + Math.cos(mid) * r;
      const y = a.y + Math.sin(mid) * r;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 3;
      ctx.fillText(text, x, y);
    });
    ctx.restore();
  },
};

// Stable identity for the Pie plugins prop (Doughnut uses DOUGHNUT_PLUGINS).
const PIE_PLUGINS = [sliceDatalabelsPlugin];

// Line point labels - opt-in (only attached when the user picks a value-label
// format). Reads `display` from chart.options.plugins.lineDatalabels. Declutters
// by skipping points that would crowd the previously drawn label on the same
// series. Percent base = sum of every plotted value across visible series
// ("share of total shown").
const lineDatalabelsPlugin = {
  id: 'lineDatalabels',
  afterDatasetsDraw(chart: ChartJS) {
    const { ctx } = chart;
    const display: TableColumnDisplay =
      (chart.options.plugins as { lineDatalabels?: { display?: TableColumnDisplay } } | undefined)
        ?.lineDatalabels?.display ?? 'abs';
    if (display === 'none') return; // value labels off
    const fg = resolveThemeColor('--foreground');

    let total = 0;
    chart.data.datasets.forEach((ds, di) => {
      if (!chart.isDatasetVisible(di)) return;
      for (const p of ds.data as Array<{ y?: number } | number>) {
        const y = typeof p === 'number' ? p : p?.y ?? 0;
        total += Number(y) || 0;
      }
    });

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!chart.isDatasetVisible(datasetIndex)) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      const points = dataset.data as Array<{ y?: number } | number>;
      let lastX = -Infinity;
      ctx.save();
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      meta.data.forEach((point, i) => {
        const raw = points[i];
        const val = typeof raw === 'number' ? raw : raw?.y ?? 0;
        if (val == null || val === 0) return;
        const el = point as unknown as { x: number; y: number };
        if (el.x - lastX < 32) return; // crowding guard
        lastX = el.x;
        ctx.fillText(composeLabel(formatNumber(val), val, total, display), el.x, el.y - 6);
      });
      ctx.restore();
    });
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface SocialChartWidgetProps {
  chartType: SocialChartType;
  data: WidgetData | undefined;
  accent?: string;
  /** Per-label color overrides - keyed by exact label as it appears in the data
   *  (group name for grouped/multi-series, category label otherwise). */
  seriesColorOverrides?: Record<string, string>;
  /** Per-label display-name overrides - same key shape as `seriesColorOverrides`.
   *  Wins over the default `formatLabel` humanisation in legends, axes, tooltips. */
  seriesLabelOverrides?: Record<string, string>;
  barOrientation?: 'horizontal' | 'vertical';
  stacked?: boolean;
  /** For time-series line charts: controls the Chart.js x-axis unit and display
   *  format. Defaults to 'day' for backwards compatibility. */
  timeBucket?: 'hour' | 'day' | 'week' | 'month';
  /** Label shown under the centered total in doughnut charts. Defaults to 'total'. */
  centerLabel?: string;
  /** How numeric value labels render (bar/line on-chart labels, pie/doughnut
   *  legend): absolute, percent of total shown, or both. Unset → each chart's
   *  historical default (pie/doughnut percent, others absolute). */
  labelDisplay?: TableColumnDisplay;
  /** Pie/doughnut only: what the on-slice label shows (name or a numeric
   *  format), independent of the legend (`labelDisplay`). Unset → 'none'. */
  sliceLabelDisplay?: SliceLabelContent;
  /** Bar/line only: visibility + title override for the screen X/Y axes. */
  xAxis?: ChartAxisStyle;
  yAxis?: ChartAxisStyle;
  /** System-default axis titles (placeholder + the text used when an axis title
   *  is enabled without a custom override). Keyed to the screen axes. */
  axisTitleDefaults?: { x: string; y: string };
}

export function SocialChartWidget({ chartType, data, accent, seriesColorOverrides, seriesLabelOverrides, barOrientation = 'horizontal', stacked = true, timeBucket = 'day', centerLabel, labelDisplay, sliceLabelDisplay, xAxis, yAxis, axisTitleDefaults = { x: '', y: '' } }: SocialChartWidgetProps) {
  // Effective format for on-chart/legend value labels. Line labels are opt-in:
  // they only render when the user explicitly set a format (lineLabelsOn).
  const valueDisplay = resolveLabelDisplay(chartType, labelDisplay);
  const lineLabelsOn = !!labelDisplay;
  // Pie/doughnut: legend value (driven by `labelDisplay`) and on-slice label
  // (driven by `sliceLabelDisplay`) are fully independent. Slices off by default.
  // The slice plugin is always attached and self-gates on this 'none' (so it
  // reacts to toggles - react-chartjs-2 only reads the `plugins` prop at mount).
  const sliceDisplay: SliceLabelContent = sliceLabelDisplay ?? 'none';
  const legendValuesOn = valueDisplay !== 'none';
  // Bar/line axis overrides: hide the whole axis and/or draw a title (custom
  // text, else the system default). Spread onto each scale's config object so it
  // wins over the base `display`/`title`. `def` is the screen-axis default title.
  const axisTitleColor = resolveThemeColor('--muted-foreground');
  const axisOpts = (axis: ChartAxisStyle | undefined, def: string) => {
    const text = axis?.title?.trim() || def;
    return {
      display: axis?.hidden ? false : true,
      title: axis?.showTitle && text
        ? { display: true as const, text, color: axisTitleColor, font: { size: 12, weight: 500 as const } }
        : { display: false as const },
    };
  };
  const { accentColor, theme } = useTheme();
  const themeIsDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Multi-hue categorical palette — for charts with many co-equal categories
  // (donuts, pies, multi-series). Sentiment/platform labels still resolve to
  // their semantic colors inside resolveSeriesColors.
  const colors = useMemo(() => {
    if (accent) return getAccentColors(accent, 15);
    return getCategoricalPalette(themeIsDark, 15);
  }, [accent, themeIsDark]);

  // Single-series bars read as one brand-orange family in the design (not a
  // rainbow) — every bar is the accent unless its label is a sentiment/platform.
  const barAccent = accent ?? accentColor;
  const monoColors = useMemo(
    () => Array.from({ length: 15 }, () => barAccent),
    [barAccent],
  );

  const timeScale = useMemo(() => {
    if (timeBucket === 'hour') {
      return {
        unit: 'hour' as const,
        displayFormats: { hour: 'MMM d, HH:mm', day: 'MMM d', month: 'MMM yyyy' },
        tooltipFormat: 'MMM d, yyyy HH:mm',
      };
    }
    if (timeBucket === 'month') {
      return {
        unit: 'month' as const,
        displayFormats: { day: 'MMM d', month: 'MMM yyyy' },
        tooltipFormat: 'MMM yyyy',
      };
    }
    if (timeBucket === 'week') {
      return {
        unit: 'week' as const,
        displayFormats: { day: 'MMM d', week: 'MMM d', month: 'MMM yyyy' },
        tooltipFormat: 'MMM d, yyyy',
      };
    }
    return {
      unit: 'day' as const,
      displayFormats: { day: 'MMM d', month: 'MMM yyyy' },
      tooltipFormat: 'MMM d, yyyy',
    };
  }, [timeBucket]);

  const lineRef = useRef<ChartJS<'line'> | null>(null);
  const barRef = useRef<ChartJS<'bar'> | null>(null);
  const pieRef = useRef<ChartJS<'pie'> | null>(null);

  useEffect(() => {
    return () => {
      lineRef.current?.destroy();
      barRef.current?.destroy();
      pieRef.current?.destroy();
    };
  }, []);

  // Normalise: convert timeSeries → labels/values for non-line types,
  // and flatten groupedCategorical for non-bar types (pie/doughnut).
  const normalizedData = useMemo(() => {
    if (!data) return data;
    if (data.labels && data.values) return data;
    if (data.groupedCategorical && chartType !== 'bar') {
      // Flatten grouped categorical into "Primary – Breakdown" labels for pie/doughnut
      const { labels: primaryLabels, datasets } = data.groupedCategorical;
      const flatLabels: string[] = [];
      const flatValues: number[] = [];
      for (const ds of datasets) {
        for (let i = 0; i < primaryLabels.length; i++) {
          if (ds.values[i] > 0) {
            flatLabels.push(`${primaryLabels[i]} – ${ds.label}`);
            flatValues.push(ds.values[i]);
          }
        }
      }
      return { ...data, labels: flatLabels, values: flatValues, groupedCategorical: undefined };
    }
    if (data.groupedCategorical && chartType === 'bar') return data;
    if (data.timeSeries && data.timeSeries.length > 0 && chartType !== 'line') {
      return {
        ...data,
        labels: data.timeSeries.map((p) => p.date),
        values: data.timeSeries.map((p) => p.value),
      };
    }
    if (data.groupedTimeSeries && Object.keys(data.groupedTimeSeries).length > 0 && chartType !== 'line') {
      const entries = Object.entries(data.groupedTimeSeries);
      if (chartType === 'bar') {
        // Keep dates on the primary axis with breakdown values as datasets so
        // bars stack/group by breakdown - matching the user's group-by intent.
        const allDates = new Set<string>();
        for (const [, series] of entries) for (const p of series) allDates.add(p.date);
        const labels = [...allDates].sort();
        const datasets = entries.map(([name, series]) => {
          const byDate = new Map(series.map((p) => [p.date, p.value]));
          return { label: name, values: labels.map((d) => byDate.get(d) ?? 0) };
        });
        return { ...data, groupedCategorical: { labels, datasets }, groupedTimeSeries: undefined };
      }
      return {
        ...data,
        labels: entries.map(([name]) => name),
        values: entries.map(([, series]) => series.reduce((sum, p) => sum + p.value, 0)),
      };
    }
    return data;
  }, [data, chartType]);

  if (!normalizedData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-7 w-7 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  // ── Grouped time series (multi-line) - only for line chart type ──────────
  if (chartType === 'line' && normalizedData.groupedTimeSeries && Object.keys(normalizedData.groupedTimeSeries).length > 0) {
    const groups = Object.entries(normalizedData.groupedTimeSeries)
      .sort(([, a], [, b]) => (b[b.length - 1]?.value ?? 0) - (a[a.length - 1]?.value ?? 0))
      .slice(0, 10);

    const seriesColors = resolveSeriesColors(groups.map(([n]) => n), colors, seriesColorOverrides);
    const chartData = {
      datasets: groups.map(([name, series], i) => ({
        label: displayLabel(name, seriesLabelOverrides),
        data: series.map((p) => ({ x: new Date(p.date), y: p.value })),
        borderColor: seriesColors[i],
        backgroundColor: seriesColors[i] + '15',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: false,
        tension: 0.4,
        cubicInterpolationMode: 'monotone' as const,
      })),
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      ...BASE_CHART_PERF,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        lineDatalabels: { display: valueDisplay },
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: {
            color: resolveThemeColor('--foreground'),
            font: { size: 10 },
            boxWidth: 8, boxHeight: 8, padding: 8,
            borderRadius: 2, useBorderRadius: true,
          },
        },
        tooltip: {
          ...getTooltipStyle(),
          callbacks: {
            label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
              ` ${ctx.dataset.label ?? ''}: ${formatNumber(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        x: {
          type: 'time' as const,
          time: timeScale,
          ...getAxisStyle(),
          ...axisOpts(xAxis, axisTitleDefaults.x),
        },
        y: {
          beginAtZero: true,
          ...getAxisStyle(),
          ticks: { ...getAxisStyle().ticks, callback: (v: string | number) => formatNumber(Number(v)) },
          ...axisOpts(yAxis, axisTitleDefaults.y),
        },
      },
    };

    return <div className="h-full w-full"><Line ref={lineRef as never} data={chartData} options={options} plugins={lineLabelsOn ? [lineDatalabelsPlugin] : []} /></div>;
  }

  // ── Single time series (line) - only for line chart type ─────────────────
  if (chartType === 'line' && normalizedData.timeSeries && normalizedData.timeSeries.length > 0) {
    const lineColor = colors[0];
    const chartData = {
      datasets: [{
        label: 'Value',
        data: normalizedData.timeSeries.map((p) => ({ x: new Date(p.date), y: p.value })),
        borderColor: lineColor,
        backgroundColor: (context: { chart: { ctx: CanvasRenderingContext2D } }) => {
          const ctx = context.chart.ctx;
          const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.clientHeight);
          g.addColorStop(0, lineColor + '40');
          g.addColorStop(1, lineColor + '05');
          return g;
        },
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.4,
        cubicInterpolationMode: 'monotone' as const,
      }],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      ...BASE_CHART_PERF,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        lineDatalabels: { display: valueDisplay },
        legend: { display: false },
        tooltip: {
          ...getTooltipStyle(),
          callbacks: { label: (ctx: { parsed: { y: number | null } }) => ` ${formatNumber(ctx.parsed.y ?? 0)}` },
        },
      },
      scales: {
        x: {
          type: 'time' as const,
          time: timeScale,
          ...getAxisStyle(),
          ...axisOpts(xAxis, axisTitleDefaults.x),
        },
        y: {
          beginAtZero: true,
          ...getAxisStyle(),
          ticks: { ...getAxisStyle().ticks, callback: (v: string | number) => formatNumber(Number(v)) },
          ...axisOpts(yAxis, axisTitleDefaults.y),
        },
      },
    };

    return <div className="h-full w-full"><Line ref={lineRef as never} data={chartData} options={options} plugins={lineLabelsOn ? [lineDatalabelsPlugin] : []} /></div>;
  }

  // ── Grouped categorical bar charts (breakdown / hue) ─────────────────────
  if (normalizedData.groupedCategorical && chartType === 'bar') {
    const { labels, datasets } = normalizedData.groupedCategorical;

    if (labels.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          No data available
        </div>
      );
    }

    const isHorizontal = barOrientation !== 'horizontal';

    // Spread color indices across the *base* palette (5 unique shades) to maximize contrast
    const basePaletteSize = 5;
    const stride = datasets.length > 1 ? Math.max(1, Math.floor(basePaletteSize / datasets.length)) : 1;
    const datasetColors = resolveSeriesColors(
      datasets.map(ds => ds.label),
      datasets.map((_, i) => colors[(i * stride) % basePaletteSize]),
      seriesColorOverrides,
    );
    const chartData = {
      labels: labels.map((l) => {
        const f = formatBucketLabel(displayLabel(l, seriesLabelOverrides));
        return f.length > 30 ? f.substring(0, 30) + '…' : f;
      }),
      datasets: datasets.map((ds, i) => ({
        label: displayLabel(ds.label, seriesLabelOverrides),
        data: ds.values,
        backgroundColor: datasetColors[i],
        borderWidth: 0,
        borderRadius: 4,
        barPercentage: 0.75,
        categoryPercentage: 0.85,
        minBarLength: 3,
      })),
    };

    const valueAxisCfg = {
      beginAtZero: true,
      ...getAxisStyle(),
      ticks: { ...getAxisStyle().ticks, callback: (v: string | number) => formatNumber(Number(v)) },
    };
    const categoryAxisCfg = { ...getAxisStyle(), grid: { display: false }, ticks: { ...getAxisStyle().ticks, font: { size: 12 }, autoSkip: true, autoSkipPadding: 4, maxRotation: 45, minRotation: 0 } };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      ...BASE_CHART_PERF,
      ...(isHorizontal ? { indexAxis: 'y' as const } : {}),
      layout: { padding: { top: 12, bottom: 4 } },
      plugins: {
        barDatalabels: { display: valueDisplay },
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: {
            color: resolveThemeColor('--foreground'),
            font: { size: 11 },
            boxWidth: 10, boxHeight: 10, padding: 14,
            borderRadius: 2, useBorderRadius: true,
          },
        },
        tooltip: {
          ...getTooltipStyle(),
          callbacks: {
            label: isHorizontal
              ? (ctx: { dataset: { label?: string }; parsed: { x: number | null } }) => ` ${ctx.dataset.label ?? ''}: ${formatNumber(ctx.parsed.x ?? 0)}`
              : (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${ctx.dataset.label ?? ''}: ${formatNumber(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        x: { ...(isHorizontal ? valueAxisCfg : categoryAxisCfg), stacked, ...axisOpts(xAxis, axisTitleDefaults.x) },
        y: { ...(isHorizontal ? categoryAxisCfg : valueAxisCfg), stacked, ...axisOpts(yAxis, axisTitleDefaults.y) },
      },
    };

    return <div key={`bar-grouped-${barOrientation}-${stacked}`} className="h-full w-full"><Bar ref={barRef as never} data={chartData} options={options} plugins={[barDatalabelsPlugin]} /></div>;
  }

  // ── Categorical charts ────────────────────────────────────────────────────
  if (normalizedData.labels && normalizedData.values) {
    const { labels, values } = normalizedData;

    if (labels.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          No data available
        </div>
      );
    }

    // Pie / Doughnut
    if (chartType === 'doughnut' || chartType === 'pie') {
      const total = values.reduce((a, b) => a + b, 0);
      const chartColors = resolveSeriesColors(labels, colors, seriesColorOverrides);
      const cardBg = resolveThemeColor('--card');
      // Design idiom (db-charts.jsx DonutChart): the legend is a vertical list
      // beside the ring, not stacked underneath. Fall back to a bottom row only
      // for large category sets that would overflow a side rail.
      const legendPosition = labels.length <= 8 ? 'right' as const : 'bottom' as const;

      const formattedLabels = labels.map((l) => displayLabel(l, seriesLabelOverrides));
      const chartData = {
        labels: formattedLabels,
        datasets: [{
          data: values,
          backgroundColor: chartColors,
          borderWidth: 2,
          borderColor: cardBg,
          hoverBorderWidth: 3,
          spacing: 1,
        }],
      };

      const options: ChartOptions<'doughnut' | 'pie'> = {
        responsive: true,
        maintainAspectRatio: false,
        ...BASE_CHART_PERF,
        cutout: chartType === 'doughnut' ? '62%' : undefined,
        plugins: {
          legend: {
            position: legendPosition,
            labels: {
              color: resolveThemeColor('--foreground'),
              font: { size: 11 },
              padding: 10, boxWidth: 10, boxHeight: 10,
              borderRadius: 2, useBorderRadius: true,
              generateLabels: (chart: ChartJS) => {
                const dataset = chart.data.datasets[0];
                return (chart.data.labels as string[]).map((label, i) => {
                  const val = (dataset.data as number[])[i];
                  const inner = valueDisplay === 'abs'
                    ? formatNumber(val)
                    : valueDisplay === 'pct'
                      ? formatPct(val, total)
                      : `${formatNumber(val)}, ${formatPct(val, total)}`;
                  // Legend shows "name (value)" unless the legend format is
                  // 'none', in which case it's the name only.
                  const text = legendValuesOn ? `${label} (${inner})` : label;
                  return { text, fillStyle: chartColors[i % chartColors.length], strokeStyle: 'transparent', hidden: false, index: i };
                });
              },
            },
          },
          tooltip: {
            ...getTooltipStyle(),
            callbacks: {
              label: (ctx: { label: string; parsed: number }) => {
                const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
                return ` ${ctx.label}: ${formatNumber(ctx.parsed)} (${pct}%)`;
              },
            },
          },
        },
      };

      // Always carry the slice-label content on the options; the always-attached
      // sliceDatalabelsPlugin self-gates on 'none'. Setting it here (vs the typed
      // `options` literal, which rejects the custom plugin key) lets toggles take
      // effect without a remount - react-chartjs-2 reads `plugins` only at mount.
      const withSliceOpts = { ...options, plugins: { ...(options.plugins ?? {}), sliceDatalabels: { display: sliceDisplay } } };

      if (chartType === 'pie') {
        return (
          <div className="h-full w-full">
            <Pie
              ref={pieRef as never}
              data={chartData}
              options={withSliceOpts as ChartOptions<'pie'>}
              plugins={PIE_PLUGINS}
            />
          </div>
        );
      }

      return (
        <DoughnutWithCenter
          data={chartData}
          options={withSliceOpts as ChartOptions<'doughnut'>}
          total={total}
          label={centerLabel ?? 'total'}
        />
      );
    }

    // Bar (horizontal or vertical)
    const isHorizontal = barOrientation !== 'horizontal';
    const chartData = {
      labels: labels.map((l) => {
        const f = formatBucketLabel(displayLabel(l, seriesLabelOverrides));
        return f.length > 30 ? f.substring(0, 30) + '…' : f;
      }),
      datasets: [{
        label: 'Value',
        data: values,
        backgroundColor: resolveSeriesColors(labels, monoColors, seriesColorOverrides),
        borderWidth: 0,
        borderRadius: 6,
        barPercentage: 0.65,
        categoryPercentage: 0.85,
        minBarLength: 3,
      }],
    };

    const valueAxisCfg = {
      beginAtZero: true,
      ...getAxisStyle(),
      ticks: { ...getAxisStyle().ticks, callback: (v: string | number) => formatNumber(Number(v)) },
    };
    const categoryAxisCfg = { ...getAxisStyle(), grid: { display: false }, ticks: { ...getAxisStyle().ticks, font: { size: 12 }, autoSkip: true, autoSkipPadding: 4, maxRotation: 45, minRotation: 0 } };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      ...BASE_CHART_PERF,
      ...(isHorizontal ? { indexAxis: 'y' as const } : {}),
      plugins: {
        barDatalabels: { display: valueDisplay },
        legend: { display: false },
        tooltip: {
          ...getTooltipStyle(),
          callbacks: {
            label: isHorizontal
              ? (ctx: { parsed: { x: number | null } }) => ` ${formatNumber(ctx.parsed.x ?? 0)}`
              : (ctx: { parsed: { y: number | null } }) => ` ${formatNumber(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        x: { ...(isHorizontal ? valueAxisCfg : categoryAxisCfg), ...axisOpts(xAxis, axisTitleDefaults.x) },
        y: { ...(isHorizontal ? categoryAxisCfg : valueAxisCfg), ...axisOpts(yAxis, axisTitleDefaults.y) },
      },
    };

    return <div key={`bar-${barOrientation}`} className="h-full w-full"><Bar ref={barRef as never} data={chartData} options={options} plugins={[barDatalabelsPlugin]} /></div>;
  }

  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
      No data available
    </div>
  );
}

// ── Doughnut with center text ─────────────────────────────────────────────────

interface DoughnutWithCenterProps {
  data: Parameters<typeof Doughnut>[0]['data'];
  options: ChartOptions<'doughnut'>;
  total: number;
  label: string;
}

// Static plugin reads total/label from chart.options each draw so toggling
// metrics (which changes the React `label`/`total` props) updates the center
// text without depending on react-chartjs-2 re-registering plugins.
const doughnutCenterTextPlugin = {
  id: 'doughnutCenterText',
  beforeDraw(chart: ChartJS) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const cfg = (chart.options.plugins as { doughnutCenterText?: { total: number; label: string } } | undefined)?.doughnutCenterText;
    if (!cfg) return;
    ctx.save();
    const fg = resolveThemeColor('--foreground');
    const mfg = resolveThemeColor('--muted-foreground');
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatNumber(cfg.total), cx, cy - 8);
    ctx.font = '400 11px system-ui, sans-serif';
    ctx.fillStyle = mfg;
    ctx.fillText(cfg.label, cx, cy + 10);
    ctx.restore();
  },
};

// Center text + slice labels are both always attached; each self-gates on its
// own options (doughnutCenterText / sliceDatalabels). Static array identity so
// react-chartjs-2 never re-registers them.
const DOUGHNUT_PLUGINS = [doughnutCenterTextPlugin, sliceDatalabelsPlugin];

const DoughnutWithCenter = forwardRef<ChartJS<'doughnut'>, DoughnutWithCenterProps>(
  function DoughnutWithCenter({ data, options, total, label }, ref) {
    const mergedOptions = useMemo(() => ({
      ...options,
      plugins: {
        ...(options.plugins ?? {}),
        doughnutCenterText: { total, label },
      },
    }), [options, total, label]);

    return (
      <div className="h-full w-full">
        <Doughnut ref={ref as never} data={data} options={mergedOptions} plugins={DOUGHNUT_PLUGINS} />
      </div>
    );
  },
);
