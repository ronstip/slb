# frontend — public share fires a guaranteed 400 (anonymous sign-in) on every load

## Symptom
On any public/unauthenticated page (e.g. `/shared/wc26brands`) the console shows:
```
identitytoolkit.googleapis.com/v1/accounts:signUp?key=... 400 (Bad Request)
Anonymous sign-in failed: FirebaseError: Firebase: Error (auth/admin-restricted-operation).
```
on every load. Noise in the console + Sentry, plus a wasted Google round-trip
during boot.

## Root cause
`AuthProvider` signs in anonymously when there's no user
([AuthProvider.tsx](../../frontend/src/auth/AuthProvider.tsx) `onAuthStateChanged`,
`!u` branch). The Firebase project has the **Anonymous provider disabled**, so
`signInAnonymously` always returns `auth/admin-restricted-operation` (HTTP 400).
The attempt can never succeed in any environment, yet runs on every public load.

It does **not** affect load time materially — the public share data fetch uses a
raw `fetch`, not the auth-gated `apiGet`, so it isn't blocked by auth. This was
purely error noise.

## Fix
Gate the attempt behind a module constant `ANONYMOUS_AUTH_ENABLED = false` and
skip it, settling straight to signed-out (the exact state the failed call left us
in anyway: `getToken()` resolves and returns `null`, `isAnonymous` stays true).
Behaviour is unchanged for every surface — public pages fetch tokenless, gated
pages show the sign-in CTA, and `signIn`/`linkAccount` already handle a null
`currentUser`. Flip the constant to `true` if the Anonymous provider is ever
enabled in the Firebase console.

## Verified
Public share in an unauthenticated browser: the 400 + "Anonymous sign-in failed"
are gone; 3 charts still render; 331 FE tests pass; `tsc` clean.

## Note — the other console error (not fixed, not a prod bug)
`Cannot read properties of null (reading 'ownerDocument')` from Chart.js is a
**React StrictMode dev-only artifact**: StrictMode double-mounts in dev, so
react-chartjs-2 creates → destroys → recreates each chart, and a stale
ResizeObserver from the first instance calls `update()` on the now-detached
canvas. Verified by temporarily disabling `<StrictMode>` in `main.tsx` — the
error vanished; re-enabling brought it back. StrictMode double-invoke does not
happen in production builds, so there is no prod impact. Left as-is to avoid
touching the heavily-used `SocialChartWidget` for dev-only noise.

## Commit
Branch `WidgetsAndBugFix`, not yet committed at time of writing.
