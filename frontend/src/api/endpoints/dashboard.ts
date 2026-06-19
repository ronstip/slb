import { apiDelete, apiGet, apiPost } from '../client.ts';
import type { DashboardAggregateResponse, DashboardDataResponse, DashboardShareInfo, SharedDashboardDataResponse } from '../types.ts';
import type { ReportConfig, SocialDashboardWidget } from '../../features/studio/dashboard/types-social-dashboard.ts';
import type { DashboardFilters } from '../../features/studio/dashboard/use-dashboard-filters.ts';
import type { PostDetails } from '../../features/studio/dashboard/use-post-details.tsx';

export async function getDashboardData(
  collectionIds: string[],
  agentId?: string,
  reportConfig?: ReportConfig | null,
  // Opt-in: omit the heavy display-only fields (lazy-fetched per visible post via
  // getDashboardPostDetails). Only callers that render inside a
  // DashboardDetailsProvider may set this; others get the full payload.
  slim = false,
): Promise<DashboardDataResponse> {
  return apiPost('/dashboard/data', {
    collection_ids: collectionIds,
    agent_id: agentId,
    report_config: reportConfig ?? undefined,
    slim,
  });
}

/** Lazy-fetch the display-only fields (ai_summary/context/media_refs) for the
 *  bounded set of posts currently on screen. Served from the same cached core
 *  as getDashboardData, so a warm dashboard answers without hitting BigQuery. */
export async function getDashboardPostDetails(
  collectionIds: string[],
  postIds: string[],
  agentId?: string,
): Promise<Record<string, PostDetails>> {
  const res = await apiPost<{ details: Record<string, PostDetails> }>(
    '/dashboard/post-details',
    { collection_ids: collectionIds, agent_id: agentId, post_ids: postIds },
  );
  return res.details ?? {};
}

/** Studio (interactive) server-side widget aggregation.
 *  Send the effective filter state (already scope-intersected on the FE) and
 *  the current layout; receive compact widget data the widgets use in place of
 *  client-side aggregation. Absent widget ids keep client-side aggregation. */
export async function getDashboardAggregate(
  collectionIds: string[],
  agentId: string | undefined,
  reportConfig: ReportConfig | null | undefined,
  filters: DashboardFilters,
  layout: SocialDashboardWidget[],
): Promise<DashboardAggregateResponse> {
  return apiPost('/dashboard/aggregate', {
    collection_ids: collectionIds,
    agent_id: agentId,
    report_config: reportConfig ?? undefined,
    filters,
    layout,
  });
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
  opts: { serverAgg?: boolean } = {},
): Promise<SharedDashboardDataResponse> {
  const API_BASE = import.meta.env.VITE_API_URL || '/api';
  // slim=1: heavy display-only fields are lazy-fetched per visible post via
  // getSharedPostDetails. The share's filter bar is hidden, so the visible set
  // is static and each widget fetches once.
  // agg (P2, default-on): the server returns pre-aggregated widgetData/tableData/
  // feedData for the widgets it can reproduce and, when the whole layout is
  // covered, omits the raw posts. We send `agg=server` to opt in and `agg=client`
  // to force the legacy full-posts path (the `?agg=client` debug escape hatch);
  // the backend `DASHBOARD_SERVER_AGG` setting is the authoritative kill switch.
  const params = opts.serverAgg ? '?slim=1&agg=server' : '?slim=1&agg=client';
  const res = await fetch(`${API_BASE}/dashboard/shares/public/${token}${params}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/** Public (tokenless) lazy-fetch of display-only fields for visible posts. */
export async function getSharedPostDetails(
  token: string,
  postIds: string[],
): Promise<Record<string, PostDetails>> {
  const API_BASE = import.meta.env.VITE_API_URL || '/api';
  const res = await fetch(`${API_BASE}/dashboard/shares/public/${token}/post-details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_ids: postIds }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as { details?: Record<string, PostDetails> };
  return data.details ?? {};
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
