import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../../components/ui/dialog.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Textarea } from '../../../../components/ui/textarea.tsx';
import { Label } from '../../../../components/ui/label.tsx';
import { Separator } from '../../../../components/ui/separator.tsx';
import {
  BarChart3, TrendingUp, PieChart, Circle, Hash, Cloud, List, Table2, Grid3x3,
  Database, Filter, Palette, GripHorizontal, Upload, Link as LinkIcon,
  Eye, EyeOff, LayoutGrid, GalleryHorizontalEnd, ImageOff, Library,
} from 'lucide-react';
import { Switch } from '../../../../components/ui/switch.tsx';
import { apiUploadFile } from '../../../../api/client.ts';
import type { SocialMediaConfig } from '../types-social-dashboard.ts';

const MarkdownArtifactEditor = lazy(() =>
  import('../../MarkdownArtifactEditor.tsx').then((m) => ({ default: m.MarkdownArtifactEditor })),
);
import { cn } from '../../../../lib/utils.ts';
import type { CustomFieldDef, DashboardPost, TopicMetric } from '../../../../api/types.ts';
import type { SocialDashboardWidget, SocialChartType, CustomChartConfig, ChartStyleOverrides, CustomTableConfig, NumberSize, DataSource, CustomMetric, CustomDimension, TimeBucket, TopValuePart, ComputedField, SocialEmbedConfig, EmbedSource, EmbedRankMetric, EmbedSpeed } from '../types-social-dashboard.ts';
import { getValidChartTypesForCustom, presetToCustomConfig, METRIC_META, TOPIC_METRIC_META, TOPIC_DIMENSION_META, getDimensionMeta, getTopicDimensionMeta, defaultTableConfigFor, defaultTopicTableConfig, NUMBER_SIZE_GRID, isDimensionColumn, normalizeTableConfig, objectFieldOf, objectFieldOfTable, defaultAxisTitles, EMBED_RANK_LABELS, DEFAULT_EMBED_RANK, DEFAULT_EMBED_COUNT, MAX_EMBED_COUNT } from '../types-social-dashboard.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import { PlatformIcon } from '../../../../components/PlatformIcon.tsx';
import { formatNumber } from '../../../../lib/format.ts';
import { embedCandidatePosts, embedPostThumbnail, embedPostMetricValue, embedHandle } from '../embed-posts.ts';
import type { FilterOptions } from '../use-dashboard-filters.ts';
import { DataSourceForm } from './DataSourceForm.tsx';
import { TableDataForm } from './TableDataForm.tsx';
import { WidgetFilterForm } from './WidgetFilterForm.tsx';
import { WidgetStyleForm } from './WidgetStyleForm.tsx';
import { ChartStyleEditor } from './ChartStyleEditor.tsx';
import { widgetContainerVisible } from '../widget-container.ts';
import { aggregateCustom, aggregatePlatforms, aggregateSentiment, aggregateTable, aggregateThemeCloud } from '../dashboard-aggregations.ts';
import { aggregateObjectList, aggregateObjectTable } from '../object-list-aggregations.ts';
import { aggregateTopicsCustom, aggregateTopicsTable } from '../topic-aggregations.ts';
import { extractChartSeriesLabels } from '../chart-series-labels.ts';
import { SocialWidgetRenderer, applyWidgetFilters, applyWidgetValueFilters, tablePrimaryDimension } from '../SocialWidgetRenderer.tsx';
import { composeWidgetField, type WidgetDataSummary } from '../../../../api/endpoints/dashboard.ts';

// ── Chart type metadata ────────────────────────────────────────────────────────

const ALL_CHART_TYPES: Array<{ type: SocialChartType; label: string; icon: React.ElementType }> = [
  { type: 'number-card',   label: 'Number',  icon: Hash },
  { type: 'bar',           label: 'Bar',     icon: BarChart3 },
  { type: 'line',          label: 'Line',    icon: TrendingUp },
  { type: 'doughnut',      label: 'Donut',   icon: Circle },
  { type: 'pie',           label: 'Pie',     icon: PieChart },
  { type: 'progress-list', label: 'List',    icon: List },
  { type: 'word-cloud',    label: 'Cloud',   icon: Cloud },
  { type: 'heatmap',       label: 'Heatmap', icon: Grid3x3 },
  { type: 'table',         label: 'Table',   icon: Table2 },
];

/** Chart types unavailable for topic widgets in phase 1. topic_metrics is a
 *  snapshot - no time series (so `line`) and no breakdown axis (so `heatmap`). */
const TOPIC_DISABLED_CHART_TYPES: ReadonlySet<SocialChartType> = new Set(['line', 'heatmap']);

/** Preset accent swatches for table styling (mirrors the chart style palette). */
const TABLE_ACCENT_COLORS = [
  '#4A7C8F', '#2B5066', '#6B3040', '#9A7B3C', '#3E6B52', '#6B4A6E',
];

// ── Container visibility toggle ─────────────────────────────────────────────────
// Controls whether the widget renders its card chrome (surface + border +
// shadow) or floats transparently on the page. Shown in every widget's config
// (text/media/embed panels + the chart/table/kpi Style tab). The displayed
// state reflects the effective default until the user sets it explicitly.

function ContainerToggle({
  draft,
  onChange,
}: {
  draft: SocialDashboardWidget;
  onChange: (show: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-xs">Container</Label>
        <p className="text-[11px] text-muted-foreground">
          Show the card background, border and shadow.
        </p>
      </div>
      <Switch
        checked={widgetContainerVisible(draft)}
        onCheckedChange={onChange}
      />
    </div>
  );
}

// ── Widget visibility toggle ─────────────────────────────────────────────────
// Hidden widgets stay in the layout and the editor (rendered dimmed with a
// badge) but are excluded from view mode, shared dashboards and PDF export.
// Turning visibility back on writes `undefined` rather than `false` so legacy
// widget docs stay byte-stable (the API serializes with exclude_none).

function VisibilityToggle({
  draft,
  onChange,
}: {
  draft: SocialDashboardWidget;
  onChange: (visible: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-xs">Visible</Label>
        <p className="text-[11px] text-muted-foreground">
          Hidden widgets stay in edit mode but are excluded from view mode and shared links.
        </p>
      </div>
      <Switch
        checked={draft.hidden !== true}
        onCheckedChange={onChange}
      />
    </div>
  );
}

// ── Scolto watermark toggle ──────────────────────────────────────────────────
// Off by default. When on, the renderer overlays the Scolto mark + wordmark in
// the widget's top-right corner (editor preview, view mode, shared/Brief).

function WatermarkToggle({
  draft,
  onChange,
}: {
  draft: SocialDashboardWidget;
  onChange: (show: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-xs">Scolto watermark</Label>
        <p className="text-[11px] text-muted-foreground">
          Overlay the Scolto logo in the top-right corner.
        </p>
      </div>
      <Switch
        checked={draft.showWatermark === true}
        onCheckedChange={(on) => onChange(on)}
      />
    </div>
  );
}

// ── Public wrapper ─────────────────────────────────────────────────────────────

interface SocialWidgetConfigDialogProps {
  open: boolean;
  widget: SocialDashboardWidget | null;
  mode?: 'add' | 'edit';
  allPosts: DashboardPost[];
  filteredPosts: DashboardPost[];
  /** Comment rows (post-shaped). `allComments` gates the source toggle's
   *  Comments/Both options; `filteredComments` drives the comment preview. */
  allComments?: DashboardPost[];
  filteredComments?: DashboardPost[];
  availableOptions: FilterOptions;
  onSave: (widget: SocialDashboardWidget) => void;
  onClose: () => void;
  /** Distinct custom enrichment field names present on the dataset. */
  customFieldNames?: string[];
  /** Declared list[object] field defs - source of typed object-leaf dims/metrics. */
  objectFieldDefs?: CustomFieldDef[];
  /** All declared custom field defs - drives condition operator/input typing. */
  customFieldDefs?: CustomFieldDef[];
  /** Report-level computed fields, surfaced as `computed:<id>` dims/metrics. */
  computedFields?: ComputedField[];
  /** Agent context used to ground AI compose with task title + description. */
  agentId?: string;
  /** Agent-scoped topic_metrics rows. Empty when no agent context (in which
   *  case the data-source toggle's Topics option is disabled). */
  topics?: TopicMetric[];
}

export function SocialWidgetConfigDialog({
  open,
  widget,
  mode = 'edit',
  allPosts,
  filteredPosts,
  allComments,
  filteredComments,
  availableOptions,
  onSave,
  onClose,
  customFieldNames,
  objectFieldDefs,
  customFieldDefs,
  computedFields,
  agentId,
  topics,
}: SocialWidgetConfigDialogProps) {
  if (!open || !widget) return null;

  return (
    <SocialWidgetConfigDialogInner
      key={widget.i}
      open={open}
      widget={widget}
      mode={mode}
      allPosts={allPosts}
      filteredPosts={filteredPosts}
      allComments={allComments}
      filteredComments={filteredComments}
      availableOptions={availableOptions}
      onSave={onSave}
      onClose={onClose}
      customFieldNames={customFieldNames}
      objectFieldDefs={objectFieldDefs}
      customFieldDefs={customFieldDefs}
      computedFields={computedFields}
      agentId={agentId}
      topics={topics}
    />
  );
}

// ── Preset → custom conversion ─────────────────────────────────────────────────

export function toCustomDraft(widget: SocialDashboardWidget): SocialDashboardWidget {
  // Content widgets (text/embed/media/html) have no data/chart config - pass
  // through untouched. Any aggregation NOT listed here is coerced to a custom
  // chart below, which would route a content widget to the wrong config UI.
  if (widget.aggregation === 'text') return widget;
  if (widget.aggregation === 'embeds') return widget;
  if (widget.aggregation === 'media') return widget;
  if (widget.aggregation === 'html') return widget;
  // Preserve the preset's chart type if it was set - e.g. channels/entities
  // ship with `chartType: 'table'` and the rich table view should survive the
  // round-trip through the edit dialog. Without this, opening any 'channels'
  // widget for edit would silently rewrite it as a bar chart on save.
  const resolvedChartType =
    widget.aggregation === 'custom' && widget.customConfig
      ? widget.chartType
      : widget.chartType ?? presetToCustomConfig(widget.aggregation, widget.kpiIndex).chartType;

  // Seed tableConfig when the widget is rendered as a table - keeps the dialog
  // populated with the actual columns the user sees on the dashboard so edits
  // round-trip. Uses dimension-aware defaults for known presets.
  let seededTableConfig = widget.tableConfig;
  if (!seededTableConfig && resolvedChartType === 'table') {
    if ((widget.dataSource ?? 'posts') === 'topics') {
      seededTableConfig = defaultTopicTableConfig();
    } else {
      const seedDim =
        (widget.customConfig?.dimension as CustomDimension | undefined)
        ?? (presetToCustomConfig(widget.aggregation, widget.kpiIndex).customConfig.dimension as CustomDimension | undefined)
        ?? 'channel_handle';
      seededTableConfig = defaultTableConfigFor(seedDim);
    }
  }

  if (widget.aggregation === 'custom' && widget.customConfig) {
    return { ...widget, tableConfig: seededTableConfig };
  }
  const { customConfig } = presetToCustomConfig(widget.aggregation, widget.kpiIndex);
  return {
    ...widget,
    aggregation: 'custom',
    customConfig,
    chartType: resolvedChartType,
    tableConfig: seededTableConfig,
    kpiIndex: undefined,
  };
}

// ── Inner component (mounted fresh per widget.i) ──────────────────────────────

function SocialWidgetConfigDialogInner({
  open,
  widget,
  mode = 'edit',
  filteredPosts,
  allComments = [],
  filteredComments = [],
  availableOptions,
  onSave,
  onClose,
  customFieldNames,
  objectFieldDefs,
  customFieldDefs,
  computedFields,
  agentId,
  topics = [],
}: SocialWidgetConfigDialogProps & { widget: SocialDashboardWidget }) {
  const [draft, setDraft] = useState<SocialDashboardWidget>(() => toCustomDraft(widget));
  const dataSource: DataSource = draft.dataSource ?? 'posts';
  const isTopics = dataSource === 'topics';
  const topicsAvailable = Boolean(agentId);
  const commentsAvailable = allComments.length > 0;

  // ── Drag state ──
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const onDragPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' || tag === 'INPUT') return;
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, origX: dragOffset.x, origY: dragOffset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [dragOffset]);

  const onDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    setDragOffset({
      x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
    });
  }, []);

  const onDragPointerUp = useCallback(() => { dragRef.current.active = false; }, []);

  // ── Resize state ── once the user drags the corner we switch from the
  // class-based max-width to explicit pixel size on the DialogContent. null =
  // unsized (use defaults). Min clamps keep both panels usable.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const resizeRef = useRef({ active: false, startX: 0, startY: 0, origW: 0, origH: 0 });

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = contentRef.current?.getBoundingClientRect();
    resizeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origW: rect?.width ?? 1100,
      origH: rect?.height ?? 600,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current.active) return;
    const w = Math.max(640, resizeRef.current.origW + (e.clientX - resizeRef.current.startX) * 2);
    const h = Math.max(400, resizeRef.current.origH + (e.clientY - resizeRef.current.startY) * 2);
    setSize({
      w: Math.min(w, window.innerWidth - 32),
      h: Math.min(h, window.innerHeight - 32),
    });
  }, []);

  const onResizePointerUp = useCallback(() => { resizeRef.current.active = false; }, []);

  // Recompute valid chart types whenever dimension/metric changes. For topic
  // widgets, drop the chart types we don't support in phase 1 (line - no time
  // series in topic_metrics).
  const validChartTypes = (isTopics
    ? getValidChartTypesForCustom(
        draft.customConfig?.dimension as CustomDimension | undefined,
        (draft.customConfig?.metric ?? 'post_count') as CustomMetric,
      ).filter((t) => !TOPIC_DISABLED_CHART_TYPES.has(t))
    : getValidChartTypesForCustom(
        draft.customConfig?.dimension as CustomDimension | undefined,
        (draft.customConfig?.metric ?? 'post_count') as CustomMetric,
      ));

  const updateDataSource = (next: DataSource) => {
    setDraft((prev) => {
      if ((prev.dataSource ?? 'posts') === next) return prev;
      // Switching source: clear customConfig + tableConfig + breakdown + time
      // bucket so we don't carry an invalid dimension/metric across vocabularies.
      const seed: CustomChartConfig =
        next === 'topics'
          ? { metric: 'topic_count' as CustomChartConfig['metric'] }
          : { metric: 'post_count' };
      const fallbackChart: SocialChartType = next === 'topics' && prev.chartType === 'line'
        ? 'bar'
        : prev.chartType;
      return {
        ...prev,
        dataSource: next,
        aggregation: 'custom',
        customConfig: seed,
        tableConfig: undefined,
        chartType: fallbackChart,
      };
    });
  };

  const updateConfig = (config: CustomChartConfig) => {
    setDraft((prev) => {
      const next = { ...prev, customConfig: config };
      // getValidChartTypesForCustom takes post-side narrow types; for topic
      // widgets the chart-type gating runs through validChartTypes in the
      // dialog, so passing through `as` here is safe.
      const valid = getValidChartTypesForCustom(
        config.dimension as CustomDimension | undefined,
        config.metric as CustomMetric,
      );
      if (!valid.includes(next.chartType as SocialChartType)) next.chartType = valid[0];
      return next;
    });
  };

  const updateChartType = (chartType: SocialChartType) => {
    setDraft((prev) => {
      // When switching INTO table mode, seed tableConfig if missing so the
      // Data tab opens populated and the preview renders immediately.
      if (chartType === 'table' && !prev.tableConfig) {
        if ((prev.dataSource ?? 'posts') === 'topics') {
          return { ...prev, chartType, tableConfig: defaultTopicTableConfig() };
        }
        const seedDim = (prev.customConfig?.dimension as CustomDimension | undefined) ?? 'channel_handle';
        return { ...prev, chartType, tableConfig: defaultTableConfigFor(seedDim) };
      }
      // Heatmap needs two axes. Seed any missing one with the posting-activity
      // default (hour × weekday) while preserving whatever the user already
      // chose, so a fresh pick lands on the familiar design.
      if (chartType === 'heatmap' && (prev.dataSource ?? 'posts') !== 'topics') {
        const cfg = prev.customConfig ?? { metric: 'post_count' as CustomMetric };
        const dimension: CustomDimension = (cfg.dimension as CustomDimension | undefined) ?? 'hour_of_day';
        let breakdownDimension = cfg.breakdownDimension as CustomDimension | undefined;
        if (!breakdownDimension || breakdownDimension === dimension) {
          breakdownDimension = dimension === 'day_of_week' ? 'hour_of_day' : 'day_of_week';
        }
        return {
          ...prev,
          chartType,
          customConfig: { ...cfg, metric: cfg.metric ?? 'post_count', dimension, breakdownDimension },
        };
      }
      return { ...prev, chartType };
    });
  };

  const updateTableConfig = (tableConfig: CustomTableConfig) => {
    setDraft((prev) => ({ ...prev, tableConfig }));
  };

  // Preview over the widget's selected source. Comments are post-shaped, so the
  // post-vocabulary preview aggregations and the inner renderer below work on
  // them unchanged.
  const previewPosts = useMemo(() => {
    const base = dataSource === 'comments'
      ? filteredComments
      : dataSource === 'both'
        ? [...filteredPosts, ...filteredComments]
        : filteredPosts;
    return applyWidgetFilters(base, draft.filters);
  }, [dataSource, filteredPosts, filteredComments, draft.filters]);

  // The inner renderer re-derives its source from `dataSource`; since
  // `previewPosts` already carries the selected comment/both rows, present them
  // to it as a plain posts source so it renders them directly (topics keep their
  // own prop-driven path).
  const previewWidget: SocialDashboardWidget = {
    ...draft, x: 0, y: 0, w: 6, h: 6,
    dataSource: dataSource === 'comments' || dataSource === 'both' ? 'posts' : draft.dataSource,
  };

  const isTextMode = draft.aggregation === 'text';
  const isEmbedMode = draft.aggregation === 'embeds';
  const isMediaMode = draft.aggregation === 'media';
  const isHtmlMode = draft.aggregation === 'html';

  // MDXEditor portals its toolbar popups (block-type dropdown, link dialog)
  // into this host. Keeping it inside DialogContent puts the popups in the
  // Radix Dialog's pointer-events scope - otherwise they render but clicks
  // are swallowed because modal Dialog blocks pointer events on body.
  // Callback ref + state so the editor re-renders once the host mounts.
  const [editorOverlayHost, setEditorOverlayHost] = useState<HTMLDivElement | null>(null);

  // Portal host for the Filters tab popovers. They must render INSIDE the
  // modal Dialog's subtree - a body portal sits outside react-remove-scroll's
  // allowed area, which silently blocks wheel-scrolling the option lists.
  const [popoverHost, setPopoverHost] = useState<HTMLDivElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        ref={contentRef}
        className={cn(
          size
            ? 'max-w-none'
            : isTextMode
              ? 'sm:max-w-[min(1600px,95vw)]'
              : isEmbedMode
                ? 'sm:max-w-[1400px]'
                : 'sm:max-w-[min(1400px,95vw)]',
          'max-h-[88vh] flex flex-col p-0 gap-0',
        )}
        style={{
          marginLeft: dragOffset.x,
          marginTop: dragOffset.y,
          ...(size ? { width: size.w, height: size.h, maxWidth: 'none', maxHeight: 'none' } : {}),
        }}
      >
        <DialogHeader
          className="px-6 pt-5 pb-3 border-b border-border shrink-0 cursor-grab active:cursor-grabbing select-none"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
        >
          <div className="flex items-center gap-2">
            <GripHorizontal className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            <DialogTitle>{mode === 'add' ? 'Add Widget' : 'Configure Widget'}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── Left: config (wider in text mode for the markdown editor) ── */}
          <div className={`${isTextMode || isEmbedMode ? 'w-[55%]' : 'w-[55%]'} border-r border-border flex flex-col min-h-0 bg-white dark:bg-zinc-950`}>
            {isEmbedMode ? (
              <EmbedConfigPanel
                draft={draft}
                setDraft={setDraft}
                posts={previewPosts}
                filteredPosts={filteredPosts}
                availableOptions={availableOptions}
                customFieldDefs={customFieldDefs}
                topics={topics}
                portalContainer={popoverHost}
              />
            ) : isMediaMode ? (
              <MediaConfigPanel draft={draft} setDraft={setDraft} />
            ) : isHtmlMode ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <Label className="text-xs w-24 shrink-0">Title</Label>
                  <Input
                    value={draft.title}
                    onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                    className="h-8 text-xs"
                    placeholder="Widget title"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Label className="text-xs w-24 shrink-0">Description</Label>
                  <Input
                    value={draft.description ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value || undefined }))}
                    className="h-8 text-xs"
                    placeholder="Optional subtitle"
                  />
                </div>

                <Separator />

                <ContainerToggle
                  draft={draft}
                  onChange={(showContainer) => setDraft((prev) => ({ ...prev, showContainer }))}
                />

                <VisibilityToggle
                  draft={draft}
                  onChange={(visible) => setDraft((prev) => ({ ...prev, hidden: visible ? undefined : true }))}
                />

                <Separator />

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    HTML
                  </Label>
                  <Textarea
                    value={draft.htmlContent ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, htmlContent: e.target.value }))}
                    className="font-mono text-xs min-h-[300px] resize-y"
                    placeholder={'<div style="text-align:center">\n  <h2>Big launch</h2>\n</div>'}
                    spellCheck={false}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Paste a self-contained HTML snippet. Inline CSS and{' '}
                    <code>&lt;style&gt;</code> blocks (incl. <code>@keyframes</code>) are supported
                    for animations. Scripts and event handlers are stripped - no JavaScript runs.
                    The preview on the right updates as you type.
                  </p>
                </div>
              </div>
            ) : isTextMode ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <Label className="text-xs w-24 shrink-0">Title</Label>
                  <Input
                    value={draft.title}
                    onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                    className="h-8 text-xs"
                    placeholder="Widget title"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Label className="text-xs w-24 shrink-0">Description</Label>
                  <Input
                    value={draft.description ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value || undefined }))}
                    className="h-8 text-xs"
                    placeholder="Optional subtitle"
                  />
                </div>

                <Separator />

                <ContainerToggle
                  draft={draft}
                  onChange={(showContainer) => setDraft((prev) => ({ ...prev, showContainer }))}
                />

                <VisibilityToggle
                  draft={draft}
                  onChange={(visible) => setDraft((prev) => ({ ...prev, hidden: visible ? undefined : true }))}
                />

                <WatermarkToggle
                  draft={draft}
                  onChange={(on) => setDraft((prev) => ({ ...prev, showWatermark: on ? true : undefined }))}
                />

                <Separator />

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Markdown
                  </Label>
                  <div className="rounded-md border border-border bg-background overflow-hidden">
                    <Suspense
                      fallback={
                        <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading editor…
                        </div>
                      }
                    >
                      <MarkdownArtifactEditor
                        initialMarkdown={draft.markdownContent ?? ''}
                        onChange={(md, isInitialNormalize) => {
                          if (isInitialNormalize) return;
                          setDraft((prev) => ({ ...prev, markdownContent: md }));
                        }}
                        overlayContainer={editorOverlayHost}
                      />
                    </Suspense>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Supports GitHub-flavored Markdown. The preview on the right updates as you type.
                  </p>
                </div>
              </div>
            ) : (
            /* Tabs: Data | Filters | Style */
            <Tabs defaultValue="data" className="flex flex-col flex-1 min-h-0">
              <TabsList className="w-full grid grid-cols-3 rounded-none border-b border-border bg-transparent h-10 shrink-0 px-4">
                <TabsTrigger value="data" className="text-xs gap-1.5">
                  <Database className="h-3.5 w-3.5" />
                  Data
                </TabsTrigger>
                <TabsTrigger value="filters" className="text-xs gap-1.5">
                  <Filter className="h-3.5 w-3.5" />
                  Filters
                </TabsTrigger>
                <TabsTrigger value="style" className="text-xs gap-1.5">
                  <Palette className="h-3.5 w-3.5" />
                  Style
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto">
                <TabsContent value="data" className="mt-0 p-5 space-y-4">
                  {/* Title - doubles as the figure header. AI compose drafts a
                       terse 4–8 word label from the current data. */}
                  <div className="flex items-center gap-3">
                    <Label className="text-xs w-24 shrink-0">Title</Label>
                    <Input
                      value={draft.title}
                      onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                      className="h-8 text-xs"
                      placeholder="Widget title"
                    />
                    <ComposeButton
                      target="header"
                      draft={draft}
                      previewPosts={previewPosts}
                      topics={topics}
                      agentId={agentId}
                      onResult={(text) => setDraft((prev) => ({ ...prev, title: text }))}
                    />
                  </div>

                  {/* Description */}
                  <div className="flex items-center gap-3">
                    <Label className="text-xs w-24 shrink-0">Description</Label>
                    <Input
                      value={draft.description ?? ''}
                      onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value || undefined }))}
                      className="h-8 text-xs"
                      placeholder="Optional subtitle"
                    />
                  </div>

                  {/* Figure text - academic-style caption rendered below the
                       chart body. Optional; blank → no change in look. */}
                  <div className="flex items-start gap-3">
                    <Label className="text-xs w-24 shrink-0 pt-2">Figure text</Label>
                    <Textarea
                      value={draft.figureText ?? ''}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, figureText: e.target.value || undefined }))
                      }
                      placeholder="1–2 sentence caption rendered below the chart."
                      className="text-xs min-h-[60px]"
                      rows={2}
                    />
                    <ComposeButton
                      target="figure_text"
                      draft={draft}
                      previewPosts={previewPosts}
                      topics={topics}
                      agentId={agentId}
                      onResult={(text) => setDraft((prev) => ({ ...prev, figureText: text }))}
                    />
                  </div>

                  <Separator />

                  {/* Data Source toggle - widget-level. Hoisted above the
                       chart/table form fork so it's visible regardless of
                       chart type. */}
                  <div className="flex items-center gap-3">
                    <Label className="text-xs w-24 shrink-0">Data Source</Label>
                    <div className="flex items-center gap-1.5">
                      {(['posts', 'topics', 'comments', 'both'] as const).map((src) => {
                        const disabled =
                          (src === 'topics' && !topicsAvailable)
                          || ((src === 'comments' || src === 'both') && !commentsAvailable);
                        const disabledTitle = src === 'topics'
                          ? 'Topics require an agent context on this dashboard'
                          : 'This agent has no enriched comments yet';
                        return (
                          <button
                            key={src}
                            type="button"
                            disabled={disabled}
                            onClick={() => updateDataSource(src)}
                            title={disabled ? disabledTitle : undefined}
                            className={cn(
                              'rounded-md border px-2.5 py-1 text-xs font-medium transition-all capitalize',
                              dataSource === src
                                ? 'border-primary bg-primary/5 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                              disabled && 'opacity-50 cursor-not-allowed hover:border-border hover:text-muted-foreground',
                            )}
                          >
                            {src}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Chart type selector - grid layout with icon on top, all types visible */}
                  <div className="space-y-2.5">
                    <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Chart Type
                    </Label>
                    <div className="grid grid-cols-4 gap-2">
                      {ALL_CHART_TYPES.map(({ type, label, icon: Icon }) => {
                        const isValid = validChartTypes.includes(type);
                        const isSelected = draft.chartType === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => isValid && updateChartType(type)}
                            className={cn(
                              'flex flex-col items-center gap-1.5 p-2.5 rounded-md border text-sm transition-colors',
                              isSelected
                                ? 'border-primary bg-primary/10 text-primary'
                                : isValid
                                  ? 'border-border hover:border-primary/50 text-muted-foreground hover:text-foreground'
                                  : 'border-border/50 text-muted-foreground/30 cursor-not-allowed',
                            )}
                          >
                            <Icon className="h-5 w-5" />
                            <span className="text-xs font-medium">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bar orientation toggle */}
                  {draft.chartType === 'bar' && (
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-24 shrink-0">Orientation</Label>
                      <div className="flex items-center gap-1.5">
                        {(['horizontal', 'vertical'] as const).map((dir) => (
                          <button
                            key={dir}
                            type="button"
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                customConfig: { ...prev.customConfig!, barOrientation: dir },
                              }))
                            }
                            className={cn(
                              'rounded-md border px-2.5 py-1 text-xs font-medium transition-all capitalize',
                              (draft.customConfig?.barOrientation ?? 'horizontal') === dir
                                ? 'border-primary bg-primary/5 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                            )}
                          >
                            {dir}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <Separator />

                  {draft.chartType === 'table' ? (
                    /* Table widgets: pick row dimension + columns + sort + limit.
                     * The chart-flavored Metric / Breakdown / Top-N / Stacked
                     * controls don't apply here, so we render a dedicated form. */
                    <TableDataForm
                      config={draft.tableConfig ?? (isTopics
                        ? defaultTopicTableConfig()
                        : defaultTableConfigFor(draft.customConfig?.dimension as CustomDimension | undefined ?? 'channel_handle'))}
                      onChange={updateTableConfig}
                      customFieldNames={customFieldNames}
                      objectFieldDefs={objectFieldDefs}
                      dataSource={dataSource}
                    />
                  ) : (
                    /* Data source: Metric → Aggregation → Group By → Time Bucket */
                    <DataSourceForm
                      config={draft.customConfig ?? { metric: 'post_count' }}
                      onChange={updateConfig}
                      onChartTypeChange={updateChartType}
                      chartType={draft.chartType}
                      customFieldNames={customFieldNames}
                      objectFieldDefs={objectFieldDefs}
                      computedFields={computedFields}
                      dataSource={dataSource}
                    />
                  )}
                </TabsContent>

                <TabsContent value="filters" className="mt-0 p-5">
                  <WidgetFilterForm
                    filters={draft.filters ?? {}}
                    availableOptions={availableOptions}
                    posts={filteredPosts}
                    customFieldDefs={customFieldDefs}
                    portalContainer={popoverHost}
                    topics={topics}
                    onChange={(filters) => setDraft((prev) => ({ ...prev, filters }))}
                  />
                </TabsContent>

                <TabsContent value="style" className="mt-0 p-5 space-y-4">
                  <ContainerToggle
                    draft={draft}
                    onChange={(showContainer) => setDraft((prev) => ({ ...prev, showContainer }))}
                  />
                  <VisibilityToggle
                    draft={draft}
                    onChange={(visible) => setDraft((prev) => ({ ...prev, hidden: visible ? undefined : true }))}
                  />
                  <WatermarkToggle
                    draft={draft}
                    onChange={(on) => setDraft((prev) => ({ ...prev, showWatermark: on ? true : undefined }))}
                  />
                  <Separator />
                  <StyleTab
                    draft={draft}
                    previewPosts={previewPosts}
                    topics={topics}
                    onKpiIndexChange={(kpiIndex) => setDraft((prev) => ({ ...prev, kpiIndex }))}
                    onStyleChange={(styleOverrides) =>
                      setDraft((prev) => ({ ...prev, styleOverrides, accent: undefined }))
                    }
                    onAccentChange={(accent) =>
                      setDraft((prev) => ({ ...prev, accent }))
                    }
                    onTableConfigChange={updateTableConfig}
                    onNumberSizeChange={(numberSize) =>
                      setDraft((prev) => ({
                        ...prev,
                        numberSize,
                        w: NUMBER_SIZE_GRID[numberSize].w,
                        h: NUMBER_SIZE_GRID[numberSize].h,
                      }))
                    }
                    onShowSparklineChange={(showSparkline) =>
                      setDraft((prev) => ({
                        ...prev,
                        showSparkline,
                        // seed sensible X-axis defaults the first time it's turned on
                        ...(showSparkline && !prev.trendDimension
                          ? { trendDimension: 'posted_at' as const, trendTimeBucket: prev.trendTimeBucket ?? 'day' }
                          : {}),
                      }))
                    }
                    onTrendDimensionChange={(trendDimension) =>
                      setDraft((prev) => ({ ...prev, trendDimension }))
                    }
                    onTrendTimeBucketChange={(trendTimeBucket) =>
                      setDraft((prev) => ({ ...prev, trendTimeBucket }))
                    }
                    onTrendCumulativeChange={(trendCumulative) =>
                      setDraft((prev) => ({ ...prev, trendCumulative }))
                    }
                    onTopValuePartsChange={(topValueParts) =>
                      setDraft((prev) => ({ ...prev, topValueParts }))
                    }
                  />
                </TabsContent>
              </div>
            </Tabs>
            )}
          </div>

          {/* ── Right: live preview (45%) ── */}
          <div className="flex-1 flex flex-col min-h-0 bg-muted/20">
            <div className="px-4 py-2.5 border-b border-border shrink-0">
              <span className="text-xs font-medium text-muted-foreground">Preview</span>
            </div>
            <div className="flex-1 p-4 min-h-0 overflow-hidden">
              <div className="h-full">
                <SocialWidgetRenderer
                  widget={previewWidget}
                  filteredPosts={previewPosts}
                  topics={topics}
                  isEditMode={false}
                  onConfigure={() => {}}
                  onRemove={() => {}}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSave(draft)}>
            {mode === 'add' ? 'Add Widget' : 'Save'}
          </Button>
        </DialogFooter>
        {isTextMode && <div ref={setEditorOverlayHost} />}
        {/* Filters-tab popover portal host (inside the dialog - see popoverHost). */}
        <div ref={setPopoverHost} />

        {/* ── Corner resize handle (bottom-right) ── */}
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          className="absolute bottom-0 right-0 z-50 h-5 w-5 cursor-nwse-resize touch-none select-none"
          title="Drag to resize"
        >
          <svg viewBox="0 0 10 10" className="absolute bottom-1 right-1 h-2.5 w-2.5 text-muted-foreground/50">
            <path d="M9 1 L9 9 L1 9" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Style tab ─────────────────────────────────────────────────────────────────

/** KPI cards have a different style model (card-tint accent only) than charts
 *  (palette accent + per-series overrides), so this branches on chart type
 *  rather than dumping both controls onto every widget. */
function StyleTab({
  draft,
  previewPosts,
  topics,
  onKpiIndexChange,
  onStyleChange,
  onAccentChange,
  onTableConfigChange,
  onNumberSizeChange,
  onShowSparklineChange,
  onTrendDimensionChange,
  onTrendTimeBucketChange,
  onTrendCumulativeChange,
  onTopValuePartsChange,
}: {
  draft: SocialDashboardWidget;
  previewPosts: DashboardPost[];
  topics: TopicMetric[];
  onKpiIndexChange: (i: number) => void;
  onStyleChange: (overrides: ChartStyleOverrides) => void;
  onAccentChange: (accent: string | undefined) => void;
  onTableConfigChange: (config: CustomTableConfig) => void;
  onNumberSizeChange: (size: NumberSize) => void;
  onShowSparklineChange: (show: boolean) => void;
  onTrendDimensionChange: (dim: CustomDimension) => void;
  onTrendTimeBucketChange: (bucket: TimeBucket) => void;
  onTrendCumulativeChange: (cumulative: boolean) => void;
  onTopValuePartsChange: (parts: TopValuePart[]) => void;
}) {
  const isTopicsSource = (draft.dataSource ?? 'posts') === 'topics';
  // KPI cards: size + accent + (optional) KPI index picker.
  if (draft.chartType === 'number-card') {
    return (
      <WidgetStyleForm
        aggregation={draft.aggregation}
        kpiIndex={draft.kpiIndex}
        accent={draft.styleOverrides?.accent ?? draft.accent}
        numberSize={draft.numberSize}
        showSparkline={draft.showSparkline}
        trendDimension={draft.trendDimension}
        trendTimeBucket={draft.trendTimeBucket}
        trendCumulative={draft.trendCumulative}
        metricAgg={draft.customConfig?.metricAgg}
        topValueParts={draft.topValueParts}
        onKpiIndexChange={onKpiIndexChange}
        onAccentChange={onAccentChange}
        onNumberSizeChange={onNumberSizeChange}
        onShowSparklineChange={onShowSparklineChange}
        onTrendDimensionChange={onTrendDimensionChange}
        onTrendTimeBucketChange={onTrendTimeBucketChange}
        onTrendCumulativeChange={onTrendCumulativeChange}
        onTopValuePartsChange={onTopValuePartsChange}
      />
    );
  }

  // Tables: density + stripes + rename row values. Accent / per-series colors
  // don't apply (rows aren't colored series), but renames carry over from the
  // shared `styleOverrides.seriesLabels` map so a table & a chart on the same
  // dimension share renames.
  if (draft.chartType === 'table') {
    const tableConfig = normalizeTableConfig(
      draft.tableConfig ?? (isTopicsSource
        ? defaultTopicTableConfig()
        : defaultTableConfigFor((draft.customConfig?.dimension as CustomDimension | undefined) ?? 'channel_handle')),
    );
    // Topic tables read from the topic_metrics rows directly; post tables run
    // the post aggregator. list[object] tables aggregate element-as-unit -
    // route to the object table aggregator (mirrors SocialWidgetRenderer) so
    // the rename groups expose the object dimension's leaf values. Filter bar
    // doesn't apply to topics (snapshot data).
    const tableObjField = !isTopicsSource ? objectFieldOfTable(tableConfig) : null;
    // previewPosts is already row-filtered (see previewPosts memo); apply the
    // value-level prune so rename groups list only the selected dimension
    // values, matching the rendered table.
    const tableAggPosts = applyWidgetValueFilters(previewPosts, draft.filters, tablePrimaryDimension(tableConfig));
    const rows = isTopicsSource
      ? aggregateTopicsTable(topics, tableConfig)
      : tableObjField
        ? aggregateObjectTable(tableAggPosts, tableObjField, tableConfig)
        : aggregateTable(tableAggPosts, tableConfig);

    // Build a rename group per dimension column - for topic widgets the
    // typical case is one group ("Topic") but other dims (beat_type,
    // top_emotion, ...) work the same. For post tables, multi-group tables
    // (e.g. channel × platform) also get one section per dim.
    const dimGroups: Array<{ columnId: string; label: string; values: string[] }> = [];
    for (const col of tableConfig.columns) {
      if (!isDimensionColumn(col) || !col.dimension) continue;
      const dim = col.dimension;
      const colLabel = isTopicsSource
        ? getTopicDimensionMeta(dim as never).label
        : getDimensionMeta(dim as CustomDimension).label;
      const seen = new Set<string>();
      const values: string[] = [];
      for (const r of rows) {
        const v = r[col.id];
        if (typeof v === 'string' && v !== '' && !seen.has(v)) {
          seen.add(v);
          values.push(v);
        }
      }
      if (values.length > 0) {
        dimGroups.push({ columnId: col.id, label: colLabel, values });
      }
    }
    const tableStyleOverrides: ChartStyleOverrides = draft.styleOverrides ?? {};
    return (
      <TableStyleForm
        config={tableConfig}
        onChange={onTableConfigChange}
        dimGroups={dimGroups}
        styleOverrides={tableStyleOverrides}
        onStyleChange={onStyleChange}
      />
    );
  }

  // Charts: compute the labels the chart will render so the per-series picker
  // matches the legend 1:1. list[object] fields aggregate element-as-unit -
  // route to the object aggregator (mirrors SocialWidgetRenderer) so the
  // per-series picker shows the object dimension's leaf values.
  const chartObjField = draft.customConfig && !isTopicsSource
    ? objectFieldOf(draft.customConfig)
    : null;
  // Value-level prune so the per-series picker lists only the values the
  // rendered chart shows (previewPosts is already row-filtered).
  const chartAggPosts = applyWidgetValueFilters(previewPosts, draft.filters, draft.customConfig?.dimension as CustomDimension | undefined);
  const previewData = draft.customConfig
    ? (chartObjField
        ? aggregateObjectList(chartAggPosts, chartObjField, draft.customConfig)
        : isTopicsSource
          ? aggregateTopicsCustom(topics, draft.customConfig)
          : aggregateCustom(chartAggPosts, draft.customConfig))
    : undefined;
  // Word cloud has no customConfig-driven previewData; its "series" are the
  // theme words. Surface them so the per-series color/rename picker renders
  // (mirrors ThemeCloud's seriesColors/seriesLabels keys, which are raw words).
  const seriesLabels = draft.chartType === 'word-cloud'
    ? aggregateThemeCloud(applyWidgetValueFilters(previewPosts, draft.filters, 'themes')).map((w) => w.text)
    : extractChartSeriesLabels(draft.chartType, previewData);
  const styleOverrides: ChartStyleOverrides = draft.styleOverrides
    ?? (draft.accent ? { accent: draft.accent } : {});

  // Default donut center label (shown as placeholder) - mirrors the renderer's
  // metricLabel(activeMetric) fallback for the widget's primary metric.
  const centerLabelDefault = draft.customConfig
    ? (isTopicsSource
        ? TOPIC_METRIC_META[draft.customConfig.metric as keyof typeof TOPIC_METRIC_META]?.label
        : METRIC_META[draft.customConfig.metric as CustomMetric]?.label) ?? String(draft.customConfig.metric)
    : undefined;

  // Default axis titles (placeholder + the value used when a title is enabled
  // without custom text) - mirrors the renderer so the editor previews match.
  const axisTitleDefaults = defaultAxisTitles(
    draft.customConfig,
    draft.chartType,
    isTopicsSource ? 'topics' : 'posts',
  );

  return (
    <ChartStyleEditor
      seriesLabels={seriesLabels}
      chartType={draft.chartType}
      value={styleOverrides}
      onChange={onStyleChange}
      centerLabelDefault={centerLabelDefault}
      xAxisDefault={axisTitleDefaults.x}
      yAxisDefault={axisTitleDefaults.y}
    />
  );
}

function TableStyleForm({
  config,
  onChange,
  dimGroups,
  styleOverrides,
  onStyleChange,
}: {
  config: CustomTableConfig;
  onChange: (config: CustomTableConfig) => void;
  /** One entry per dimension column on the table. Each carries the distinct
   *  raw values present in the rendered preview rows, so the user can rename
   *  them. Renames are written to the shared `styleOverrides.seriesLabels`
   *  map - keyed by raw value, so renames apply consistently wherever the
   *  same value appears (table cells, chart legends). */
  dimGroups: Array<{ columnId: string; label: string; values: string[] }>;
  styleOverrides: ChartStyleOverrides;
  onStyleChange: (overrides: ChartStyleOverrides) => void;
}) {
  const setRowLabel = (raw: string, name: string | undefined) => {
    const next = { ...(styleOverrides.seriesLabels ?? {}) };
    if (name === undefined || name.trim() === '') delete next[raw];
    else next[raw] = name;
    onStyleChange({
      ...styleOverrides,
      seriesLabels: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Density</Label>
          <div className="flex items-center gap-1.5">
            {(['compact', 'comfortable'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onChange({ ...config, density: d })}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-all capitalize',
                  (config.density ?? 'compact') === d
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Text size */}
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Text size</Label>
          <div className="flex items-center gap-1.5">
            {([['xs', 'Small'], ['sm', 'Medium'], ['base', 'Large']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ ...config, fontSize: value })}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-all',
                  (config.fontSize ?? 'xs') === value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Accent color - recolors in-cell bars/heatmaps + (with bold header) the header band */}
        <div className="flex items-center gap-3">
          <Label className="text-xs w-24 shrink-0">Accent</Label>
          <div className="flex flex-wrap items-center gap-2">
            {TABLE_ACCENT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onChange({ ...config, accent: color })}
                className={cn(
                  'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110',
                  config.accent === color ? 'border-foreground scale-110' : 'border-transparent',
                )}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
            <input
              type="color"
              className="h-6 w-9 cursor-pointer rounded border border-border p-0.5"
              value={config.accent ?? '#4A7C8F'}
              onChange={(e) => onChange({ ...config, accent: e.target.value })}
              title="Custom color"
            />
            <button
              type="button"
              onClick={() => onChange({ ...config, accent: undefined })}
              className={cn(
                'h-6 w-6 rounded-full border-2 text-[10px] font-medium text-muted-foreground transition-all hover:scale-110',
                !config.accent ? 'border-foreground scale-110 bg-muted' : 'border-dashed border-border bg-muted/50',
              )}
              title="Auto (theme color)"
            >
              A
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={config.striped ?? true}
            onChange={(e) => onChange({ ...config, striped: e.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer"
          />
          Striped rows
        </label>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={config.headerBold ?? false}
            onChange={(e) => onChange({ ...config, headerBold: e.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer"
          />
          Bold accent header
        </label>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={config.emphasizeFirstColumn ?? false}
            onChange={(e) => onChange({ ...config, emphasizeFirstColumn: e.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer"
          />
          Bold first column
        </label>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={(config.columnWidth ?? 'equal') === 'equal'}
            onChange={(e) => onChange({ ...config, columnWidth: e.target.checked ? 'equal' : 'value' })}
            className="h-3.5 w-3.5 cursor-pointer"
          />
          Equal column widths
        </label>
      </div>

      {dimGroups.length > 0 && (
        <div className="space-y-5">
          {dimGroups.map((group) => (
            <div key={group.columnId} className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Rename {group.label} Values
              </Label>
              <p className="text-xs text-muted-foreground/80">
                Override the display name for each unique value in the {group.label} column. Leave blank to keep the raw value.
              </p>
              <div className="space-y-1.5">
                {group.values.map((raw) => {
                  const current = styleOverrides.seriesLabels?.[raw] ?? '';
                  return (
                    <div key={raw} className="flex items-center gap-2">
                      <span
                        className="w-1/3 shrink-0 truncate text-xs text-muted-foreground"
                        title={raw}
                      >
                        {raw}
                      </span>
                      <Input
                        type="text"
                        value={current}
                        placeholder={raw}
                        onChange={(e) => setRowLabel(raw, e.target.value)}
                        className="h-7 flex-1 min-w-0 text-xs"
                      />
                      {current !== '' && (
                        <button
                          type="button"
                          onClick={() => setRowLabel(raw, undefined)}
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="Reset"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AI compose button (used for Title + Figure text inputs) ──────────────────

function buildDataSummary(
  previewPosts: DashboardPost[],
  widget: SocialDashboardWidget,
  topics: TopicMetric[],
): WidgetDataSummary {
  const summary: WidgetDataSummary = { post_count: previewPosts.length };
  const isTopicsSource = (widget.dataSource ?? 'posts') === 'topics';

  // Time range from posted_at
  if (previewPosts.length > 0) {
    const dates = previewPosts
      .map((p) => p.posted_at?.slice(0, 10) ?? '')
      .filter((d) => d.length > 0)
      .sort();
    if (dates.length > 0) {
      summary.time_range = { from: dates[0], to: dates[dates.length - 1] };
    }
  }

  // Widget-specific buckets via the same aggregator the chart uses
  const cfg = widget.customConfig;
  if (cfg) {
    summary.metric_label = isTopicsSource
      ? TOPIC_METRIC_META[cfg.metric as keyof typeof TOPIC_METRIC_META]?.label ?? String(cfg.metric)
      : METRIC_META[cfg.metric as CustomMetric]?.label;
    if (cfg.dimension) {
      summary.dimension_label = isTopicsSource
        ? TOPIC_DIMENSION_META[cfg.dimension as keyof typeof TOPIC_DIMENSION_META]?.label
          ?? getTopicDimensionMeta(cfg.dimension as never).label
        : getDimensionMeta(cfg.dimension as CustomDimension).label;
    }
    const data = isTopicsSource
      ? aggregateTopicsCustom(topics, cfg)
      : aggregateCustom(applyWidgetValueFilters(previewPosts, widget.filters, cfg.dimension as CustomDimension | undefined), cfg);
    if (!cfg.dimension && typeof data.value === 'number') {
      summary.kpi_value = data.value;
    } else if (data.labels && data.values) {
      summary.top_buckets = data.labels.slice(0, 8).map((label, i) => ({
        label,
        value: data.values![i],
      }));
    } else if (data.groupedCategorical) {
      summary.top_buckets = data.groupedCategorical.labels.slice(0, 8).map((label, i) => ({
        label,
        value: data.groupedCategorical!.datasets.reduce(
          (sum, ds) => sum + (ds.values[i] ?? 0),
          0,
        ),
      }));
    } else if (data.timeSeries) {
      summary.top_buckets = data.timeSeries.slice(0, 8).map((p) => ({
        label: p.date,
        value: p.value,
      }));
    }
  }

  // Always include high-level backdrop so the model can ground the language
  summary.top_platforms = aggregatePlatforms(previewPosts).slice(0, 5).map((p) => ({
    label: p.platform,
    value: p.post_count,
  }));
  summary.top_sentiments = aggregateSentiment(previewPosts).slice(0, 5).map((s) => ({
    label: s.sentiment,
    value: s.count,
  }));

  return summary;
}

function ComposeButton({
  target,
  draft,
  previewPosts,
  topics,
  agentId,
  onResult,
}: {
  target: 'header' | 'figure_text';
  draft: SocialDashboardWidget;
  previewPosts: DashboardPost[];
  topics: TopicMetric[];
  agentId?: string;
  onResult: (text: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleClick = useCallback(async () => {
    setPending(true);
    setErrored(false);
    try {
      const result = await composeWidgetField({
        target,
        widget: {
          title: draft.title,
          description: draft.description,
          chart_type: draft.chartType,
          aggregation: draft.aggregation,
          custom_config: draft.customConfig
            ? (draft.customConfig as unknown as Record<string, unknown>)
            : null,
          filters: draft.filters
            ? (draft.filters as unknown as Record<string, unknown>)
            : null,
          figure_text: draft.figureText,
        },
        data_summary: buildDataSummary(previewPosts, draft, topics),
        agent_id: agentId,
      });
      onResult(result.text);
    } catch {
      setErrored(true);
    } finally {
      setPending(false);
    }
  }, [target, draft, previewPosts, agentId, onResult]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-2 shrink-0 text-xs gap-1.5"
      disabled={pending}
      onClick={handleClick}
      title={errored ? 'Compose failed - try again' : 'Compose with AI'}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className={`h-3.5 w-3.5 ${errored ? 'text-destructive' : ''}`} />
      )}
      <span className="hidden sm:inline">AI</span>
    </Button>
  );
}

// ── Embed Posts config panel ─────────────────────────────────────────────────
// One URL per line. Render mode (single vs carousel) is auto-derived from the
// list length at render time - the user does not pick.

/** Infer media kind from a URL's file extension (mp4/webm → video, else image). */
function inferMediaKind(url: string): 'image' | 'video' {
  return /\.(mp4|webm)(\?|#|$)/i.test(url) ? 'video' : 'image';
}

function MediaConfigPanel({
  draft,
  setDraft,
}: {
  draft: SocialDashboardWidget;
  setDraft: React.Dispatch<React.SetStateAction<SocialDashboardWidget>>;
}) {
  const media = draft.media ?? { kind: 'image' as const };
  const [sourceMode, setSourceMode] = useState<'upload' | 'url'>(
    media.uploadPath ? 'upload' : 'url',
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const patchMedia = (patch: Partial<SocialMediaConfig>) =>
    setDraft((prev) => ({
      ...prev,
      media: { ...(prev.media ?? { kind: 'image' }), ...patch },
    }));

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await apiUploadFile<{ gcs_path: string; kind: 'image' | 'video' }>(
        '/upload/media',
        file,
      );
      patchMedia({ uploadPath: res.gcs_path, kind: res.kind, src: undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const isVideo = media.kind === 'video';

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Title</Label>
        <Input
          value={draft.title}
          onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
          className="h-8 text-xs"
          placeholder="Optional title"
        />
      </div>

      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Description</Label>
        <Input
          value={draft.description ?? ''}
          onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value || undefined }))}
          className="h-8 text-xs"
          placeholder="Optional subtitle"
        />
      </div>

      <Separator />

      <ContainerToggle
        draft={draft}
        onChange={(showContainer) => setDraft((prev) => ({ ...prev, showContainer }))}
      />

      <VisibilityToggle
        draft={draft}
        onChange={(visible) => setDraft((prev) => ({ ...prev, hidden: visible ? undefined : true }))}
      />

      <WatermarkToggle
        draft={draft}
        onChange={(on) => setDraft((prev) => ({ ...prev, showWatermark: on ? true : undefined }))}
      />

      <Separator />

      {/* Source: Upload | URL */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Source
        </Label>
        <div className="inline-flex rounded-md border border-border p-0.5">
          <Button
            type="button"
            variant={sourceMode === 'upload' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setSourceMode('upload')}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </Button>
          <Button
            type="button"
            variant={sourceMode === 'url' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setSourceMode('url')}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            Link
          </Button>
        </div>
      </div>

      {sourceMode === 'upload' ? (
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
            className="hidden"
            onChange={handleFile}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? 'Uploading…' : media.uploadPath ? 'Replace file' : 'Choose file'}
          </Button>
          {media.uploadPath && !uploading && (
            <p className="text-[11px] text-muted-foreground truncate">
              Uploaded · {media.kind}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            PNG, JPG, WebP, GIF, MP4, or WebM. Max 50MB.
          </p>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            value={media.uploadPath ? '' : (media.src ?? '')}
            onChange={(e) => {
              const url = e.target.value.trim();
              patchMedia({ src: url || undefined, uploadPath: undefined, kind: inferMediaKind(url) });
            }}
            className="h-8 text-xs font-mono"
            placeholder="https://example.com/image.gif"
          />
          <p className="text-[11px] text-muted-foreground">
            Paste an image, GIF, or video URL. Detected as {isVideo ? 'video' : 'image'}.
          </p>
        </div>
      )}

      <Separator />

      {/* Fit: Contain | Cover */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Fit
        </Label>
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(['contain', 'cover'] as const).map((f) => (
            <Button
              key={f}
              type="button"
              variant={(media.fit ?? 'contain') === f ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs capitalize"
              onClick={() => patchMedia({ fit: f })}
            >
              {f}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Contain shows the whole media; Cover fills the frame and may crop.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Alt text</Label>
        <Input
          value={media.alt ?? ''}
          onChange={(e) => patchMedia({ alt: e.target.value || undefined })}
          className="h-8 text-xs"
          placeholder="Accessibility description"
        />
      </div>

      {isVideo && (
        <>
          <Separator />
          <div className="space-y-3">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Video playback
            </Label>
            {([
              ['controls', 'Show controls', media.controls ?? true],
              ['autoplay', 'Autoplay', media.autoplay ?? false],
              ['loop', 'Loop', media.loop ?? false],
              ['muted', 'Muted', media.muted ?? false],
            ] as const).map(([key, label, val]) => (
              <div key={key} className="flex items-center justify-between">
                <Label className="text-xs">{label}</Label>
                <Switch
                  checked={val}
                  onCheckedChange={(checked) => patchMedia({ [key]: checked } as Partial<SocialMediaConfig>)}
                />
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Autoplay forces muted playback (browser requirement).
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function EmbedConfigPanel({
  draft,
  setDraft,
  posts,
  filteredPosts,
  availableOptions,
  customFieldDefs,
  topics,
  portalContainer,
}: {
  draft: SocialDashboardWidget;
  setDraft: React.Dispatch<React.SetStateAction<SocialDashboardWidget>>;
  /** Posts in scope (global-filtered + the draft's own widget filters) - the
   *  candidate pool the collection-mode selection ranks. */
  posts: DashboardPost[];
  /** Global-filtered posts (pre widget-filter) - feeds the filter form's
   *  per-value counts so they stay stable as you select (matches the chart
   *  widget Filters tab). */
  filteredPosts: DashboardPost[];
  availableOptions: FilterOptions;
  customFieldDefs?: CustomFieldDef[];
  topics?: TopicMetric[];
  portalContainer?: HTMLElement | null;
}) {
  const urls = draft.embedUrls ?? [];
  // Local text mirrors the textarea so users can type blank lines / partial
  // URLs without them being stripped mid-edit; we normalize on blur.
  const [text, setText] = useState(() => urls.join('\n'));

  const cfg: SocialEmbedConfig = draft.embedConfig ?? {};
  const source: EmbedSource = cfg.source ?? 'urls';
  const rankBy = cfg.rankBy ?? DEFAULT_EMBED_RANK;
  const count = cfg.count ?? DEFAULT_EMBED_COUNT;
  const display = cfg.display ?? 'grid';

  const commit = (raw: string) => {
    const next = raw
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    setDraft((prev) => ({ ...prev, embedUrls: next }));
  };

  const patchCfg = (patch: Partial<SocialEmbedConfig>) =>
    setDraft((prev) => ({ ...prev, embedConfig: { ...(prev.embedConfig ?? {}), ...patch } }));

  const hidden = useMemo(() => new Set(cfg.hiddenPostIds ?? []), [cfg.hiddenPostIds]);
  const candidates = useMemo(
    () => embedCandidatePosts(posts, { source: 'collection', rankBy, count }),
    [posts, rankBy, count],
  );
  const shownCount = candidates.reduce((n, p) => n + (hidden.has(p.post_id) ? 0 : 1), 0);

  const toggleHidden = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    patchCfg({ hiddenPostIds: next.size ? [...next] : undefined });
  };

  const mode = urls.length <= 1 ? 'Single' : `Carousel (${urls.length})`;

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Title</Label>
        <Input
          value={draft.title}
          onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
          className="h-8 text-xs"
          placeholder="Widget title"
        />
      </div>

      <div className="flex items-center gap-3">
        <Label className="text-xs w-24 shrink-0">Description</Label>
        <Input
          value={draft.description ?? ''}
          onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value || undefined }))}
          className="h-8 text-xs"
          placeholder="Optional subtitle"
        />
      </div>

      <Separator />

      <ContainerToggle
        draft={draft}
        onChange={(showContainer) => setDraft((prev) => ({ ...prev, showContainer }))}
      />

      <VisibilityToggle
        draft={draft}
        onChange={(visible) => setDraft((prev) => ({ ...prev, hidden: visible ? undefined : true }))}
      />

      <WatermarkToggle
        draft={draft}
        onChange={(on) => setDraft((prev) => ({ ...prev, showWatermark: on ? true : undefined }))}
      />

      <Separator />

      {/* Source: From collection | Links */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Source
        </Label>
        <div className="inline-flex rounded-md border border-border p-0.5">
          <Button
            type="button"
            variant={source === 'collection' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => patchCfg({ source: 'collection' })}
          >
            <Library className="h-3.5 w-3.5" />
            From collection
          </Button>
          <Button
            type="button"
            variant={source === 'urls' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => patchCfg({ source: 'urls' })}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            Links
          </Button>
        </div>
      </div>

      {source === 'urls' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Post URLs
            </Label>
            <span className="text-[11px] text-muted-foreground">{mode}</span>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commit(text)}
            placeholder={'https://x.com/user/status/123\nhttps://www.instagram.com/p/abc/\nhttps://www.tiktok.com/@user/video/123'}
            className="text-xs font-mono min-h-[180px]"
            rows={8}
          />
          <p className="text-[11px] text-muted-foreground">
            One URL per line. Supported: X / Twitter, Instagram, TikTok, YouTube,
            Facebook, LinkedIn. Other URLs render as a link card. Add 2+ to switch
            to carousel automatically.
          </p>
        </div>
      ) : (
        <>
          {/* Layout: Grid | Marquee */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Layout
            </Label>
            <div className="inline-flex rounded-md border border-border p-0.5">
              <Button
                type="button"
                variant={display === 'grid' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => patchCfg({ display: 'grid' })}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Grid
              </Button>
              <Button
                type="button"
                variant={display === 'marquee' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => patchCfg({ display: 'marquee' })}
              >
                <GalleryHorizontalEnd className="h-3.5 w-3.5" />
                Marquee
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Grid scrolls horizontally; Marquee auto-scrolls. Click any post to
              open the original in a new tab.
            </p>
          </div>

          {display === 'marquee' && (
            <div className="flex items-center gap-3">
              <Label className="text-xs w-24 shrink-0">Speed</Label>
              <Select value={cfg.speed ?? 'normal'} onValueChange={(v) => patchCfg({ speed: v as EmbedSpeed })}>
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slow">Slow</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="fast">Fast</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Rank metric */}
          <div className="flex items-center gap-3">
            <Label className="text-xs w-24 shrink-0">Top by</Label>
            <Select value={rankBy} onValueChange={(v) => patchCfg({ rankBy: v as EmbedRankMetric })}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EMBED_RANK_LABELS) as EmbedRankMetric[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {EMBED_RANK_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Count */}
          <div className="flex items-center gap-3">
            <Label className="text-xs w-24 shrink-0">Number of posts</Label>
            <Input
              type="number"
              min={1}
              max={MAX_EMBED_COUNT}
              value={count}
              onChange={(e) => {
                const n = Number(e.target.value);
                patchCfg({
                  count: Number.isFinite(n)
                    ? Math.max(1, Math.min(MAX_EMBED_COUNT, Math.floor(n)))
                    : DEFAULT_EMBED_COUNT,
                });
              }}
              className="h-8 w-24 text-xs"
            />
            <span className="text-[11px] text-muted-foreground">
              {shownCount} shown · top {Math.min(count, MAX_EMBED_COUNT)} by {EMBED_RANK_LABELS[rankBy].toLowerCase()}
            </span>
          </div>

          <Separator />

          {/* Scope filters (reuses the chart widget filter form) */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Filter posts
            </Label>
            <WidgetFilterForm
              filters={draft.filters ?? {}}
              availableOptions={availableOptions}
              posts={filteredPosts}
              customFieldDefs={customFieldDefs}
              portalContainer={portalContainer}
              topics={topics}
              onChange={(filters) =>
                setDraft((prev) => ({ ...prev, filters: Object.keys(filters).length ? filters : undefined }))
              }
            />
          </div>

          <Separator />

          {/* Candidate preview with per-post show/hide */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Selected posts
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {shownCount}/{candidates.length} shown
              </span>
            </div>
            {candidates.length === 0 ? (
              <p className="py-4 text-center text-[11px] italic text-muted-foreground">
                No posts match the current filters.
              </p>
            ) : (
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {candidates.map((post) => {
                  const isHidden = hidden.has(post.post_id);
                  const thumb = embedPostThumbnail(post);
                  const metricVal = embedPostMetricValue(post, rankBy === 'recent' ? 'view_count' : rankBy);
                  return (
                    <div
                      key={post.post_id}
                      className={cn(
                        'flex items-center gap-2 rounded-md border border-border p-1.5 transition-opacity',
                        isHidden && 'opacity-45',
                      )}
                    >
                      <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded bg-zinc-800">
                        {thumb ? (
                          <img
                            src={thumb.url}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <ImageOff className="h-4 w-4 text-white/40" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-xs font-medium">
                          <PlatformIcon platform={post.platform} className="h-3 w-3 shrink-0" />
                          <span className="truncate">{embedHandle(post.channel_handle)}</span>
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {formatNumber(metricVal)} {rankBy === 'recent' ? 'views' : EMBED_RANK_LABELS[rankBy].replace(/^Most /, '')}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                        title={isHidden ? 'Show this post' : 'Hide this post'}
                        onClick={() => toggleHidden(post.post_id)}
                      >
                        {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
