import type { FeedPost } from '../../../api/types.ts';
import { PostCard } from '../../studio/PostCard.tsx';

interface PostEmbedCardProps {
  data: Record<string, unknown>;
}

export function PostEmbedCard({ data }: PostEmbedCardProps) {
  const rawPosts = (data.posts ?? []) as Record<string, unknown>[];

  if (rawPosts.length === 0) return null;

  const posts: FeedPost[] = rawPosts.map((p) => ({
    post_id: (p.post_id as string) || '',
    platform: (p.platform as string) || '',
    channel_handle: (p.channel_handle as string) || '',
    channel_id: p.channel_id as string | undefined,
    title: p.title as string | undefined,
    content: p.content as string | undefined,
    post_url: (p.post_url as string) || '',
    posted_at: (p.posted_at as string) || '',
    post_type: (p.post_type as string) || '',
    media_refs: (p.media_refs ?? []) as FeedPost['media_refs'],
    likes: (p.likes as number) ?? 0,
    shares: (p.shares as number) ?? 0,
    views: (p.views as number) ?? 0,
    comments_count: (p.comments_count as number) ?? 0,
    saves: (p.saves as number) ?? 0,
    total_engagement: (p.total_engagement as number) ?? 0,
    sentiment: p.sentiment as string | undefined,
    themes: (p.themes ?? []) as string[],
    entities: (p.entities ?? []) as string[],
    ai_summary: p.ai_summary as string | undefined,
    content_type: p.content_type as string | undefined,
  }));

  const isSingle = posts.length === 1;

  return (
    <div className={`${isSingle ? '' : 'grid grid-cols-2 gap-2'} ${posts.length > 4 ? 'max-h-[700px] overflow-y-auto' : ''}`}>
      {posts.map((post) => (
        <PostCard key={post.post_id} post={post} />
      ))}
    </div>
  );
}
