import { describe, it, expect } from 'vitest';
import type { DashboardPost } from '../../../api/types.ts';
import {
  rankEmbedPosts,
  resolveEmbedPosts,
  embedCandidatePosts,
  embedPostMetricValue,
  embedPostThumbnail,
  resolveEmbedCount,
  postEngagementTotal,
  marqueeDurationSeconds,
  embedHandle,
} from './embed-posts.ts';

// Collection-mode Embed Posts picks the top-N posts feeding the dashboard,
// ranked by a metric, then drops any the editor manually hid. These tests pin
// the pure selection logic (the UI layers on top of it).

function p(over: Partial<DashboardPost>): DashboardPost {
  return {
    post_id: 'x', collection_id: 'c1', platform: 'tiktok', channel_handle: 'h',
    posted_at: '2026-01-01T00:00:00Z', post_url: 'https://example.com/x',
    like_count: 0, view_count: 0, comment_count: 0, share_count: 0,
    ...over,
  } as DashboardPost;
}

describe('embedPostMetricValue', () => {
  it('reads each engagement metric off the post', () => {
    const post = p({ view_count: 10, like_count: 5, comment_count: 3, share_count: 2 });
    expect(embedPostMetricValue(post, 'view_count')).toBe(10);
    expect(embedPostMetricValue(post, 'like_count')).toBe(5);
    expect(embedPostMetricValue(post, 'comment_count')).toBe(3);
    expect(embedPostMetricValue(post, 'share_count')).toBe(2);
    expect(embedPostMetricValue(post, 'engagement_total')).toBe(10); // 5+3+2
  });

  it('maps `recent` to the posted-at epoch', () => {
    const older = p({ posted_at: '2026-01-01T00:00:00Z' });
    const newer = p({ posted_at: '2026-06-01T00:00:00Z' });
    expect(embedPostMetricValue(newer, 'recent')).toBeGreaterThan(
      embedPostMetricValue(older, 'recent'),
    );
  });

  it('treats a missing/invalid posted_at as 0 for `recent`', () => {
    expect(embedPostMetricValue(p({ posted_at: '' }), 'recent')).toBe(0);
  });
});

describe('postEngagementTotal', () => {
  it('sums likes + comments + shares (not views)', () => {
    expect(postEngagementTotal(p({ view_count: 99, like_count: 4, comment_count: 1, share_count: 2 }))).toBe(7);
  });
});

describe('rankEmbedPosts', () => {
  it('orders highest-first by the chosen metric', () => {
    const posts = [
      p({ post_id: 'a', view_count: 100 }),
      p({ post_id: 'b', view_count: 300 }),
      p({ post_id: 'c', view_count: 200 }),
    ];
    expect(rankEmbedPosts(posts, 'view_count').map((x) => x.post_id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps input order on ties (stable)', () => {
    const posts = [
      p({ post_id: 'a', like_count: 5 }),
      p({ post_id: 'b', like_count: 5 }),
      p({ post_id: 'c', like_count: 5 }),
    ];
    expect(rankEmbedPosts(posts, 'like_count').map((x) => x.post_id)).toEqual(['a', 'b', 'c']);
  });

  it('drops posts without a usable post_url', () => {
    const posts = [
      p({ post_id: 'a', view_count: 10, post_url: 'https://example.com/a' }),
      p({ post_id: 'b', view_count: 99, post_url: undefined }),
      p({ post_id: 'c', view_count: 50, post_url: '   ' }),
    ];
    expect(rankEmbedPosts(posts, 'view_count').map((x) => x.post_id)).toEqual(['a']);
  });
});

describe('resolveEmbedCount', () => {
  it('defaults when unset and clamps to [1, 30]', () => {
    expect(resolveEmbedCount(undefined)).toBe(8);
    expect(resolveEmbedCount(0)).toBe(1);
    expect(resolveEmbedCount(5)).toBe(5);
    expect(resolveEmbedCount(999)).toBe(30);
    expect(resolveEmbedCount(3.7)).toBe(3);
  });
});

describe('embedCandidatePosts / resolveEmbedPosts', () => {
  const posts = [
    p({ post_id: 'a', view_count: 10 }),
    p({ post_id: 'b', view_count: 40 }),
    p({ post_id: 'c', view_count: 30 }),
    p({ post_id: 'd', view_count: 20 }),
  ];

  it('caps the candidate set to `count`, ranked', () => {
    expect(embedCandidatePosts(posts, { source: 'collection', rankBy: 'view_count', count: 2 }).map((x) => x.post_id))
      .toEqual(['b', 'c']);
  });

  it('removes manually-hidden ids from the rendered set', () => {
    const out = resolveEmbedPosts(posts, {
      source: 'collection', rankBy: 'view_count', count: 3, hiddenPostIds: ['c'],
    });
    expect(out.map((x) => x.post_id)).toEqual(['b', 'd']);
  });

  it('hiding never re-ranks the remaining posts', () => {
    const out = resolveEmbedPosts(posts, {
      source: 'collection', rankBy: 'view_count', count: 4, hiddenPostIds: ['b'],
    });
    expect(out.map((x) => x.post_id)).toEqual(['c', 'd', 'a']);
  });

  it('defaults rankBy to views and count to 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => p({ post_id: `p${i}`, view_count: i }));
    const out = embedCandidatePosts(many, { source: 'collection' });
    expect(out).toHaveLength(8);
    expect(out[0].post_id).toBe('p11'); // highest views first
  });
});

describe('embedPostThumbnail', () => {
  it('returns null when the post has no media', () => {
    expect(embedPostThumbnail(p({ media_refs: undefined }))).toBeNull();
    expect(embedPostThumbnail(p({ media_refs: '[]' }))).toBeNull();
  });

  it('prefers an image ref and proxies a GCS uri', () => {
    const refs = JSON.stringify([
      { media_type: 'image', content_type: 'image/jpeg', original_url: 'https://cdn/x.jpg', gcs_uri: 'gs://bucket/path/x.jpg' },
    ]);
    const thumb = embedPostThumbnail(p({ media_refs: refs }));
    expect(thumb).not.toBeNull();
    expect(thumb!.isVideo).toBe(false);
    expect(thumb!.url).toContain('/media/path/x.jpg');
  });

  it('falls back to a video ref and marks it as video', () => {
    const refs = JSON.stringify([
      { media_type: 'video', content_type: 'video/mp4', original_url: 'https://cdn/v.mp4', preview_image_url: 'https://cdn/v.jpg' },
    ]);
    const thumb = embedPostThumbnail(p({ media_refs: refs }));
    expect(thumb).not.toBeNull();
    expect(thumb!.isVideo).toBe(true);
    expect(thumb!.url).toContain('media-proxy');
  });
});

describe('embedHandle', () => {
  it('prefixes exactly one @ and never doubles an existing one', () => {
    expect(embedHandle('433')).toBe('@433');        // Instagram-style (no @)
    expect(embedHandle('@fifa')).toBe('@fifa');      // YouTube-style (already @)
    expect(embedHandle('@@weird')).toBe('@weird');
    expect(embedHandle(undefined)).toBe('@');
  });
});

describe('marqueeDurationSeconds', () => {
  it('scales with card count and is faster for `fast`', () => {
    expect(marqueeDurationSeconds('fast', 10)).toBeLessThan(marqueeDurationSeconds('normal', 10));
    expect(marqueeDurationSeconds('normal', 10)).toBeLessThan(marqueeDurationSeconds('slow', 10));
    expect(marqueeDurationSeconds('normal', 1)).toBeGreaterThanOrEqual(8); // floor
  });
});
