import { apiGet, apiPost } from '../client.ts';
import type {
  AdminOverview,
  AdminUserList,
  AdminUserDetail,
  AdminActivity,
  AdminCollectionList,
  AdminRevenue,
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

export function getAdminCollections(params?: Record<string, string>): Promise<AdminCollectionList> {
  return apiGet<AdminCollectionList>('/admin/collections', params);
}

export function getAdminRevenue(days: number = 90): Promise<AdminRevenue> {
  return apiGet<AdminRevenue>('/admin/revenue', { days: String(days) });
}

export function startImpersonation(targetUid: string): Promise<void> {
  return apiPost<void>('/admin/impersonate/start', { target_uid: targetUid });
}

export function stopImpersonation(): Promise<void> {
  return apiPost<void>('/admin/impersonate/stop', {});
}
