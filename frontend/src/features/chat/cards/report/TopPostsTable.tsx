import { ExternalLink } from 'lucide-react';
import { formatNumber } from '../../../../lib/format.ts';
import { PLATFORM_LABELS } from '../../../../lib/constants.ts';

interface PostRow {
  post_id: string;
  platform: string;
  channel_handle: string;
  title: string;
  post_url: string;
  likes: number;
  views: number;
  shares: number;
  comments_count: number;
  total_engagement: number;
  sentiment: string;
}

interface TopPostsTableProps {
  data: Record<string, unknown>;
}

export function TopPostsTable({ data }: TopPostsTableProps) {
  const posts = (data.posts ?? []) as PostRow[];
  if (posts.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="w-8 px-2 py-2" />
            <th className="px-3 py-2 font-medium text-muted-foreground">Post</th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">Views</th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">Likes</th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">Comments</th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">Shares</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post, i) => {
            const platformLabel = PLATFORM_LABELS[post.platform?.toLowerCase()] ?? post.platform;

            return (
              <tr
                key={post.post_id || i}
                className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-2 py-1.5 text-center">
                  {post.post_url && (
                    <a
                      href={post.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </td>
                <td className="px-3 py-1.5 max-w-[300px]">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{platformLabel}</span>
                    <span>·</span>
                    <span>@{post.channel_handle}</span>
                  </div>
                  {post.title && (
                    <p className="text-[12px] leading-tight text-foreground line-clamp-1">
                      {post.title}
                    </p>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                  {post.views > 0 ? formatNumber(post.views) : '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                  {post.likes > 0 ? formatNumber(post.likes) : '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                  {post.comments_count > 0 ? formatNumber(post.comments_count) : '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[12px] tabular-nums text-foreground">
                  {post.shares > 0 ? formatNumber(post.shares) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
