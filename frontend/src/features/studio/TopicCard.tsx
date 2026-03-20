import { useState } from 'react';
import { ChevronDown, ChevronUp, Eye, ThumbsUp, MessageCircle } from 'lucide-react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui/card.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { getTopicAnalytics, getTopicPosts } from '../../api/endpoints/topics.ts';
import { formatNumber } from '../../lib/format.ts';
import { SENTIMENT_COLORS } from '../../lib/constants.ts';
import type { TopicCluster, TopicPost } from '../../api/types.ts';

interface TopicCardProps {
  topic: TopicCluster;
  collectionId: string;
}

export function TopicCard({ topic, collectionId }: TopicCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-hidden shadow-sm transition-shadow hover:shadow-md">
      {/* Collapsed header — always visible */}
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {topic.topic_name}
            </h3>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {topic.post_count} posts
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
            {topic.topic_summary}
          </p>
          {topic.topic_keywords.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {topic.topic_keywords.map((kw) => (
                <Badge key={kw} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {kw}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 pt-0.5 text-muted-foreground">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <TopicDetail clusterId={topic.cluster_id} collectionId={collectionId} />
      )}
    </Card>
  );
}

function TopicDetail({ clusterId, collectionId }: { clusterId: string; collectionId: string }) {
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['topic-analytics', clusterId, collectionId],
    queryFn: () => getTopicAnalytics(clusterId, collectionId),
  });

  const {
    data: postsData,
    fetchNextPage,
    hasNextPage,
    isFetching: postsFetching,
  } = useInfiniteQuery({
    queryKey: ['topic-posts', clusterId, collectionId],
    queryFn: ({ pageParam = 0 }) =>
      getTopicPosts(clusterId, collectionId, { limit: 6, offset: pageParam }),
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
      {/* Analytics */}
      {analyticsLoading ? (
        <div className="h-16 animate-pulse rounded bg-secondary" />
      ) : totals ? (
        <div className="space-y-2">
          {/* Sentiment distribution */}
          <SentimentBar totals={totals} />

          {/* Engagement totals */}
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

          {/* Platform breakdown */}
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
      ) : null}

      {/* Posts */}
      {posts.length > 0 && (
        <div className="space-y-2">
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
              {postsFetching ? 'Loading...' : 'Load more'}
            </Button>
          )}
        </div>
      )}
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
  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2">
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
        <a
          href={post.post_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      )}
    </div>
  );
}
