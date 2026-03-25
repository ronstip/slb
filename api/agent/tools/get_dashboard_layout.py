"""
Get Dashboard Layout Tool — reads the current widget configuration of a dashboard.

The agent should call this before update_dashboard when it needs to know
existing widget IDs, titles, or types (e.g. "change the sentiment chart to a bar").
"""

import logging

from api.deps import get_fs

logger = logging.getLogger(__name__)

_FIRESTORE_COLLECTION = "dashboard_layouts"


def get_dashboard_layout(artifact_id: str) -> dict:
    """Read the current widget layout of a dashboard artifact.

    WHEN TO USE: Before calling update_dashboard when you need to know the current
    widget IDs or types. For example, if the user says "change the sentiment chart"
    you need to look up its widget ID first.

    Args:
        artifact_id: The dashboard artifact ID (e.g. "dashboard-abc12345").
                     Use the active_dashboard_id from context if available.

    Returns:
        Current widget list with IDs, titles, aggregation types, and chart types,
        plus the active filter bar configuration.
    """
    if not artifact_id:
        return {"status": "error", "message": "artifact_id is required."}

    fs = get_fs()
    doc_ref = fs._db.collection(_FIRESTORE_COLLECTION).document(artifact_id)
    doc = doc_ref.get()

    if not doc.exists:
        return {
            "status": "success",
            "artifact_id": artifact_id,
            "message": "No saved layout found — dashboard is using default layout.",
            "widgets": [],
            "filter_bar_filters": None,
            "is_default": True,
        }

    data = doc.to_dict()
    widgets: list[dict] = data.get("layout") or []
    filter_bar_filters = data.get("filterBarFilters")

    widget_summary = [
        {
            "id": w.get("i"),
            "title": w.get("title"),
            "aggregation": w.get("aggregation"),
            "chartType": w.get("chartType"),
            "x": w.get("x"), "y": w.get("y"),
            "w": w.get("w"), "h": w.get("h"),
        }
        for w in widgets
    ]

    logger.info("get_dashboard_layout: artifact=%s widgets=%d", artifact_id, len(widgets))

    return {
        "status": "success",
        "artifact_id": artifact_id,
        "widget_count": len(widgets),
        "widgets": widget_summary,
        "filter_bar_filters": filter_bar_filters,
        "is_default": False,
    }
