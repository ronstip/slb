import { useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Eye, ThumbsUp, MessageCircle, Hash, Flame } from 'lucide-react';
import { Badge } from '../../../components/ui/badge.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Separator } from '../../../components/ui/separator.tsx';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import { getAgentTopicAnalytics, getAgentTopicPosts } from '../../../api/endpoints/topics.ts';
import { formatNumber } from '../../../lib/format.ts';
import type { TopicCluster } from '../../../api/types.ts';
import {
  resolveThumbnail,
  sentimentColor,
  sentimentColorAlpha,
  viralityScore,
} from '../topic-helpers.ts';
import { SentimentBar } from '../TopicDetail.tsx';
import { PostCard } from '../PostCard.tsx';

interface TopicHeroProps {
  topic: TopicCluster;
  agentId: string;
}

export function TopicHero({ topic, agentId }: TopicHeroProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const thumbSrc = resolveThumbnail(topic);
  const showImage = thumbSrc && !imgFailed;
  const tintStrong = sentimentColorAlpha(topic, 0.35);
  const tintSoft = sentimentColorAlpha(topic, 0.12);
  const vColor = sentimentColor(topic);
  const virality = viralityScore(topic);

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['topic-analytics', topic.cluster_id, agentId],
    queryFn: () => getAgentTopicAnalytics(agentId, topic.cluster_id),
  });

  const {
    data: postsData,
    fetchNextPage,
    hasNextPage,
    isFetching: postsFetching,
  } = useInfiniteQuery({
    queryKey: ['topic-posts', topic.cluster_id, agentId],
    queryFn: ({ pageParam = 0 }) =>
      getAgentTopicPosts(agentId, topic.cluster_id, { limit: 8, offset: pageParam }),
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < 8) return undefined;
      return allPages.flatMap((p) => p).length;
    },
    initialPageParam: 0,
  });

  const posts = postsData?.pages.flatMap((p) => p) ?? [];
  const totals = analytics?.totals;
  const platforms = analytics?.platforms ?? [];
  const maxPlatformCount = platforms.reduce((m, p) => Math.max(m, p.post_count), 0) || 1;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
      {/* Banner — blurred backdrop fill, contained image on top so wide/tall
          thumbnails letterbox cleanly instead of zoom-cropping. */}
      <div className="relative h-56 w-full shrink-0 overflow-hidden bg-secondary">
        {showImage ? (
          <>
            <img
              src={thumbSrc}
              aria-hidden=""
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl"
            />
            <img
              src={thumbSrc}
              alt=""
              className="relative mx-auto h-full max-w-full object-contain drop-shadow-md"
              onError={() => setImgFailed(true)}
            />
          </>
        ) : (
          <div className="absolute inset-0">
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(135deg, ${tintStrong} 0%, ${tintSoft} 60%, transparent 100%)`,
              }}
            />
            <div className="relative flex h-full w-full items-center justify-center gap-4">
              {(topic.platforms ?? []).slice(0, 4).map((p) => (
                <PlatformIcon key={p} platform={p} className="h-16 w-16 opacity-90" />
              ))}
              {(topic.platforms ?? []).length === 0 && (
                <div className="h-16 w-16 rounded-full bg-foreground/5" />
              )}
            </div>
          </div>
        )}

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/40 to-transparent"
        />

        {virality != null && (
          <span
            className="absolute right-4 top-4 flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-bold tabular-nums text-white shadow-sm backdrop-blur-sm"
            style={{ backgroundColor: vColor }}
          >
            <Flame className="h-3.5 w-3.5" />x{formatNumber(virality)}
          </span>
        )}
        <span className="absolute bottom-4 left-4 rounded-md bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {topic.post_count} posts
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 px-6 py-5">
        <div>
          <h2 className="font-heading text-2xl font-semibold leading-tight text-foreground">
            {topic.topic_name}
          </h2>
          {topic.topic_summary && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {topic.topic_summary}
            </p>
          )}

          {topic.topic_keywords?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {topic.topic_keywords.map((kw) => (
                <Badge key={kw} variant="secondary" className="text-[11px] font-normal">
                  <Hash className="mr-0.5 h-2.5 w-2.5" />
                  {kw}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Posts" value={formatNumber(topic.post_count)} />
          <StatTile
            label="Views"
            value={formatNumber(totals?.total_views ?? topic.total_views ?? 0)}
            icon={<Eye className="h-3.5 w-3.5" />}
          />
          <StatTile
            label="Likes"
            value={formatNumber(totals?.total_likes ?? topic.total_likes ?? 0)}
            icon={<ThumbsUp className="h-3.5 w-3.5" />}
          />
          <StatTile
            label="Comments"
            value={formatNumber(totals?.total_comments ?? 0)}
            icon={<MessageCircle className="h-3.5 w-3.5" />}
          />
        </div>

        {/* Sentiment + platforms */}
        {analyticsLoading ? (
          <div className="h-20 animate-pulse rounded bg-secondary" />
        ) : totals ? (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                Sentiment
              </span>
              <SentimentBar totals={totals} />
            </div>

            {platforms.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                  Platforms
                </span>
                <ul className="space-y-1.5">
                  {platforms.map((p) => (
                    <li key={p.platform} className="flex items-center gap-2 text-xs">
                      <PlatformIcon platform={p.platform} className="h-3.5 w-3.5 shrink-0" />
                      <span className="w-16 shrink-0 capitalize text-muted-foreground">
                        {p.platform}
                      </span>
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${(p.post_count / maxPlatformCount) * 100}%`,
                            backgroundColor: vColor,
                          }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
                        {p.post_count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}

        <Separator />

        {/* Examples */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
              Examples
            </span>
            {posts.length > 0 && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {posts.length}
                {hasNextPage ? '+' : ''}
              </span>
            )}
          </div>
          {posts.length === 0 && !postsFetching ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No example posts yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {posts.map((post) => (
                <PostCard key={post.post_id} post={post} />
              ))}
            </div>
          )}
          {hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => fetchNextPage()}
              disabled={postsFetching}
            >
              {postsFetching ? 'Loading…' : 'Show more posts'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
