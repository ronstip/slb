import { apiDelete, apiGet, apiPost } from '../client.ts';
import type { DashboardDataResponse, DashboardShareInfo, SharedDashboardDataResponse } from '../types.ts';

export async function getDashboardData(
  collectionIds: string[],
  agentId?: string,
): Promise<DashboardDataResponse> {
  return apiPost('/dashboard/data', { collection_ids: collectionIds, agent_id: agentId });
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
  agent_id?: string;
}): Promise<DashboardShareInfo> {
  return apiPost('/dashboard/shares', payload);
}

export async function revokeDashboardShare(token: string): Promise<void> {
  await apiDelete(`/dashboard/shares/${token}`);
}

// Custom-slug shares (super-admin only)

export async function getCustomSlugShare(
  dashboardId: string,
): Promise<DashboardShareInfo | null> {
  return apiGet<DashboardShareInfo | null>(`/dashboard/shares/custom/${dashboardId}`);
}

export async function createCustomSlugShare(payload: {
  dashboard_id: string;
  collection_ids: string[];
  title: string;
  agent_id?: string;
  slug: string;
}): Promise<DashboardShareInfo> {
  return apiPost('/dashboard/shares/custom', payload);
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

// --- Widget annotation compose (AI-drafted header / figure text) ---

export interface WidgetBucketStat {
  label: string;
  value: number;
}

export interface WidgetDataSummary {
  post_count: number;
  time_range?: { from: string | null; to: string | null };
  metric_label?: string;
  dimension_label?: string;
  top_buckets?: WidgetBucketStat[];
  kpi_value?: number;
  top_sentiments?: WidgetBucketStat[];
  top_platforms?: WidgetBucketStat[];
}

export interface WidgetSnapshot {
  title?: string;
  description?: string;
  chart_type?: string;
  aggregation?: string;
  custom_config?: Record<string, unknown> | null;
  filters?: Record<string, unknown> | null;
  figure_header?: string;
  figure_text?: string;
}

export interface ComposeWidgetFieldRequest {
  target: 'header' | 'figure_text';
  widget: WidgetSnapshot;
  data_summary: WidgetDataSummary;
  agent_id?: string;
}

export async function composeWidgetField(
  req: ComposeWidgetFieldRequest,
): Promise<{ text: string }> {
  return apiPost('/dashboard/widget/compose-field', req);
}
