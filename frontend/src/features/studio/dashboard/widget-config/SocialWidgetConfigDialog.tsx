import { useState, useMemo, useRef, useCallback } from 'react';
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
import { Label } from '../../../../components/ui/label.tsx';
import { Separator } from '../../../../components/ui/separator.tsx';
import {
  BarChart3, TrendingUp, PieChart, Circle, Hash, Cloud, List, Table2,
  Database, Filter, Palette, GripHorizontal,
} from 'lucide-react';
import { cn } from '../../../../lib/utils.ts';
import type { DashboardPost } from '../../../../api/types.ts';
import type { SocialDashboardWidget, SocialChartType, CustomChartConfig } from '../types-social-dashboard.ts';
import { getValidChartTypesForCustom, presetToCustomConfig } from '../types-social-dashboard.ts';
import type { FilterOptions } from '../use-dashboard-filters.ts';
import { DataSourceForm } from './DataSourceForm.tsx';
import { WidgetFilterForm } from './WidgetFilterForm.tsx';
import { WidgetStyleForm } from './WidgetStyleForm.tsx';
import { SocialWidgetRenderer, applyWidgetFilters } from '../SocialWidgetRenderer.tsx';

// ── Chart type metadata ────────────────────────────────────────────────────────

const ALL_CHART_TYPES: Array<{ type: SocialChartType; label: string; icon: React.ElementType }> = [
  { type: 'number-card',   label: 'Number',  icon: Hash },
  { type: 'bar',           label: 'Bar',     icon: BarChart3 },
  { type: 'line',          label: 'Line',    icon: TrendingUp },
  { type: 'doughnut',      label: 'Donut',   icon: Circle },
  { type: 'pie',           label: 'Pie',     icon: PieChart },
  { type: 'progress-list', label: 'List',    icon: List },
  { type: 'word-cloud',    label: 'Cloud',   icon: Cloud },
  { type: 'table',         label: 'Table',   icon: Table2 },
];

// ── Public wrapper ─────────────────────────────────────────────────────────────

interface SocialWidgetConfigDialogProps {
  open: boolean;
  widget: SocialDashboardWidget | null;
  mode?: 'add' | 'edit';
  allPosts: DashboardPost[];
  filteredPosts: DashboardPost[];
  availableOptions: FilterOptions;
  onSave: (widget: SocialDashboardWidget) => void;
  onClose: () => void;
}

export function SocialWidgetConfigDialog({
  open,
  widget,
  mode = 'edit',
  allPosts,
  filteredPosts,
  availableOptions,
  onSave,
  onClose,
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
      availableOptions={availableOptions}
      onSave={onSave}
      onClose={onClose}
    />
  );
}

// ── Preset → custom conversion ─────────────────────────────────────────────────

function toCustomDraft(widget: SocialDashboardWidget): SocialDashboardWidget {
  if (widget.aggregation === 'custom' && widget.customConfig) return widget;
  const { customConfig, chartType } = presetToCustomConfig(widget.aggregation, widget.kpiIndex);
  return { ...widget, aggregation: 'custom', customConfig, chartType, kpiIndex: undefined };
}

// ── Inner component (mounted fresh per widget.i) ──────────────────────────────

function SocialWidgetConfigDialogInner({
  open,
  widget,
  mode = 'edit',
  filteredPosts,
  availableOptions,
  onSave,
  onClose,
}: SocialWidgetConfigDialogProps & { widget: SocialDashboardWidget }) {
  const [draft, setDraft] = useState<SocialDashboardWidget>(() => toCustomDraft(widget));

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

  // Recompute valid chart types whenever dimension/metric changes
  const validChartTypes = getValidChartTypesForCustom(
    draft.customConfig?.dimension,
    draft.customConfig?.metric ?? 'post_count',
  );

  const updateConfig = (config: CustomChartConfig) => {
    setDraft((prev) => {
      const next = { ...prev, customConfig: config };
      const valid = getValidChartTypesForCustom(config.dimension, config.metric);
      if (!valid.includes(next.chartType as SocialChartType)) next.chartType = valid[0];
      return next;
    });
  };

  const updateChartType = (chartType: SocialChartType) => {
    setDraft((prev) => ({ ...prev, chartType }));
  };

  const previewPosts = useMemo(
    () => applyWidgetFilters(filteredPosts, draft.filters),
    [filteredPosts, draft.filters],
  );

  const previewWidget: SocialDashboardWidget = { ...draft, x: 0, y: 0, w: 6, h: 6 };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="sm:max-w-[1100px] max-h-[88vh] flex flex-col p-0 gap-0"
        style={{ marginLeft: dragOffset.x, marginTop: dragOffset.y }}
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
          {/* ── Left: config (55%) ── */}
          <div className="w-[55%] border-r border-border flex flex-col min-h-0 bg-white dark:bg-zinc-950">
            {/* Tabs: Data | Filters | Style */}
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
                  {/* Title */}
                  <div className="flex items-center gap-3">
                    <Label className="text-xs w-24 shrink-0">Title</Label>
                    <Input
                      value={draft.title}
                      onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                      className="h-8 text-xs"
                      placeholder="Widget title"
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

                  <Separator />

                  {/* Chart type selector — grid layout with icon on top, all types visible */}
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

                  {/* Data source: Metric → Aggregation → Group By → Time Bucket */}
                  <DataSourceForm
                    config={draft.customConfig ?? { metric: 'post_count' }}
                    onChange={updateConfig}
                    onChartTypeChange={updateChartType}
                  />
                </TabsContent>

                <TabsContent value="filters" className="mt-0 p-5">
                  <WidgetFilterForm
                    filters={draft.filters ?? {}}
                    availableOptions={availableOptions}
                    onChange={(filters) => setDraft((prev) => ({ ...prev, filters }))}
                  />
                </TabsContent>

                <TabsContent value="style" className="mt-0 p-5">
                  <WidgetStyleForm
                    aggregation={draft.aggregation}
                    kpiIndex={draft.kpiIndex}
                    accent={draft.accent}
                    onKpiIndexChange={(kpiIndex) => setDraft((prev) => ({ ...prev, kpiIndex }))}
                    onAccentChange={(accent) => setDraft((prev) => ({ ...prev, accent }))}
                  />
                </TabsContent>
              </div>
            </Tabs>
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
      </DialogContent>
    </Dialog>
  );
}
