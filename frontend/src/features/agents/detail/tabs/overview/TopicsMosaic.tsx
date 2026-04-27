import { useMemo, useState, useRef, useEffect } from 'react';
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
import { TopicDetail } from '../../../../studio/TopicDetail.tsx';
import { PlatformIcon } from '../../../../../components/PlatformIcon.tsx';

const MIN_POSTS_FOR_MOSAIC = 3;
const DEFAULT_MAX_CARDS = 6;

interface TopicsMosaicProps {
  agentId: string;
  isAgentRunning: boolean;
  onOpenTopics: () => void;
  maxCards?: number;
}

export function TopicsMosaic({
  agentId,
  isAgentRunning,
  onOpenTopics,
  maxCards = DEFAULT_MAX_CARDS,
}: TopicsMosaicProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
    <section className="rounded-2xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2">
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
        <MosaicSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState isAgentRunning={isAgentRunning} isError={isError} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((topic) => (
            <MosaicCard
              key={topic.cluster_id}
              topic={topic}
              agentId={agentId}
              expanded={expandedId === topic.cluster_id}
              onToggle={() =>
                setExpandedId((prev) => (prev === topic.cluster_id ? null : topic.cluster_id))
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface MosaicCardProps {
  topic: TopicCluster;
  agentId: string;
  expanded: boolean;
  onToggle: () => void;
}

function MosaicCard({ topic, agentId, expanded, onToggle }: MosaicCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const thumbSrc = resolveThumbnail(topic);
  const sentiment = dominantSentiment(topic);
  const virality = viralityScore(topic);
  const vColor = sentimentColor(topic);
  const tintStrong = sentimentColorAlpha(topic, 0.35);
  const tintSoft = sentimentColorAlpha(topic, 0.12);
  const showImage = thumbSrc && !imgFailed;

  useEffect(() => {
    if (expanded) {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expanded]);

  return (
    <article
      ref={cardRef}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-all hover:border-border hover:shadow-md cursor-pointer ${expanded ? 'md:col-span-2' : ''}`}
    >
      {/* Banner image (or sentiment-tinted fallback w/ platform logos) */}
      <div className="relative h-44 w-full overflow-hidden bg-secondary">
        {showImage ? (
          <img
            src={thumbSrc}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
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
        {/* Sentiment color wash on top of image (subtle) */}
        {showImage && (
          <div
            aria-hidden
            className="absolute inset-0 mix-blend-multiply"
            style={{ background: `linear-gradient(135deg, ${tintStrong} 0%, transparent 60%)` }}
          />
        )}
        {/* Bottom vignette so badges/overlays read on bright images */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent"
        />
        {/* Virality badge — floats top-right of image */}
        {virality != null && (
          <span
            className="absolute right-2 top-2 rounded-md px-2 py-1 text-xs font-bold tabular-nums text-white shadow-sm backdrop-blur-sm"
            style={{ backgroundColor: vColor }}
          >
            x{formatNumber(virality)}
          </span>
        )}
        {/* Post count chip — bottom-left of image */}
        <span className="absolute bottom-2 left-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {topic.post_count} posts
        </span>
      </div>

      {/* Content below image */}
      <div className="relative flex-1 p-3 space-y-1.5">
        <h4 className="font-heading text-base font-semibold leading-snug text-foreground line-clamp-2">
          {topic.topic_name}
        </h4>

        {topic.topic_summary && (
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
            {topic.topic_summary}
          </p>
        )}

        <div className="flex items-center gap-2.5 pt-0.5 text-[11px] text-muted-foreground">
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

      {expanded && (
        <div
          className="relative border-t border-border/50 bg-card/80 backdrop-blur-sm animate-in fade-in slide-in-from-top-1"
          onClick={(e) => e.stopPropagation()}
        >
          <TopicDetail
            clusterId={topic.cluster_id}
            agentId={agentId}
            topicSummary={topic.topic_summary}
          />
        </div>
      )}
    </article>
  );
}

function MosaicSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="relative min-h-[140px] overflow-hidden rounded-xl border border-border/60 bg-card"
        >
          <div
            className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-muted/60 to-transparent"
            style={{ animationDelay: `${i * 120}ms` }}
          />
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
  const visible = platforms.slice(0, 4);
  const single = visible.length === 1;
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(135deg, ${tintStrong} 0%, ${tintSoft} 60%, transparent 100%)` }}
      />
      <div className="relative flex h-full w-full items-center justify-center gap-4">
        {visible.length === 0 ? (
          <div className="h-16 w-16 rounded-full bg-foreground/5" />
        ) : (
          visible.map((p) => (
            <PlatformIcon
              key={p}
              platform={p}
              className={single ? 'h-20 w-20 opacity-90' : 'h-12 w-12 opacity-90'}
            />
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
