import { ArrowLeft, Download, Table2 } from 'lucide-react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { downloadCsv, CSV_COLUMNS } from '../../lib/download-csv.ts';

interface DataExportViewProps {
  artifact: Extract<Artifact, { type: 'data_export' }>;
}

const DISPLAY_ROWS = 20;

export function DataExportView({ artifact }: DataExportViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);

  const handleDownload = () => {
    downloadCsv(artifact.rows, `data-export-${artifact.id}`);
  };

  const displayRows = artifact.rows.slice(0, DISPLAY_ROWS);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
        <button
          onClick={collapseReport}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
          Download CSV
        </button>
      </div>

      <div className="p-4">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <Table2 className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-base font-semibold text-foreground">{artifact.title}</h3>
            <p className="text-xs text-muted-foreground">
              {artifact.rowCount} posts · {artifact.columnNames.length} columns
              {artifact.rowCount > DISPLAY_ROWS && ` · showing first ${DISPLAY_ROWS}`}
            </p>
          </div>
        </div>

        {/* Data table */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
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
              {displayRows.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {CSV_COLUMNS.map((col) => (
                    <td key={col.key} className="max-w-[200px] truncate px-3 py-2 text-foreground whitespace-nowrap">
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
