import { useState, useRef, useCallback } from 'react';
import { ArrowLeft, Download, ChevronDown, ChevronRight, Table2 } from 'lucide-react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { SentimentPie } from './charts/SentimentPie.tsx';
import { SentimentBar } from './charts/SentimentBar.tsx';
import { VolumeChart } from './charts/VolumeChart.tsx';
import { LineChart } from './charts/LineChart.tsx';
import { Histogram } from './charts/Histogram.tsx';
import { ThemeBar } from './charts/ThemeBar.tsx';
import { PlatformBar } from './charts/PlatformBar.tsx';
import { ContentTypeDonut } from './charts/ContentTypeDonut.tsx';
import { LanguagePie } from './charts/LanguagePie.tsx';
import { EngagementMetrics } from './charts/EngagementMetrics.tsx';
import { ChannelTable } from './charts/ChannelTable.tsx';
import { EntityTable } from './charts/EntityTable.tsx';
import { SENTIMENT_COLORS, PLATFORM_COLORS } from '../../lib/constants.ts';
import { downloadChartPng } from '../../lib/chart-export.ts';
import type { ChartOverrides } from './charts/chart-overrides.ts';
import { UnderlyingDataDialog, type UnderlyingDataFallback } from './UnderlyingDataDialog.tsx';

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
  | 'entity_table'
  | 'value_count';

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
  value_count: Histogram,
};

interface ChartCustomization {
  colorKeys: (data: unknown[]) => string[];
  defaultColors: Record<string, string>;
  supportsValues: boolean;
}

const CHART_CUSTOMIZATIONS: Partial<Record<ChartType, ChartCustomization>> = {
  sentiment_pie: {
    colorKeys: (d) => (d as any[]).map((e) => e.sentiment),
    defaultColors: SENTIMENT_COLORS,
    supportsValues: true,
  },
  sentiment_bar: {
    colorKeys: (d) => (d as any[]).map((e) => e.sentiment),
    defaultColors: SENTIMENT_COLORS,
    supportsValues: true,
  },
  platform_bar: {
    colorKeys: (d) => (d as any[]).map((e) => e.platform),
    defaultColors: PLATFORM_COLORS,
    supportsValues: true,
  },
  content_type_donut: {
    colorKeys: (d) => (d as any[]).map((e) => e.content_type),
    defaultColors: {},
    supportsValues: true,
  },
  language_pie: {
    colorKeys: (d) => (d as any[]).map((e) => e.language),
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
  value_count: {
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

interface ChartArtifactViewProps {
  artifact: Extract<Artifact, { type: 'chart' }>;
}

export function ChartArtifactView({ artifact }: ChartArtifactViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);

  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>(
    artifact.colorOverrides ?? {},
  );
  const [showValues, setShowValues] = useState(true);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [activeColorKey, setActiveColorKey] = useState<string | null>(null);
  const [showUnderlyingData, setShowUnderlyingData] = useState(false);

  const exportRef = useRef<HTMLDivElement>(null);

  const chartType = artifact.chartType as ChartType;
  const ChartComponent = CHART_COMPONENTS[chartType];
  const customization = CHART_CUSTOMIZATIONS[chartType];
  const overrides: ChartOverrides = { colorOverrides, showValues };

  const handleDownload = useCallback(async () => {
    if (!exportRef.current) return;
    await downloadChartPng(exportRef.current, artifact.title.replace(/\s+/g, '_').toLowerCase());
  }, [artifact.title]);

  const getCurrentColor = (key: string, index: number) => {
    if (colorOverrides[key]) return colorOverrides[key];
    if (customization?.defaultColors[key]) return customization.defaultColors[key];
    const fallbacks = ['#6B7B9E', '#7BA589', '#B89A6A', '#A87878', '#8E8E93', '#A8788C', '#6A9AB8'];
    return fallbacks[index % fallbacks.length];
  };

  if (!ChartComponent) return null;

  const colorKeys = customization?.colorKeys(artifact.data) ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <div className="shrink-0 flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
        <button
          onClick={collapseReport}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </button>
        <div className="flex items-center gap-1.5">
          {(artifact.collectionIds?.length ?? 0) > 0 && (
            <button
              onClick={() => setShowUnderlyingData(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <Table2 className="h-3.5 w-3.5" />
              Data
            </button>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Download PNG
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div ref={exportRef} className="px-4 pb-2 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {artifact.title}
        </p>
        <ChartComponent data={artifact.data} overrides={overrides} />
      </div>

      {/* Customize panel */}
      {customization && (
        <div className="border-t border-border/30 mx-4">
          <button
            onClick={() => setCustomizeOpen(!customizeOpen)}
            className="flex w-full items-center gap-1.5 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          >
            {customizeOpen
              ? <ChevronDown className="h-2.5 w-2.5" />
              : <ChevronRight className="h-2.5 w-2.5" />}
            Customize
          </button>

          {customizeOpen && (
            <div className="space-y-3 pb-4">
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
                      showValues ? 'bg-foreground' : 'bg-muted-foreground/20'
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
      </div>
      <UnderlyingDataDialog
        artifactId={showUnderlyingData ? artifact.id : null}
        fallback={artifact.collectionIds?.length ? {
          collectionIds: artifact.collectionIds,
          createdAt: artifact.createdAt.toISOString(),
          filterSql: artifact.filterSql,
          sourceSql: artifact.sourceSql,
        } as UnderlyingDataFallback : undefined}
        onClose={() => setShowUnderlyingData(false)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Color picker — inline swatch selector                              */
/* ------------------------------------------------------------------ */

function ColorPicker({
  label,
  color,
  onChange: _onChange,
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
        active ? 'border-foreground/30 bg-foreground/5 text-foreground' : 'border-border/40'
      }`}
    >
      <div className="h-3 w-3 rounded-full border border-border/30" style={{ backgroundColor: color }} />
      <span className="max-w-[60px] truncate capitalize">{label}</span>
    </button>
  );
}
