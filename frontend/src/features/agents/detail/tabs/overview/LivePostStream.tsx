import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { MessageSquare, Play, Sparkles } from 'lucide-react';
import { getMultiCollectionPosts } from '../../../../../api/endpoints/feed.ts';
import { getCollectionStatus } from '../../../../../api/endpoints/collections.ts';
import { mediaUrl } from '../../../../../api/client.ts';
import type { FeedPost } from '../../../../../api/types.ts';
import { PlatformIcon } from '../../../../../components/PlatformIcon.tsx';
import { formatNumber, timeAgo } from '../../../../../lib/format.ts';
import { cn } from '../../../../../lib/utils.ts';

interface LivePostStreamProps {
  collectionIds: string[];
  isAgentRunning: boolean;
  onOpenData: () => void;
}

export function LivePostStream({ collectionIds, isAgentRunning, onOpenData }: LivePostStreamProps) {
  // Per-collection status (to know whether any collection is still running — governs refetch cadence + "live" banner)
  const statusQueries = useQueries({
    queries: collectionIds.map((id) => ({
      queryKey: ['collection-status', id],
      queryFn: () => getCollectionStatus(id),
      enabled: !!id,
      staleTime: 10_000,
      refetchInterval: (query: { state: { data?: { status?: string } } }) => {
        const s = query.state.data?.status;
        return s === 'success' || s === 'failed' ? false : 10_000;
      },
    })),
  });

  const anyCollecting = statusQueries.some((q) => q.data?.status === 'running');
  const totalPosts = statusQueries.reduce((sum, q) => sum + (q.data?.posts_collected ?? 0), 0);

  const PAGE_SIZE = 24;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['overview-posts', [...collectionIds].sort().join(',')],
    queryFn: ({ pageParam = 0 }) =>
      getMultiCollectionPosts({
        collection_ids: collectionIds,
        sort: 'views',
        limit: PAGE_SIZE,
        offset: pageParam,
        dedup: true,
        relevant_to_task: 'true',
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + lastPage.posts.length;
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: collectionIds.length > 0,
    staleTime: 10_000,
    refetchInterval: isAgentRunning || anyCollecting ? 10_000 : false,
  });

  const posts = data?.pages.flatMap((p) => p.posts) ?? [];

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (collectionIds.length === 0) {
    return (
      <Section title="Live feed" meta="No data sources configured yet.">
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Configure data sources in Settings to start collecting posts.
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Live feed"
      meta={
        <span className="flex items-center gap-2">
          {anyCollecting && (
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
          )}
          <span>
            {formatNumber(totalPosts)} post{totalPosts === 1 ? '' : 's'}
            {collectionIds.length > 1 && ` · ${collectionIds.length} sources`}
          </span>
        </span>
      }
      action={{ label: 'View all posts', onClick: onOpenData }}
    >
      {posts.length > 0 ? (
        <div className="max-h-[640px] overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {posts.map((post, i) => (
              <PostCard key={post.post_id} post={post} isLatest={anyCollecting && i === 0} />
            ))}
          </div>
          <div ref={sentinelRef} className="h-8" />
          {isFetchingNextPage && (
            <p className="py-2 text-center text-xs text-muted-foreground">Loading more…</p>
          )}
        </div>
      ) : isLoading || isAgentRunning || anyCollecting ? (
        <div className="space-y-3">
          <p className="text-center text-sm text-muted-foreground">
            {anyCollecting ? 'Collecting posts…' : 'Waiting for posts…'}
          </p>
          <SkeletonGrid />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No posts collected yet.</p>
        </div>
      )}
    </Section>
  );
}

function PostCard({ post, isLatest }: { post: FeedPost; isLatest: boolean }) {
  const media = post.media_refs?.find((m) => m.media_type === 'image' || m.media_type === 'video');
  const isVideo = media?.media_type === 'video';
  // Videos: prefer the X-provided preview_image_url thumbnail, since the original_url
  // is a CDN MP4 that won't render as an <img>.
  const resolvedImg = media
    ? isVideo && media.preview_image_url
      ? mediaUrl(undefined, media.preview_image_url)
      : mediaUrl(media.gcs_uri, media.original_url)
    : null;
  const body = post.content || post.title || post.ai_summary || '';

  return (
    <a
      href={post.post_url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'group relative flex flex-col gap-2 overflow-hidden rounded-xl border border-border/60 bg-card p-3 transition-all hover:border-border hover:shadow-sm',
        isLatest && 'animate-in fade-in slide-in-from-top-2 duration-500',
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        <PlatformIcon platform={post.platform} className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-medium text-foreground/90">{post.channel_handle || post.platform}</span>
        <span className="ml-auto shrink-0 text-muted-foreground/70">{timeAgo(post.posted_at)}</span>
      </div>
      <div className="relative h-28 w-full overflow-hidden rounded-md bg-muted">
        {resolvedImg ? (
          <>
            <img
              src={resolvedImg}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy"
            />
            {isVideo && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
                  <Play className="h-4 w-4 fill-white text-white" />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted/40 via-muted/20 to-muted/40">
            <PlatformIcon platform={post.platform} className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
      </div>
      {body && (
        <p className="line-clamp-3 text-xs leading-relaxed text-foreground/80">{body}</p>
      )}
      {post.total_engagement > 0 && (
        <div className="mt-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{formatNumber(post.total_engagement)} engagement</span>
          {post.views != null && post.views > 0 && <span>{formatNumber(post.views)} views</span>}
        </div>
      )}
      <EnrichmentOverlay post={post} />
    </a>
  );
}

function EnrichmentOverlay({ post }: { post: FeedPost }) {
  const themes = post.themes ?? [];
  const entities = post.entities ?? [];
  const hasEnrichment =
    !!post.ai_summary ||
    !!post.sentiment ||
    !!post.emotion ||
    themes.length > 0 ||
    entities.length > 0;

  if (!hasEnrichment) return null;

  const sentimentDot =
    post.sentiment === 'positive'
      ? 'bg-emerald-500'
      : post.sentiment === 'negative'
        ? 'bg-rose-500'
        : 'bg-sky-500';

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col gap-2.5 overflow-hidden rounded-xl bg-gradient-to-br from-background/98 via-background/95 to-background/98 p-3 opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover:opacity-100">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          <Sparkles className="h-3 w-3 text-primary" />
          AI insights
        </div>
        {(post.sentiment || post.emotion) && (
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/75">
            {post.sentiment && (
              <span className="flex items-center gap-1">
                <span className={cn('inline-block h-1.5 w-1.5 rounded-full', sentimentDot)} />
                <span className="capitalize">{post.sentiment}</span>
              </span>
            )}
            {post.sentiment && post.emotion && (
              <span className="text-muted-foreground/40">·</span>
            )}
            {post.emotion && <span className="capitalize">{post.emotion}</span>}
          </div>
        )}
      </div>

      {post.ai_summary && (
        <p className="line-clamp-4 text-[12px] leading-relaxed text-foreground/90">
          {post.ai_summary}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-1.5">
        {entities.length > 0 && (
          <div className="flex items-baseline gap-2">
            <span className="w-14 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Mentions
            </span>
            <div className="flex flex-wrap gap-1">
              {entities.slice(0, 5).map((e) => (
                <span
                  key={`e-${e}`}
                  className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] leading-none text-foreground/85"
                >
                  {e}
                </span>
              ))}
              {entities.length > 5 && (
                <span className="self-center text-[10px] leading-none text-muted-foreground/60">
                  +{entities.length - 5}
                </span>
              )}
            </div>
          </div>
        )}
        {themes.length > 0 && (
          <div className="flex items-baseline gap-2">
            <span className="w-14 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Topics
            </span>
            <div className="flex flex-wrap gap-1">
              {themes.slice(0, 5).map((t) => (
                <span
                  key={`t-${t}`}
                  className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] leading-none text-foreground/85"
                >
                  {t}
                </span>
              ))}
              {themes.length > 5 && (
                <span className="self-center text-[10px] leading-none text-muted-foreground/60">
                  +{themes.length - 5}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="relative h-48 overflow-hidden rounded-xl border border-border/40 bg-card"
        >
          <div
            className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-muted/60 to-transparent"
            style={{ animationDelay: `${i * 120}ms` }}
          />
          <div className="flex h-full flex-col gap-3 p-3">
            <div className="h-3 w-1/3 rounded bg-muted/60" />
            <div className="h-20 w-full rounded bg-muted/50" />
            <div className="h-2.5 w-full rounded bg-muted/50" />
            <div className="h-2.5 w-2/3 rounded bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-sm font-semibold text-foreground">{title}</h3>
          {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            {action.label} →
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

