import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  ThumbsUp,
  MessageCircle,
  List,
  BarChart3,
  Sparkles,
  Table2,
} from 'lucide-react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui/card.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Separator } from '../../components/ui/separator.tsx';
import { getAgentTopicAnalytics, getAgentTopicPosts } from '../../api/endpoints/topics.ts';
import { mediaUrl } from '../../api/client.ts';
import { formatNumber } from '../../lib/format.ts';
import { SENTIMENT_COLORS } from '../../lib/constants.ts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.tsx';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useSSEChat } from '../chat/hooks/useSSEChat.ts';
import type { TopicCluster, TopicPost } from '../../api/types.ts';

interface TopicCardProps {
  topic: TopicCluster;
  agentId: string;
  rank?: number;
  onViewPosts?: (clusterId: string, topicName: string) => void;
}

const MAX_VISIBLE_KEYWORDS = 3;

function viralityScore(topic: TopicCluster): number | null {
  if (!topic.total_views || !topic.post_count) return null;
  return Math.round(topic.total_views / topic.post_count);
}

/** Returns a color on a green-gray-red gradient based on positive vs negative ratio. */
function sentimentColor(topic: TopicCluster): string {
  const pos = topic.positive_count ?? 0;
  const neg = topic.negative_count ?? 0;
  const total = pos + neg;
  if (!total) return '#94A3B8'; // neutral gray
  const ratio = pos / total; // 1 = all positive, 0 = all negative
  // Interpolate: red(0) → gray(0.5) → green(1)
  if (ratio >= 0.5) {
    const t = (ratio - 0.5) * 2; // 0→1
    const r = Math.round(148 - t * 114); // 148→34
    const g = Math.round(163 + t * 32);  // 163→195
    const b = Math.round(184 - t * 94);  // 184→90
    return `rgb(${r},${g},${b})`;
  } else {
    const t = ratio * 2; // 0→1
    const r = Math.round(239 - t * 91);  // 239→148
    const g = Math.round(68 + t * 95);   // 68→163
    const b = Math.round(68 + t * 116);  // 68→184
    return `rgb(${r},${g},${b})`;
  }
}

function dominantSentiment(topic: TopicCluster) {
  const counts = [
    { key: 'positive', count: topic.positive_count ?? 0 },
    { key: 'negative', count: topic.negative_count ?? 0 },
    { key: 'neutral', count: topic.neutral_count ?? 0 },
    { key: 'mixed', count: topic.mixed_count ?? 0 },
  ];
  const total = counts.reduce((s, c) => s + c.count, 0);
  if (!total) return null;
  const top = counts.sort((a, b) => b.count - a.count)[0];
  return { key: top.key, pct: Math.round((top.count / total) * 100) };
}

function resolveThumbnail(topic: TopicCluster): string | null {
  if (topic.thumbnail_gcs_uri) return mediaUrl(topic.thumbnail_gcs_uri);
  if (topic.thumbnail_url) return mediaUrl(undefined, topic.thumbnail_url);
  return null;
}

function resolvePostThumbnail(post: TopicPost): string | null {
  if (post.thumbnail_gcs_uri) return mediaUrl(post.thumbnail_gcs_uri);
  if (post.thumbnail_url) return mediaUrl(undefined, post.thumbnail_url);
  return null;
}

export function TopicCard({ topic, agentId, rank, onViewPosts }: TopicCardProps) {
  const [expanded, setExpanded] = useState(false);
  const thumbSrc = resolveThumbnail(topic);
  const sentiment = dominantSentiment(topic);
  const { sendMessage } = useSSEChat();
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const artifacts = useStudioStore((s) => s.artifacts);
  const expandReport = useStudioStore((s) => s.expandReport);
  const setPendingTopicFilter = useStudioStore((s) => s.setPendingTopicFilter);

  const visibleKeywords = topic.topic_keywords.slice(0, MAX_VISIBLE_KEYWORDS);
  const extraCount = topic.topic_keywords.length - MAX_VISIBLE_KEYWORDS;

  const handleViewPosts = (e: React.MouseEvent) => {
    e.stopPropagation();
    onViewPosts?.(topic.cluster_id, topic.topic_name);
  };

  const handleDashboard = (e: React.MouseEvent) => {
    e.stopPropagation();
    const dashboard = artifacts.find((a) => a.type === 'dashboard');
    if (dashboard) {
      setPendingTopicFilter({ themes: topic.topic_keywords, topicName: topic.topic_name });
      setActiveTab('artifacts');
      expandReport(dashboard.id);
    }
  };

  const handleAskAI = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendMessage(`Analyze the topic "${topic.topic_name}" in depth. What are the key themes, notable posts, and sentiment drivers?`);
  };

  const virality = viralityScore(topic);
  const vColor = sentimentColor(topic);

  return (
    <Card className="overflow-hidden rounded-lg shadow-sm transition-shadow hover:shadow-md !py-0 !gap-0">
      {/* Collapsed header — always visible */}
      <div
        className="w-full text-left cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
      >
        {/* Main content area */}
        <div className="flex gap-3 px-3 pt-3 pb-2">
          {/* Thumbnail */}
          {thumbSrc && (
            <img
              src={thumbSrc}
              alt=""
              className="h-16 w-16 shrink-0 rounded object-cover bg-secondary"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Title row: rank + title + virality badge + chevron */}
            <div className="flex items-start gap-1.5">
              {rank && (
                <span className="shrink-0 text-[13px] font-bold text-foreground/40 tabular-nums leading-snug">
                  {rank}
                </span>
              )}
              <h3 className="flex-1 min-w-0 text-[13px] font-semibold text-foreground leading-snug line-clamp-2">
                {topic.topic_name}
              </h3>
              <div className="shrink-0 flex items-center gap-1.5">
                {virality != null && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white"
                          style={{ backgroundColor: vColor }}
                        >
                          x{formatNumber(virality)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <p className="font-semibold">Virality Factor: x{formatNumber(virality)}</p>
                        <p className="text-[10px] opacity-70">Avg. views per post · Color reflects sentiment</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <div className="text-muted-foreground/40">
                  {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </div>
              </div>
            </div>

            {/* Metrics row */}
            <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
              <span className="font-medium">{topic.post_count} posts</span>
              {sentiment && (
                <span className="flex items-center gap-1">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: SENTIMENT_COLORS[sentiment.key] }}
                  />
                  {sentiment.pct}% {sentiment.key}
                </span>
              )}
              {topic.total_views != null && topic.total_views > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" /> {formatNumber(topic.total_views)}
                </span>
              )}
            </div>

            {/* Keywords */}
            {visibleKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {visibleKeywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
                    {kw}
                  </Badge>
                ))}
                {extraCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                    +{extraCount}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons — pinned to bottom edge */}
        <div className="flex items-center gap-1 border-t border-border/40 mx-3 mt-2 pt-1.5 pb-1.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground" onClick={handleViewPosts}>
            <List className="h-3 w-3" />
            Posts
          </Button>
          <Button variant="ghost" size="sm" className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground" onClick={handleViewPosts}>
            <Table2 className="h-3 w-3" />
            Data
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={handleDashboard}
            disabled={!artifacts.some((a) => a.type === 'dashboard')}
          >
            <BarChart3 className="h-3 w-3" />
            Analytics
          </Button>
          <Button variant="ghost" size="sm" className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground" onClick={handleAskAI}>
            <Sparkles className="h-3 w-3" />
            Ask AI
          </Button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <TopicDetail clusterId={topic.cluster_id} agentId={agentId} topicSummary={topic.topic_summary} />
      )}
    </Card>
  );
}


function TopicDetail({ clusterId, agentId, topicSummary }: { clusterId: string; agentId: string; topicSummary: string }) {
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
      {/* Topic summary */}
      <p className="text-xs text-muted-foreground">{topicSummary}</p>

      {/* Representative posts first */}
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

      {/* Analytics */}
      {analyticsLoading ? (
        <div className="h-16 animate-pulse rounded bg-secondary" />
      ) : totals ? (
        <>
          <Separator className="opacity-50" />
          <div className="space-y-2">
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
              Analytics
            </span>
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
