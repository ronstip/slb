import { apiGet } from '../client.ts';
import type { TopicCluster, TopicAnalytics, TopicPost, TopicsNarrative } from '../types.ts';

export async function getAgentTopics(agentId: string): Promise<TopicCluster[]> {
  return apiGet(`/agents/${agentId}/topics`);
}

export async function getAgentTopicsNarrative(agentId: string): Promise<TopicsNarrative | null> {
  return apiGet(`/agents/${agentId}/topics/narrative`);
}

export async function getAgentTopicAnalytics(
  agentId: string,
  clusterId: string,
): Promise<TopicAnalytics> {
  return apiGet(`/agents/${agentId}/topics/${clusterId}/analytics`);
}

export async function getAgentTopicPosts(
  agentId: string,
  clusterId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<TopicPost[]> {
  const queryParams: Record<string, string> = {};
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.offset) queryParams.offset = String(params.offset);
  return apiGet(`/agents/${agentId}/topics/${clusterId}/posts`, queryParams);
}
