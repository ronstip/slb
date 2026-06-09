import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button.tsx';
import { useTableSort, type SortDir } from './use-table-sort.ts';
import { useIsMobile } from '../../hooks/useIsMobile.ts';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ColumnDef<T> {
  key: string;
  header: string | ReactNode;
  width?: string;
  /** Minimum pixel width. The table grows to the sum of these and scrolls
   *  horizontally once that exceeds the container, instead of squeezing. */
  minWidth?: number;
  align?: 'left' | 'right';
  sortable?: boolean;
  sortKey?: string;
  /** Pin this column to the left edge while the table scrolls horizontally
   *  (mobile-wide tables). Sticky columns must be the leading contiguous run;
   *  `stickyLeftPx` is the cumulative pixel offset of preceding sticky columns. */
  sticky?: boolean;
  stickyLeftPx?: number;
  render: (row: T, idx: number) => ReactNode;
}

/** Fallback min width for columns that don't declare one. */
const DEFAULT_COL_MIN_PX = 120;

/** On narrow viewports, clamp generous label-column minimums so a multi-column
 *  table needs less horizontal scrolling and the first few metrics stay in view. */
const MOBILE_COL_MAX_PX = 150;

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  getRowKey: (row: T) => string;
  pageSize?: number;
  defaultSortKey?: string;
  defaultSortDir?: SortDir;
  emptyMessage?: string;
  renderExpandedRow?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  striped?: boolean;
  density?: 'compact' | 'comfortable';
  /** Body/header text size. Default 'xs'. */
  fontSize?: 'xs' | 'sm' | 'base';
  /** Accent color: overrides `--primary` within the table so in-cell bars /
   *  heatmaps recolor, and (with `headerBold`) tints the header band. */
  accentColor?: string;
  /** Render a bolder, accent-tinted header row. */
  headerBold?: boolean;
}

const FONT_SIZE_CLASS: Record<'xs' | 'sm' | 'base', string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-[15px]',
};

/* ------------------------------------------------------------------ */
/* DataTable                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_PAGE_SIZE = 25;

export function DataTable<T>({
  data,
  columns,
  getRowKey,
  pageSize = DEFAULT_PAGE_SIZE,
  defaultSortKey,
  defaultSortDir = 'desc',
  emptyMessage = 'No data found.',
  renderExpandedRow,
  onRowClick,
  className,
  striped = true,
  density = 'compact',
  fontSize = 'xs',
  accentColor,
  headerBold = false,
}: DataTableProps<T>) {
  const headerPadY = density === 'comfortable' ? 'py-3' : 'py-2';
  const cellPadY = density === 'comfortable' ? 'py-3' : 'py-1.5';
  const cellPadX = density === 'comfortable' ? 'px-3' : 'px-2';
  const hasSorting = defaultSortKey != null;
  const isMobile = useIsMobile(600);

  // Right-edge scroll affordance: a fade overlay shown while the table can
  // still be scrolled further right, so wide tables on mobile read as
  // horizontally scrollable instead of silently truncated.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [data, columns]);
  const { sorted, sortKey, sortDir, handleSort } = useTableSort(
    data,
    defaultSortKey ?? '',
    defaultSortDir,
  );

  const [page, setPage] = useState(0);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const rows = hasSorting ? sorted : data;
  const hasPagination = pageSize > 0 && rows.length > pageSize;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = pageSize > 0
    ? rows.slice(safePage * pageSize, (safePage + 1) * pageSize)
    : rows;

  // Reset page when sort changes
  function onSort(key: string) {
    handleSort(key);
    setPage(0);
  }

  function toggleRow(rowId: string) {
    setExpandedRowId((prev) => (prev === rowId ? null : rowId));
  }

  const isExpandable = renderExpandedRow != null;
  const colCount = columns.length;

  // Sum of per-column minimums: the table claims at least this width and the
  // container scrolls horizontally once it exceeds the viewport, so adding
  // columns no longer squeezes everything into the screen.
  const effMinWidth = (col: ColumnDef<T>): number => {
    const base = col.minWidth ?? DEFAULT_COL_MIN_PX;
    // Sticky identity columns keep their full width (they're pinned, not
    // squeezed); other label columns are clamped on mobile to fit more on screen.
    return isMobile && !col.sticky ? Math.min(base, MOBILE_COL_MAX_PX) : base;
  };
  const minTableWidth = columns.reduce((sum, col) => sum + effMinWidth(col), 0);

  // Class added to a sticky cell to mask the scrolling content beneath it. Falls
  // back to an opaque surface when the row isn't striped (rowBg can be '').
  const stickyCellClasses = (rowBg: string) =>
    `sticky z-10 ${rowBg || 'bg-background'}`;

  // Accent override scoped to the table: in-cell bar/heatmap viz read
  // `var(--primary)`, so setting it here recolors them without touching the
  // global theme. Also used to tint the header band when `headerBold` is on.
  const rootStyle = accentColor
    ? ({ ['--primary' as string]: accentColor } as React.CSSProperties)
    : undefined;
  const theadStyle: React.CSSProperties | undefined = headerBold
    ? { backgroundColor: 'color-mix(in srgb, var(--primary) 14%, var(--card))' }
    : undefined;
  const theadClass = headerBold
    ? 'sticky top-0 z-10 font-semibold text-foreground'
    : 'sticky top-0 z-10 bg-muted';

  return (
    <div className="relative min-h-0 flex-1 flex flex-col" style={rootStyle}>
      <div ref={scrollRef} className={`min-h-0 flex-1 overflow-auto ${className ?? ''}`}>
        <table className={`w-full table-fixed ${FONT_SIZE_CLASS[fontSize]}`} style={{ minWidth: minTableWidth }}>
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} className={col.width ?? ''} />
            ))}
          </colgroup>
          <thead className={theadClass} style={theadStyle}>
            <tr className={`border-b border-border/60 ${headerBold ? '' : 'text-muted-foreground'}`}>
              {columns.map((col) => {
                const isSortable = col.sortable && hasSorting;
                const colSortKey = col.sortKey ?? col.key;
                const isLastSticky = col.sticky && !columns[columns.indexOf(col) + 1]?.sticky;
                return (
                  <th
                    key={col.key}
                    className={`truncate ${cellPadX} ${headerPadY} font-medium ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } ${isSortable ? 'cursor-pointer select-none' : ''} ${
                      col.sticky ? `sticky z-20 ${headerBold ? '' : 'bg-muted'}` : ''
                    } ${isLastSticky ? 'shadow-[1px_0_0_0_var(--border)]' : ''}`}
                    style={col.sticky ? { left: col.stickyLeftPx ?? 0, ...(headerBold ? theadStyle : undefined) } : undefined}
                    title={typeof col.header === 'string' ? col.header : undefined}
                    onClick={isSortable ? () => onSort(colSortKey) : undefined}
                  >
                    {isSortable ? (
                      <span className={`inline-flex items-center gap-0.5 ${col.align === 'right' ? 'justify-end' : ''}`}>
                        {col.header}
                        <SortIcon active={sortKey === colSortKey} dir={sortDir} />
                      </span>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => {
              const rowId = getRowKey(row);
              const isExpanded = expandedRowId === rowId;
              const rowBg = isExpanded
                ? 'bg-accent/50'
                : striped
                  ? idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'
                  : '';

              return (
                <RowGroup key={rowId}>
                  <tr
                    className={`${rowBg} border-b border-border/20 ${isExpandable || onRowClick ? 'cursor-pointer' : ''} transition-colors hover:bg-primary/[0.04]`}
                    onClick={() => {
                      if (isExpandable) toggleRow(rowId);
                      onRowClick?.(row);
                    }}
                  >
                    {columns.map((col) => {
                      const isLastSticky = col.sticky && !columns[columns.indexOf(col) + 1]?.sticky;
                      return (
                        <td
                          key={col.key}
                          className={`${cellPadX} ${cellPadY} overflow-hidden ${col.align === 'right' ? 'text-right' : ''} ${
                            col.sticky ? stickyCellClasses(rowBg) : ''
                          } ${isLastSticky ? 'shadow-[1px_0_0_0_var(--border)]' : ''}`}
                          style={col.sticky ? { left: col.stickyLeftPx ?? 0 } : undefined}
                        >
                          {col.render(row, idx)}
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && renderExpandedRow && (
                    <tr>
                      <td colSpan={colCount} className="border-b border-border bg-card px-4 py-3">
                        <div className="max-h-[290px] overflow-y-auto">
                          {renderExpandedRow(row)}
                        </div>
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="py-12 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Right-edge fade: signals more columns are reachable by scrolling. */}
      {canScrollRight && (
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent"
        />
      )}

      {hasPagination && (
        <div className="flex shrink-0 items-center justify-between border-t border-border/60 bg-muted/20 px-3 py-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            Page <span className="font-medium text-foreground">{safePage + 1}</span> of {totalPages}
            <span className="ml-2 text-[10px]">({rows.length} rows)</span>
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Internal                                                            */
/* ------------------------------------------------------------------ */

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronDown className="h-3 w-3 opacity-30" />;
  return dir === 'desc'
    ? <ChevronDown className="h-3 w-3 text-foreground" />
    : <ChevronUp className="h-3 w-3 text-foreground" />;
}

/** Fragment wrapper for row + expanded row pairs */
function RowGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
