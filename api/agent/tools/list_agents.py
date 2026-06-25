"""List Agents Tool — the user's agents, sorted by most recent run.

The Concierge serves a User across ALL of their monitoring agents, so before it
can answer a data question it must pick the *relevant* agent. This tool returns
the user's agents (own + org-shared) ordered by `last_run_at` descending — the
most recently run agent first — which is the best proxy for "what the user is
currently paying attention to". Read-only: it never mutates anything.

Identity comes from the session state (`user_id` / `org_id`) the Concierge
stamps on the ADK session — the same Organization scope as web chat.
"""

import logging

from google.adk.tools import ToolContext

from api.services.agent_service import list_agents as _list_agents

logger = logging.getLogger(__name__)


def _iso(value):
    """Normalize a timestamp (datetime | ISO str | None) to a sortable ISO
    string, or None. Used both for sorting and for the returned payload."""
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def list_agents(tool_context: ToolContext = None) -> dict:
    """List the user's monitoring agents, most recently run first.

    Use this to discover which agents exist and to pick the relevant one before
    answering a data question (each agent has its own scoped data). Agents are
    sorted by their most recent activity so the top of the list reflects current
    relevancy. Returns each agent's id, title, status, and last activity time.

    Returns:
        A dictionary: ``{"status", "agent_count", "agents": [...]}`` where each
        agent carries ``agent_id``, ``title``, ``status``, ``last_active_at``,
        ``is_owner`` and ``owner_label`` (set when the agent is org-shared by a
        teammate).
    """
    state = tool_context.state if tool_context else {}
    user_id = state.get("user_id")
    if not user_id:
        return {"status": "error", "message": "No user in tool context."}
    org_id = state.get("org_id")

    agents = _list_agents(user_id, org_id)
    compact = _compact_agents(agents)
    return {"status": "success", "agent_count": len(compact), "agents": compact}


def _compact_agents(agents: list[dict], current_user_id: str | None = None) -> list[dict]:
    """Map raw agent docs to compact rows, sorted most-recently-active first.

    Single source of truth for the digest shape shared by the ``list_agents``
    tool and the Concierge prompt builder. ``current_user_id`` lets the
    read-only path (``fs.list_user_agents``, which doesn't stamp ``is_owner``)
    derive ownership from the doc's ``user_id``; the service path already sets
    ``is_owner`` so it's used as-is when present.
    """
    compact = [
        {
            "agent_id": a.get("agent_id"),
            "title": a.get("title", ""),
            "status": a.get("status", "unknown"),
            "last_active_at": _last_active_at(a),
            "is_owner": (
                (a.get("user_id") == current_user_id)
                if current_user_id is not None
                else a.get("is_owner", True)
            ),
            "owner_label": a.get("owner_label"),
        }
        for a in agents
    ]
    # Most recently active first; agents with no timestamp at all sort last.
    compact.sort(key=lambda a: a["last_active_at"] or "", reverse=True)
    return compact


def build_agents_digest(
    user_id: str, org_id: str | None, limit: int = 10, fs=None
) -> list[dict]:
    """Read-only digest of the user's most-recently-active agents (own +
    org-shared), truncated to ``limit``. Used to inject agents into the
    Concierge system prompt at build time so it can skip the ``list_agents``
    tool round-trip.

    Deliberately uses the read-only ``fs.list_user_agents`` path — NOT the
    service-layer ``list_agents`` (which runs ``reconcile_user_org_membership``,
    a write) — because this runs on every Concierge turn.
    """
    if fs is None:
        from api.deps import get_fs

        fs = get_fs()
    agents = fs.list_user_agents(user_id, org_id)
    return _compact_agents(agents, current_user_id=user_id)[:limit]


def _last_active_at(agent: dict):
    """Best-effort recency signal. ``last_run_at`` is the intended field but is
    not yet populated on most agents, so coalesce through the timestamps that
    ARE set on a run/edit — preferring a true run completion when present. Auto-
    upgrades to ``last_run_at`` once that field starts being written."""
    for key in ("last_run_at", "completed_at", "updated_at", "created_at"):
        v = agent.get(key)
        if v:
            return _iso(v)
    return None
