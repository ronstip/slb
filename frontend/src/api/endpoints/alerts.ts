import { apiGet, apiPost, apiPatch, apiDelete } from '../client.ts';
import type {
  SocialDashboardWidget,
  SocialWidgetFilters,
} from '../../features/studio/dashboard/types-social-dashboard.ts';

/** A dynamic email alert: a saved dashboard filter attached to an agent. When a
 *  collection run brings in posts matching `filters`, the recipients are emailed. */
export interface Alert {
  alert_id: string;
  agent_id: string;
  name: string;
  enabled: boolean;
  filters: SocialWidgetFilters;
  /** Dashboard widgets rendered (as PNGs) into the email. Empty → text body. */
  widgets: SocialDashboardWidget[];
  recipients: string[];
  max_items_per_email: number;
  created_at: string | null;
  updated_at: string | null;
  last_triggered_at: string | null;
  last_match_count: number;
  trigger_count: number;
  created_by: 'user' | 'agent';
}

export interface AlertCreateBody {
  name: string;
  filters: SocialWidgetFilters;
  recipients: string[];
  enabled?: boolean;
  max_items_per_email?: number;
  widgets?: SocialDashboardWidget[];
}

export type AlertUpdateBody = Partial<{
  name: string;
  filters: SocialWidgetFilters;
  recipients: string[];
  enabled: boolean;
  max_items_per_email: number;
  widgets: SocialDashboardWidget[];
}>;

export interface AlertPreviewPost {
  post_id: string;
  platform: string | null;
  channel_handle: string | null;
  sentiment: string | null;
  posted_at: string;
  content: string;
  post_url: string | null;
}

export interface AlertPreviewResult {
  matched_count: number;
  scanned_count: number;
  sample: AlertPreviewPost[];
}

export function listAlerts(agentId: string): Promise<{ alerts: Alert[] }> {
  return apiGet(`/agents/${agentId}/alerts`);
}

export function createAlert(agentId: string, body: AlertCreateBody): Promise<Alert> {
  return apiPost(`/agents/${agentId}/alerts`, body);
}

export function previewAlert(
  agentId: string,
  filters: SocialWidgetFilters,
): Promise<AlertPreviewResult> {
  return apiPost(`/agents/${agentId}/alerts/preview`, { filters });
}

export function updateAlert(alertId: string, body: AlertUpdateBody): Promise<Alert> {
  return apiPatch(`/alerts/${alertId}`, body);
}

export function deleteAlert(alertId: string): Promise<void> {
  return apiDelete(`/alerts/${alertId}`);
}

export function testAlert(
  alertId: string,
): Promise<{ status: string; sent_to: string[]; matched_count: number }> {
  return apiPost(`/alerts/${alertId}/test`, {});
}
