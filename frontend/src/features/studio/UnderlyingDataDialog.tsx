import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { getUnderlyingData, postUnderlyingData, type UnderlyingDataResponse } from '../../api/endpoints/artifacts.ts';
import { formatNumber } from '../../lib/format.ts';
import { PostDataTable } from './PostDataTable.tsx';
import type { DataExportRow } from '../../api/types.ts';

export interface UnderlyingDataFallback {
  collectionIds: string[];
  createdAt: string;
  filterSql?: string;
  sourceSql?: string;
}

interface UnderlyingDataDialogProps {
  artifactId: string | null;
  fallback?: UnderlyingDataFallback;
  onClose: () => void;
}

export function UnderlyingDataDialog({ artifactId, fallback, onClose }: UnderlyingDataDialogProps) {
  const [data, setData] = useState<UnderlyingDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifactId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);

    getUnderlyingData(artifactId)
      .then(setData)
      .catch((err) => {
        if (err?.status === 404 && fallback?.collectionIds?.length) {
          return postUnderlyingData({
            collection_ids: fallback.collectionIds,
            created_at: fallback.createdAt,
            filter_sql: fallback.filterSql,
            source_sql: fallback.sourceSql,
          }).then(setData);
        }
        throw err;
      })
      .catch((err) => setError(err?.message || 'Failed to load underlying data'))
      .finally(() => setLoading(false));
  }, [artifactId, fallback]);

  const rows = (data?.rows ?? []) as DataExportRow[];

  return (
    <Dialog open={!!artifactId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-screen-2xl sm:max-w-screen-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3">
          <DialogTitle className="text-sm font-semibold">Underlying Data</DialogTitle>
          {data && (
            <p className="text-xs text-muted-foreground">
              {formatNumber(data.row_count)} rows · Snapshot: {new Date(data.created_at).toLocaleString()}
            </p>
          )}
        </DialogHeader>

        {loading && (
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex flex-1 items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {data && !loading && rows.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">No rows found.</p>
          </div>
        )}

        {data && !loading && rows.length > 0 && (
          <PostDataTable rows={rows} />
        )}
      </DialogContent>
    </Dialog>
  );
}
