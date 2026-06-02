"""Idempotency for artifact-creating tools.

The agent's chat baseline showed 65 duplicate actions across 75 tool calls -
the model kept re-creating dashboards, charts, and SQL probes because nothing
in the system said "you already did this." This helper gives every artifact
tool a way to say "I already did this in the current session - here's the
existing artifact_id" instead of minting a new one.

Usage in a tool:

    from api.agent.tools._idempotency import action_key, check_or_register

    def create_chart(collection_ids, chart_type, ..., tool_context=None):
        key = action_key("create_chart", {
            "collection_ids": sorted(collection_ids),
            "chart_type": chart_type,
        })
        existing = check_or_register(tool_context, key, dry_run=True)
        if existing:
            return {
                "status": "duplicate",
                "chart_id": existing["artifact_id"],
                "message": "Already created earlier this session - reusing.",
            }

        # ... do the real work, get chart_id ...

        check_or_register(tool_context, key, artifact_id=chart_id)
        return {"status": "success", "chart_id": chart_id, ...}

The state lives in `tool_context.state["recent_actions"]` keyed by the
hash. Cleared automatically per session because session state itself is
per-session.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

# Session-state key under which we keep the action ledger.
_LEDGER_KEY = "recent_actions"

# How many actions to keep before evicting the oldest. Keeps state bounded
# in long sessions.
_MAX_LEDGER_SIZE = 64


def action_key(tool_name: str, args: dict[str, Any]) -> str:
    """Hash a (tool_name, canonical_args) pair to a stable short key.

    Canonical JSON ensures key order doesn't change the hash. Values are
    coerced via `default=str` so things like UUIDs and dates don't break.
    """
    payload = json.dumps(args or {}, sort_keys=True, default=str)
    digest = hashlib.sha1(f"{tool_name}|{payload}".encode("utf-8")).hexdigest()
    return digest[:16]


def _get_ledger(tool_context) -> dict[str, dict[str, Any]]:
    """Return the recent-actions ledger from session state, creating if needed.

    Tolerates a missing tool_context (some test paths) - returns a temporary
    dict in that case so the tool still functions, just without dedup.
    """
    if tool_context is None or not hasattr(tool_context, "state"):
        return {}
    state = tool_context.state
    ledger = state.get(_LEDGER_KEY)
    if not isinstance(ledger, dict):
        ledger = {}
        state[_LEDGER_KEY] = ledger
    return ledger


def check_or_register(
    tool_context,
    key: str,
    *,
    artifact_id: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any] | None:
    """Look up `key` in the session's action ledger.

    - `dry_run=True`: only check. Returns the ledger entry if seen, else None.
    - `dry_run=False` with `artifact_id`: register this key → artifact_id.
      Returns None on a fresh registration; returns the existing entry if
      `key` was already registered (caller can choose to reuse).

    Eviction: when the ledger exceeds _MAX_LEDGER_SIZE, the oldest entries
    are dropped. This is approximate (Python dict iteration order = insertion
    order in 3.7+) but adequate for a per-session bound.
    """
    ledger = _get_ledger(tool_context)
    existing = ledger.get(key)

    if dry_run:
        return existing

    if existing:
        return existing  # already registered; caller decides

    if artifact_id is None:
        # Nothing to register without an id.
        return None

    ledger[key] = {
        "artifact_id": artifact_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if len(ledger) > _MAX_LEDGER_SIZE:
        # Drop the oldest insertion-order entry.
        oldest = next(iter(ledger))
        ledger.pop(oldest, None)

    return None


