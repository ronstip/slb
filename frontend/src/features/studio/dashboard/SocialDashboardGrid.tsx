import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Sparkles, Check, EyeOff } from 'lucide-react';
import type { DashboardKpis, DashboardPost, TopicMetric } from '../../../api/types.ts';
import type { SocialDashboardWidget, DashboardOrientation, ComputedField } from './types-social-dashboard.ts';
import { SocialWidgetRenderer } from './SocialWidgetRenderer.tsx';
import { buildCompactLayout } from './buildCompactLayout.ts';
import { canPersistDesktopLayout, layoutHasGeometryChange, LG_MIN_WIDTH } from './layout-persist-guard.ts';
import type { AttachedWidget } from './coauthor-context.ts';
import { getWidgetCategoryLabels, getWidgetRenamableLabels } from './widget-labels.ts';

function mergeRefs<T>(...refs: Array<React.Ref<T | null> | undefined | null>) {
  return (node: T | null) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    });
  };
}

const BREAKPOINTS = { lg: LG_MIN_WIDTH, md: 480, sm: 360, xs: 0 };
const COLS = { lg: 12, md: 8, sm: 4, xs: 2 };
const ROW_HEIGHT = 48;
// Inter-widget gap. Matches the Claude design's 14px grid gap (db-app.jsx
// `gap: 14`) for the airier card separation the design calls for.
const MARGIN: [number, number] = [14, 14];

interface SocialDashboardGridProps {
  widgets: SocialDashboardWidget[];
  filteredPosts: DashboardPost[];
  /** Globally-filtered comment rows. Forwarded to comments/both widgets. */
  filteredComments?: DashboardPost[];
  /** Agent-scoped topic_metrics rows. Forwarded to topic widgets. */
  topics?: TopicMetric[];
  isEditMode: boolean;
  orientation?: DashboardOrientation;
  onLayoutChange: (widgets: SocialDashboardWidget[]) => void;
  onConfigure: (widgetId: string) => void;
  onRemove: (widgetId: string) => void;
  onDuplicate?: (widgetId: string) => void;
  onFilterToggle?: (key: string, value: string) => void;
  /** Click-through handler for topic widget items. Undefined disables it
   *  (e.g. on shared/public dashboards or when no agent context). */
  onTopicNavigate?: (clusterId: string) => void;
  gridRef?: React.RefObject<HTMLElement | null>;
  serverKpis?: DashboardKpis;
  /** When set, text widgets call this with a measured ideal grid-row height. */
  onAutoSize?: (i: string, h: number) => void;
  /** True while the AI co-author popover is open - shows the per-widget pin
   *  affordance + selection ring. */
  coAuthorActive?: boolean;
  /** Ids of widgets currently pinned to the co-author message. */
  attachedWidgetIds?: Set<string>;
  /** Toggle a widget's pin. Receives id + current title for the chip. */
  onToggleAttachWidget?: (w: AttachedWidget) => void;
  /** Report-level value colors (field → value → hex). Applied as the base
   *  series-color layer; per-widget overrides win. */
  reportValueColors?: Record<string, Record<string, string>>;
  /** Report-level computed fields. Forwarded so widgets can aggregate `expr`
   *  computed metrics. */
  reportComputedFields?: ComputedField[];
}

// A4 portrait/landscape content-width ratio (after page margins). Used to
// constrain the on-screen grid to roughly match the PDF page proportions
// when the user picks a vertical layout.
const VERTICAL_WIDTH_RATIO = 0.69;

export function SocialDashboardGrid({
  widgets,
  filteredPosts,
  filteredComments,
  topics,
  isEditMode,
  orientation = 'horizontal',
  onLayoutChange,
  onConfigure,
  onRemove,
  onDuplicate,
  onFilterToggle,
  onTopicNavigate,
  gridRef,
  serverKpis,
  onAutoSize,
  coAuthorActive = false,
  attachedWidgetIds,
  onToggleAttachWidget,
  reportValueColors,
  reportComputedFields,
}: SocialDashboardGridProps) {
  const [currentBreakpoint, setCurrentBreakpoint] = useState<string>('lg');
  const isDragging = useRef(false);
  const { width, containerRef } = useContainerWidth({ initialWidth: 1280 });
  // Latest measured width, read by the persist guard. Kept in a ref so
  // handleLayoutChange has a STABLE identity across the ResizeObserver's
  // per-pixel width ticks - otherwise its identity churns every tick, which
  // re-subscribes RGL's onLayoutChange effect and adds to the relayout thrash
  // when the container is resizing (e.g. toggling device emulation).
  const widthRef = useRef(width);
  widthRef.current = width;

  // Intrinsic aspect ratios of media widgets, reported by MediaWidget once the
  // image/video loads. Used to size media cells to their natural proportions on
  // compact (mobile) breakpoints instead of inheriting the desktop row count.
  const [mediaAspect, setMediaAspect] = useState<Record<string, number>>({});
  const handleMediaAspect = useCallback((id: string, ratio: number) => {
    setMediaAspect((prev) =>
      // Ignore sub-pixel jitter so a reload can't churn the layout.
      Math.abs((prev[id] ?? 0) - ratio) < 0.01 ? prev : { ...prev, [id]: ratio },
    );
  }, []);

  // Viewport-based mobile flag. Independent of the grid's measured container
  // width so toggling the vertical clamp can't feed back into the breakpoint
  // calculation and oscillate. The 600 threshold matches BREAKPOINTS.lg.
  const [isNarrowViewport, setIsNarrowViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 600 : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 599px)');
    const update = () => setIsNarrowViewport(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const lgLayout: LayoutItem[] = useMemo(
    () =>
      widgets.map((w) => ({
        i: w.i,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: w.chartType === 'number-card' || w.aggregation === 'media' ? 2 : 3,
        // Text/embed cards are content-scrollable, so allow them to shrink below the
        // generic 3-row floor for fine manual sizing. Text cards go all the way to a
        // single row so a one-line title (~34px) can hug its row without a fixed gap;
        // embeds and media keep a 2-row floor (an embed needs vertical room; media
        // just scales the image/video to fit, so a small 2-row card is fine).
        minH: w.chartType === 'number-card' || w.aggregation === 'text'
          ? 1
          : w.aggregation === 'embeds' || w.aggregation === 'media' || w.aggregation === 'html'
            ? 2
            : 3,
        isDraggable: isEditMode && currentBreakpoint === 'lg',
        isResizable: isEditMode && currentBreakpoint === 'lg',
      })),
    [widgets, isEditMode, currentBreakpoint],
  );

  // Rebuilt only when an input that actually shapes the compact layouts changes
  // (widgets, measured width, the mobile inset, or a media cell's measured
  // aspect). Without this the three buildCompactLayout passes ran on every
  // render — including each resize tick and every unrelated state change.
  // Measured compact-breakpoint heights for content that reflows on a narrow
  // viewport (text/embed/html snippets fit a different height than the desktop
  // cell). Kept LOCAL and disposable: feeding these back into the persisted
  // `widget.h` would let a mobile measurement corrupt the authored desktop
  // layout (the cell would stay mobile-tall after the user widens back, and an
  // edit could persist it). The lg layout always uses the authored `h`.
  const [compactHeights, setCompactHeights] = useState<Record<string, number>>({});

  const layouts = useMemo(() => {
    // Pixel width of a full-width compact cell = grid width minus the horizontal
    // container padding (see `containerPadding` below - 4px each side on mobile).
    // Feeds media aspect-ratio sizing in buildCompactLayout.
    const compactOptions = {
      mediaAspect,
      fullWidthPx: Math.max(0, width - (isNarrowViewport ? 8 : 0)),
      heightOverrides: compactHeights,
    };
    return {
      lg: lgLayout,
      md: buildCompactLayout(widgets, COLS.md, compactOptions),
      sm: buildCompactLayout(widgets, COLS.sm, compactOptions),
      xs: buildCompactLayout(widgets, COLS.xs, compactOptions),
    };
  }, [lgLayout, widgets, mediaAspect, width, isNarrowViewport, compactHeights]);

  // Id of the widget the user just resized, captured on resize-stop and consumed
  // by the very next handleLayoutChange (RGL fires onResizeStop then
  // onLayoutChange synchronously). We fold `manualHeight` into the same layout
  // commit instead of a separate setWidgets so the flag can't be clobbered by
  // this concrete commit, and so it never rebuilds `layouts` mid-gesture.
  const pendingResizeId = useRef<string | null>(null);

  const handleLayoutChange = useCallback(
    (layout: Layout) => {
      // Only persist the desktop (lg) layout - compact md/sm/xs layouts are
      // auto-derived and disposable. Gate on the LIVE measured `width` (the same
      // value RGL breakpoints on), NOT `currentBreakpoint`: when the container
      // narrows, RGL fires onBreakpointChange + onLayoutChange in one commit, so
      // currentBreakpoint is still a stale 'lg' here while RGL has already handed
      // us the 2-col xs layout. Trusting it persisted x=0/w=2 for every widget -
      // the single-column corruption. See layout-persist-guard.ts.
      if (!canPersistDesktopLayout(isEditMode, isDragging.current, widthRef.current)) return;
      const resizedId = pendingResizeId.current;
      // Skip no-op re-fires. RGL calls onLayoutChange even when it merely
      // re-applied its own compacted layout (nothing moved); committing anyway
      // churns widgets → layouts → RGL → onLayoutChange in an infinite
      // "Maximum update depth exceeded" loop (most easily triggered right after
      // a story rewrite, when our row-packed layout and RGL's vertical
      // compaction disagree by a row). A pending manual resize still commits so
      // `manualHeight` gets recorded even on a same-size resize.
      if (resizedId == null && !layoutHasGeometryChange(widgets, layout)) return;
      pendingResizeId.current = null;
      const updated = widgets.map((w) => {
        const item = layout.find((l) => l.i === w.i);
        if (!item) return w;
        const next = { ...w, x: item.x, y: item.y, w: item.w, h: item.h };
        // The user took manual control of this card's height - stop auto-fitting.
        if (w.i === resizedId) next.manualHeight = true;
        return next;
      });
      onLayoutChange(updated);
    },
    [widgets, isEditMode, onLayoutChange],
  );

  const canInteract = isEditMode && currentBreakpoint === 'lg';

  // Non-lg breakpoints reflow each widget to a single narrow column. HTML
  // marketing snippets reflow their own internal layout there too, so their
  // content height no longer matches the desktop-authored cell. Flag it so
  // HtmlWidget auto-sizes to the reflowed content (and skips zoom-to-fit, which
  // would otherwise shrink the taller mobile layout into the desktop cell).
  const compact = currentBreakpoint !== 'lg';

  // Route auto-size measurements by breakpoint. On desktop (lg) they persist to
  // the canonical `widget.h` via the parent handler. On a compact breakpoint
  // they stay in local `compactHeights` so the disposable mobile layout never
  // rewrites the authored desktop heights. Gate on the LIVE measured width (not
  // the lagging `currentBreakpoint` state) for the same reason the persist
  // guard does - RGL fires onBreakpointChange + the measurement together.
  const handleWidgetAutoSize = useCallback(
    (id: string, h: number) => {
      if (widthRef.current >= LG_MIN_WIDTH) {
        onAutoSize?.(id, h);
      } else {
        setCompactHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
      }
    },
    [onAutoSize],
  );

  // The vertical (A4 portrait) clamp is for desktop PDF parity. On a narrow
  // viewport it would shrink the dashboard to ~69% of an already small screen
  // - skip it. Gated on viewport width (not the RGL-derived breakpoint) so the
  // clamp can't toggle its own input width and oscillate.
  const containerStyle: React.CSSProperties =
    orientation === 'vertical' && !isNarrowViewport
      ? { maxWidth: `${VERTICAL_WIDTH_RATIO * 100}%`, marginLeft: 'auto', marginRight: 'auto' }
      : {};

  // Side padding lives on the outer page container (px-7 ≈ 28px, matching the
  // design's page margin); the grid itself sits flush so we don't double up.
  // Mobile keeps a little inset so card shadows don't clip the viewport edge.
  const containerPadding: [number, number] = isNarrowViewport ? [4, 8] : [0, 8];

  return (
    <div
      ref={mergeRefs(containerRef, gridRef)}
      className="w-full"
      style={containerStyle}
    >
      <ResponsiveGridLayout
        className="layout"
        width={width}
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={MARGIN}
        containerPadding={containerPadding}
        dragConfig={{ enabled: canInteract, handle: '.drag-handle' }}
        resizeConfig={{ enabled: canInteract }}
        onBreakpointChange={(bp) => setCurrentBreakpoint(bp)}
        onLayoutChange={handleLayoutChange}
        onDragStart={() => { isDragging.current = true; }}
        onDragStop={() => { isDragging.current = false; }}
        onResizeStop={(_layout, oldItem, newItem) => {
          // Record which card was resized; the immediately-following
          // handleLayoutChange folds `manualHeight: true` into the same commit.
          pendingResizeId.current = newItem?.i ?? oldItem?.i ?? null;
        }}
      >
        {widgets.map((widget, widgetIndex) => {
          const attached = attachedWidgetIds?.has(widget.i) ?? false;
          const dimmedHidden = isEditMode && widget.hidden === true;
          return (
            <div
              key={widget.i}
              className={
                [
                  coAuthorActive && attached
                    ? 'rounded-xl ring-2 ring-primary ring-offset-1 ring-offset-background'
                    : '',
                  dimmedHidden ? 'opacity-50' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            >
              {dimmedHidden && (
                <span
                  className="absolute left-1.5 top-1.5 z-20 inline-flex items-center gap-1 rounded-md border border-border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                  title="Hidden in view mode and on shared dashboards"
                >
                  <EyeOff className="h-3 w-3" />
                  Hidden
                </span>
              )}
              {coAuthorActive && onToggleAttachWidget && (
                <button
                  type="button"
                  data-coauthor-attach
                  onClick={() =>
                    onToggleAttachWidget({
                      i: widget.i,
                      title: widget.title,
                      // Attach the chart's exact category labels so the agent can
                      // recolor each slice ("make it colorful") and rename the
                      // category text ("Ugc" → "UGC") instead of being blind to
                      // data-derived names. Color keys = colorable series only;
                      // rename keys also include the x-axis categories.
                      labels: getWidgetCategoryLabels(widget, filteredPosts, topics),
                      renamableLabels: getWidgetRenamableLabels(widget, filteredPosts, topics),
                    })
                  }
                  title={attached ? 'Unpin from AI message' : 'Pin to AI message'}
                  aria-pressed={attached}
                  className={`absolute right-1.5 top-1.5 z-20 inline-flex h-6 w-6 items-center justify-center rounded-md border shadow-sm transition-colors ${
                    attached
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background/90 text-muted-foreground hover:text-primary hover:border-primary/50'
                  }`}
                >
                  {attached ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              <SocialWidgetRenderer
                widget={widget}
                widgetIndex={widgetIndex}
                filteredPosts={filteredPosts}
                filteredComments={filteredComments}
                topics={topics}
                isEditMode={isEditMode}
                onConfigure={onConfigure}
                onRemove={onRemove}
                onDuplicate={onDuplicate}
                onFilterToggle={onFilterToggle}
                onTopicNavigate={onTopicNavigate}
                serverKpis={serverKpis}
                onAutoSize={handleWidgetAutoSize}
                onMediaAspect={handleMediaAspect}
                compact={compact}
                reportValueColors={reportValueColors}
                reportComputedFields={reportComputedFields}
              />
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
