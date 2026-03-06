import type { CollectionStatusResponse } from '../../api/types.ts';
import type { Source } from '../../stores/sources-store.ts';

export function mapCollectionToSource(c: CollectionStatusResponse): Source {
  return {
    collectionId: c.collection_id,
    status: c.status,
    config: c.config ?? {
      platforms: [],
      keywords: [],
      channel_urls: [],
      time_range: { start: '', end: '' },
      max_calls: 0,
      include_comments: false,
      geo_scope: 'global',
    },
    title: c.config?.keywords?.join(', ') || `Collection ${c.collection_id.slice(0, 8)}`,
    postsCollected: c.posts_collected,
    totalViews: c.total_views,
    positivePct: c.positive_pct,
    selected: false,
    active: false,
    createdAt: c.created_at ?? new Date().toISOString(),
    errorMessage: c.error_message,
    visibility: (c.visibility as 'private' | 'org') ?? 'private',
    userId: c.user_id ?? undefined,
    lastRunAt: c.last_run_at,
    nextRunAt: c.next_run_at,
    totalRuns: c.total_runs,
  };
}
