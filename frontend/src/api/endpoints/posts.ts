import { apiGet, apiPost } from '../client.ts';

export interface EnrichmentOverride {
  post_id: string;
  is_related_to_task: boolean;
  ai_summary: string;
  sentiment: string;
  emotion: string;
  entities: string[];
  themes: string[];
  detected_brands: string[];
  content_type: string;
  channel_type: string;
  language: string;
  context: string;
  custom_fields?: Record<string, unknown> | null;
  source?: string | null;
}

export interface OverrideRequest {
  agent_id: string;
  collection_id: string;
  fields: Partial<Omit<EnrichmentOverride, 'post_id' | 'source'>>;
}

export interface DraftRequest {
  agent_id: string;
  collection_id: string;
  instruction: string;
}

export async function overridePostEnrichment(
  postId: string,
  body: OverrideRequest,
): Promise<EnrichmentOverride> {
  return apiPost(`/posts/${encodeURIComponent(postId)}/override`, body);
}

export async function draftPostOverride(
  postId: string,
  body: DraftRequest,
): Promise<EnrichmentOverride> {
  return apiPost(`/posts/${encodeURIComponent(postId)}/draft-override`, body);
}

export interface FetchCommentsResponse {
  status: string;
  post_id: string;
}

export async function fetchPostComments(
  postId: string,
  agentId?: string,
): Promise<FetchCommentsResponse> {
  return apiPost(`/posts/${encodeURIComponent(postId)}/fetch-comments`, {
    agent_id: agentId,
  });
}

export interface CommentItem {
  comment_id: string;
  root_comment_id: string | null;
  channel_handle: string;
  channel_id: string | null;
  content: string | null;
  commented_at: string | null;
  likes: number | null;
  replies_count: number | null;
  views: number | null;
}

export interface CommentsResponse {
  post_id: string;
  comments: CommentItem[];
}

export async function listPostComments(postId: string): Promise<CommentsResponse> {
  return apiGet(`/posts/${encodeURIComponent(postId)}/comments`);
}
