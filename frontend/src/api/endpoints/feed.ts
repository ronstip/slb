import { apiGet } from '../client.ts';
import type { FeedParams, FeedResponse } from '../types.ts';

export async function getPosts(
  collectionId: string,
  params: FeedParams = {},
): Promise<FeedResponse> {
  const queryParams: Record<string, string> = {};
  if (params.sort) queryParams.sort = params.sort;
  if (params.platform && params.platform !== 'all') queryParams.platform = params.platform;
  if (params.sentiment && params.sentiment !== 'all') queryParams.sentiment = params.sentiment;
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.offset) queryParams.offset = String(params.offset);

  return apiGet(`/collections/${collectionId}/posts`, queryParams);
}
