import { useState } from 'react';
import { Download, Table2, Eye } from 'lucide-react';
import type { DataExportResult } from '../../../api/types.ts';
import { downloadCollection } from '../../../api/endpoints/collections.ts';
import { ExportTableModal } from './ExportTableModal.tsx';

interface DataExportCardProps {
  data: Record<string, unknown>;
}

export function DataExportCard({ data }: DataExportCardProps) {
  const exportData = data as unknown as DataExportResult;
  const { rows, row_count, message, collection_id } = exportData;
  const [tableOpen, setTableOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!collection_id) return;
    setDownloading(true);
    try {
      await downloadCollection(collection_id, 'Data Export');
    } finally {
      setDownloading(false);
    }
  };

  if (row_count === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-border/40 bg-background p-4">
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-3 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-background shadow-sm">
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTableOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Eye className="h-3.5 w-3.5" />
              View Table
            </button>
            {collection_id && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                {downloading ? 'Downloading…' : 'Download CSV'}
              </button>
            )}
          </div>
        </div>
      </div>

      <ExportTableModal
        rows={rows}
        title="Data Export"
        open={tableOpen}
        onClose={() => setTableOpen(false)}
      />
    </>
  );
}
