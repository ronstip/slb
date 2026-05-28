# Stale anonymous CurrentUser cache breaks invite-email-match

## Symptom

After the one-click invite flow shipped, a non-registered user opening
`/invite/{code}` in a fresh browser saw:

> Wrong Account
> You're signed in as `client@example.com`, but this invite is for
> `client@example.com`.

Both displayed emails identical — but the backend still 403'd the join.

## Repro

1. Open an invite link in an incognito window.
2. Anonymous Firebase sign-in fires; `AuthProvider.fetchProfile()` calls
   `/me`, which populates `_user_cache[anon_uid] = CurrentUser(email="", ...)`.
3. Click "Sign in with Google" → `linkWithPopup` upgrades the same uid to
   Google (uid unchanged, token now carries the real email).
4. `InviteHandler` calls `POST /orgs/join/{code}` with the new Google token.
5. `_resolve_real_user` returns the **stale anon CurrentUser** from
   `_user_cache` (5-minute TTL, keyed by uid). `actor_email = ""`.
6. Backend compares `"" != "client@example.com"` → 403.

The UI showed the correct email on the "signed in as" line (read from
Firebase auth state, not the backend), making the mismatch invisible.

## Root cause

`_user_cache` is keyed by uid. `linkWithPopup` keeps the same uid, so an
anonymous CurrentUser cached from an earlier `/me` call stayed valid for
the linked Google session. The `/auth/link-account` route already calls
`_user_cache.pop(uid)`, but only fires on the `credential-already-in-use`
fallback path (different uid). The happy-path link had no invalidation.

A secondary issue: `_get_or_create_user` returns the existing user doc as
soon as it finds one, never overwriting `email`/`is_anonymous` after the
anon→Google upgrade. So Finance, audit logs, and invite-email-match would
all see `email=""` indefinitely.

## Fix

Two layers in [api/auth/dependencies.py](../../api/auth/dependencies.py):

1. `_resolve_real_user` now skips the cache when the cached entry's
   `is_anonymous` or `email` doesn't match the decoded token — i.e.
   detects an anon→linked identity drift and re-provisions.
2. `_get_or_create_user` detects anon→linked on existing-user reads and
   backfills `email`, `display_name`, `photo_url`, `is_anonymous=False` on
   the user doc.

## Regression tests

- [api/tests/test_org_invites.py](../../api/tests/test_org_invites.py)
  - `test_anon_to_linked_backfills_email_on_user_doc`
  - `test_anon_to_linked_invalidates_user_cache`

## Commit / branch

Branch: `dev` (follow-up to the one-click invite feature).
