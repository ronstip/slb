# Allowlist signup gate blocks non-allowlisted invitees

## Symptom

A real client opened a prod org-invite link on a fresh machine, signed in
with Google, and saw:

> Wrong Account
> You're signed in as `client@gmail.com`, but this invite is for
> `client@gmail.com`.
> *Access restricted to approved users*

(Identical email on both sides; the small grey "Access restricted to
approved users" caption was the only tell.)

## Repro (prod-only)

1. Prod runs `signup_gate=allowlist` with `ALLOWED_EMAILS=…internal…`.
2. Invitee's email is by definition NOT on that allowlist.
3. Invitee signs in → first authenticated request hits the allowlist gate
   in `_resolve_real_user` → 403 *"Access restricted to approved users"*.
4. Frontend's invite handler treats every 403 from `POST /orgs/join/{code}`
   as an email-mismatch → renders the "Wrong Account" card.

The gate fires before `/orgs/join` even runs, so the email-match logic
that was supposed to bless the invitee never gets a chance.

## Root cause

The allowlist was the only signup-gate signal. It treats "this email is on
the static `ALLOWED_EMAILS` list" as the sole proof of authorization,
ignoring two other equally-strong signals:

- A pending invite for this email (an admin already vouched).
- Existing org membership (the user already passed authorization once).

## Fix

[api/auth/dependencies.py](../../api/auth/dependencies.py) -
`_resolve_real_user` now bypasses the allowlist when
`_has_invite_or_membership(uid, email)` returns true:

- Pending invite for this email → user is mid-flow accepting an invite.
- `user_doc.org_id` is set → existing org member; allowlist removal must
  not lock them out.

## Regression tests

- [api/tests/test_org_invites.py](../../api/tests/test_org_invites.py)
  - `test_allowlist_bypass_pending_invite_passes`
  - `test_allowlist_bypass_existing_member_passes`
  - `test_allowlist_bypass_random_user_blocked`

## Frontend follow-up (not done)

`InviteHandler` could distinguish 403 "allowlist" from 403 "email
mismatch" by looking at the response detail string. Today both render the
same "Wrong Account" card. Not blocking now - once this backend fix
deploys, allowlist 403 stops happening for invitees. Leave as polish.

## Commit / branch

Branch: `dev` (follow-up to the cache-staleness fix and the one-click
invite feature).
