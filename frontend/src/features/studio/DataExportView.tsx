import { useState } from 'react';
import { ArrowLeft, Download, Eye, Table2 } from 'lucide-react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { downloadCollection } from '../../api/endpoints/collections.ts';
import { ExportTableModal } from '../chat/cards/ExportTableModal.tsx';

interface DataExportViewProps {
  artifact: Extract<Artifact, { type: 'data_export' }>;
}

export function DataExportView({ artifact }: DataExportViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const [tableOpen, setTableOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    const collectionId = artifact.sourceIds[0];
    if (!collectionId) return;
    setDownloading(true);
    try {
      await downloadCollection(collectionId, artifact.title);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTableOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <Eye className="h-3.5 w-3.5" />
              View Table
            </button>
            {artifact.sourceIds[0] && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                {downloading ? 'Downloading…' : 'Download CSV'}
              </button>
            )}
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-2.5">
            <Table2 className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-base font-semibold text-foreground">{artifact.title}</h3>
              <p className="text-xs text-muted-foreground">
                {artifact.rowCount} posts · {artifact.columnNames.length} columns
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Click "View Table" to browse and sort all {artifact.rowCount} posts.
          </p>
        </div>
      </div>

      <ExportTableModal
        rows={artifact.rows}
        title={artifact.title}
        open={tableOpen}
        onClose={() => setTableOpen(false)}
      />
    </>
  );
}
