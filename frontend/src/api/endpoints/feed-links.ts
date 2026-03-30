import { apiGet, apiPost, apiDelete } from '../client.ts';
import type { FeedLinkInfo } from '../types.ts';

export async function createFeedLink(payload: {
  collection_ids: string[];
  filters: Record<string, string>;
  title: string;
}): Promise<FeedLinkInfo> {
  return apiPost('/feed-links', payload);
}

export async function listFeedLinks(): Promise<FeedLinkInfo[]> {
  return apiGet('/feed-links');
}

export async function revokeFeedLink(token: string): Promise<void> {
  return apiDelete(`/feed-links/${token}`);
}
