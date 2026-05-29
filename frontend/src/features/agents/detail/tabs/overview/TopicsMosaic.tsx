import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Hash } from 'lucide-react';
import { getAgentTopics } from '../../../../../api/endpoints/topics.ts';
import type { TopicCluster } from '../../../../../api/types.ts';
import { formatNumber } from '../../../../../lib/format.ts';
import { SENTIMENT_COLORS } from '../../../../../lib/constants.ts';
import {
  viralityScore,
  sentimentColor,
  sentimentColorAlpha,
  dominantSentiment,
  resolveThumbnail,
} from '../../../../studio/topic-helpers.ts';
import { PlatformIcon } from '../../../../../components/PlatformIcon.tsx';

const MIN_POSTS_FOR_MOSAIC = 3;
const DEFAULT_MAX_CARDS = 6;

interface TopicsMosaicProps {
  agentId: string;
  isAgentRunning: boolean;
  onOpenTopics: () => void;
  onOpenTopic: (clusterId: string) => void;
  maxCards?: number;
}

export function TopicsMosaic({
  agentId,
  isAgentRunning,
  onOpenTopics,
  onOpenTopic,
  maxCards = DEFAULT_MAX_CARDS,
}: TopicsMosaicProps) {
  const { data: topics, isLoading, isError } = useQuery({
    queryKey: ['topics', agentId],
    queryFn: () => getAgentTopics(agentId),
    enabled: !!agentId,
    staleTime: 5 * 60_000,
    refetchInterval: isAgentRunning ? 30_000 : false,
  });

  const items = topics ?? [];
  const visible = useMemo(() => {
    return items
      .filter((t) => (t.post_count ?? 0) >= MIN_POSTS_FOR_MOSAIC)
      .map((t) => ({ t, v: viralityScore(t) ?? -1 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, maxCards)
      .map((x) => x.t);
  }, [items, maxCards]);

  const hasOverflow = items.length > visible.length;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 animate-in fade-in slide-in-from-bottom-2">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-sm font-semibold text-foreground">Topics</h3>
          {visible.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {hasOverflow ? `Top ${visible.length} of ${items.length}` : `${visible.length} total`}
            </span>
          )}
        </div>
        {visible.length > 0 && (
          <button
            onClick={onOpenTopics}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            View all →
          </button>
        )}
      </header>

      {isLoading && visible.length === 0 ? (
        <RowsSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState isAgentRunning={isAgentRunning} isError={isError} />
      ) : (
        <ul className="flex flex-col divide-y divide-border/40">
          {visible.map((topic) => (
            <TopicRow
              key={topic.cluster_id}
              topic={topic}
              onOpen={() => onOpenTopic(topic.cluster_id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface TopicRowProps {
  topic: TopicCluster;
  onOpen: () => void;
}

function TopicRow({ topic, onOpen }: TopicRowProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const thumbSrc = resolveThumbnail(topic);
  const sentiment = dominantSentiment(topic);
  const virality = viralityScore(topic);
  const vColor = sentimentColor(topic);
  const tintStrong = sentimentColorAlpha(topic, 0.35);
  const tintSoft = sentimentColorAlpha(topic, 0.12);
  const showImage = thumbSrc && !imgFailed;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-muted/30 rounded-lg px-2 -mx-2"
      >
        {/* Thumbnail */}
        <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-secondary">
          {showImage ? (
            <img
              src={thumbSrc}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <PlatformLogoFallback
              platforms={topic.platforms ?? []}
              tintStrong={tintStrong}
              tintSoft={tintSoft}
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="flex-1 min-w-0 truncate font-heading text-sm font-semibold text-foreground">
              {topic.topic_name}
            </h4>
            {virality != null && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white"
                style={{ backgroundColor: vColor }}
              >
                x{formatNumber(virality)}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2.5 text-[11px] text-muted-foreground">
            <span className="font-medium">{formatNumber(topic.post_count)} posts</span>
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
        </div>
      </button>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col divide-y divide-border/40">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5 px-2 -mx-2">
          <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-muted/40">
            <div
              className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-muted/60 to-transparent"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-2/3 rounded bg-muted/40" />
            <div className="h-2.5 w-1/3 rounded bg-muted/30" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlatformLogoFallback({
  platforms,
  tintStrong,
  tintSoft,
}: {
  platforms: string[];
  tintStrong: string;
  tintSoft: string;
}) {
  const visible = platforms.slice(0, 2);
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(135deg, ${tintStrong} 0%, ${tintSoft} 60%, transparent 100%)` }}
      />
      <div className="relative flex h-full w-full items-center justify-center gap-1.5">
        {visible.length === 0 ? (
          <Hash className="h-5 w-5 text-foreground/30" />
        ) : (
          visible.map((p) => (
            <PlatformIcon key={p} platform={p} className="h-5 w-5 opacity-80" />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ isAgentRunning, isError }: { isAgentRunning: boolean; isError: boolean }) {
  const message = isError
    ? 'Topics unavailable.'
    : isAgentRunning
      ? 'Topics will emerge as posts are analyzed…'
      : 'No topics generated yet.';
  return (
    <div className="flex flex-col items-center gap-1.5 py-8 text-center">
      <Hash className="h-6 w-6 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
