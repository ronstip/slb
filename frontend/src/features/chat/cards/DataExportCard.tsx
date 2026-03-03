import { useState, useCallback } from 'react';
import { Table2, Download, ExternalLink } from 'lucide-react';
import { Card } from '../../../components/ui/card.tsx';
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
    <Card className="mt-3 overflow-hidden rounded-md">
      <div className="flex items-center gap-3 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10">
          <Table2 className="h-5 w-5 text-accent-blue" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">Data Export</p>
          <p className="text-xs text-muted-foreground/70">
            {row_count} posts · saved to artifacts
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {_artifactId && (
            <button
              onClick={handleView}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              View
            </button>
          )}
          {collection_id && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <Download className="h-3 w-3" />
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
