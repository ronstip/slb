# frontend — shared explorer dashboard "Access denied" race

## Symptom

Opening an explorer dashboard of an agent shared org-wide produced an "Access
denied" toast ("You don't have access to that.") on cold load. `GET
/dashboard/layouts/{layout_id}` returned **403**, then the page self-healed and
rendered fine seconds later. Reporter was a super-admin viewing another
super-admin's agent in the **same org** — i.e. genuinely authorized.

## Repro

1. Be signed in; have a stale `slb-impersonation` target in sessionStorage from a
   prior "View as User" session (or otherwise hit a cold load before `/me`
   resolves).
2. Cold-load an org-shared agent's explorer dashboard.
3. The first `GET /dashboard/layouts/{id}` 403s → toast; a later refetch succeeds.

## Root cause

The layout query (`useDashboardLayout`) fired before the auth identity settled.

- `buildAuthHeaders` (`frontend/src/api/client.ts`) attaches `X-Impersonate-User-Id`
  on every request, read **synchronously** from raw sessionStorage
  (`getImpersonationUid`). On a cold load this header is attached before
  `AuthProvider.resetAllStores()` clears a stale impersonation target.
- The backend resolves that target user; `can_access_component`
  (`api/services/collection_service.py`) gates on owner OR same-org +
  `visibility=="org"` (no super-admin bypass — by design). A different-org
  target → 403 "Access denied". (Missing token would be 401, not 403 — confirming
  a valid-but-wrong identity was sent.)
- `AuthProvider` flips `loading` to false and resolves the auth-ready promise the
  moment Firebase reports a user, but `fetchProfile()` (`/me`) and
  `resetAllStores()` run after. The layout query firing in that window is the bug.
  The "self-heal" is `resetAllStores()` → `queryClient.clear()` triggering a clean
  refetch on the next identity transition.

The toast comes from the global `QueryCache.onError` (`frontend/src/main.tsx`) →
`notifyError`/`mapError` 403 branch (`frontend/src/lib/notify.ts`); the layout
query isn't tagged `meta:{silent:true}`.

## Fix

Gate the layout query on settled auth, reusing the hook's existing `enabled`
option. New pure helper `isAuthReady({loading, profile, devMode})` in
`frontend/src/auth/authReady.ts` returns `!loading && (devMode || !!profile)` —
gating on `profile` guarantees `resetAllStores()` + `/me` completed.

- `frontend/src/features/studio/dashboard/DashboardView.tsx`: `useDashboardLayout(id, { enabled: authReady })`.
- `frontend/src/features/studio/dashboard/SocialDashboardView.tsx`: `enabled: !readOnly && authReady`; the one-shot init effect also guards on `layoutGatePending = !readOnly && !authReady` so the authed path doesn't hydrate from defaults during the gated window (when `enabled:false`, `isLoading` is also false).

Public/shared (`readOnly`) viewers are unaffected — `enabled` stays false and the
layout is inlined.

Not done (intentionally out of scope): clearing the stale impersonation target at
boot for same-uid refreshes (risks the "impersonation survives refresh"
behavior); also did not add a super-admin access bypass (policy unchanged).

## Regression test

`frontend/src/auth/authReady.test.ts` — covers the gate logic, incl. the bug
window (`loading:false, profile:null` → not ready). Component/hook rendering
isn't a supported test surface here (vitest runs in `node`, no
`@testing-library/react`/jsdom), so the gate was extracted to a pure, testable
helper.

## Commit

Branch `dev` (uncommitted at time of writing).
