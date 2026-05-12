import { apiGet, apiPatch, apiPost } from '../client.ts';
import type {
  TopicAnalytics,
  TopicCluster,
  TopicPost,
  TopicsConfig,
  TopicsNarrative,
  TopicsRegenerateResult,
} from '../types.ts';

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

export interface RegenerateTopicsBody {
  algorithm_version?: 'brothers_v1' | 'llm_taxonomy_v2';
  window_days?: number;
  sample_size?: number;
  batch_size?: number;
  save_as_default?: boolean;
}

export async function regenerateAgentTopics(
  agentId: string,
  body: RegenerateTopicsBody,
): Promise<TopicsRegenerateResult> {
  return apiPost(`/agents/${agentId}/topics/regenerate`, body);
}

export async function patchTopicsConfig(
  agentId: string,
  body: Partial<TopicsConfig>,
): Promise<{ agent_id: string; topics_config: TopicsConfig }> {
  return apiPatch(`/agents/${agentId}/topics-config`, body);
}
