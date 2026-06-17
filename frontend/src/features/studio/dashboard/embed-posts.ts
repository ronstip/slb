import type { DashboardPost, MediaRef } from '../../../api/types.ts';
import { mediaUrl } from '../../../api/client.ts';
import { parseMediaRefs } from '../../../components/DataTable/ExpandedPostRow.tsx';
import {
  DEFAULT_EMBED_COUNT,
  DEFAULT_EMBED_RANK,
  MAX_EMBED_COUNT,
  type EmbedRankMetric,
  type SocialEmbedConfig,
} from './types-social-dashboard.ts';

/** Total engagement for a post = likes + comments + shares. `DashboardPost` has
 *  no stored engagement column, so we derive it the same way the aggregators do. */
export function postEngagementTotal(post: DashboardPost): number {
  return (post.like_count ?? 0) + (post.comment_count ?? 0) + (post.share_count ?? 0);
}

/** The numeric value a post contributes to a given ranking metric. `recent` maps
 *  to the posted-at epoch so the same comparator handles every metric. */
export function embedPostMetricValue(post: DashboardPost, rankBy: EmbedRankMetric): number {
  switch (rankBy) {
    case 'view_count':       return post.view_count ?? 0;
    case 'like_count':       return post.like_count ?? 0;
    case 'comment_count':    return post.comment_count ?? 0;
    case 'share_count':      return post.share_count ?? 0;
    case 'engagement_total': return postEngagementTotal(post);
    case 'recent': {
      const t = post.posted_at ? Date.parse(post.posted_at) : NaN;
      return Number.isNaN(t) ? 0 : t;
    }
    default:                 return 0;
  }
}

/** Rank posts by a metric, highest first. Stable, non-mutating; ties keep input
 *  order. Posts without a usable `post_url` are dropped — a card with nothing to
 *  open is useless in the gallery. */
export function rankEmbedPosts(posts: DashboardPost[], rankBy: EmbedRankMetric): DashboardPost[] {
  const usable = posts.filter((p) => typeof p.post_url === 'string' && p.post_url.trim().length > 0);
  return usable
    .map((post, i) => ({ post, i, v: embedPostMetricValue(post, rankBy) }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => x.post);
}

/** Clamp a configured count into [1, MAX_EMBED_COUNT], defaulting when unset. */
export function resolveEmbedCount(count: number | undefined): number {
  if (count == null || !Number.isFinite(count)) return DEFAULT_EMBED_COUNT;
  return Math.max(1, Math.min(MAX_EMBED_COUNT, Math.floor(count)));
}

/** The ranked candidate set for collection mode: top-N by the chosen metric,
 *  BEFORE manual hiding. The config panel shows these with show/hide toggles. */
export function embedCandidatePosts(
  posts: DashboardPost[],
  config: SocialEmbedConfig | undefined,
): DashboardPost[] {
  const rankBy = config?.rankBy ?? DEFAULT_EMBED_RANK;
  const count = resolveEmbedCount(config?.count);
  return rankEmbedPosts(posts, rankBy).slice(0, count);
}

/** The posts actually rendered in collection mode: the ranked candidate set with
 *  any manually-hidden post_ids removed (order preserved). */
export function resolveEmbedPosts(
  posts: DashboardPost[],
  config: SocialEmbedConfig | undefined,
): DashboardPost[] {
  const hidden = new Set(config?.hiddenPostIds ?? []);
  return embedCandidatePosts(posts, config).filter((p) => !hidden.has(p.post_id));
}

export interface EmbedThumbnail {
  url: string;
  isVideo: boolean;
}

/** Resolve a displayable thumbnail for a post from its media refs. Prefers a
 *  proxied GCS image, then an explicit preview image, then the original media
 *  URL (also proxied to dodge CDN CORS/hotlink rules). Returns null when the
 *  post carries no usable media. */
export function embedPostThumbnail(post: DashboardPost): EmbedThumbnail | null {
  const refs = parseMediaRefs(post.media_refs) ?? [];
  if (refs.length === 0) return null;
  // Prefer an image ref for the still; fall back to a video ref's preview.
  const image = refs.find((m) => m.media_type !== 'video' && (m.gcs_uri || m.original_url || m.preview_image_url));
  const video = refs.find((m) => m.media_type === 'video');
  const chosen = image ?? video ?? refs[0];
  const url = thumbUrl(chosen);
  if (!url) return null;
  return { url, isVideo: !image && !!video };
}

function thumbUrl(m: MediaRef | undefined): string {
  if (!m) return '';
  if (m.gcs_uri) return mediaUrl(m.gcs_uri);
  if (m.preview_image_url) return mediaUrl(undefined, m.preview_image_url);
  if (m.original_url) return mediaUrl(undefined, m.original_url);
  return '';
}

/** A channel handle prefixed with exactly one `@`. Some platforms (YouTube)
 *  already store the leading `@`, so naively prefixing yields `@@fifa`. */
export function embedHandle(handle: string | undefined | null): string {
  return `@${(handle ?? '').replace(/^@+/, '')}`;
}

/** Marquee animation duration (seconds) for one full loop, by speed setting.
 *  Scaled by card count so a long row doesn't whip past. */
export function marqueeDurationSeconds(speed: SocialEmbedConfig['speed'], cardCount: number): number {
  const perCard = speed === 'fast' ? 2.5 : speed === 'slow' ? 6 : 4;
  return Math.max(8, Math.round(perCard * Math.max(1, cardCount)));
}
