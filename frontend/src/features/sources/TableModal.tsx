import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronUp, ChevronDown, ExternalLink } from 'lucide-react';
import { getPosts } from '../../api/endpoints/feed.ts';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import type { FeedPost } from '../../api/types.ts';
import type { Source } from '../../stores/sources-store.ts';

interface TableModalProps {
  source: Source;
  open: boolean;
  onClose: () => void;
}

type SortKey = 'posted_at' | 'likes' | 'views' | 'comments_count';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

export function TableModal({ source, open, onClose }: TableModalProps) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('views');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { data, isLoading } = useQuery({
    queryKey: ['collection-table', source.collectionId],
    queryFn: () => getPosts(source.collectionId, { sort: 'views', limit: 200 }),
    enabled: open,
    staleTime: 2 * 60 * 1000,
  });

  const allPosts = data?.posts ?? [];

  // Client-side sort
  const sorted = [...allPosts].sort((a, b) => {
    let av: number | string = a[sortKey as keyof FeedPost] as number | string ?? 0;
    let bv: number | string = b[sortKey as keyof FeedPost] as number | string ?? 0;
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
    return sortDir === 'desc' ? (
      <ChevronDown className="h-3 w-3 text-foreground" />
    ) : (
      <ChevronUp className="h-3 w-3 text-foreground" />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-screen-2xl sm:max-w-screen-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-3">
          <DialogTitle className="text-sm font-semibold">
            {source.title}
            {allPosts.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {formatNumber(allPosts.length)} posts
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-secondary" />
              ))}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-muted-foreground">
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2 text-left font-medium">Platform</th>
                  <th className="px-3 py-2 text-left font-medium">Handle</th>
                  <th className="px-3 py-2 text-left font-medium w-64">Content</th>
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
                  <th className="px-3 py-2 text-left font-medium">AI Summary</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((post, idx) => (
                  <TableRow key={post.post_id} post={post} idx={idx} />
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-muted-foreground">
                      No posts found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-between border-t px-5 py-2">
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
      </DialogContent>
    </Dialog>
  );
}

function TableRow({ post, idx }: { post: FeedPost; idx: number }) {
  const sentColor = post.sentiment ? SENTIMENT_COLORS[post.sentiment] : undefined;
  const text = [post.title, post.content].filter(Boolean).join(' ').slice(0, 120);

  return (
    <tr className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
      <td className="px-3 py-1.5">
        <a
          href={post.post_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
        {PLATFORM_LABELS[post.platform] || post.platform}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">@{post.channel_handle}</td>
      <td className="px-3 py-1.5">
        <span className="line-clamp-2 max-w-xs text-xs text-foreground/90" title={[post.title, post.content].filter(Boolean).join(' ')}>
          {text || '—'}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
        {timeAgo(post.posted_at)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(post.likes ?? 0)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(post.views ?? 0)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(post.comments_count ?? 0)}</td>
      <td className="px-3 py-1.5">
        {post.sentiment && (
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
            style={{ color: sentColor, backgroundColor: sentColor ? `${sentColor}20` : undefined }}
          >
            {post.sentiment}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap gap-1">
          {(post.themes ?? []).slice(0, 2).map((t) => (
            <span key={t} className="rounded-full bg-accent-vibrant/10 px-1.5 py-0.5 text-[10px] text-accent-vibrant capitalize">
              {t}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-1.5">
        {post.ai_summary && (
          <span
            className="line-clamp-2 max-w-[160px] text-[10px] text-muted-foreground"
            title={post.ai_summary}
          >
            {post.ai_summary.slice(0, 100)}
          </span>
        )}
      </td>
    </tr>
  );
}
