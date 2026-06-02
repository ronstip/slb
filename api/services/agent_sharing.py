"""Single source of truth for what an agent shares with its org.

The **agent is the unit of org sharing** (see `can_access_agent` in
`collection_service`). This module owns the *component registry*: the set of
Firestore docs that inherit an agent's visibility, plus the fan-out that
stamps / reverts that visibility on share, un-share, and org reconcile.

Keeping the registry here means "what is part of a shared agent" is defined in
exactly one place. Both `agent_service.set_agent_visibility` (the explicit
share toggle) and `agent_service.reconcile_user_org_membership` (the org-switch
reconcile) delegate their component fan-out to `propagate_to_components`.

See docs/agent-sharing-architecture.md for the full model.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _safe(fn, label: str) -> None:
    """Run a single per-component write, swallowing failures.

    A missing / legacy / orphaned component doc must never abort the whole
    share toggle - the agent's own visibility is already written by the caller,
    so a partial fan-out is recoverable (re-toggle, or the reconcile path) while
    a raised exception would leave the agent flipped but the toggle 500'd.
    """
    try:
        fn()
    except Exception:
        logger.exception("agent share: failed to propagate visibility to %s", label)


def propagate_to_components(
    fs: Any,
    agent: dict,
    *,
    org_id: str | None,
    visibility: str | None = None,
) -> None:
    """Fan an agent's org-share state out to every component it owns.

    `org_id` is always restamped on each component so it stays in lock-step with
    the agent (the agent's `org_id` is the authority; components are denormalized
    copies that the per-doc access checks read).

    `visibility` semantics:
      - ``"org"`` / ``"private"``  → bring every component in line with it.
      - ``None``                   → restamp `org_id` only, leave each
        component's share state untouched. Used by the reconcile path when the
        owner's org changed but the agent itself stayed private (so there is no
        share state to move).

    Artifacts have no `visibility` field - they gate on a `shared` bool - so the
    visibility is translated to ``shared = (visibility == "org")`` for them.
    """
    # 1. Collections - the feed / posts / dashboard access checks all read the
    #    per-collection `visibility` + `org_id`, so these must mirror the agent.
    col_updates: dict[str, Any] = {"org_id": org_id}
    if visibility is not None:
        col_updates["visibility"] = visibility
    for cid in agent.get("collection_ids", []) or []:
        _safe(
            lambda cid=cid: fs.update_collection_status(cid, **col_updates),
            f"collection {cid}",
        )

    # 2. Artifacts - deliverables (briefs / slides / exports). They predate the
    #    `visibility` field and gate on a `shared` bool, so the visibility is
    #    translated: org -> shared=True, private -> shared=False.
    art_updates: dict[str, Any] = {"org_id": org_id}
    if visibility is not None:
        art_updates["shared"] = visibility == "org"
    for aid in agent.get("artifact_ids", []) or []:
        _safe(
            lambda aid=aid: fs.update_artifact(aid, dict(art_updates)),
            f"artifact {aid}",
        )

    # Explorer / dashboard layouts are wired in later steps of
    # docs/agent-sharing-architecture.md §5 - added here so this stays the one
    # place the registry lives.
