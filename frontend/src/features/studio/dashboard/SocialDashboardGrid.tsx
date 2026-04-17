import { useCallback, useRef, useState } from 'react';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { DashboardKpis, DashboardPost } from '../../../api/types.ts';
import type { SocialDashboardWidget } from './types-social-dashboard.ts';
import { SocialWidgetRenderer } from './SocialWidgetRenderer.tsx';

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

function buildCompactLayout(widgets: SocialDashboardWidget[], cols: number): LayoutItem[] {
  const isNumberCard = (w: SocialDashboardWidget) => w.chartType === 'number-card';
  const cards = widgets.filter(isNumberCard);
  const charts = widgets.filter((w) => !isNumberCard(w));

  const layout: LayoutItem[] = [];
  let y = 0;

  const cardW = Math.max(1, Math.floor(cols / Math.max(cards.length, 1)));
  cards.forEach((w, i) => {
    layout.push({ i: w.i, x: i * cardW, y: 0, w: cardW, h: 2 });
  });
  if (cards.length > 0) y = 2;

  charts.forEach((w) => {
    layout.push({ i: w.i, x: 0, y, w: cols, h: Math.max(w.h, 4) });
    y += Math.max(w.h, 4);
  });

  return layout;
}

interface SocialDashboardGridProps {
  widgets: SocialDashboardWidget[];
  filteredPosts: DashboardPost[];
  isEditMode: boolean;
  onLayoutChange: (widgets: SocialDashboardWidget[]) => void;
  onConfigure: (widgetId: string) => void;
  onRemove: (widgetId: string) => void;
  onDuplicate?: (widgetId: string) => void;
  onFilterToggle?: (key: string, value: string) => void;
  gridRef?: React.RefObject<HTMLElement | null>;
  serverKpis?: DashboardKpis;
}

export function SocialDashboardGrid({
  widgets,
  filteredPosts,
  isEditMode,
  onLayoutChange,
  onConfigure,
  onRemove,
  onDuplicate,
  onFilterToggle,
  gridRef,
  serverKpis,
}: SocialDashboardGridProps) {
  const [currentBreakpoint, setCurrentBreakpoint] = useState<string>('lg');
  const isDragging = useRef(false);
  const { width, containerRef } = useContainerWidth({ initialWidth: 1280 });

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
      // Only persist lg-breakpoint positions — compact layouts are auto-derived
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

  return (
    <div ref={mergeRefs(containerRef, gridRef)} className="w-full">
      <ResponsiveGridLayout
        className="layout"
        width={width}
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={MARGIN}
        containerPadding={[12, 8]}
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
              isEditMode={isEditMode}
              onConfigure={() => onConfigure(widget.i)}
              onRemove={() => onRemove(widget.i)}
              onDuplicate={onDuplicate ? () => onDuplicate(widget.i) : undefined}
              onFilterToggle={onFilterToggle}
              serverKpis={serverKpis}
            />
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
