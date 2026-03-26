"""Show Metrics Tool — renders inline metric cards in chat via tool result."""

import logging

from api.deps import get_fs

logger = logging.getLogger(__name__)


def show_metrics(
    collection_id: str | None = None,
    items: list[dict] | None = None,
) -> dict:
    """Display key metrics inline in the chat as stat cards.

    WHEN TO USE: When presenting collection overviews, analysis summaries,
    or when the user asks about key stats. Use after data is ready.

    Args:
        collection_id: Fetch stats for this collection (uses cached signature).
        items: Custom metric items as [{"label": "Total Posts", "value": 1234}, ...].
               Use this when you have agent-computed metrics not tied to a collection.

    Provide EITHER collection_id OR items, not both.
    """
    if items:
        return {
            "status": "success",
            "display": "metrics",
            "items": items,
        }

    if not collection_id:
        return {"status": "error", "message": "Provide either collection_id or items."}

    try:
        fs = get_fs()
        doc = fs.collection("collections").document(collection_id).get()
        if not doc.exists:
            return {"status": "error", "message": f"Collection {collection_id} not found."}

        data = doc.to_dict() or {}
        stats = data.get("stats") or {}

        metric_items = []
        if stats.get("total_posts"):
            metric_items.append({"label": "Total Posts", "value": stats["total_posts"]})
        if stats.get("total_views"):
            metric_items.append({"label": "Views", "value": stats["total_views"]})
        if stats.get("total_likes"):
            metric_items.append({"label": "Likes", "value": stats["total_likes"]})
        if stats.get("total_comments"):
            metric_items.append({"label": "Comments", "value": stats["total_comments"]})
        if stats.get("total_shares"):
            metric_items.append({"label": "Shares", "value": stats["total_shares"]})

        return {
            "status": "success",
            "display": "metrics",
            "collection_id": collection_id,
            "items": metric_items,
        }
    except Exception as e:
        logger.exception("show_metrics failed for %s", collection_id)
        return {"status": "error", "message": f"Failed to fetch metrics: {e}"}
