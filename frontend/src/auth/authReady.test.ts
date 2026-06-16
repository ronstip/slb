import { describe, it, expect } from 'vitest';
import { isAuthReady } from './authReady.ts';

// Regression: the explorer dashboard's layout query (`useDashboardLayout`) used
// to fire on cold load before the auth identity had settled, so the request
// could carry a stale `X-Impersonate-User-Id` (or a not-yet-resolved identity)
// and hit a 403 "Access denied" toast before self-healing on the refetch.
// The gate must stay closed until `loading` is done AND `/me` profile has
// resolved (which only happens after `resetAllStores()` ran in AuthProvider),
// except in dev mode where there is no Firebase/profile.
describe('isAuthReady', () => {
  it('is not ready while auth is still loading', () => {
    expect(isAuthReady({ loading: true, profile: null, devMode: false })).toBe(false);
    expect(isAuthReady({ loading: true, profile: { uid: 'u' }, devMode: false })).toBe(false);
  });

  it('is not ready once loaded but before the profile resolves (the bug window)', () => {
    expect(isAuthReady({ loading: false, profile: null, devMode: false })).toBe(false);
  });

  it('is ready once loaded and the profile has resolved', () => {
    expect(isAuthReady({ loading: false, profile: { uid: 'u' }, devMode: false })).toBe(true);
  });

  it('is ready in dev mode without a profile (no Firebase)', () => {
    expect(isAuthReady({ loading: false, profile: null, devMode: true })).toBe(true);
  });
});
