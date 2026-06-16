/**
 * Whether the auth identity is fully settled enough to fire authed data
 * queries.
 *
 * Gating on `profile` (not just `!loading`) is deliberate: `AuthProvider`
 * resolves the auth-ready promise and flips `loading` to false the moment
 * Firebase reports a user, but `fetchProfile()` (`/me`) runs AFTER
 * `resetAllStores()` in `onAuthStateChanged`. Queries that fire in that window
 * can carry a stale `X-Impersonate-User-Id` (read synchronously from
 * sessionStorage in the API client) or a not-yet-resolved identity, producing a
 * transient 403 "Access denied" before the cleared-store refetch self-heals.
 * Waiting for `profile` guarantees the stores were reset and the identity is
 * the real, settled one. `devMode` (no Firebase) has no profile, so it's ready
 * as soon as loading is done.
 */
export function isAuthReady(s: {
  loading: boolean;
  profile: unknown;
  devMode: boolean;
}): boolean {
  return !s.loading && (s.devMode || !!s.profile);
}
