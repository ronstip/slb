import { useState, useRef, useCallback } from 'react';
import { Bookmark, Download, ClipboardCopy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '../../../components/ui/card.tsx';
import { SentimentPie } from '../../studio/charts/SentimentPie.tsx';
import { SentimentBar } from '../../studio/charts/SentimentBar.tsx';
import { VolumeChart } from '../../studio/charts/VolumeChart.tsx';
import { LineChart } from '../../studio/charts/LineChart.tsx';
import { Histogram } from '../../studio/charts/Histogram.tsx';
import { ThemeBar } from '../../studio/charts/ThemeBar.tsx';
import { PlatformBar } from '../../studio/charts/PlatformBar.tsx';
import { ContentTypeDonut } from '../../studio/charts/ContentTypeDonut.tsx';
import { LanguagePie } from '../../studio/charts/LanguagePie.tsx';
import { EngagementMetrics } from '../../studio/charts/EngagementMetrics.tsx';
import { ChannelTable } from '../../studio/charts/ChannelTable.tsx';
import { EntityTable } from '../../studio/charts/EntityTable.tsx';
import { SENTIMENT_COLORS, PLATFORM_COLORS } from '../../../lib/constants.ts';
import { downloadChartPng, copyChartToClipboard } from '../../../lib/chart-export.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import type { ChartOverrides } from '../../studio/charts/chart-overrides.ts';

type ChartType =
  | 'sentiment_pie'
  | 'sentiment_bar'
  | 'volume_chart'
  | 'line_chart'
  | 'histogram'
  | 'theme_bar'
  | 'platform_bar'
  | 'content_type_donut'
  | 'language_pie'
  | 'engagement_metrics'
  | 'channel_table'
  | 'entity_table';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHART_COMPONENTS: Record<ChartType, React.ComponentType<{ data: any; overrides?: ChartOverrides }>> = {
  sentiment_pie: SentimentPie,
  sentiment_bar: SentimentBar,
  volume_chart: VolumeChart,
  line_chart: LineChart,
  histogram: Histogram,
  theme_bar: ThemeBar,
  platform_bar: PlatformBar,
  content_type_donut: ContentTypeDonut,
  language_pie: LanguagePie,
  engagement_metrics: EngagementMetrics,
  channel_table: ChannelTable,
  entity_table: EntityTable,
};

/* ------------------------------------------------------------------ */
/* Customization schema per chart type                                 */
/* ------------------------------------------------------------------ */

interface ChartCustomization {
  colorKeys: (data: unknown[]) => string[];
  defaultColors: Record<string, string>;
  supportsValues: boolean;
}

const CHART_CUSTOMIZATIONS: Partial<Record<ChartType, ChartCustomization>> = {
  sentiment_pie: {
    colorKeys: (d) => d.map((e: any) => e.sentiment),
    defaultColors: SENTIMENT_COLORS,
    supportsValues: true,
  },
  sentiment_bar: {
    colorKeys: (d) => d.map((e: any) => e.sentiment),
    defaultColors: SENTIMENT_COLORS,
    supportsValues: true,
  },
  platform_bar: {
    colorKeys: (d) => d.map((e: any) => e.platform),
    defaultColors: PLATFORM_COLORS,
    supportsValues: true,
  },
  content_type_donut: {
    colorKeys: (d) => d.map((e: any) => e.content_type),
    defaultColors: {},
    supportsValues: true,
  },
  language_pie: {
    colorKeys: (d) => d.map((e: any) => e.language),
    defaultColors: {},
    supportsValues: true,
  },
  theme_bar: {
    colorKeys: () => ['bar'],
    defaultColors: { bar: '#6B8CAE' },
    supportsValues: true,
  },
  line_chart: {
    colorKeys: () => ['line'],
    defaultColors: { line: '#5A7A9E' },
    supportsValues: false,
  },
  histogram: {
    colorKeys: () => ['bar'],
    defaultColors: { bar: '#6B8CAE' },
    supportsValues: true,
  },
};

const COLOR_PRESETS = [
  '#5A9E7E', '#C07070', '#6A9AB8', '#B89A5A',
  '#A8677A', '#57534E', '#7C3AED', '#0891B2',
  '#E07850', '#4A90D9', '#D4A373', '#6D9DC5',
  '#B56576', '#80B192', '#E6B566', '#8B5CF6',
];

/* ------------------------------------------------------------------ */
/* ChartCard component                                                 */
/* ------------------------------------------------------------------ */

interface ChartCardProps {
  data: Record<string, unknown>;
}

export function ChartCard({ data }: ChartCardProps) {
  const chartType = data.chart_type as ChartType;
  const chartData = data.data as unknown[];
  const originalTitle = (data.title as string) || 'Chart';

  const [title, setTitle] = useState(originalTitle);
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState(true);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [activeColorKey, setActiveColorKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const ChartComponent = CHART_COMPONENTS[chartType];
  if (!ChartComponent || !chartData) return null;

  const customization = CHART_CUSTOMIZATIONS[chartType];
  const overrides: ChartOverrides = { colorOverrides, showValues };

  const handleDownload = useCallback(async () => {
    if (!exportRef.current) return;
    await downloadChartPng(exportRef.current, title.replace(/\s+/g, '_').toLowerCase());
  }, [title]);

  const handleCopy = useCallback(async () => {
    if (!exportRef.current) return;
    await copyChartToClipboard(exportRef.current);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const handleSave = useCallback(() => {
    useStudioStore.getState().addArtifact({
      id: `chart-${Date.now()}`,
      type: 'chart',
      title,
      chartType,
      data: chartData,
      colorOverrides: Object.keys(colorOverrides).length > 0 ? colorOverrides : undefined,
      createdAt: new Date(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [title, chartType, chartData, colorOverrides]);

  const colorKeys = customization?.colorKeys(chartData) ?? [];
  const getCurrentColor = (key: string, index: number) => {
    if (colorOverrides[key]) return colorOverrides[key];
    if (customization?.defaultColors[key]) return customization.defaultColors[key];
    // Fallback for charts without named defaults (content_type, language)
    const fallbacks = ['#6B7B9E', '#7BA589', '#B89A6A', '#A87878', '#8E8E93', '#A8788C', '#6A9AB8'];
    return fallbacks[index % fallbacks.length];
  };

  return (
    <Card className="mt-3 rounded-md" ref={chartRef}>
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-0.5 px-4 pt-2">
        <button
          onClick={handleSave}
          className="rounded p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          title="Save as artifact"
        >
          {saved ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Bookmark className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleDownload}
          className="rounded p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          title="Download as PNG"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleCopy}
          className="rounded p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          title="Copy to clipboard"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Export area: title + chart (this is what gets exported as PNG) */}
      <div ref={exportRef} className="px-4 pb-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-1 w-full bg-transparent text-xs font-medium uppercase tracking-wider text-muted-foreground outline-none focus:text-foreground focus:border-b focus:border-primary/30"
          title="Click to edit title"
        />
        <ChartComponent data={chartData} overrides={overrides} />
      </div>

      {/* Customize panel */}
      {customization && (
        <div className="border-t border-border/30">
          <button
            onClick={() => setCustomizeOpen(!customizeOpen)}
            className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          >
            {customizeOpen
              ? <ChevronDown className="h-2.5 w-2.5" />
              : <ChevronRight className="h-2.5 w-2.5" />}
            Customize
          </button>

          {customizeOpen && (
            <div className="space-y-3 px-4 pb-3">
              {/* Color pickers */}
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Colors
                </span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {colorKeys.map((key, i) => (
                    <ColorPicker
                      key={key}
                      label={key}
                      color={getCurrentColor(key, i)}
                      onChange={(color) => {
                        setColorOverrides((prev) => ({ ...prev, [key]: color }));
                        setActiveColorKey(null);
                      }}
                      active={activeColorKey === key}
                      onToggle={() => setActiveColorKey(activeColorKey === key ? null : key)}
                    />
                  ))}
                </div>
                {/* Inline swatch palette */}
                {activeColorKey !== null && (
                  <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-border/40 bg-muted/30 p-2">
                    {COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        onClick={() => {
                          setColorOverrides((prev) => ({ ...prev, [activeColorKey]: preset }));
                          setActiveColorKey(null);
                        }}
                        className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${
                          preset === getCurrentColor(activeColorKey, colorKeys.indexOf(activeColorKey))
                            ? 'border-foreground'
                            : 'border-transparent'
                        }`}
                        style={{ backgroundColor: preset }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Show values toggle */}
              {customization.supportsValues && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    Show values
                  </span>
                  <button
                    onClick={() => setShowValues(!showValues)}
                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                      showValues ? 'bg-primary' : 'bg-muted-foreground/20'
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                        showValues ? 'translate-x-3.5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Color picker — inline swatch selector                              */
/* ------------------------------------------------------------------ */

function ColorPicker({
  label,
  color,
  onChange,
  active,
  onToggle,
}: {
  label: string;
  color: string;
  onChange: (color: string) => void;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-border ${
        active ? 'border-primary/50 bg-primary/5 text-foreground' : 'border-border/40'
      }`}
    >
      <div className="h-3 w-3 rounded-full border border-border/30" style={{ backgroundColor: color }} />
      <span className="max-w-[60px] truncate capitalize">{label}</span>
    </button>
  );
}
