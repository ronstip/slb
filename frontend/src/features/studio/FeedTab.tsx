import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getMultiCollectionPosts } from '../../api/endpoints/feed.ts';
import { PostCard } from './PostCard.tsx';
import { FeedControls } from './FeedControls.tsx';
import type { FeedParams, FeedPost } from '../../api/types.ts';

/** Split posts into two balanced columns by alternating assignment. */
function splitColumns(posts: FeedPost[]): [FeedPost[], FeedPost[]] {
  const left: FeedPost[] = [];
  const right: FeedPost[] = [];
  posts.forEach((post, i) => (i % 2 === 0 ? left : right).push(post));
  return [left, right];
}

export function FeedTab() {
  const sources = useSourcesStore((s) => s.sources);
  // All active (checkbox-checked) collections in session
  const activeSources = sources.filter((s) => s.active && s.selected);
  // Auto-refetch while any active collection is still collecting/enriching
  const isAnyCollecting = activeSources.some((s) => s.status === 'pending' || s.status === 'collecting' || s.status === 'enriching');
  const activeIds = activeSources.map((s) => s.collectionId);

  const [sort, setSort] = useState<FeedParams['sort']>('views');
  const [platform, setPlatform] = useState('all');
  const [sentiment, setSentiment] = useState('all');
  // Which of the active collections to show (empty = all)
  const [collectionFilter, setCollectionFilter] = useState<string[]>([]);

  // Keep collectionFilter in sync when activeSources change
  useEffect(() => {
    setCollectionFilter((prev) => {
      const still = prev.filter((id) => activeIds.includes(id));
      return still.length === 0 ? [] : still;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds.join(',')]);

  // Effective IDs to query (empty filter = use all active)
  const effectiveIds = collectionFilter.length > 0 ? collectionFilter : activeIds;

  const containerRef = useRef<HTMLDivElement>(null);
  const [useTwoCols, setUseTwoCols] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setUseTwoCols(el.getBoundingClientRect().width >= 380);
    const observer = new ResizeObserver(([entry]) => {
      setUseTwoCols(entry.contentRect.width >= 380);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { data, fetchNextPage, hasNextPage, isFetching, isLoading, isError } = useInfiniteQuery({
    queryKey: ['feed-multi', effectiveIds.join(','), sort, platform, sentiment],
    queryFn: ({ pageParam = 0 }) =>
      getMultiCollectionPosts({
        collection_ids: effectiveIds,
        sort,
        platform,
        sentiment,
        limit: 12,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
    enabled: effectiveIds.length > 0,
    refetchInterval: isAnyCollecting ? 3000 : false,
  });

  const allPosts = useMemo(() => {
    const seen = new Set<string>();
    return (data?.pages.flatMap((p) => p.posts) ?? []).filter((p) => {
      if (seen.has(p.post_id)) return false;
      seen.add(p.post_id);
      return true;
    });
  }, [data]);
  const totalCount = data?.pages[0]?.total ?? 0;
  const showCollectionLabels = activeSources.length > 1;

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (
        target.scrollHeight - target.scrollTop - target.clientHeight < 200 &&
        hasNextPage &&
        !isFetching
      ) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetching],
  );

  if (activeIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <p className="text-sm text-muted-foreground">
          Check at least one collection in the Sources panel to see posts.
        </p>
      </div>
    );
  }

  const [colA, colB] = splitColumns(allPosts);

  const collectionTitleMap = Object.fromEntries(
    activeSources.map((s) => [s.collectionId, s.title]),
  );

  return (
    <div className="flex h-full flex-col">
      <FeedControls
        sort={sort}
        platform={platform}
        sentiment={sentiment}
        onSortChange={setSort}
        onPlatformChange={setPlatform}
        onSentimentChange={setSentiment}
        totalCount={totalCount}
        activeSources={activeSources}
        collectionFilter={collectionFilter}
        onCollectionFilterChange={setCollectionFilter}
      />

      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 pb-4" onScroll={handleScroll}>
        {isLoading ? (
          <div className={useTwoCols ? 'grid grid-cols-2 gap-4 pt-4' : 'flex flex-col gap-4 pt-4'}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-secondary" />
            ))}
          </div>
        ) : isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Failed to load posts. Try adjusting the filters.
          </p>
        ) : allPosts.length === 0 && isAnyCollecting ? (
          <div className="flex flex-col items-center gap-4 pt-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-vibrant opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-vibrant" />
              </span>
              Collecting posts…
            </div>
            <div className={colCount > 1 ? `${gridClass} gap-4 w-full` : 'flex flex-col gap-4 w-full'}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-32 animate-pulse rounded-xl bg-secondary" />
              ))}
            </div>
          </div>
        ) : allPosts.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No posts found.
          </p>
        ) : useTwoCols ? (
          <div className="grid grid-cols-2 gap-4 pt-4 items-start">
            <div className="flex flex-col gap-4">
              {colA.map((post) => (
                <PostCard
                  key={post.post_id}
                  post={post}
                  collectionTitle={showCollectionLabels ? collectionTitleMap[post.collection_id ?? ''] : undefined}
                />
              ))}
            </div>
            <div className="flex flex-col gap-4">
              {colB.map((post) => (
                <PostCard
                  key={post.post_id}
                  post={post}
                  collectionTitle={showCollectionLabels ? collectionTitleMap[post.collection_id ?? ''] : undefined}
                />
              ))}
            </div>
            {isFetching && (
              <div className="col-span-2 py-4 text-center text-xs text-muted-foreground/70">
                Loading more...
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4 pt-4">
            {allPosts.map((post) => (
              <PostCard
                key={post.post_id}
                post={post}
                collectionTitle={showCollectionLabels ? collectionTitleMap[post.collection_id ?? ''] : undefined}
              />
            ))}
            {isFetching && (
              <div className="py-4 text-center text-xs text-muted-foreground/70">
                Loading more...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
