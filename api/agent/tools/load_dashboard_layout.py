"""Load Dashboard Layout Tool — read the current widget list for an existing dashboard.

Use before ``compose_dashboard`` when the user asks for an INCREMENTAL change
to a dashboard they already have open (e.g. "make the sentiment chart
bigger", "add a themes panel"). Load the layout, modify the widget list,
then re-publish via ``compose_dashboard`` — never start from scratch and
destroy user edits.
"""

import logging

from google.adk.tools import ToolContext

from api.deps import get_fs

logger = logging.getLogger(__name__)

LAYOUTS_COLLECTION = "dashboard_layouts"


def load_dashboard_layout(dashboard_id: str, tool_context: ToolContext = None) -> dict:
    """Return the persisted widget layout for a dashboard.

    Args:
        dashboard_id: The dashboard_id returned by ``compose_dashboard`` or
            ``generate_dashboard`` (e.g. ``"dashboard-a1b2c3d4"``).
        tool_context: ADK tool context (injected automatically).

    Returns:
        {status, dashboard_id, widgets, collection_ids, rationale, filterBarFilters, title}
        where ``widgets`` is the list you'd pass back to ``compose_dashboard``.
        If the dashboard doesn't exist yet (no custom layout saved) returns
        ``{status: 'not_found', ...}`` — in that case the user is seeing the
        default template and any change should be a fresh ``compose_dashboard`` call.
    """
    state = tool_context.state if tool_context else {}
    user_id = state.get("user_id", "")

    if not dashboard_id:
        return {"status": "error", "message": "dashboard_id is required."}

    fs = get_fs()
    doc = fs._db.collection(LAYOUTS_COLLECTION).document(dashboard_id).get()
    if not doc.exists:
        return {
            "status": "not_found",
            "dashboard_id": dashboard_id,
            "message": (
                "No saved layout for this dashboard — the user is seeing the default "
                "template. To customize, call compose_dashboard with the widgets you want."
            ),
        }

    data = doc.to_dict() or {}
    if user_id and data.get("user_id") and data["user_id"] != user_id:
        return {"status": "error", "message": "Access denied."}

    return {
        "status": "success",
        "dashboard_id": dashboard_id,
        "widgets": data.get("layout") or [],
        "collection_ids": data.get("collection_ids") or [],
        "rationale": data.get("rationale"),
        "filterBarFilters": data.get("filterBarFilters"),
        "title": data.get("title"),
    }
