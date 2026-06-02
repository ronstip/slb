# api — new users not blocked from the app

## Symptom
A brand-new Google user (never approved/invited) could sign in and navigate the
whole app, getting only sporadic "You don't have access to that." toasts. New,
non-invited users should be blocked (shown the "Account pending approval" page);
invited users should land in Trial.

## Repro
1. Deploy with `SIGNUP_GATE=open` (or via `scripts/deploy_prod.sh`, which set no
   `SIGNUP_GATE` → defaulted to `open`).
2. Sign in with a Google account that is not on any allowlist and has no invite.
3. App renders normally; only per-resource 403s surface as toasts.

## Root cause
New accounts are provisioned `plan.tier="blocked"`
(`api/auth/dependencies.py` `_get_or_create_user`), but the read/access gate
`require_access()` (`api/services/entitlements.py`) is inert unless
`signup_gate == "entitlements"`. Prod default was `open`, and the two deploy
paths disagreed: `.github/workflows/deploy.yml` used `allowlist` while
`scripts/deploy_prod.sh` set nothing (→ `open`). With the access gate off,
`blocked` users were never 402'd on reads, so they roamed freely. The sporadic
toasts were ordinary per-resource ownership 403s (`frontend/src/lib/notify.ts`
`case 403`), unrelated to the account gate.

All enforcement machinery already existed (super-admin bypass, 402→`/account-pending`
redirect, `accountBlock` client mirror, invite→Trial promotion in `/orgs/join`,
invitee allowlist bypass). Only the gate needed turning on.

## Fix
Set `SIGNUP_GATE=entitlements` in all deploy paths so they can't diverge:
`scripts/deploy_prod.sh`, `.github/workflows/deploy.yml`, and documented in
`.env.example`. This activates `enforce_access` on every `_gated` router →
`tier=blocked` returns 402 `account_blocked` → frontend redirects to
`/account-pending`. Super admins bypass; invitees are promoted to `trial` on
accepting and pass.

Migration check (2026-06-02): all 9 existing users are already `free`/`trial`
(none `blocked`), so the flip locks out no current user. Watch for `trial`
accounts whose `trial_expires_at` has passed — they would get `trial_expired`.

## Regression test
`api/tests/test_enforce_access.py` — `enforce_access` invokes `require_access`
for real users, propagates the 402 block, and skips anonymous users. Tier logic
itself is covered by `api/tests/test_entitlements.py`.

## Fix commit
Branch `dev` (uncommitted at time of writing).
