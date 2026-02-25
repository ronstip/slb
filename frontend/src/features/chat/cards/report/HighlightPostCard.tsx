import { ExternalLink, ThumbsUp, Eye, MessageCircle, Share2 } from 'lucide-react';
import { formatNumber } from '../../../../lib/format.ts';

interface HighlightPostCardProps {
  data: Record<string, unknown>;
}

const PLATFORM_COLORS: Record<string, string> = {
  youtube: 'bg-red-500/10 text-red-500',
  tiktok: 'bg-fuchsia-500/10 text-fuchsia-500',
  reddit: 'bg-orange-500/10 text-orange-500',
  twitter: 'bg-sky-500/10 text-sky-500',
  instagram: 'bg-pink-500/10 text-pink-500',
};

export function HighlightPostCard({ data }: HighlightPostCardProps) {
  const platform = (data.platform ?? '') as string;
  const channelHandle = (data.channel_handle ?? '') as string;
  const title = (data.title ?? '') as string;
  const postUrl = (data.post_url ?? '') as string;
  const likes = (data.likes ?? 0) as number;
  const views = (data.views ?? 0) as number;
  const shares = (data.shares ?? 0) as number;
  const commentsCount = (data.comments_count ?? 0) as number;
  const sentiment = (data.sentiment ?? '') as string;
  const contentType = (data.content_type ?? '') as string;

  const platformColor = PLATFORM_COLORS[platform.toLowerCase()] ?? 'bg-muted text-muted-foreground';

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${platformColor}`}>
            {platform}
          </span>
          <span className="text-xs text-muted-foreground">@{channelHandle}</span>
          {sentiment && (
            <span className="text-[10px] text-muted-foreground/60">{sentiment}</span>
          )}
          {contentType && (
            <span className="text-[10px] text-muted-foreground/60">{contentType}</span>
          )}
        </div>
        {title && (
          <p className="mt-1 text-sm leading-snug text-foreground line-clamp-2">{title}</p>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
          {views > 0 && (
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" /> {formatNumber(views)}
            </span>
          )}
          {likes > 0 && (
            <span className="flex items-center gap-1">
              <ThumbsUp className="h-3 w-3" /> {formatNumber(likes)}
            </span>
          )}
          {commentsCount > 0 && (
            <span className="flex items-center gap-1">
              <MessageCircle className="h-3 w-3" /> {formatNumber(commentsCount)}
            </span>
          )}
          {shares > 0 && (
            <span className="flex items-center gap-1">
              <Share2 className="h-3 w-3" /> {formatNumber(shares)}
            </span>
          )}
        </div>
      </div>
      {postUrl && (
        <a
          href={postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
