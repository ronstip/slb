import { useState, useCallback } from 'react';
import { Table2, Download, Eye } from 'lucide-react';
import type { DataExportResult } from '../../../api/types.ts';
import { downloadCollection } from '../../../api/endpoints/collections.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';

interface DataExportCardProps {
  data: Record<string, unknown>;
}

export function DataExportCard({ data }: DataExportCardProps) {
  const exportData = data as unknown as DataExportResult & { _artifactId?: string };
  const { row_count, message, collection_id, _artifactId } = exportData;
  const [downloading, setDownloading] = useState(false);

  const handleView = useCallback(() => {
    if (!_artifactId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(_artifactId);
  }, [_artifactId]);

  const handleDownload = useCallback(async () => {
    if (!collection_id) return;
    setDownloading(true);
    try {
      await downloadCollection(collection_id, 'Data Export');
    } finally {
      setDownloading(false);
    }
  }, [collection_id]);

  if (row_count === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-border/40 bg-background p-4">
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  return (
    <div onClick={handleView} className="mt-3 cursor-pointer overflow-hidden rounded-2xl border border-accent-blue/20 bg-gradient-to-b from-accent-blue/5 to-background shadow-sm transition-colors hover:bg-accent-blue/5">
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-blue/10">
            <Table2 className="h-4 w-4 text-accent-blue" />
          </div>
          <div className="flex flex-col">
            <h4 className="text-sm font-semibold text-foreground">Table</h4>
            <p className="text-[11px] text-muted-foreground">
              {row_count} posts · saved to artifacts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {_artifactId && (
            <button
              onClick={handleView}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="View in Studio"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          )}
          {collection_id && (
            <button
              onClick={(e) => { e.stopPropagation(); handleDownload(); }}
              disabled={downloading}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
              title={downloading ? 'Downloading…' : 'Download CSV'}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
