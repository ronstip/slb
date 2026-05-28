import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, MessageCircle, Eye, Loader2, RefreshCw, MessagesSquare } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet.tsx';
import { Button } from '../../components/ui/button.tsx';
import {
  fetchPostComments,
  listPostComments,
  type CommentItem,
} from '../../api/endpoints/posts.ts';
import type { FeedPost } from '../../api/types.ts';

interface CommentsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: FeedPost;
  agentId?: string;
}

interface ThreadNode {
  root: CommentItem;
  replies: CommentItem[];
}

function groupIntoThreads(rows: CommentItem[]): ThreadNode[] {
  const byRoot = new Map<string, CommentItem>();
  const replies = new Map<string, CommentItem[]>();
  for (const c of rows) {
    if (c.root_comment_id == null) {
      byRoot.set(c.comment_id, c);
    } else {
      const list = replies.get(c.root_comment_id) ?? [];
      list.push(c);
      replies.set(c.root_comment_id, list);
    }
  }
  // Orphan replies (root not in current batch) become their own thread.
  for (const c of rows) {
    if (c.root_comment_id != null && !byRoot.has(c.root_comment_id)) {
      byRoot.set(c.comment_id, c);
    }
  }
  const threads: ThreadNode[] = [];
  for (const [rootId, root] of byRoot) {
    const r = (replies.get(rootId) ?? []).slice().sort((a, b) => {
      return (a.commented_at ?? '').localeCompare(b.commented_at ?? '');
    });
    threads.push({ root, replies: r });
  }
  threads.sort((a, b) => (b.root.likes ?? 0) - (a.root.likes ?? 0));
  return threads;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatChip({ icon: Icon, value }: { icon: typeof Heart; value: number | null }) {
  if (value == null || value === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      {value.toLocaleString()}
    </span>
  );
}

function CommentRow({ c, depth }: { c: CommentItem; depth: number }) {
  return (
    <div
      className="border-l border-border/60 pl-3 py-2"
      style={{ marginLeft: depth * 16 }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">@{c.channel_handle}</span>
        <span className="text-xs text-muted-foreground">{formatTimestamp(c.commented_at)}</span>
      </div>
      {c.content && (
        <p className="mt-1 text-sm whitespace-pre-wrap break-words text-foreground/90">
          {c.content}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-3">
        <StatChip icon={Heart} value={c.likes} />
        <StatChip icon={MessageCircle} value={c.replies_count} />
        <StatChip icon={Eye} value={c.views} />
      </div>
    </div>
  );
}

export function CommentsDrawer({ open, onOpenChange, post, agentId }: CommentsDrawerProps) {
  const qc = useQueryClient();
  const commentsSupported =
    post.platform === 'twitter' ||
    post.platform === 'instagram' ||
    post.platform === 'tiktok';

  const query = useQuery({
    queryKey: ['post-comments', post.post_id],
    queryFn: () => listPostComments(post.post_id),
    enabled: open,
  });

  const fetchMutation = useMutation({
    mutationFn: () => fetchPostComments(post.post_id, agentId),
    onSuccess: () => {
      toast('Fetching comments…', {
        description: "We'll add replies once they arrive. Refresh in ~30s.",
      });
    },
    onError: (err) => {
      toast.error('Could not fetch comments', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    },
  });

  const threads = useMemo(
    () => groupIntoThreads(query.data?.comments ?? []),
    [query.data],
  );

  const total = query.data?.comments.length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="border-b">
          <SheetTitle>Comments</SheetTitle>
          <SheetDescription>
            @{post.channel_handle}
            {post.comments_count != null && (
              <> · {post.comments_count.toLocaleString()} on platform</>
            )}
            {total > 0 && <> · {total.toLocaleString()} fetched</>}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {!commentsSupported && (
            <div className="p-6 text-sm text-muted-foreground">
              Comment fetching isn't supported for {post.platform} yet.
            </div>
          )}

          {commentsSupported && query.isLoading && (
            <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading comments…
            </div>
          )}

          {commentsSupported && query.isError && (
            <div className="p-6 text-sm text-destructive">
              Could not load comments:{' '}
              {query.error instanceof Error ? query.error.message : 'Unknown error'}
            </div>
          )}

          {commentsSupported && query.isSuccess && total === 0 && (
            <div className="p-6 space-y-3 text-sm">
              <p className="text-muted-foreground">
                {fetchMutation.isSuccess
                  ? 'Fetching… replies appear here once the worker finishes (~30s). Hit Refresh below.'
                  : 'No comments fetched yet for this post.'}
              </p>
              {!fetchMutation.isSuccess && (
                <Button
                  size="sm"
                  onClick={() => fetchMutation.mutate()}
                  disabled={fetchMutation.isPending}
                >
                  <MessagesSquare className="h-4 w-4 mr-2" />
                  Fetch comments
                </Button>
              )}
            </div>
          )}

          {commentsSupported && query.isSuccess && total > 0 && (
            <div className="px-4 py-3 space-y-4">
              {threads.map((t) => (
                <div key={t.root.comment_id} className="space-y-1">
                  <CommentRow c={t.root} depth={0} />
                  {t.replies.map((r) => (
                    <CommentRow key={r.comment_id} c={r} depth={1} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {commentsSupported && (
          <div className="border-t px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Replies are append-only — refetch to pull new ones.
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => qc.invalidateQueries({ queryKey: ['post-comments', post.post_id] })}
                disabled={query.isFetching}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${query.isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fetchMutation.mutate()}
                disabled={fetchMutation.isPending}
              >
                <MessagesSquare className="h-4 w-4 mr-1" />
                {total > 0 ? 'Refetch' : 'Fetch'}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
