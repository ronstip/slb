import { useMemo } from 'react';
import { Eye, Heart, MessageCircle, Share2, Zap, Play, ImageOff, ExternalLink } from 'lucide-react';
import type { DashboardPost } from '../../../api/types.ts';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import { PLATFORM_COLORS } from '../../../lib/constants.ts';
import { formatNumber } from '../../../lib/format.ts';
import { cn } from '../../../lib/utils.ts';
import type { EmbedDisplay, EmbedRankMetric, EmbedSpeed } from './types-social-dashboard.ts';
import { embedPostThumbnail, embedPostMetricValue, marqueeDurationSeconds, embedHandle } from './embed-posts.ts';

// ── Visual gallery for the collection-mode Embed Posts widget ─────────────────
// A row of portrait post cards (thumbnail · platform badge · headline metric ·
// handle · date) rendered either as a horizontally-scrollable grid or an
// auto-scrolling marquee. Each card links to the original post in a new tab.

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  twitter: 'X',
  x: 'X',
  youtube: 'YouTube',
  facebook: 'Facebook',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  web: 'Web',
  google_search: 'Web',
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? (platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Post');
}

const METRIC_ICON: Record<Exclude<EmbedRankMetric, 'recent'>, typeof Eye> = {
  view_count: Eye,
  like_count: Heart,
  comment_count: MessageCircle,
  share_count: Share2,
  engagement_total: Zap,
};

/** The headline number shown on the card: the ranking metric's value, except
 *  `recent` which has no number of its own — fall back to views (then likes). */
function headlineFor(post: DashboardPost, rankBy: EmbedRankMetric): { Icon: typeof Eye; value: number } | null {
  if (rankBy === 'recent') {
    if ((post.view_count ?? 0) > 0) return { Icon: Eye, value: post.view_count };
    if ((post.like_count ?? 0) > 0) return { Icon: Heart, value: post.like_count };
    return null;
  }
  const value = embedPostMetricValue(post, rankBy);
  if (value <= 0) return null;
  return { Icon: METRIC_ICON[rankBy], value };
}

function formatPostDate(raw: string | undefined): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function PostTile({ post, rankBy }: { post: DashboardPost; rankBy: EmbedRankMetric }) {
  const thumb = embedPostThumbnail(post);
  const headline = headlineFor(post, rankBy);
  const accent = PLATFORM_COLORS[post.platform] ?? '#6B7294';
  const date = formatPostDate(post.posted_at);

  return (
    <a
      href={post.post_url}
      target="_blank"
      rel="noopener noreferrer"
      title={post.title || post.content || post.post_url}
      className="group @container relative block h-full aspect-[9/16] min-w-[6.5rem] shrink-0 overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/10 shadow-md transition-transform duration-200 hover:-translate-y-0.5 hover:ring-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* Thumbnail */}
      {thumb ? (
        <img
          src={thumb.url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: `linear-gradient(150deg, ${accent}33, #18181b 70%)` }}
        >
          <ImageOff className="h-6 w-6 text-white/40" />
        </div>
      )}

      {/* Legibility scrims top + bottom */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/80" />

      {/* Play affordance for video stills */}
      {thumb?.isVideo && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 ring-1 ring-white/30 backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
            <Play className="h-4 w-4 translate-x-px fill-white text-white" />
          </div>
        </div>
      )}

      {/* Top row: platform badge + headline metric. Pills adapt to card width
          (container queries): below ~9rem the platform label hides to its icon,
          and the metric pill never shrinks/clips — so small cards stay tidy. */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-1.5 @[10rem]:p-2">
        <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold text-white/95 ring-1 ring-white/15 backdrop-blur-sm">
          <PlatformIcon platform={post.platform} className="h-3 w-3 shrink-0" color="#FFFFFF" />
          <span className="hidden truncate @[9rem]:inline">{platformLabel(post.platform)}</span>
        </span>
        {headline && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/15 backdrop-blur-sm">
            <headline.Icon className="h-3 w-3 shrink-0" />
            {formatNumber(headline.value)}
          </span>
        )}
      </div>

      {/* Bottom row: handle + date + open hint */}
      <div className="absolute inset-x-0 bottom-0 p-1.5 @[10rem]:p-2">
        <div className="flex items-center gap-1 text-[11px] font-medium text-white">
          <span className="truncate">{embedHandle(post.channel_handle)}</span>
          <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-white/0 transition-colors group-hover:text-white/90" />
        </div>
        {date && <div className="hidden text-[10px] text-white/70 @[7.5rem]:block">{date}</div>}
      </div>
    </a>
  );
}

interface EmbedPostGalleryProps {
  posts: DashboardPost[];
  display: EmbedDisplay;
  rankBy: EmbedRankMetric;
  speed?: EmbedSpeed;
}

export function EmbedPostGallery({ posts, display, rankBy, speed }: EmbedPostGalleryProps) {
  // Marquee needs two back-to-back copies so the -50% translate loops seamlessly.
  const duration = useMemo(() => marqueeDurationSeconds(speed, posts.length), [speed, posts.length]);

  if (posts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs italic text-muted-foreground">
        No posts match this selection
      </div>
    );
  }

  if (display === 'marquee') {
    // Each tile carries its own right gutter (pr-3) so every unit has identical
    // width — translating the doubled track by exactly -50% then loops with no
    // visible seam (a track-level `gap` would offset the two halves).
    const loop = [...posts, ...posts];
    return (
      <div className="embed-marquee-viewport h-full w-full overflow-hidden">
        <div className="embed-marquee-track h-full" style={{ animationDuration: `${duration}s` }}>
          {loop.map((post, i) => (
            <div key={`${i}-${post.post_id}`} className="h-full shrink-0 pr-3" aria-hidden={i >= posts.length}>
              <PostTile post={post} rankBy={rankBy} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Grid: a single horizontally-scrollable, snap-aligned row of cards.
  return (
    <div
      className={cn(
        'flex h-full w-full items-stretch gap-3 overflow-x-auto pb-1',
        'snap-x snap-mandatory scroll-smooth',
      )}
    >
      {posts.map((post) => (
        <div key={post.post_id} className="h-full shrink-0 snap-start">
          <PostTile post={post} rankBy={rankBy} />
        </div>
      ))}
    </div>
  );
}
