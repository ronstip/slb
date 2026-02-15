import { apiGet, apiPost, apiDelete } from '../client.ts';
import type {
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
