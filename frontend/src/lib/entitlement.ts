import type { UserProfile } from '../api/types.ts';

/** Why an account can't use the app right now (client-side mirror of the
 *  server gate). `null` = has access. Super admins / impersonation always pass. */
export type AccessBlock = 'blocked' | 'trial_expired' | null;

export function accountBlock(profile: UserProfile | null): AccessBlock {
  if (!profile || profile.is_super_admin || profile.impersonation) return null;
  const plan = profile.plan;
  if (!plan) return null;
  if (plan.tier === 'blocked') return 'blocked';
  if (
    plan.tier === 'trial' &&
    plan.trial_expires_at &&
    new Date(plan.trial_expires_at).getTime() < Date.now()
  ) {
    return 'trial_expired';
  }
  return null;
}
