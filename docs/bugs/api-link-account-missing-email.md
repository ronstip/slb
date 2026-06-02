# api — link-account migration drops the user's email

## Symptom
A user could appear "logged in with the right email" (profile/Account page shows
it) yet be effectively invisible in the admin Users list — rendering as a
blank/near-empty row.

> Note: this was the *suspected* cause of the "new user missing from admin Users
> list" report. A read-only prod diagnostic (2026-06-02) showed the reported
> user (`ron@scolto.com`) had **no** Firestore doc at all (an environment/backend
> mismatch — they authenticated against a non-prod API), so it was NOT the cause
> of that specific report. The bug below is real but latent; fixed as hardening.

## Root cause
Every visitor is signed in anonymously first (`AuthProvider`), creating a
`users/{uid}` doc with `email=""`, `is_anonymous=True`. When the Google sign-in
produces a **new** uid (the `auth/credential-already-in-use` path), the client
calls `POST /auth/link-account`. The handler (`api/routers/auth.py`
`link_account`) copied the anonymous doc to the new uid and only flipped
`is_anonymous=False` — it never backfilled the real email/display_name from the
authenticated identity. The new-uid doc kept `email=""`. `/me` still looked fine
because it reads the email from the Firebase token, not Firestore. And the doc
never self-healed: `_get_or_create_user`'s backfill branch only fires for docs
still marked `is_anonymous`.

## Fix
- `link_account` now backfills `email`/`display_name` from the authenticated
  `CurrentUser` when creating the new-uid doc.
- `_get_or_create_user` gained an `elif` self-heal: a non-anonymous doc with a
  blank email is repaired from the token on the next request.

## Regression test
`api/tests/test_link_account.py`:
- `test_link_account_backfills_real_email_on_new_uid`
- `test_get_or_create_self_heals_blank_email_on_nonanon_doc`

## Fix commit
Branch `dev` (uncommitted at time of writing).
