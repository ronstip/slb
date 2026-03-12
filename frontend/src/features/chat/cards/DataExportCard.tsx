import { useState, useCallback } from 'react';
import { Table2, Download } from 'lucide-react';
import type { DataExportResult } from '../../../api/types.ts';
import { downloadCollection } from '../../../api/endpoints/collections.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { formatNumber } from '../../../lib/format.ts';

interface DataExportCardProps {
  data: Record<string, unknown>;
}

export function DataExportCard({ data }: DataExportCardProps) {
  const exportData = data as unknown as DataExportResult & { _artifactId?: string; title?: string; collection_name?: string };
  const { row_count, message, collection_id, _artifactId } = exportData;
  const title = exportData.title || 'Data Export';
  const collectionName = exportData.collection_name;
  const [downloading, setDownloading] = useState(false);

  const handleView = useCallback(() => {
    if (!_artifactId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(_artifactId);
  }, [_artifactId]);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
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
      <div className="rounded-2xl border border-border/40 bg-background p-4">
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  const meta = collectionName
    ? `${formatNumber(row_count)} posts from ${collectionName}`
    : `${formatNumber(row_count)} posts`;

  return (
    <div onClick={handleView} className="cursor-pointer overflow-hidden rounded-2xl border border-accent-blue/20 bg-gradient-to-b from-accent-blue/5 to-background shadow-sm transition-colors hover:border-accent-blue/40">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10">
            <Table2 className="h-4 w-4 text-accent-blue" />
          </div>
          <div className="flex flex-col min-w-0">
            <h4 className="text-sm font-semibold text-foreground truncate">{title}</h4>
            <p className="text-[11px] text-muted-foreground truncate">{meta}</p>
          </div>
        </div>
        {collection_id && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            title={downloading ? 'Downloading...' : 'Download CSV'}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
