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
import type { SocialChartType, WidgetData } from './types-social-dashboard.ts';
import { useTheme } from '../../../components/theme-provider.tsx';
import { generateChartPalette } from '../../../lib/accent-colors.ts';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';

/** Resolve colors for a set of labels — uses semantic colors for sentiment, accent palette otherwise. */
function resolveSeriesColors(labels: string[], accentColors: string[]): string[] {
  return labels.map((l, i) => {
    const key = l.toLowerCase();
    return key in SENTIMENT_COLORS ? SENTIMENT_COLORS[key] : accentColors[i % accentColors.length];
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
  // Already mixed-case or contains spaces — assume curated, leave alone.
  if (/\s/.test(raw) || /[a-z][A-Z]/.test(raw)) return raw;
  return raw
    .replace(/_/g, '-')
    .split('-')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part)
    .join('-');
}

// ── Datalabel plugins ─────────────────────────────────────────────────────────

type ArcGetProps = (
  p: ['x', 'y', 'startAngle', 'endAngle', 'innerRadius', 'outerRadius'],
  a: boolean,
) => { x: number; y: number; startAngle: number; endAngle: number; innerRadius: number; outerRadius: number };

type BarGetProps = (
  p: ['x', 'y', 'base'],
  a: boolean,
) => { x: number; y: number; base: number };

const pieDatalabelsPlugin = {
  id: 'pieDatalabels',
  afterDatasetsDraw(chart: ChartJS) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const values = chart.data.datasets[0]?.data as number[] | undefined;
    if (!values?.length) return;
    const total = values.reduce((a, b) => a + (b || 0), 0);
    if (total === 0) return;

    ctx.save();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 3;

    meta.data.forEach((arc, i) => {
      const val = values[i];
      if (!val) return;
      const pct = (val / total) * 100;
      if (pct < 5) return;
      const props = (arc as unknown as { getProps: ArcGetProps }).getProps(
        ['x', 'y', 'startAngle', 'endAngle', 'innerRadius', 'outerRadius'],
        true,
      );
      const angle = (props.startAngle + props.endAngle) / 2;
      const radius = (props.innerRadius + props.outerRadius) / 2;
      const x = props.x + Math.cos(angle) * radius;
      const y = props.y + Math.sin(angle) * radius;
      ctx.fillText(`${pct.toFixed(0)}%`, x, y);
    });
    ctx.restore();
  },
};

const barDatalabelsPlugin = {
  id: 'barDatalabels',
  afterDatasetsDraw(chart: ChartJS) {
    const { ctx } = chart;
    const isHorizontalBar = chart.options.indexAxis === 'y';
    const scales = chart.options.scales as
      | { x?: { stacked?: boolean }; y?: { stacked?: boolean } }
      | undefined;
    const isStacked = !!(scales?.x?.stacked || scales?.y?.stacked);
    const multiDataset = chart.data.datasets.length > 1;
    const fg = resolveThemeColor('--foreground');

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
          ctx.fillText(formatNumber(val), cx, cy);
        } else {
          ctx.fillStyle = fg;
          if (isHorizontalBar) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(formatNumber(val), props.x + 4, props.y);
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(formatNumber(val), props.x, props.y - 4);
          }
        }
        ctx.restore();
      });
    });
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface SocialChartWidgetProps {
  chartType: SocialChartType;
  data: WidgetData | undefined;
  accent?: string;
  barOrientation?: 'horizontal' | 'vertical';
  stacked?: boolean;
}

export function SocialChartWidget({ chartType, data, accent, barOrientation = 'horizontal', stacked = true }: SocialChartWidgetProps) {
  const { accentColor, theme } = useTheme();
  const themeIsDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const colors = useMemo(() => {
    // Per-widget accent override → monochromatic shades of that accent
    if (accent) return getAccentColors(accent, 15);
    // Default → derive from the app's accent color (monochromatic)
    const basePalette = generateChartPalette(accentColor, themeIsDark);
    // Extend the 5-color palette to 15 by cycling with slight alpha variation
    return Array.from({ length: 15 }, (_, i) => basePalette[i % basePalette.length]);
  }, [accent, accentColor, themeIsDark]);

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

  // ── Grouped time series (multi-line) — only for line chart type ──────────
  if (chartType === 'line' && normalizedData.groupedTimeSeries && Object.keys(normalizedData.groupedTimeSeries).length > 0) {
    const groups = Object.entries(normalizedData.groupedTimeSeries)
      .sort(([, a], [, b]) => (b[b.length - 1]?.value ?? 0) - (a[a.length - 1]?.value ?? 0))
      .slice(0, 10);

    const seriesColors = resolveSeriesColors(groups.map(([n]) => n), colors);
    const chartData = {
      datasets: groups.map(([name, series], i) => ({
        label: name,
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
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
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
          time: { unit: 'day' as const, displayFormats: { day: 'MMM d', month: 'MMM yyyy' }, tooltipFormat: 'MMM d, yyyy' },
          ...getAxisStyle(),
        },
        y: {
          beginAtZero: true,
          ...getAxisStyle(),
          ticks: { ...getAxisStyle().ticks, callback: (v: string | number) => formatNumber(Number(v)) },
        },
      },
    };

    return <div className="h-full w-full"><Line ref={lineRef as never} data={chartData} options={options} /></div>;
  }

  // ── Single time series (line) — only for line chart type ─────────────────
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
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...getTooltipStyle(),
          callbacks: { label: (ctx: { parsed: { y: number | null } }) => ` ${formatNumber(ctx.parsed.y ?? 0)}` },
        },
      },
      scales: {
        x: {
          type: 'time' as const,
          time: { unit: 'day' as const, displayFormats: { day: 'MMM d', month: 'MMM yyyy' }, tooltipFormat: 'MMM d, yyyy' },
          ...getAxisStyle(),
        },
        y: {
          beginAtZero: true,
          ...getAxisStyle(),
          ticks: { ...getAxisStyle().ticks, callback: (v: string | number) => formatNumber(Number(v)) },
        },
      },
    };

    return <div className="h-full w-full"><Line ref={lineRef as never} data={chartData} options={options} /></div>;
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
    );
    const chartData = {
      labels: labels.map((l) => {
        const f = formatLabel(l);
        return f.length > 30 ? f.substring(0, 30) + '…' : f;
      }),
      datasets: datasets.map((ds, i) => ({
        label: formatLabel(ds.label),
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
    const categoryAxisCfg = { ...getAxisStyle(), grid: { display: false }, ticks: { ...getAxisStyle().ticks, font: { size: 12 } } };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      ...(isHorizontal ? { indexAxis: 'y' as const } : {}),
      layout: { padding: { top: 12, bottom: 4 } },
      plugins: {
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
        x: { ...(isHorizontal ? valueAxisCfg : categoryAxisCfg), stacked },
        y: { ...(isHorizontal ? categoryAxisCfg : valueAxisCfg), stacked },
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
      const chartColors = resolveSeriesColors(labels, colors);
      const cardBg = resolveThemeColor('--card');
      const legendPosition = labels.length <= 6 ? 'bottom' as const : 'right' as const;

      const formattedLabels = labels.map(formatLabel);
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
        cutout: chartType === 'doughnut' ? '70%' : undefined,
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
                  const pct = total > 0 ? ((val / total) * 100).toFixed(0) : '0';
                  return { text: `${label} (${pct}%)`, fillStyle: chartColors[i % chartColors.length], strokeStyle: 'transparent', hidden: false, index: i };
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

      if (chartType === 'pie') {
        return <div className="h-full w-full"><Pie ref={pieRef as never} data={chartData} options={options as ChartOptions<'pie'>} plugins={[pieDatalabelsPlugin]} /></div>;
      }

      return (
        <DoughnutWithCenter
          data={chartData}
          options={options as ChartOptions<'doughnut'>}
          total={total}
        />
      );
    }

    // Bar (horizontal or vertical)
    const isHorizontal = barOrientation !== 'horizontal';
    const chartData = {
      labels: labels.map((l) => {
        const f = formatLabel(l);
        return f.length > 30 ? f.substring(0, 30) + '…' : f;
      }),
      datasets: [{
        label: 'Value',
        data: values,
        backgroundColor: resolveSeriesColors(labels, colors),
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
    const categoryAxisCfg = { ...getAxisStyle(), grid: { display: false }, ticks: { ...getAxisStyle().ticks, font: { size: 12 } } };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      ...(isHorizontal ? { indexAxis: 'y' as const } : {}),
      plugins: {
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
        x: isHorizontal ? valueAxisCfg : categoryAxisCfg,
        y: isHorizontal ? categoryAxisCfg : valueAxisCfg,
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
}

const DoughnutWithCenter = forwardRef<ChartJS<'doughnut'>, DoughnutWithCenterProps>(
  function DoughnutWithCenter({ data, options, total }, ref) {
    const plugins = useMemo(() => [
      {
        id: 'doughnutCenterText',
        beforeDraw(chart: ChartJS) {
          const { ctx, chartArea } = chart;
          if (!chartArea) return;
          ctx.save();
          const fg = resolveThemeColor('--foreground');
          const mfg = resolveThemeColor('--muted-foreground');
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top + chartArea.bottom) / 2;
          ctx.font = 'bold 20px system-ui, sans-serif';
          ctx.fillStyle = fg;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(formatNumber(total), cx, cy - 8);
          ctx.font = '400 11px system-ui, sans-serif';
          ctx.fillStyle = mfg;
          ctx.fillText('total', cx, cy + 10);
          ctx.restore();
        },
      },
      pieDatalabelsPlugin,
    ], [total]);

    return (
      <div className="h-full w-full">
        <Doughnut ref={ref as never} data={data} options={options} plugins={plugins} />
      </div>
    );
  },
);
