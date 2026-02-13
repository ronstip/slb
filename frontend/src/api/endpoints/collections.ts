import { apiGet, apiPost } from '../client.ts';
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

export async function listCollections(userId?: string): Promise<CollectionStatusResponse[]> {
  const params = userId ? { user_id: userId } : undefined;
  return apiGet('/collections', params);
}
