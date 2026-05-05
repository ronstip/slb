import { useState, type ReactNode } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button.tsx';
import { useTableSort, type SortDir } from './use-table-sort.ts';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ColumnDef<T> {
  key: string;
  header: string | ReactNode;
  width?: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  sortKey?: string;
  render: (row: T, idx: number) => ReactNode;
}

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
}

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
}: DataTableProps<T>) {
  const headerPadY = density === 'comfortable' ? 'py-3' : 'py-2';
  const cellPadY = density === 'comfortable' ? 'py-3' : 'py-1.5';
  const cellPadX = density === 'comfortable' ? 'px-3' : 'px-2';
  const hasSorting = defaultSortKey != null;
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

  return (
    <>
      <div className={`min-h-0 flex-1 overflow-auto ${className ?? ''}`}>
        <table className="w-full table-fixed text-xs">
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} className={col.width ?? ''} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="border-b border-border/60 text-muted-foreground">
              {columns.map((col) => {
                const isSortable = col.sortable && hasSorting;
                const colSortKey = col.sortKey ?? col.key;
                return (
                  <th
                    key={col.key}
                    className={`truncate ${cellPadX} ${headerPadY} font-medium ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } ${isSortable ? 'cursor-pointer select-none' : ''}`}
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
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`${cellPadX} ${cellPadY} overflow-hidden ${col.align === 'right' ? 'text-right' : ''}`}
                      >
                        {col.render(row, idx)}
                      </td>
                    ))}
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
    </>
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
