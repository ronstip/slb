import { useState } from 'react';
import { ArrowLeft, Download, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { downloadCollection } from '../../api/endpoints/collections.ts';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';
import { Button } from '../../components/ui/button.tsx';
import type { DataExportRow } from '../../api/types.ts';

interface DataExportViewProps {
  artifact: Extract<Artifact, { type: 'data_export' }>;
}

type SortKey = 'posted_at' | 'likes' | 'views' | 'comments_count';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

export function DataExportView({ artifact }: DataExportViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const [downloading, setDownloading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('views');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

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

  const sorted = [...artifact.rows].sort((a, b) => {
    let av = (a[sortKey] ?? 0) as number | string;
    let bv = (b[sortKey] ?? 0) as number | string;
    if (sortKey === 'posted_at') {
      av = String(av);
      bv = String(bv);
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    av = Number(av);
    bv = Number(bv);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(0);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (col !== sortKey) return <ChevronDown className="h-3 w-3 opacity-30" />;
    return sortDir === 'desc'
      ? <ChevronDown className="h-3 w-3 text-primary" />
      : <ChevronUp className="h-3 w-3 text-primary" />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-secondary px-3 py-2">
        <button
          onClick={collapseReport}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {formatNumber(artifact.rowCount)} posts
          </span>
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

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b text-muted-foreground">
              <th className="px-3 py-2" />
              <th className="px-3 py-2 text-left font-medium">Platform</th>
              <th className="px-3 py-2 text-left font-medium">Handle</th>
              <th className="px-3 py-2 text-left font-medium">Content</th>
              <th
                className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-medium"
                onClick={() => handleSort('posted_at')}
              >
                <span className="inline-flex items-center gap-1">
                  Posted <SortIcon col="posted_at" />
                </span>
              </th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-right font-medium"
                onClick={() => handleSort('likes')}
              >
                <span className="inline-flex items-center justify-end gap-1">
                  Likes <SortIcon col="likes" />
                </span>
              </th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-right font-medium"
                onClick={() => handleSort('views')}
              >
                <span className="inline-flex items-center justify-end gap-1">
                  Views <SortIcon col="views" />
                </span>
              </th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-right font-medium"
                onClick={() => handleSort('comments_count')}
              >
                <span className="inline-flex items-center justify-end gap-1">
                  Comments <SortIcon col="comments_count" />
                </span>
              </th>
              <th className="px-3 py-2 text-left font-medium">Sentiment</th>
              <th className="px-3 py-2 text-left font-medium">Themes</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => (
              <DataRow key={row.post_id} row={row} idx={idx} />
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-12 text-center text-muted-foreground">
                  No posts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Page {safePage + 1} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DataRow({ row, idx }: { row: DataExportRow; idx: number }) {
  const sentColor = row.sentiment ? SENTIMENT_COLORS[row.sentiment] : undefined;
  const text = [row.title, row.content].filter(Boolean).join(' ').slice(0, 100);
  const themes = row.themes
    ? row.themes.split(';').map((t) => t.trim()).filter(Boolean)
    : [];

  return (
    <tr className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
      <td className="px-3 py-1.5">
        <a
          href={row.post_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
        {PLATFORM_LABELS[row.platform] || row.platform}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">@{row.channel_handle}</td>
      <td className="px-3 py-1.5">
        <span
          className="line-clamp-2 max-w-[140px] text-xs text-foreground/90"
          title={[row.title, row.content].filter(Boolean).join(' ')}
        >
          {text || '—'}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
        {timeAgo(row.posted_at)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(row.likes ?? 0)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(row.views ?? 0)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(row.comments_count ?? 0)}</td>
      <td className="px-3 py-1.5">
        {row.sentiment && (
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
            style={{ color: sentColor, backgroundColor: sentColor ? `${sentColor}20` : undefined }}
          >
            {row.sentiment}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap gap-1">
          {themes.slice(0, 2).map((t) => (
            <span
              key={t}
              className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] capitalize text-primary"
            >
              {t}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}
