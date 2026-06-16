import { RotateCcw } from 'lucide-react';
import { Label } from '../../../../components/ui/label.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { cn } from '../../../../lib/utils.ts';
import type { ChartStyleOverrides } from '../../../../stores/studio-store.ts';
import type { SocialChartType, TableColumnDisplay } from '../types-social-dashboard.ts';
import { resolveLabelDisplay } from '../chart-label-format.ts';
import { SENTIMENT_COLORS } from '../../../../lib/constants.ts';
import { generateChartPalette } from '../../../../lib/accent-colors.ts';
import { useTheme } from '../../../../components/theme-provider.tsx';

const PRESET_COLORS = [
  '#4A7C8F', '#2B5066', '#5A7FA0', '#6B3040', '#9E4A5A',
  '#9A7B3C', '#3E6B52', '#4A5568', '#8B6040', '#6B4A6E',
];

/** Chart types that draw numeric value labels and so expose the format toggle. */
const VALUE_LABEL_CHART_TYPES: SocialChartType[] = ['bar', 'line', 'pie', 'doughnut'];

const VALUE_LABEL_OPTIONS: Array<{ value: TableColumnDisplay; label: string }> = [
  { value: 'abs',     label: 'Number'  },
  { value: 'pct',     label: 'Percent' },
  { value: 'abs_pct', label: 'Both'    },
  { value: 'none',    label: 'None'    },
];

/** Word-cloud size multipliers (applied on top of the adaptive range). */
const WORD_CLOUD_SIZE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0.7, label: 'Small'  },
  { value: 1,   label: 'Medium' },
  { value: 1.4, label: 'Large'  },
];

interface ChartStyleEditorProps {
  /** Series labels in render order - drives the per-series rows. */
  seriesLabels: string[];
  /** The widget's chart type - gates the value-label format toggle and its
   *  effective default (pie/doughnut = percent, others = number). */
  chartType: SocialChartType;
  /** Current overrides (controlled). */
  value: ChartStyleOverrides;
  onChange: (next: ChartStyleOverrides) => void;
  /** Default donut center label (the active metric's label) - shown as the
   *  placeholder when no custom center label is set. Doughnut only. */
  centerLabelDefault?: string;
}

/** Compute the default color a label *would* render with given the
 *  current accent - same precedence as resolveSeriesColors but without
 *  the user override, so we can show users what they're overriding. */
function computeDefaultColor(
  label: string,
  index: number,
  palette: string[],
): string {
  const key = label.toLowerCase();
  if (key in SENTIMENT_COLORS) return SENTIMENT_COLORS[key];
  return palette[index % palette.length];
}

export function ChartStyleEditor({ seriesLabels, chartType, value, onChange, centerLabelDefault }: ChartStyleEditorProps) {
  const { accentColor: appAccent, theme } = useTheme();
  const themeIsDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const effectiveAccent = value.accent ?? appAccent;
  const palette = generateChartPalette(effectiveAccent, themeIsDark);

  const setAccent = (accent: string | undefined) =>
    onChange({ ...value, accent });

  const setLabelDisplay = (labelDisplay: TableColumnDisplay) =>
    onChange({ ...value, labelDisplay });

  const setCenterLabel = (centerLabel: string) =>
    onChange({ ...value, centerLabel: centerLabel.trim() === '' ? undefined : centerLabel });

  const setWordCloudScale = (wordCloudScale: number) =>
    onChange({ ...value, wordCloudScale: wordCloudScale === 1 ? undefined : wordCloudScale });

  const isWordCloud = chartType === 'word-cloud';
  const activeWordCloudScale = value.wordCloudScale ?? 1;

  // Whether to offer the value-label format toggle, and which option reads as
  // active. Line charts draw labels only once a format is chosen, so an unset
  // line shows no option selected (i.e. labels off); bar/pie reflect their
  // historical default.
  const showValueLabels = VALUE_LABEL_CHART_TYPES.includes(chartType);
  const activeDisplay: TableColumnDisplay | undefined = value.labelDisplay
    ?? (chartType === 'line' ? undefined : resolveLabelDisplay(chartType, undefined));

  const setSeriesColor = (label: string, color: string | undefined) => {
    const next = { ...(value.seriesColors ?? {}) };
    if (color === undefined) delete next[label];
    else next[label] = color;
    onChange({
      ...value,
      seriesColors: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  const setSeriesLabel = (label: string, name: string | undefined) => {
    const next = { ...(value.seriesLabels ?? {}) };
    if (name === undefined || name.trim() === '') delete next[label];
    else next[label] = name;
    onChange({
      ...value,
      seriesLabels: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Accent (palette base) */}
      <div className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Accent Color
        </Label>
        <p className="text-xs text-muted-foreground/80">
          Base color for the auto-generated palette. Per-series overrides below take precedence.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setAccent(color)}
              className={cn(
                'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                value.accent === color ? 'border-foreground scale-110' : 'border-transparent',
              )}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
          <button
            type="button"
            onClick={() => setAccent(undefined)}
            className={cn(
              'h-7 w-7 rounded-full border-2 text-[10px] font-medium text-muted-foreground transition-all hover:scale-110',
              !value.accent ? 'border-foreground scale-110 bg-muted' : 'border-dashed border-border bg-muted/50',
            )}
            title="Auto (theme accent)"
          >
            A
          </button>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <div
            className="h-7 w-7 shrink-0 rounded-md border border-border"
            style={{ backgroundColor: effectiveAccent }}
          />
          <Input
            type="color"
            className="h-7 w-14 cursor-pointer p-0.5"
            value={value.accent ?? effectiveAccent}
            onChange={(e) => setAccent(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">Custom hex</span>
        </div>
      </div>

      {/* Word-cloud size (multiplier on the adaptive, container-driven range) */}
      {isWordCloud && (
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Size
          </Label>
          <p className="text-xs text-muted-foreground/80">
            Words scale to fit the widget automatically. Nudge the overall size up or down.
          </p>
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {WORD_CLOUD_SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setWordCloudScale(opt.value)}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs font-medium transition-all',
                  activeWordCloudScale === opt.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Value-label format (number / percent / both) */}
      {showValueLabels && (
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Value Labels
          </Label>
          <p className="text-xs text-muted-foreground/80">
            {chartType === 'pie' || chartType === 'doughnut'
              ? 'Show each slice as its absolute number, percent of the total shown, or both (in the legend).'
              : chartType === 'line'
                ? 'Label data points with the absolute number, percent of the total shown, or both. Off until you pick one.'
                : 'Label bars with the absolute number, percent of the total shown, or both.'}
          </p>
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {VALUE_LABEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLabelDisplay(opt.value)}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs font-medium transition-all',
                  activeDisplay === opt.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Donut center label (text above the KPI number) */}
      {chartType === 'doughnut' && (
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Center Label
          </Label>
          <p className="text-xs text-muted-foreground/80">
            Text shown inside the donut, above the total. Leave blank to use the metric name.
          </p>
          <Input
            type="text"
            value={value.centerLabel ?? ''}
            placeholder={centerLabelDefault ?? 'Total'}
            onChange={(e) => setCenterLabel(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      )}

      {/* Per-series overrides */}
      {seriesLabels.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Series
          </Label>
          <p className="text-xs text-muted-foreground/80">
            Change the color and display name for each value. Renames apply to legends, axes, tooltips, and tables.
          </p>
          <div className="space-y-1.5">
            {seriesLabels.map((label, i) => {
              const colorOverride = value.seriesColors?.[label];
              const fallback = computeDefaultColor(label, i, palette);
              const currentColor = colorOverride ?? fallback;
              const nameOverride = value.seriesLabels?.[label] ?? '';
              const hasOverride = colorOverride !== undefined || nameOverride !== '';
              return (
                <div key={label} className="flex items-center gap-2">
                  <Input
                    type="color"
                    className="h-7 w-10 shrink-0 cursor-pointer p-0.5"
                    value={currentColor}
                    onChange={(e) => setSeriesColor(label, e.target.value)}
                  />
                  <Input
                    type="text"
                    value={nameOverride}
                    placeholder={label}
                    onChange={(e) => setSeriesLabel(label, e.target.value)}
                    className="h-7 flex-1 min-w-0 text-xs"
                    title={`Raw: ${label}`}
                  />
                  {hasOverride ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSeriesColor(label, undefined);
                        setSeriesLabel(label, undefined);
                      }}
                      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Reset to default"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">auto</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
