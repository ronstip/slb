import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../client.ts';
import type {
  AdminOverview,
  AdminUserList,
  AdminUserDetail,
  AdminActivity,
  AdminCollectionList,
  AdminWaitlistList,
  CollectionAudit,
  CostBreakdown,
  FinanceSummary,
  PricingConfig,
  PricingUpdate,
  RoutingConfig,
  RoutingUpdate,
  PlanTier,
} from '../types.ts';

export function checkAdminAccess(): Promise<{ is_admin: boolean }> {
  return apiGet<{ is_admin: boolean }>('/admin/check');
}

export function getAdminOverview(): Promise<AdminOverview> {
  return apiGet<AdminOverview>('/admin/overview');
}

export function getAdminUsers(params?: Record<string, string>): Promise<AdminUserList> {
  return apiGet<AdminUserList>('/admin/users', params);
}

export function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  return apiGet<AdminUserDetail>(`/admin/users/${userId}`);
}

export function getAdminActivity(days: number = 30): Promise<AdminActivity> {
  return apiGet<AdminActivity>('/admin/activity', { days: String(days) });
}

// --- §E plan + credit administration ---

export function updateUserPlan(
  userId: string,
  body: { tier: PlanTier; trial_expires_at?: string | null; notes?: string },
): Promise<{ status: string; tier: string }> {
  return apiPatch(`/admin/users/${userId}/plan`, body);
}

export function grantUserCredit(
  userId: string,
  body: { amount_cents?: number; amount_micros?: number; reason?: string; kind?: string },
): Promise<{ status: string; balance_micros: number }> {
  return apiPost(`/admin/users/${userId}/credit`, body);
}

export type CostRange = 'week' | 'mtd' | 'all' | 'custom';

export function getUserCost(
  userId: string,
  range: CostRange = 'mtd',
  start?: string,
  end?: string,
): Promise<CostBreakdown> {
  const params: Record<string, string> = { range };
  if (range === 'custom') {
    if (start) params.start = start;
    if (end) params.end = end;
  }
  return apiGet<CostBreakdown>(`/admin/users/${userId}/cost`, params);
}

export function getAdminCollections(params?: Record<string, string>): Promise<AdminCollectionList> {
  return apiGet<AdminCollectionList>('/admin/collections', params);
}

export function getCollectionAudit(collectionId: string): Promise<CollectionAudit> {
  return apiGet<CollectionAudit>(`/admin/collections/${collectionId}/audit`);
}

// --- §E Finance (platform cost vs revenue) + pricing administration ---

export function getFinance(
  range: CostRange = 'mtd',
  start?: string,
  end?: string,
): Promise<FinanceSummary> {
  const params: Record<string, string> = { range };
  if (range === 'custom') {
    if (start) params.start = start;
    if (end) params.end = end;
  }
  return apiGet<FinanceSummary>('/admin/finance', params);
}

export function getPricing(): Promise<PricingConfig> {
  return apiGet<PricingConfig>('/admin/pricing');
}

export function updatePricing(body: PricingUpdate): Promise<PricingConfig> {
  return apiPut<PricingConfig>('/admin/pricing', body);
}

export function getRouting(): Promise<RoutingConfig> {
  return apiGet<RoutingConfig>('/admin/routing');
}

export function updateRouting(body: RoutingUpdate): Promise<RoutingConfig> {
  return apiPut<RoutingConfig>('/admin/routing', body);
}

export function startImpersonation(targetUid: string): Promise<void> {
  return apiPost<void>('/admin/impersonate/start', { target_uid: targetUid });
}

export function stopImpersonation(): Promise<void> {
  return apiPost<void>('/admin/impersonate/stop', {});
}

export function getAdminWaitlist(params?: Record<string, string>): Promise<AdminWaitlistList> {
  return apiGet<AdminWaitlistList>('/admin/waitlist', params);
}

export function deleteAdminWaitlistEntry(entryId: string): Promise<void> {
  return apiDelete<void>(`/admin/waitlist/${encodeURIComponent(entryId)}`);
}
