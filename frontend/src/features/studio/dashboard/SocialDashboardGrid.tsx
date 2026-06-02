import { useCallback, useEffect, useRef, useState } from 'react';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { DashboardKpis, DashboardPost, TopicMetric } from '../../../api/types.ts';
import type { SocialDashboardWidget, DashboardOrientation } from './types-social-dashboard.ts';
import { SocialWidgetRenderer } from './SocialWidgetRenderer.tsx';
import { buildCompactLayout } from './buildCompactLayout.ts';

function mergeRefs<T>(...refs: Array<React.Ref<T | null> | undefined | null>) {
  return (node: T | null) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    });
  };
}

const BREAKPOINTS = { lg: 600, md: 480, sm: 360, xs: 0 };
const COLS = { lg: 12, md: 8, sm: 4, xs: 2 };
const ROW_HEIGHT = 48;
const MARGIN: [number, number] = [6, 6];

interface SocialDashboardGridProps {
  widgets: SocialDashboardWidget[];
  filteredPosts: DashboardPost[];
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
}

// A4 portrait/landscape content-width ratio (after page margins). Used to
// constrain the on-screen grid to roughly match the PDF page proportions
// when the user picks a vertical layout.
const VERTICAL_WIDTH_RATIO = 0.69;

export function SocialDashboardGrid({
  widgets,
  filteredPosts,
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
}: SocialDashboardGridProps) {
  const [currentBreakpoint, setCurrentBreakpoint] = useState<string>('lg');
  const isDragging = useRef(false);
  const { width, containerRef } = useContainerWidth({ initialWidth: 1280 });

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

  const lgLayout: LayoutItem[] = widgets.map((w) => ({
    i: w.i,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    minW: w.chartType === 'number-card' ? 2 : 3,
    minH: w.chartType === 'number-card' ? 1 : 3,
    isDraggable: isEditMode && currentBreakpoint === 'lg',
    isResizable: isEditMode && currentBreakpoint === 'lg',
  }));

  const layouts = {
    lg: lgLayout,
    md: buildCompactLayout(widgets, COLS.md),
    sm: buildCompactLayout(widgets, COLS.sm),
    xs: buildCompactLayout(widgets, COLS.xs),
  };

  const handleLayoutChange = useCallback(
    (layout: Layout) => {
      // Only persist lg-breakpoint positions - compact layouts are auto-derived
      if (!isEditMode || isDragging.current || currentBreakpoint !== 'lg') return;
      const updated = widgets.map((w) => {
        const item = layout.find((l) => l.i === w.i);
        if (!item) return w;
        return { ...w, x: item.x, y: item.y, w: item.w, h: item.h };
      });
      onLayoutChange(updated);
    },
    [widgets, isEditMode, onLayoutChange, currentBreakpoint],
  );

  const canInteract = isEditMode && currentBreakpoint === 'lg';

  // The vertical (A4 portrait) clamp is for desktop PDF parity. On a narrow
  // viewport it would shrink the dashboard to ~69% of an already small screen
  // - skip it. Gated on viewport width (not the RGL-derived breakpoint) so the
  // clamp can't toggle its own input width and oscillate.
  const containerStyle: React.CSSProperties =
    orientation === 'vertical' && !isNarrowViewport
      ? { maxWidth: `${VERTICAL_WIDTH_RATIO * 100}%`, marginLeft: 'auto', marginRight: 'auto' }
      : {};

  // Tighter side padding on mobile so widgets get more of the viewport.
  const containerPadding: [number, number] = isNarrowViewport ? [4, 8] : [12, 8];

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
      >
        {widgets.map((widget) => (
          <div key={widget.i}>
            <SocialWidgetRenderer
              widget={widget}
              filteredPosts={filteredPosts}
              topics={topics}
              isEditMode={isEditMode}
              onConfigure={() => onConfigure(widget.i)}
              onRemove={() => onRemove(widget.i)}
              onDuplicate={onDuplicate ? () => onDuplicate(widget.i) : undefined}
              onFilterToggle={onFilterToggle}
              onTopicNavigate={onTopicNavigate}
              serverKpis={serverKpis}
              onAutoSize={onAutoSize}
            />
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
