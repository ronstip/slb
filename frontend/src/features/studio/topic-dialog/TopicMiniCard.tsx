import { useState } from 'react';
import type { TopicCluster } from '../../../api/types.ts';
import { SENTIMENT_COLORS } from '../../../lib/constants.ts';
import { formatNumber } from '../../../lib/format.ts';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import { dominantSentiment, resolveThumbnail, sentimentColorAlpha } from '../topic-helpers.ts';

interface TopicMiniCardProps {
  topic: TopicCluster;
  selected: boolean;
  onSelect: () => void;
}

export function TopicMiniCard({ topic, selected, onSelect }: TopicMiniCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const thumbSrc = resolveThumbnail(topic);
  const showImage = thumbSrc && !imgFailed;
  const sentiment = dominantSentiment(topic);
  const tintSoft = sentimentColorAlpha(topic, 0.18);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex w-full items-start gap-2.5 rounded-lg border p-2 text-left transition-colors ${
        selected
          ? 'border-primary/60 bg-primary/5'
          : 'border-transparent hover:border-border/60 hover:bg-secondary/60'
      }`}
    >
      {selected && (
        <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
      )}

      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-secondary">
        {showImage ? (
          <img
            src={thumbSrc}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: tintSoft }}
          >
            {topic.platforms?.[0] ? (
              <PlatformIcon platform={topic.platforms[0]} className="h-6 w-6 opacity-80" />
            ) : (
              <div className="h-5 w-5 rounded-full bg-foreground/10" />
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="line-clamp-2 text-xs font-medium leading-snug text-foreground">
          {topic.topic_name}
        </h4>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="tabular-nums">{formatNumber(topic.post_count)} posts</span>
          {sentiment && (
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: SENTIMENT_COLORS[sentiment.key] }}
              />
              {sentiment.pct}%
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
