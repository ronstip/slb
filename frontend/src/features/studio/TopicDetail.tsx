import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Eye, ThumbsUp, MessageCircle } from 'lucide-react';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Separator } from '../../components/ui/separator.tsx';
import { getAgentTopicAnalytics, getAgentTopicPosts } from '../../api/endpoints/topics.ts';
import { formatNumber } from '../../lib/format.ts';
import { SENTIMENT_COLORS } from '../../lib/constants.ts';
import { resolvePostThumbnail } from './topic-helpers.ts';
import type { TopicPost } from '../../api/types.ts';

interface TopicDetailProps {
  clusterId: string;
  agentId: string;
  topicSummary: string;
}

export function TopicDetail({ clusterId, agentId, topicSummary }: TopicDetailProps) {
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['topic-analytics', clusterId, agentId],
    queryFn: () => getAgentTopicAnalytics(agentId, clusterId),
  });

  const {
    data: postsData,
    fetchNextPage,
    hasNextPage,
    isFetching: postsFetching,
  } = useInfiniteQuery({
    queryKey: ['topic-posts', clusterId, agentId],
    queryFn: ({ pageParam = 0 }) =>
      getAgentTopicPosts(agentId, clusterId, { limit: 6, offset: pageParam }),
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < 6) return undefined;
      return allPages.flatMap((p) => p).length;
    },
    initialPageParam: 0,
  });

  const posts = postsData?.pages.flatMap((p) => p) ?? [];
  const totals = analytics?.totals;

  return (
    <div className="border-t border-border/50 px-4 py-3 space-y-3">
      <p className="text-xs text-muted-foreground">{topicSummary}</p>

      {posts.length > 0 && (
        <>
          <Separator className="opacity-50" />
          <div className="space-y-2">
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
              Top Posts
            </span>
            {posts.map((post) => (
              <TopicPostRow key={post.post_id} post={post} />
            ))}
            {hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => fetchNextPage()}
                disabled={postsFetching}
              >
                {postsFetching ? 'Loading...' : 'Show more posts'}
              </Button>
            )}
          </div>
        </>
      )}

      {analyticsLoading ? (
        <div className="h-16 animate-pulse rounded bg-secondary" />
      ) : totals ? (
        <>
          <Separator className="opacity-50" />
          <div className="space-y-2">
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
              Analytics
            </span>
            <SentimentBar totals={totals} />

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" /> {formatNumber(totals.total_views)}
              </span>
              <span className="flex items-center gap-1">
                <ThumbsUp className="h-3 w-3" /> {formatNumber(totals.total_likes)}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="h-3 w-3" /> {formatNumber(totals.total_comments)}
              </span>
            </div>

            {analytics?.platforms && analytics.platforms.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {analytics.platforms.map((p) => (
                  <span key={p.platform} className="text-[11px] text-muted-foreground">
                    <span className="capitalize font-medium">{p.platform}</span>{' '}
                    {p.post_count}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function SentimentBar({ totals }: { totals: { positive_count: number; negative_count: number; neutral_count: number; mixed_count: number; post_count: number } }) {
  const total = totals.post_count || 1;
  const segments = [
    { key: 'positive', count: totals.positive_count, color: SENTIMENT_COLORS.positive },
    { key: 'negative', count: totals.negative_count, color: SENTIMENT_COLORS.negative },
    { key: 'neutral', count: totals.neutral_count, color: SENTIMENT_COLORS.neutral },
    { key: 'mixed', count: totals.mixed_count, color: SENTIMENT_COLORS.mixed },
  ].filter((s) => s.count > 0);

  return (
    <div className="space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
        {segments.map((s) => (
          <div
            key={s.key}
            className="h-full"
            style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
            {Math.round((s.count / total) * 100)}% {s.key}
          </span>
        ))}
      </div>
    </div>
  );
}

function TopicPostRow({ post }: { post: TopicPost }) {
  const thumbSrc = resolvePostThumbnail(post);
  const Wrapper = post.post_url ? 'a' : 'div';
  const wrapperProps = post.post_url
    ? { href: post.post_url, target: '_blank' as const, rel: 'noopener noreferrer', onClick: (e: React.MouseEvent) => e.stopPropagation() }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 transition-colors hover:bg-secondary/80 cursor-pointer no-underline"
    >
      {thumbSrc && (
        <img
          src={thumbSrc}
          alt=""
          className="h-10 w-10 shrink-0 rounded object-cover bg-secondary"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="capitalize font-medium">{post.platform}</span>
          {post.channel_name && <span className="truncate">@{post.channel_name}</span>}
          {post.is_representative && (
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              Rep
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-foreground line-clamp-2">
          {post.ai_summary || post.title || post.content || 'No content'}
        </p>
        <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
          {post.views != null && <span><Eye className="inline h-2.5 w-2.5" /> {formatNumber(post.views)}</span>}
          {post.likes != null && <span><ThumbsUp className="inline h-2.5 w-2.5" /> {formatNumber(post.likes)}</span>}
          {post.sentiment && (
            <span
              className="capitalize"
              style={{ color: SENTIMENT_COLORS[post.sentiment] }}
            >
              {post.sentiment}
            </span>
          )}
        </div>
      </div>
      {post.post_url && (
        <div className="shrink-0 text-muted-foreground/50">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </div>
      )}
    </Wrapper>
  );
}
