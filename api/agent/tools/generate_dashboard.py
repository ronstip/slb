"""
Generate Dashboard Tool — populates the Explore tab with the default layout.

Dashboards are NOT artifacts and NOT user-facing deliverables. They live in
the Explore tab. This tool returns a metadata payload so the frontend can
render the default 17-widget template; the data is fetched client-side via
POST /dashboard/data.
"""

import logging
import uuid

from google.adk.tools.tool_context import ToolContext

from api.agent.tools._idempotency import action_key, check_or_register
from api.deps import get_fs

logger = logging.getLogger(__name__)


def generate_dashboard(
    collection_ids: list[str],
    title: str = "",
    tool_context: ToolContext = None,
) -> dict:
    """Populate the Explore tab with the default 17-widget template.

    Dashboards are NOT user-facing deliverables. Do NOT announce a dashboard
    to the user, list it in todos, or echo its contents in chat. Use this
    tool silently when a default Explore view fits the agent's data. For
    tailored layouts, use ``compose_dashboard``.

    Args:
        collection_ids: List of collection IDs to include.
        title: Optional custom title. Auto-generated if empty.

    Returns:
        Dashboard metadata payload, or a `status: "duplicate"` payload
        pointing at the existing dashboard_id if this exact request was
        already served earlier in the session.
    """
    if not collection_ids:
        return {"status": "error", "message": "At least one collection_id is required."}

    key = action_key("generate_dashboard", {
        "collection_ids": sorted(collection_ids),
        "title": title or "",
    })
    existing = check_or_register(tool_context, key, dry_run=True)
    if existing:
        return {
            "status": "duplicate",
            "dashboard_id": existing["artifact_id"],
            "message": (
                "A dashboard for this exact request was already created earlier "
                "in this session — reusing it. Don't generate another."
            ),
        }

    fs = get_fs()
    collection_names: dict[str, str] = {}
    for cid in collection_ids:
        status = fs.get_collection_status(cid)
        if not status:
            return {"status": "error", "message": f"Collection {cid} not found."}
        keywords = status.get("config", {}).get("keywords", [])
        collection_names[cid] = ", ".join(keywords[:3]) if isinstance(keywords, list) and keywords else cid

    if not title:
        if len(collection_ids) == 1:
            title = f"Dashboard: {list(collection_names.values())[0]}"
        else:
            title = f"Dashboard: {len(collection_ids)} collections"

    dashboard_id = f"dashboard-{uuid.uuid4().hex[:8]}"
    check_or_register(tool_context, key, artifact_id=dashboard_id)

    return {
        "status": "success",
        "dashboard_id": dashboard_id,
        "title": title,
        "collection_ids": collection_ids,
        "collection_names": collection_names,
        "message": "Explore tab populated with the default layout.",
    }
