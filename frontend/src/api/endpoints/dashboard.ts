import { apiDelete, apiGet, apiPost } from '../client.ts';
import type { DashboardDataResponse, DashboardShareInfo, SharedDashboardDataResponse } from '../types.ts';

export async function getDashboardData(
  collectionIds: string[],
): Promise<DashboardDataResponse> {
  return apiPost('/dashboard/data', { collection_ids: collectionIds });
}

// --- Dashboard sharing ---

export async function getDashboardShare(
  dashboardId: string,
): Promise<DashboardShareInfo | null> {
  return apiGet<DashboardShareInfo | null>(`/dashboard/shares/${dashboardId}`);
}

export async function createDashboardShare(payload: {
  dashboard_id: string;
  collection_ids: string[];
  title: string;
}): Promise<DashboardShareInfo> {
  return apiPost('/dashboard/shares', payload);
}

export async function revokeDashboardShare(token: string): Promise<void> {
  await apiDelete(`/dashboard/shares/${token}`);
}

export async function getSharedDashboardData(
  token: string,
): Promise<SharedDashboardDataResponse> {
  const API_BASE = import.meta.env.VITE_API_URL || '/api';
  const res = await fetch(`${API_BASE}/dashboard/shares/public/${token}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
