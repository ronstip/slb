import { useState, useCallback, useRef, useEffect } from 'react';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getPosts } from '../../api/endpoints/feed.ts';
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
  const feedSourceId = useStudioStore((s) => s.feedSourceId);
  const sources = useSourcesStore((s) => s.sources);
  const selectedSources = sources.filter((s) => s.selected);

  const [sort, setSort] = useState<FeedParams['sort']>('views');
  const [platform, setPlatform] = useState('all');
  const [sentiment, setSentiment] = useState('all');

  // Track container width to decide 1-col vs 2-col layout
  const containerRef = useRef<HTMLDivElement>(null);
  const [useTwoCols, setUseTwoCols] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Set initial value immediately so first render uses correct layout
    setUseTwoCols(el.getBoundingClientRect().width >= 380);
    const observer = new ResizeObserver(([entry]) => {
      setUseTwoCols(entry.contentRect.width >= 380);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const activeSourceId = feedSourceId || selectedSources[0]?.collectionId;

  const { data, fetchNextPage, hasNextPage, isFetching, isLoading, isError } = useInfiniteQuery({
    queryKey: ['feed', activeSourceId, sort, platform, sentiment],
    queryFn: ({ pageParam = 0 }) =>
      getPosts(activeSourceId!, { sort, platform, sentiment, limit: 12, offset: pageParam }),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
    enabled: !!activeSourceId,
  });

  const allPosts = data?.pages.flatMap((p) => p.posts) ?? [];
  const totalCount = data?.pages[0]?.total ?? 0;

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

  if (!activeSourceId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <p className="text-sm text-muted-foreground">
          Select a source to view its posts.
        </p>
      </div>
    );
  }

  const [colA, colB] = splitColumns(allPosts);

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
        ) : allPosts.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No posts found.
          </p>
        ) : useTwoCols ? (
          /* Two-column masonry-style layout */
          <div className="grid grid-cols-2 gap-4 pt-4 items-start">
            <div className="flex flex-col gap-4">
              {colA.map((post) => (
                <PostCard key={post.post_id} post={post} />
              ))}
            </div>
            <div className="flex flex-col gap-4">
              {colB.map((post) => (
                <PostCard key={post.post_id} post={post} />
              ))}
            </div>
            {isFetching && (
              <div className="col-span-2 py-4 text-center text-xs text-muted-foreground/70">
                Loading more...
              </div>
            )}
          </div>
        ) : (
          /* Single-column layout for narrower widths */
          <div className="flex flex-col gap-4 pt-4">
            {allPosts.map((post) => (
              <PostCard key={post.post_id} post={post} />
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
