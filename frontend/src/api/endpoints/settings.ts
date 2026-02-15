import { apiGet, apiPost } from '../client.ts';
import type {
  UserProfile,
  UserPreferences,
  OrgDetails,
  OrgInvite,
  UsageStats,
  UsageTrendResponse,
  CreditBalance,
  CreditPack,
  CreditPurchaseHistoryItem,
} from '../types.ts';

// --- Account ---

export async function updateProfile(data: { display_name?: string; preferences?: Partial<UserPreferences> }): Promise<UserProfile> {
  return apiPost<UserProfile>('/me', data);
}

// --- Organization ---

export function getOrgDetails(): Promise<OrgDetails> {
  return apiGet<OrgDetails>('/orgs/me');
}

export function createOrg(data: { name: string; domain?: string }): Promise<{ org_id: string; name: string; slug: string; domain: string | null }> {
  return apiPost('/orgs', data);
}

export function updateOrg(data: { name?: string; domain?: string }): Promise<OrgDetails> {
  return apiPost('/orgs/me/update', data);
}

export function createInvite(data: { email: string; role?: string }): Promise<OrgInvite> {
  return apiPost('/orgs/me/invites', data);
}

export function getInvites(): Promise<OrgInvite[]> {
  return apiGet<OrgInvite[]>('/orgs/me/invites');
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await apiPost(`/orgs/me/invites/${inviteId}/revoke`, {});
}

export function joinOrg(inviteCode: string): Promise<{ status: string; org_id: string }> {
  return apiPost(`/orgs/join/${inviteCode}`, {});
}

export function updateMemberRole(uid: string, role: string): Promise<{ status: string }> {
  return apiPost(`/orgs/me/members/${uid}/role`, { role });
}

export async function removeMember(uid: string): Promise<void> {
  await apiPost(`/orgs/me/members/${uid}/remove`, {});
}

export async function leaveOrg(): Promise<void> {
  await apiPost('/orgs/me/leave', {});
}

// --- Usage ---

export function getUsage(): Promise<UsageStats> {
  return apiGet<UsageStats>('/usage/me');
}

export function getOrgUsage(): Promise<UsageStats> {
  return apiGet<UsageStats>('/usage/org');
}

export function getUsageTrend(days: number = 30): Promise<UsageTrendResponse> {
  return apiGet<UsageTrendResponse>('/usage/trend', { days: String(days) });
}

export function getOrgUsageTrend(days: number = 30): Promise<UsageTrendResponse> {
  return apiGet<UsageTrendResponse>('/usage/org/trend', { days: String(days) });
}

// --- Credits ---

export function getCreditBalance(): Promise<CreditBalance> {
  return apiGet<CreditBalance>('/billing/credits');
}

export function getCreditPacks(): Promise<CreditPack[]> {
  return apiGet<CreditPack[]>('/billing/credit-packs');
}

export function purchaseCredits(packId: string): Promise<{ url: string }> {
  return apiPost('/billing/purchase-credits', { pack_id: packId });
}

export function getCreditHistory(): Promise<CreditPurchaseHistoryItem[]> {
  return apiGet<CreditPurchaseHistoryItem[]>('/billing/credit-history');
}
