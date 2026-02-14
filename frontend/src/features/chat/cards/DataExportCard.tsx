import { Download, Table2 } from 'lucide-react';
import type { DataExportResult } from '../../../api/types.ts';
import { downloadCsv, CSV_COLUMNS } from '../../../lib/download-csv.ts';

interface DataExportCardProps {
  data: Record<string, unknown>;
}

const PREVIEW_ROWS = 5;

export function DataExportCard({ data }: DataExportCardProps) {
  const exportData = data as unknown as DataExportResult;
  const { rows, row_count, message } = exportData;

  const previewRows = rows.slice(0, PREVIEW_ROWS);

  const handleDownload = () => {
    downloadCsv(rows, `data-export-${Date.now()}`);
  };

  if (row_count === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-border/40 bg-background p-4">
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-background shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Table2 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Data Export</h4>
            <p className="text-xs text-muted-foreground">{row_count} posts</p>
          </div>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Download className="h-3.5 w-3.5" />
          Download CSV
        </button>
      </div>

      {/* Preview table */}
      <div className="border-t border-primary/10 px-5 pb-4">
        <p className="py-2 text-xs text-muted-foreground">
          Preview (first {previewRows.length} of {row_count} rows)
        </p>
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-secondary">
                {CSV_COLUMNS.map((col) => (
                  <th key={col.key} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} className="border-t border-border/30">
                  {CSV_COLUMNS.map((col) => (
                    <td key={col.key} className="max-w-[180px] truncate px-3 py-2 text-foreground whitespace-nowrap">
                      {row[col.key as keyof typeof row] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
