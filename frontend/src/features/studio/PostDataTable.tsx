import { ArrowLeft, Download, Table2 } from 'lucide-react';
import { DataTable, postColumns, ExpandedPostRow, parseMediaRefs } from '../../components/DataTable/index.ts';
import { PostCard } from './PostCard.tsx';
import { formatNumber } from '../../lib/format.ts';
import type { DataExportRow, FeedPost } from '../../api/types.ts';

interface PostDataTableProps {
  rows: DataExportRow[];
  emptyMessage?: string;
  /** When provided, renders the shared artifact header bar */
  onBack?: () => void;
  backLabel?: string;
  rowCount?: number;
  onDownload?: () => void;
  downloadLabel?: string;
  downloading?: boolean;
  onShowData?: () => void;
}

const columns = postColumns<DataExportRow>({
  hoverContent: (row) => <PostCard post={rowToFeedPost(row)} />,
});

export function PostDataTable({
  rows,
  emptyMessage = 'No posts found.',
  onBack,
  backLabel = 'Back to Studio',
  rowCount,
  onDownload,
  downloadLabel = 'Download CSV',
  downloading,
  onShowData,
}: PostDataTableProps) {
  return (
    <>
      {onBack && (
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-secondary px-3 py-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </button>
          <div className="flex items-center gap-1.5">
            {rowCount != null && (
              <span className="text-xs text-muted-foreground">
                {formatNumber(rowCount)} posts
              </span>
            )}
            {onShowData && (
              <button
                onClick={onShowData}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <Table2 className="h-3.5 w-3.5" />
                Data
              </button>
            )}
            {onDownload && (
              <button
                onClick={onDownload}
                disabled={downloading}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                {downloadLabel}
              </button>
            )}
          </div>
        </div>
      )}
      <DataTable
        data={rows}
        columns={columns}
        getRowKey={(r) => r.post_id}
        defaultSortKey="views"
        emptyMessage={emptyMessage}
        renderExpandedRow={(row) => <ExpandedPostRow row={row} />}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Internal helper                                                     */
/* ------------------------------------------------------------------ */

function rowToFeedPost(row: DataExportRow): FeedPost {
  return {
    post_id: row.post_id,
    platform: row.platform,
    channel_handle: row.channel_handle,
    title: row.title ?? undefined,
    content: row.content ?? undefined,
    post_url: row.post_url,
    posted_at: row.posted_at,
    post_type: row.post_type,
    media_refs: parseMediaRefs(row.media_refs),
    likes: row.likes ?? undefined,
    shares: row.shares ?? undefined,
    views: row.views ?? undefined,
    comments_count: row.comments_count ?? undefined,
    total_engagement: row.total_engagement,
    sentiment: row.sentiment ?? undefined,
    emotion: row.emotion ?? undefined,
    themes: row.themes ? row.themes.split(';').map((t) => t.trim()).filter(Boolean) : undefined,
    entities: row.entities ? row.entities.split(';').map((e) => e.trim()).filter(Boolean) : undefined,
    ai_summary: row.ai_summary ?? undefined,
    content_type: row.content_type ?? undefined,
    key_quotes: row.key_quotes ?? undefined,
  };
}
