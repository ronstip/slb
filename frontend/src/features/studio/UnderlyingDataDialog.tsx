import { useState, useEffect } from 'react';
import { Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '../../components/ui/hover-card.tsx';
import { PostCard } from './PostCard.tsx';
import { getUnderlyingData, postUnderlyingData, type UnderlyingDataResponse } from '../../api/endpoints/artifacts.ts';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';
import type { DataExportRow, FeedPost, MediaRef } from '../../api/types.ts';

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

type SortKey = 'posted_at' | 'likes' | 'views' | 'comments_count';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 25;

export function UnderlyingDataDialog({ artifactId, fallback, onClose }: UnderlyingDataDialogProps) {
  const [data, setData] = useState<UnderlyingDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('views');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  useEffect(() => {
    if (!artifactId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setPage(0);
    setExpandedRowId(null);
    setSortKey('views');
    setSortDir('desc');

    getUnderlyingData(artifactId)
      .then(setData)
      .catch((err) => {
        // If artifact not in Firestore (restored session), try inline POST
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

  function SortIcon({ col }: { col: SortKey }) {
    if (col !== sortKey) return <ChevronDown className="h-3 w-3 opacity-30" />;
    return sortDir === 'desc'
      ? <ChevronDown className="h-3 w-3 text-foreground" />
      : <ChevronUp className="h-3 w-3 text-foreground" />;
  }

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
          <>
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
                    <th className="cursor-pointer select-none truncate px-2 py-2 text-left font-medium" onClick={() => handleSort('posted_at')}>
                      <span className="inline-flex items-center gap-0.5">Posted <SortIcon col="posted_at" /></span>
                    </th>
                    <th className="cursor-pointer select-none truncate px-2 py-2 text-right font-medium" onClick={() => handleSort('likes')}>
                      <span className="inline-flex items-center justify-end gap-0.5">Likes <SortIcon col="likes" /></span>
                    </th>
                    <th className="cursor-pointer select-none truncate px-2 py-2 text-right font-medium" onClick={() => handleSort('views')}>
                      <span className="inline-flex items-center justify-end gap-0.5">Views <SortIcon col="views" /></span>
                    </th>
                    <th className="cursor-pointer select-none truncate px-2 py-2 text-right font-medium" onClick={() => handleSort('comments_count')}>
                      <span className="inline-flex items-center justify-end gap-0.5">Comments <SortIcon col="comments_count" /></span>
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
                      onToggle={() => setExpandedRowId((prev) => (prev === row.post_id ? null : row.post_id))}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex shrink-0 items-center justify-between border-t px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  Page {safePage + 1} of {totalPages}
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}


function DataRow({ row, idx, isExpanded, onToggle }: { row: DataExportRow; idx: number; isExpanded: boolean; onToggle: () => void }) {
  const sentColor = row.sentiment ? SENTIMENT_COLORS[row.sentiment] : undefined;
  const summaryText = row.ai_summary?.slice(0, 120) || [row.title, row.content].filter(Boolean).join(' ').slice(0, 100);
  const themes = row.themes ? row.themes.split(';').map((t) => t.trim()).filter(Boolean) : [];
  const entities = row.entities ? row.entities.split(';').map((e) => e.trim()).filter(Boolean) : [];
  const rowBg = isExpanded ? 'bg-accent/50' : idx % 2 === 0 ? 'bg-background' : 'bg-muted/30';

  return (
    <>
      <tr className={`${rowBg} cursor-pointer transition-colors hover:bg-accent/30`} onClick={onToggle}>
        <td className="px-2 py-1.5">
          <HoverCard openDelay={100} closeDelay={100}>
            <HoverCardTrigger asChild>
              <a href={row.post_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3 w-3" />
              </a>
            </HoverCardTrigger>
            <HoverCardContent side="left" align="start" className="w-80 p-0">
              <PostCard post={rowToFeedPost(row)} />
            </HoverCardContent>
          </HoverCard>
        </td>
        <td className="truncate px-2 py-1.5 text-muted-foreground">{PLATFORM_LABELS[row.platform] || row.platform}</td>
        <td className="truncate px-2 py-1.5">@{row.channel_handle}</td>
        <td className="overflow-hidden px-2 py-1.5">
          <span className="line-clamp-2 text-xs text-foreground/90" title={row.ai_summary || [row.title, row.content].filter(Boolean).join(' ')}>
            {summaryText || '\u2014'}
          </span>
        </td>
        <td className="truncate px-2 py-1.5 text-muted-foreground">{timeAgo(row.posted_at)}</td>
        <td className="truncate px-2 py-1.5 text-right tabular-nums">{formatNumber(row.likes ?? 0)}</td>
        <td className="truncate px-2 py-1.5 text-right tabular-nums">{formatNumber(row.views ?? 0)}</td>
        <td className="truncate px-2 py-1.5 text-right tabular-nums">{formatNumber(row.comments_count ?? 0)}</td>
        <td className="px-2 py-1.5">
          {row.sentiment && (
            <span className="inline-block truncate rounded-full px-2 py-0.5 text-[10px] font-medium capitalize" style={{ color: sentColor, backgroundColor: sentColor ? `${sentColor}20` : undefined }}>
              {row.sentiment}
            </span>
          )}
        </td>
        <td className="px-2 py-1.5">
          <div className="flex flex-wrap gap-1 overflow-hidden">
            {themes.slice(0, 2).map((t) => (
              <span key={t} className="truncate rounded-full bg-accent-vibrant/10 px-1.5 py-0.5 text-[10px] capitalize text-accent-vibrant">{t}</span>
            ))}
          </div>
        </td>
        <td className="px-2 py-1.5">
          <div className="flex flex-wrap gap-1 overflow-hidden">
            {entities.slice(0, 2).map((e) => (
              <span key={e} className="truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{e}</span>
            ))}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={11} className="border-b border-border bg-card px-4 py-3">
            <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs">
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
                      <p key={i} className="italic text-foreground/80">&ldquo;{q}&rdquo;</p>
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
          </td>
        </tr>
      )}
    </>
  );
}


function parseMediaRefs(raw?: string | MediaRef[]): MediaRef[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw) as MediaRef[];
  } catch {
    return undefined;
  }
}

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
