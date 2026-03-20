import { apiGet } from '../client.ts';
import type { TopicCluster, TopicAnalytics, TopicPost } from '../types.ts';

export async function getTopics(collectionId: string): Promise<TopicCluster[]> {
  return apiGet(`/collections/${collectionId}/topics`);
}

export async function getTopicAnalytics(
  clusterId: string,
  collectionId: string,
): Promise<TopicAnalytics> {
  return apiGet(`/topics/${clusterId}/analytics`, { collection_id: collectionId });
}

export async function getTopicPosts(
  clusterId: string,
  collectionId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<TopicPost[]> {
  const queryParams: Record<string, string> = { collection_id: collectionId };
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.offset) queryParams.offset = String(params.offset);
  return apiGet(`/topics/${clusterId}/posts`, queryParams);
}
