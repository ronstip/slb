import { apiGet, apiPost, apiPatch, apiDelete, apiGetBlob } from '../client.ts';
import type {
  CollectionStats,
  CollectionStatusResponse,
  CreateCollectionRequest,
} from '../types.ts';

export async function createCollection(
  data: CreateCollectionRequest,
): Promise<{ collection_id: string; status: string }> {
  return apiPost('/collections', data);
}

export async function getCollectionStatus(
  collectionId: string,
): Promise<CollectionStatusResponse> {
  return apiGet(`/collection/${collectionId}`);
}

export async function listCollections(): Promise<CollectionStatusResponse[]> {
  return apiGet('/collections');
}

export async function setCollectionVisibility(
  collectionId: string,
  visibility: 'private' | 'org',
): Promise<{ status: string; visibility: string }> {
  return apiPost(`/collection/${collectionId}/visibility`, { visibility });
}

export async function deleteCollection(
  collectionId: string,
): Promise<{ status: string }> {
  return apiDelete(`/collection/${collectionId}`);
}

export async function getCollectionStats(
  collectionId: string,
): Promise<CollectionStats> {
  return apiGet(`/collection/${collectionId}/stats`);
}

export async function triggerCollection(
  collectionId: string,
): Promise<{ status: string; message: string }> {
  return apiPost(`/collection/${collectionId}/trigger`, {});
}

export async function updateCollectionMode(
  collectionId: string,
  ongoing: boolean,
  schedule?: string,
): Promise<{ ongoing: boolean; schedule: string | null }> {
  return apiPatch(`/collection/${collectionId}/mode`, { ongoing, schedule });
}

export async function downloadCollection(
  collectionId: string,
  titleHint: string,
): Promise<void> {
  const blob = await apiGetBlob(`/collection/${collectionId}/download`);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = titleHint.slice(0, 40).replace(/[^a-z0-9]+/gi, '_');
  const filename = `${slug}_${today}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
