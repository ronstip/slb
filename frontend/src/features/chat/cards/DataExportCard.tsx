import { useState, useCallback } from 'react';
import { Table2, Download } from 'lucide-react';
import type { DataExportResult, DataExportRow } from '../../../api/types.ts';
import { downloadCollection } from '../../../api/endpoints/collections.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { DataTable, previewColumns } from '../../../components/DataTable/index.ts';
import { formatNumber } from '../../../lib/format.ts';

interface DataExportCardProps {
  data: Record<string, unknown>;
}

const PREVIEW_ROWS = 3;

const columns = previewColumns<DataExportRow>();

export function DataExportCard({ data }: DataExportCardProps) {
  const exportData = data as unknown as DataExportResult & { _artifactId?: string; title?: string; collection_name?: string };
  const { row_count, message, collection_id, _artifactId, rows } = exportData;
  const title = exportData.title || 'Data Export';
  const collectionName = exportData.collection_name;
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

  const previewRows = (rows ?? []).slice(0, PREVIEW_ROWS) as DataExportRow[];
  const meta = collectionName
    ? `${formatNumber(row_count)} posts from ${collectionName}`
    : `${formatNumber(row_count)} posts`;

  return (
    <div onClick={handleView} className="mt-3 cursor-pointer overflow-hidden rounded-2xl border border-accent-blue/20 bg-gradient-to-b from-accent-blue/5 to-background shadow-sm transition-colors hover:border-accent-blue/40">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-blue/10">
            <Table2 className="h-4 w-4 text-accent-blue" />
          </div>
          <div className="flex flex-col">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <p className="text-[11px] text-muted-foreground">{meta}</p>
          </div>
        </div>
        {collection_id && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDownload(); }}
            disabled={downloading}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            title={downloading ? 'Downloading...' : 'Download CSV'}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Mini table preview */}
      {previewRows.length > 0 && (
        <div className="mx-4 mb-3 overflow-hidden rounded-lg border border-border/50">
          <DataTable
            data={previewRows}
            columns={columns}
            getRowKey={(r) => r.post_id}
            pageSize={0}
            striped={false}
            className="text-[11px] [&_th]:bg-muted/40 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-muted-foreground [&_td]:px-2.5 [&_td]:py-1.5 [&_tr]:border-b [&_tr]:border-border/30 [&_tr:last-child]:border-b-0 [&_thead_tr]:border-border/50"
          />
          {row_count > PREVIEW_ROWS && (
            <div className="border-t border-border/30 bg-muted/20 px-2.5 py-1 text-center text-[10px] text-muted-foreground">
              +{formatNumber(row_count - PREVIEW_ROWS)} more rows
            </div>
          )}
        </div>
      )}
    </div>
  );
}
