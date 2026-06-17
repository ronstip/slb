# frontend — idle tab logged out to landing page (401 cascade)

## Symptom

Sit on an authed page (commonly an agent's dashboard), leave it idle for a
while, come back → app bounces to the landing page and demands re-login. Server
log shows a burst of 401s on whatever the page was polling/saving:

```
POST /dashboard/layouts/<id>            401 Unauthorized
GET  /agents/<id>                       401 Unauthorized
GET  /agents/<id>/artifacts             401 Unauthorized
GET  /agents/<id>/logs?limit=50         401 Unauthorized
```

(The `firestore` positional-filter `UserWarning` and the ADC quota-project
`UserWarning` in the same log are unrelated backend noise.)

## Repro

1. Open an agent dashboard while signed in.
2. Background the tab / let the machine sleep for > ~1 hour (the Firebase ID
   token lifetime).
3. Return to the tab. The first request fires with the now-expired token.

## Root cause

Firebase ID tokens live ~1h. The JS SDK refreshes them on a `setTimeout` that
browsers **suspend** for backgrounded tabs / sleeping machines, so the proactive
refresh never fires while idle. On return, `getToken()` called
`auth.currentUser.getIdToken()` with **no force-refresh**, handing back the
stale token. The backend (`firebase_auth.verify_id_token`) rejects it → 401.

`handleResponse` in `frontend/src/api/client.ts` treated **any** 401 as a dead
session: `signOut()` + `navigate('/')`, with zero retry. The dashboard autosave
POST 401'd first, signed the user out, and the sibling requests queued behind it
(agents/artifacts/logs) all cascaded the same way → landing page.

The defect: a *recoverable* expired token (refresh token still valid) was
handled identically to a genuinely *dead* session.

## Fix

On 401, force `getIdToken(true)` (mints a fresh token from the still-valid
refresh token) and retry the request **once**; only fall through to the
sign-out path if the retry *also* 401s.

- `frontend/src/api/client.ts` — new `authedFetch()` wrapper does the
  single forced-refresh retry; all REST verbs route through it. `tokenGetter`
  and `buildAuthHeaders()` gained a `forceRefresh` arg.
- `frontend/src/api/sse-client.ts` — same single-retry on the chat SSE POST.
- `frontend/src/auth/AuthProvider.tsx` — `getToken(forceRefresh?)` passes the
  flag to `getIdToken()`.

## Regression test

`frontend/src/api/client.test.ts` → `describe('apiGet 401 forced-refresh retry')`:
- 401 → refresh + retry → 200, user NOT signed out.
- 401 → retry also 401 → signs out + navigates `/` (genuinely dead session).

Also corrected a stale pre-existing test in the same file that asserted the old
403→`/access-denied` redirect (the code intentionally surfaces resource-level
403s to the caller now).

## Fix commit

Branch `GA4`, not yet committed at time of writing.
