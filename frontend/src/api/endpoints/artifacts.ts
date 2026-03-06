import { apiGet, apiPatch, apiDelete } from '../client.ts';

export interface ArtifactListItem {
  artifact_id: string;
  type: 'insight_report' | 'chart' | 'data_export' | 'dashboard';
  title: string;
  user_id: string;
  org_id: string | null;
  session_id: string;
  collection_ids: string[];
  favorited: boolean;
  shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface ArtifactDetail extends ArtifactListItem {
  payload: Record<string, unknown>;
}

export function listArtifacts(): Promise<ArtifactListItem[]> {
  return apiGet<ArtifactListItem[]>('/artifacts');
}

export function getArtifact(id: string): Promise<ArtifactDetail> {
  return apiGet<ArtifactDetail>(`/artifacts/${id}`);
}

export function updateArtifact(
  id: string,
  updates: { title?: string; favorited?: boolean; shared?: boolean },
): Promise<{ status: string }> {
  return apiPatch(`/artifacts/${id}`, updates);
}

export function deleteArtifact(id: string): Promise<{ status: string }> {
  return apiDelete(`/artifacts/${id}`);
}
