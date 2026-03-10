import { useState } from 'react';
import { ArrowLeft, ChevronUp, ChevronDown, Download, ExternalLink, Table2 } from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '../../components/ui/hover-card.tsx';
import { Button } from '../../components/ui/button.tsx';
import { PostCard } from './PostCard.tsx';
import { PostMedia } from './PostCard.tsx';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';
import type { DataExportRow, FeedPost, MediaRef } from '../../api/types.ts';

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

type SortKey = 'posted_at' | 'likes' | 'views' | 'comments_count';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

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
  const [sortKey, setSortKey] = useState<SortKey>('views');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const sorted = [...rows].sort((a, b) => {
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

  function toggleRow(postId: string) {
    setExpandedRowId((prev) => (prev === postId ? null : postId));
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (col !== sortKey) return <ChevronDown className="h-3 w-3 opacity-30" />;
    return sortDir === 'desc'
      ? <ChevronDown className="h-3 w-3 text-foreground" />
      : <ChevronUp className="h-3 w-3 text-foreground" />;
  }

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
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col className="w-8" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col />
            <col className="w-[7%]" />
            <col className="w-[6%]" />
            <col className="w-[6%]" />
            <col className="w-[7%]" />
            <col className="w-[8%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b text-muted-foreground">
              <th className="px-2 py-2" />
              <th className="truncate px-2 py-2 text-left font-medium">Platform</th>
              <th className="truncate px-2 py-2 text-left font-medium">Handle</th>
              <th className="truncate px-2 py-2 text-left font-medium">AI Summary</th>
              <th
                className="cursor-pointer select-none truncate px-2 py-2 text-left font-medium"
                onClick={() => handleSort('posted_at')}
              >
                <span className="inline-flex items-center gap-0.5">
                  Posted <SortIcon col="posted_at" />
                </span>
              </th>
              <th
                className="cursor-pointer select-none truncate px-2 py-2 text-right font-medium"
                onClick={() => handleSort('likes')}
              >
                <span className="inline-flex items-center justify-end gap-0.5">
                  Likes <SortIcon col="likes" />
                </span>
              </th>
              <th
                className="cursor-pointer select-none truncate px-2 py-2 text-right font-medium"
                onClick={() => handleSort('views')}
              >
                <span className="inline-flex items-center justify-end gap-0.5">
                  Views <SortIcon col="views" />
                </span>
              </th>
              <th
                className="cursor-pointer select-none truncate px-2 py-2 text-right font-medium"
                onClick={() => handleSort('comments_count')}
              >
                <span className="inline-flex items-center justify-end gap-0.5">
                  Comments <SortIcon col="comments_count" />
                </span>
              </th>
              <th className="truncate px-2 py-2 text-left font-medium">Sentiment</th>
              <th className="truncate px-2 py-2 text-left font-medium">Themes</th>
              <th className="truncate px-2 py-2 text-left font-medium">Entities</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => (
              <DataRow
                key={row.post_id}
                row={row}
                idx={idx}
                isExpanded={expandedRowId === row.post_id}
                onToggle={() => toggleRow(row.post_id)}
              />
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={11} className="py-12 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* DataRow                                                             */
/* ------------------------------------------------------------------ */

interface DataRowProps {
  row: DataExportRow;
  idx: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function DataRow({ row, idx, isExpanded, onToggle }: DataRowProps) {
  const sentColor = row.sentiment ? SENTIMENT_COLORS[row.sentiment] : undefined;
  const summaryText = row.ai_summary?.slice(0, 120) || [row.title, row.content].filter(Boolean).join(' ').slice(0, 100);
  const themes = row.themes
    ? row.themes.split(';').map((t) => t.trim()).filter(Boolean)
    : [];
  const entities = row.entities
    ? row.entities.split(';').map((e) => e.trim()).filter(Boolean)
    : [];
  const media = parseMediaRefs(row.media_refs)?.filter((m) => m?.original_url || m?.gcs_uri) ?? [];

  const rowBg = isExpanded
    ? 'bg-accent/50'
    : idx % 2 === 0 ? 'bg-background' : 'bg-muted/30';

  return (
    <>
      <tr
        className={`${rowBg} cursor-pointer transition-colors hover:bg-accent/30`}
        onClick={onToggle}
      >
        <td className="px-2 py-1.5">
          <HoverCard openDelay={100} closeDelay={100}>
            <HoverCardTrigger asChild>
              <a
                href={row.post_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </HoverCardTrigger>
            <HoverCardContent side="left" align="start" className="w-80 p-0">
              <PostCard post={rowToFeedPost(row)} />
            </HoverCardContent>
          </HoverCard>
        </td>
        <td className="truncate px-2 py-1.5 text-muted-foreground">
          {PLATFORM_LABELS[row.platform] || row.platform}
        </td>
        <td className="truncate px-2 py-1.5">@{row.channel_handle}</td>
        <td className="overflow-hidden px-2 py-1.5">
          <span
            className="line-clamp-2 text-xs text-foreground/90"
            title={row.ai_summary || [row.title, row.content].filter(Boolean).join(' ')}
          >
            {summaryText || '—'}
          </span>
        </td>
        <td className="truncate px-2 py-1.5 text-muted-foreground">
          {timeAgo(row.posted_at)}
        </td>
        <td className="truncate px-2 py-1.5 text-right tabular-nums">{formatNumber(row.likes ?? 0)}</td>
        <td className="truncate px-2 py-1.5 text-right tabular-nums">{formatNumber(row.views ?? 0)}</td>
        <td className="truncate px-2 py-1.5 text-right tabular-nums">{formatNumber(row.comments_count ?? 0)}</td>
        <td className="px-2 py-1.5">
          {row.sentiment && (
            <span
              className="inline-block truncate rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
              style={{ color: sentColor, backgroundColor: sentColor ? `${sentColor}20` : undefined }}
            >
              {row.sentiment}
            </span>
          )}
        </td>
        <td className="px-2 py-1.5">
          <div className="flex flex-wrap gap-1 overflow-hidden">
            {themes.slice(0, 2).map((t) => (
              <span
                key={t}
                className="truncate rounded-full bg-accent-vibrant/10 px-1.5 py-0.5 text-[10px] capitalize text-accent-vibrant"
              >
                {t}
              </span>
            ))}
          </div>
        </td>
        <td className="px-2 py-1.5">
          <div className="flex flex-wrap gap-1 overflow-hidden">
            {entities.slice(0, 2).map((e) => (
              <span
                key={e}
                className="truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {e}
              </span>
            ))}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={11} className="border-b border-border bg-card px-4 py-3">
            <div className={`flex gap-6 ${media.length > 0 ? '' : ''}`}>
              {/* Left side: metadata */}
              <div className={`grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs ${media.length > 0 ? 'flex-1 min-w-0' : 'w-full'}`}>
                {row.content && (
                  <>
                    <span className="font-medium text-muted-foreground">Content</span>
                    <p className="whitespace-pre-wrap text-foreground">{row.title ? `${row.title}\n${row.content}` : row.content}</p>
                  </>
                )}
                {row.ai_summary && (
                  <>
                    <span className="font-medium text-muted-foreground">AI Summary</span>
                    <p className="text-foreground">{row.ai_summary}</p>
                  </>
                )}
                {row.key_quotes && row.key_quotes.length > 0 && (
                  <>
                    <span className="font-medium text-muted-foreground">Key Quotes</span>
                    <div className="flex flex-col gap-1">
                      {row.key_quotes.map((q, i) => (
                        <p key={i} className="italic text-foreground/80">"{q}"</p>
                      ))}
                    </div>
                  </>
                )}
                {row.emotion && (
                  <>
                    <span className="font-medium text-muted-foreground">Emotion</span>
                    <span className="capitalize text-foreground">{row.emotion}</span>
                  </>
                )}
                {themes.length > 0 && (
                  <>
                    <span className="font-medium text-muted-foreground">Themes</span>
                    <div className="flex flex-wrap gap-1">
                      {themes.map((t) => (
                        <span key={t} className="rounded-full bg-accent-vibrant/10 px-1.5 py-0.5 text-[10px] capitalize text-accent-vibrant">{t}</span>
                      ))}
                    </div>
                  </>
                )}
                {entities.length > 0 && (
                  <>
                    <span className="font-medium text-muted-foreground">Entities</span>
                    <div className="flex flex-wrap gap-1">
                      {entities.map((e) => (
                        <span key={e} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{e}</span>
                      ))}
                    </div>
                  </>
                )}
                {row.content_type && (
                  <>
                    <span className="font-medium text-muted-foreground">Content Type</span>
                    <span className="capitalize text-foreground">{row.content_type}</span>
                  </>
                )}
              </div>

              {/* Right side: media */}
              {media.length > 0 && (
                <div className="w-[280px] shrink-0 overflow-hidden rounded-lg">
                  <PostMedia media={media} postUrl={row.post_url} />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function parseMediaRefs(raw?: string | MediaRef[]): MediaRef[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw) as MediaRef[];
  } catch {
    return undefined;
  }
}

export function rowToFeedPost(row: DataExportRow): FeedPost {
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
