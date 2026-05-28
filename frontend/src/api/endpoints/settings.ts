import { apiGet, apiPost } from '../client.ts';
import type {
  UserProfile,
  UserPreferences,
  OrgDetails,
  OrgInvite,
  OrgInvitePreview,
  UsageStats,
  Wallet,
  TopUpOption,
  CreditTransaction,
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

/** Public — no auth required. Used by the signed-out invite page. */
export function getInvitePreview(inviteCode: string): Promise<OrgInvitePreview> {
  return apiGet<OrgInvitePreview>(`/orgs/invites/preview/${inviteCode}`);
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

// --- Credit wallet ($-based) ---

export function getWallet(): Promise<Wallet> {
  return apiGet<Wallet>('/billing/credits');
}

export function getTopUpOptions(): Promise<TopUpOption[]> {
  return apiGet<TopUpOption[]>('/billing/topup-options');
}

export function topUp(amountCents: number): Promise<{ url: string }> {
  return apiPost('/billing/topup', { amount_cents: amountCents });
}

export function getCreditHistory(): Promise<CreditTransaction[]> {
  return apiGet<CreditTransaction[]>('/billing/history');
}
