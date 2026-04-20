import { apiGet, apiPost, apiPatch, apiDelete } from '../client.ts';

export interface ArtifactListItem {
  artifact_id: string;
  type: 'chart' | 'data_export' | 'dashboard' | 'presentation';
  title: string;
  user_id: string;
  org_id: string | null;
  session_id: string;
  collection_ids: string[];
  favorited: boolean;
  shared: boolean;
  created_at: string;
  updated_at: string;
  chart_type?: string | null;
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

export interface UnderlyingDataResponse {
  rows: Record<string, unknown>[];
  row_count: number;
  column_names: string[];
  sql: string;
  created_at: string;
  collection_ids: string[];
}

export function getUnderlyingData(id: string): Promise<UnderlyingDataResponse> {
  return apiGet<UnderlyingDataResponse>(`/artifacts/${id}/underlying-data`);
}

export interface InlineUnderlyingDataParams {
  collection_ids: string[];
  created_at: string;
  filter_sql?: string;
  source_sql?: string;
}

export function postUnderlyingData(
  params: InlineUnderlyingDataParams,
): Promise<UnderlyingDataResponse> {
  return apiPost<UnderlyingDataResponse>('/underlying-data', params);
}
