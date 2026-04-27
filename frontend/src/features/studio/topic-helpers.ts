import { mediaUrl } from '../../api/client.ts';
import type { TopicCluster, TopicPost } from '../../api/types.ts';

export function viralityScore(topic: TopicCluster): number | null {
  if (!topic.total_views || !topic.post_count) return null;
  return Math.round(topic.total_views / topic.post_count);
}

/** Returns the {r,g,b} tuple on the green-gray-red sentiment gradient. */
export function sentimentRgb(topic: TopicCluster): { r: number; g: number; b: number } {
  const pos = topic.positive_count ?? 0;
  const neg = topic.negative_count ?? 0;
  const total = pos + neg;
  if (!total) return { r: 148, g: 163, b: 184 };
  const ratio = pos / total;
  if (ratio >= 0.5) {
    const t = (ratio - 0.5) * 2;
    return {
      r: Math.round(148 - t * 114),
      g: Math.round(163 + t * 32),
      b: Math.round(184 - t * 94),
    };
  } else {
    const t = ratio * 2;
    return {
      r: Math.round(239 - t * 91),
      g: Math.round(68 + t * 95),
      b: Math.round(68 + t * 116),
    };
  }
}

/** Returns a color on a green-gray-red gradient based on positive vs negative ratio. */
export function sentimentColor(topic: TopicCluster): string {
  const { r, g, b } = sentimentRgb(topic);
  return `rgb(${r},${g},${b})`;
}

export function sentimentColorAlpha(topic: TopicCluster, alpha: number): string {
  const { r, g, b } = sentimentRgb(topic);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function dominantSentiment(topic: TopicCluster): { key: string; pct: number } | null {
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

export function resolveThumbnail(topic: TopicCluster): string | null {
  if (topic.thumbnail_gcs_uri) return mediaUrl(topic.thumbnail_gcs_uri);
  if (topic.thumbnail_url) return topic.thumbnail_url;
  return null;
}

export function resolvePostThumbnail(post: TopicPost): string | null {
  if (post.thumbnail_gcs_uri) return mediaUrl(post.thumbnail_gcs_uri);
  if (post.thumbnail_url) return post.thumbnail_url;
  return null;
}
