import { useState } from 'react';
import { ExternalLink, Play, ImageOff, ThumbsUp, MessageCircle, Eye, Share2 } from 'lucide-react';
import type { FeedPost, MediaRef } from '../../api/types.ts';
import { mediaUrl } from '../../api/client.ts';
import { PLATFORM_COLORS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';
import { Card } from '../../components/ui/card.tsx';
import { Badge } from '../../components/ui/badge.tsx';

interface PostCardProps {
  post: FeedPost;
}

export function PostCard({ post }: PostCardProps) {
  const sentimentColor = post.sentiment ? SENTIMENT_COLORS[post.sentiment] : undefined;
  const media = (post.media_refs ?? []).filter((m) => m?.original_url || m?.gcs_uri);

  return (
    <Card className="overflow-hidden">
      {/* Media */}
      {media.length > 0 && <PostMedia media={media} postUrl={post.post_url} />}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-center gap-2 text-xs">
          <PlatformIcon platform={post.platform} className="h-4 w-4 shrink-0" />
          <span className="font-medium text-foreground truncate">@{post.channel_handle}</span>
          <span className="text-muted-foreground/70 shrink-0">{timeAgo(post.posted_at)}</span>
        </div>

        {/* Content */}
        {(post.title || post.content) && (
          <p className="mt-2.5 text-sm text-foreground line-clamp-3">
            {post.title && <span className="font-medium">{post.title} </span>}
            {post.content}
          </p>
        )}

        {/* Sentiment + content type */}
        <div className="mt-2.5 flex items-center gap-2">
          {post.sentiment && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium capitalize"
              style={{
                color: sentimentColor,
                backgroundColor: sentimentColor ? `${sentimentColor}15` : undefined,
              }}
            >
              {post.sentiment}
            </span>
          )}
          {post.content_type && (
            <span className="text-xs text-muted-foreground/70 capitalize">
              {post.content_type}
            </span>
          )}
        </div>

        {/* Engagement */}
        <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground">
          {post.likes != null && (
            <span className="inline-flex items-center gap-1">
              <ThumbsUp className="h-3 w-3" />
              {formatNumber(post.likes)}
            </span>
          )}
          {post.comments_count != null && (
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3 w-3" />
              {formatNumber(post.comments_count)}
            </span>
          )}
          {post.views != null && (
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {formatNumber(post.views)}
            </span>
          )}
          {post.shares != null && (
            <span className="inline-flex items-center gap-1">
              <Share2 className="h-3 w-3" />
              {formatNumber(post.shares)}
            </span>
          )}
        </div>

        {/* Themes */}
        {post.themes && post.themes.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {post.themes.slice(0, 3).map((theme) => (
              <Badge key={theme} variant="secondary" className="text-xs font-normal">
                {theme}
              </Badge>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="mt-2.5 flex items-center gap-2">
          <a
            href={post.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary transition-colors hover:text-primary/80"
          >
            <ExternalLink className="h-3 w-3" />
            Original
          </a>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Platform icon SVGs                                                  */
/* ------------------------------------------------------------------ */

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const color = PLATFORM_COLORS[platform] || '#6B7294';

  switch (platform) {
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill={color} className={className}>
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      );
    case 'twitter':
      return (
        <svg viewBox="0 0 24 24" fill={color} className={className}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" fill={color} className={className}>
          <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.88-2.88 2.89 2.89 0 012.88-2.88c.3 0 .59.05.86.12V9.01a6.32 6.32 0 00-.86-.06 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.98a8.21 8.21 0 004.77 1.52V7.05a4.83 4.83 0 01-1-.36z" />
        </svg>
      );
    case 'reddit':
      return (
        <svg viewBox="0 0 24 24" fill={color} className={className}>
          <path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 00.029-.463.33.33 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.095z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill={color} className={className}>
          <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      );
    default:
      return (
        <div
          className={`rounded-full ${className}`}
          style={{ backgroundColor: color }}
        />
      );
  }
}

/* ------------------------------------------------------------------ */
/* Media helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve a media URL for direct embedding in <img>/<video> tags.
 * GCS URIs need the backend proxy. External URLs can be used directly
 * since <img> and <video> tags are not subject to CORS restrictions.
 */
function resolveUrl(m: MediaRef): string {
  if (m.gcs_uri) {
    return mediaUrl(m.gcs_uri);
  }
  return m.original_url || '';
}

function PostMedia({ media, postUrl }: { media: MediaRef[]; postUrl: string }) {
  const images = media.filter((m) => m.media_type === 'image');
  const videos = media.filter((m) => m.media_type === 'video');

  // If there's a video, show it prominently (no extra thumbnail images)
  if (videos.length > 0) {
    return <VideoPlayer media={videos[0]} postUrl={postUrl} />;
  }

  // Images only
  if (images.length === 1) {
    return <MediaImage media={images[0]} className="w-full max-h-64 object-cover" />;
  }

  if (images.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-0.5">
        {images.map((img, i) => (
          <MediaImage key={i} media={img} className="h-36 w-full object-cover" />
        ))}
      </div>
    );
  }

  if (images.length >= 3) {
    return (
      <div className="grid grid-cols-3 gap-0.5">
        <MediaImage media={images[0]} className="col-span-2 row-span-2 h-48 w-full object-cover" />
        {images.slice(1, 3).map((img, i) => (
          <MediaImage key={i} media={img} className="h-[calc(96px-1px)] w-full object-cover" />
        ))}
        {images.length > 3 && (
          <div className="relative h-[calc(96px-1px)] w-full">
            <MediaImage media={images[3]} className="h-full w-full object-cover" />
            {images.length > 4 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-medium text-white">
                +{images.length - 3}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function MediaImage({ media, className }: { media: MediaRef; className?: string }) {
  const primarySrc = resolveUrl(media);
  const fallbackSrc = media.original_url
    ? mediaUrl(undefined, media.original_url)
    : undefined;
  const [src, setSrc] = useState(primarySrc);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-secondary text-muted-foreground/70 ${className}`}>
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-secondary" />
      )}
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (fallbackSrc && src !== fallbackSrc) {
            setSrc(fallbackSrc);
          } else {
            setFailed(true);
          }
        }}
        className={`h-full w-full ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200 object-cover`}
      />
    </div>
  );
}

function VideoPlayer({ media, postUrl }: { media: MediaRef; postUrl: string }) {
  const primarySrc = resolveUrl(media);
  const fallbackSrc = media.original_url
    ? mediaUrl(undefined, media.original_url)
    : undefined;
  const [src, setSrc] = useState(primarySrc);
  const [failed, setFailed] = useState(false);

  if (failed) {
    // Fallback: link to original post
    return (
      <a
        href={postUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-40 items-center justify-center gap-2 bg-secondary text-muted-foreground transition-colors hover:bg-border"
      >
        <Play className="h-8 w-8" />
        <span className="text-sm font-medium">Watch on original platform</span>
      </a>
    );
  }

  return (
    <video
      src={src}
      controls
      preload="metadata"
      onError={() => {
        if (fallbackSrc && src !== fallbackSrc) {
          setSrc(fallbackSrc);
        } else {
          setFailed(true);
        }
      }}
      className="w-full max-h-72 bg-black object-contain"
    />
  );
}
