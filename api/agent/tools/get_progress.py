import logging

from config.settings import get_settings
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)


def get_progress(collection_id: str) -> dict:
    """Check the current progress of a data collection experiment.

    Call this tool when the user asks about the status of their collection,
    or to check if collection and enrichment are complete before generating insights.

    Args:
        collection_id: The collection ID returned by start_collection.

    Returns:
        A dictionary with status and progress counts.
    """
    settings = get_settings()
    fs = FirestoreClient(settings)

    status = fs.get_collection_status(collection_id)
    if not status:
        return {
            "status": "error",
            "message": f"Collection {collection_id} not found.",
        }

    return {
        "status": "success",
        "collection_status": status.get("status", "unknown"),
        "posts_collected": status.get("posts_collected", 0),
        "posts_enriched": status.get("posts_enriched", 0),
        "posts_embedded": status.get("posts_embedded", 0),
        "error_message": status.get("error_message"),
        "message": _format_message(status),
    }


def _format_message(status: dict) -> str:
    s = status.get("status", "unknown")
    posts = status.get("posts_collected", 0)

    if s == "pending":
        return "Collection is queued and will start shortly."
    elif s == "collecting":
        return f"Collection in progress: {posts} posts collected so far."
    elif s == "enriching":
        enriched = status.get("posts_enriched", 0)
        return f"Enrichment in progress: {enriched} of {posts} posts enriched so far."
    elif s == "completed":
        enriched = status.get("posts_enriched", 0)
        embedded = status.get("posts_embedded", 0)
        msg = f"Collection complete! {posts} posts collected."
        if enriched > 0:
            msg += f" Enriched: {enriched}, Embedded: {embedded}."
            msg += " Ready for insights — use get_insights."
        else:
            msg += " Enrichment has not run yet. Use enrich_collection to run AI enrichment before generating insights."
        return msg
    elif s == "cancelled":
        return f"Collection was cancelled. {posts} posts were collected before cancellation."
    elif s == "failed":
        err = status.get("error_message", "Unknown error")
        return f"Collection failed: {err}"
    else:
        return f"Unknown status: {s}"
