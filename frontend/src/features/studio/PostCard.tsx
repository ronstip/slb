import { useState } from 'react';
import { ExternalLink, Play, ImageOff } from 'lucide-react';
import type { FeedPost, MediaRef } from '../../api/types.ts';
import { mediaUrl } from '../../api/client.ts';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';

interface PostCardProps {
  post: FeedPost;
}

export function PostCard({ post }: PostCardProps) {
  const platformLabel = PLATFORM_LABELS[post.platform] || post.platform;
  const platformAbbrev = platformLabel.slice(0, 2).toUpperCase();
  const sentimentColor = post.sentiment ? SENTIMENT_COLORS[post.sentiment] : undefined;
  const media = (post.media_refs ?? []).filter((m) => m?.original_url || m?.gcs_uri);

  return (
    <div className="rounded-xl border border-border-default/50 bg-bg-surface shadow-sm overflow-hidden">
      {/* Media */}
      {media.length > 0 && <PostMedia media={media} postUrl={post.post_url} />}

      <div className="p-3.5">
        {/* Header */}
        <div className="flex items-center gap-2 text-xs">
          <span
            className="rounded-md px-1.5 py-0.5 font-medium text-white"
            style={{ backgroundColor: sentimentColor || '#6B7294' }}
          >
            {platformAbbrev}
          </span>
          <span className="font-medium text-text-primary">@{post.channel_handle}</span>
          <span className="text-text-tertiary">{timeAgo(post.posted_at)}</span>
        </div>

        {/* Content */}
        {(post.title || post.content) && (
          <p className="mt-2 text-sm text-text-primary line-clamp-3">
            {post.title && <span className="font-medium">{post.title} </span>}
            {post.content}
          </p>
        )}

        {/* Sentiment + content type */}
        <div className="mt-2 flex items-center gap-2">
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
            <span className="text-xs text-text-tertiary capitalize">
              {post.content_type}
            </span>
          )}
        </div>

        {/* Engagement */}
        <div className="mt-2 flex items-center gap-3 text-xs text-text-secondary">
          {post.likes != null && <span>&#10084;&#65039; {formatNumber(post.likes)}</span>}
          {post.comments_count != null && <span>&#128172; {formatNumber(post.comments_count)}</span>}
          {post.views != null && <span>&#128065; {formatNumber(post.views)}</span>}
          {post.shares != null && <span>&#8599; {formatNumber(post.shares)}</span>}
        </div>

        {/* Themes */}
        {post.themes && post.themes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {post.themes.slice(0, 3).map((theme) => (
              <span key={theme} className="rounded-lg bg-bg-surface-secondary px-1.5 py-0.5 text-xs text-text-secondary">
                {theme}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="mt-2 flex items-center gap-2">
          <a
            href={post.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent-hover"
          >
            <ExternalLink className="h-3 w-3" />
            Original
          </a>
        </div>
      </div>
    </div>
  );
}

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

  // If there's a video, show it prominently
  if (videos.length > 0) {
    return (
      <div className="relative">
        <VideoPlayer media={videos[0]} postUrl={postUrl} />
        {images.length > 0 && (
          <div className="flex gap-1 p-2 pt-0">
            {images.slice(0, 3).map((img, i) => (
              <MediaImage key={i} media={img} className="h-16 w-16 rounded-lg" />
            ))}
          </div>
        )}
      </div>
    );
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

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-bg-surface-secondary text-text-tertiary ${className}`}>
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (fallbackSrc && src !== fallbackSrc) {
          setSrc(fallbackSrc);
        } else {
          setFailed(true);
        }
      }}
      className={className}
    />
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
        className="flex h-40 items-center justify-center gap-2 bg-bg-surface-secondary text-text-secondary transition-colors hover:bg-border-default"
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
