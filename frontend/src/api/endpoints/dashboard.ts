import { apiPost } from '../client.ts';
import type { DashboardDataResponse } from '../types.ts';

export async function getDashboardData(
  collectionIds: string[],
): Promise<DashboardDataResponse> {
  return apiPost('/dashboard/data', { collection_ids: collectionIds });
}
