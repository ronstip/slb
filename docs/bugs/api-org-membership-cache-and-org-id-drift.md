# api — "Share with org" missing on agents owned by users who joined an org after signup

## Symptom
User B accepts an invite to user A's org and signs in. User B's own agents have NO **Share with org** option in the 3-dots menu, even though the share toggle works fine for user A. Same issue for users who created an org themselves but had pre-existing agents.

## Repro
1. User A creates a new org, invites user B as admin.
2. User B accepts the invite (`POST /orgs/join/{code}`), confirms membership in Settings → Organization.
3. User B opens any of his own agents on the Agents page → 3-dots menu shows only Rename / Archive. **No "Share with org"**.

## Root cause
Two compounding bugs around the lifecycle of `agent.org_id`:

1. **Stale `CurrentUser` cache.** `api/auth/dependencies.py` caches the resolved `CurrentUser` for 5 minutes (`_user_cache`) to avoid a Firestore read per request. `join_org` (and `create_org`, `leave_org`, role/remove ops) wrote `users/{uid}.org_id` to Firestore but did NOT invalidate the cache. So for up to 5 minutes after joining, `user.org_id` was still `None` server-side. Any agent the user created in that window was stamped `org_id=None` at creation time.

2. **No reconciliation when org membership changes.** `agent.org_id` is captured at creation time. If the owner later joins / leaves / switches orgs, the stamp drifts. The frontend gate `canShare = isOwner && !!task.org_id` ([frontend/src/features/agents/AgentCard.tsx:419](frontend/src/features/agents/AgentCard.tsx#L419)) then hides the share toggle on agents created before the org existed (or carried over from a previous org).

Re-stamping naively would also leak: an agent shared with org A would silently become visible in org B if the owner switched orgs.

## Fix
- **Invalidate the user cache** on every `users/{uid}.org_id|org_role` write: added `invalidate_user_cache(uid)` in `api/auth/dependencies.py`, wired into `create_org`, `join_org`, `leave_org`, `update_member_role`, `remove_member`.
- **Reconcile on demand.** New `reconcile_user_org_membership(user_id, current_org_id)` in `api/services/agent_service.py` enforces the invariant `agent.org_id == owner.org_id` across all of the user's agents. When the stamp drifts:
  - Stamp the current org_id on the agent + propagate to its collections.
  - If the agent was `visibility=="org"`, reset to `private` so a stale share never follows the owner across an org switch (or after leaving an org).
- **Wire reconcile** into `create_org` / `join_org` / `leave_org` / `remove_member` (proactive) and into `list_agents` (lazy / idempotent — heals users who joined before the fix landed, and any future drift).

## Regression tests
`api/tests/test_agent_access.py`:
- `test_reconcile_stamps_org_id_on_orphan_agents` — primary bug.
- `test_reconcile_unshares_when_switching_orgs` — no share leak across orgs.
- `test_reconcile_drops_share_when_leaving_org` — no orphan share after leaving.
- `test_reconcile_preserves_private_visibility_on_join` — joining doesn't auto-share.
- `test_reconcile_is_noop_when_org_matches` — steady-state idempotence.
- `test_reconcile_ignores_other_users_agents` — query scoped to owner.
- `test_invalidate_user_cache_drops_entry` + missing-key no-op.

## Fix commit
Branch `dev` (uncommitted at time of writing).
