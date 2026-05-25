# api — every org member saw all org agents (then 403'd on their feeds)

## Symptom
Two accounts in the same org (`saharmalka@gmail.com` super-admin, `sahar.malka.work@gmail.com` free) saw the **identical** agent list. The free member's console then spammed:

```
[api] 403 Forbidden: {"detail":"Access denied for collection <uuid>"}
POST /feed 403 (Forbidden)
```

## Repro
1. Put two users in the same org (`users/{uid}.org_id` equal). Here both were in "Test Org" `Bhtx1tzdzHan9aUZGDlJ`.
2. Sign in as the non-owner member, open Home.
3. The member sees the owner's agents; each `POST /feed` for those agents' collections returns 403.

## Root cause
Org sharing was implemented at the **collection** level (a pre-agents leftover), but the agent list shared **everything**:

- `FirestoreClient.list_user_agents` returned **every** agent stamped with the user's `org_id`, with no per-agent visibility check → the member saw all 28 of the owner's agents.
- The feed/collection access check (`can_access_collection`) only grants a non-owner access when the *collection* has `visibility == "org"`. Collections are created `visibility:"private"`, so every `/feed` for those (legitimately not-shared) collections 403'd.

So the list said "you can see this agent" while the data layer said "you can't read its collections" — the mismatch produced the 403 storm.

## Fix
Moved sharing **up to the agent** (opt-in) and centralized the rule:

- New `agents/{id}.visibility` (`private` default | `org`). `can_access_agent(user, agent)` = owner OR (org match AND `visibility=="org"`). Replaced ~10 duplicated inline `owner-or-same-org` checks across `agents.py`, `topics.py`, `briefing.py`, `sessions.py` with it.
- `list_user_agents`: own agents (any visibility) + org agents only where `visibility=="org"`; absent field = private (so the 95 pre-existing fieldless agents are excluded). `agent_service.list_agents` annotates `is_owner` + `owner_label` for the "Shared by …" UI.
- `PATCH /agents/{id}/visibility` (owner-only) → `set_agent_visibility` propagates the chosen visibility down to the agent's collections, so the existing collection-level `can_access_collection` keeps working unchanged everywhere (feed/posts/dashboard). `add_agent_collection` inherits org visibility for collections attached later.
- Run actions (`/run`, `/sources/run`) tightened to **owner-only** — a shared (read-only) viewer must not spend the owner's wallet.
- Retired the old per-collection share UI (EditCollectionDialog, CollectionLibraryCard, SourceCard, CollectionsSidebar) and the dead `POST /collection/{id}/visibility` route.

No data deletion needed: with default `private`, the member now sees 0 of the owner's agents until the owner explicitly shares one.

## Regression test
`api/tests/test_agent_access.py` — `can_access_agent` cases, `list_user_agents` scoping (member sees own + only shared, not private/legacy), and `set_agent_visibility` collection propagation.

## Fix commit
Branch `dev` (uncommitted at time of writing).
