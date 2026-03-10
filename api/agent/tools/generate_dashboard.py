"""
Generate Dashboard Tool — creates an interactive dashboard artifact.

Unlike generate_report (which fetches data and builds static cards),
this tool is lightweight. It validates the collections exist and returns
a metadata payload. The frontend fetches the actual data via the
POST /dashboard/data REST endpoint and does all filtering client-side.
"""

import logging
import uuid

from api.deps import get_fs

logger = logging.getLogger(__name__)


def generate_dashboard(
    collection_ids: list[str],
    title: str = "",
) -> dict:
    """Create an interactive dashboard for one or more collections.

    WHEN TO USE: When the user wants to "explore", "filter", or interact
    with data. Also called automatically on collection completion.
    WHEN NOT TO USE: When the user wants a narrative report with findings
    and insights — use generate_report instead.

    Provides the same charts as generate_report but with interactive filters:
    sentiment, entities, language, collection, content_type, platform, date
    range, themes, and channels.

    Args:
        collection_ids: List of collection IDs to include.
        title: Optional custom title. Auto-generated if empty.

    Returns:
        Dashboard metadata payload that the frontend renders as an artifact.
    """
    if not collection_ids:
        return {"status": "error", "message": "At least one collection_id is required."}

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

    return {
        "status": "success",
        "dashboard_id": dashboard_id,
        "title": title,
        "collection_ids": collection_ids,
        "collection_names": collection_names,
        "message": "Interactive dashboard created. Open it in the Studio panel to explore with filters.",
    }
