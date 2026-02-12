import logging

from config.settings import get_settings
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)


def cancel_collection(collection_id: str) -> dict:
    """Cancel a running data collection or enrichment.

    Call this tool when the user wants to stop a collection that is currently
    in progress. The worker will stop at the next batch boundary.
    Posts already collected will remain available.

    Args:
        collection_id: The collection ID to cancel.

    Returns:
        A dictionary confirming the cancellation request.
    """
    settings = get_settings()
    fs = FirestoreClient(settings)

    status = fs.get_collection_status(collection_id)
    if not status:
        return {
            "status": "error",
            "message": f"Collection {collection_id} not found.",
        }

    current_status = status.get("status")
    if current_status in ("completed", "failed", "cancelled"):
        return {
            "status": "error",
            "message": f"Collection {collection_id} is already {current_status}. Cannot cancel.",
        }

    fs.update_collection_status(collection_id, status="cancelled")
    posts_so_far = status.get("posts_collected", 0)

    return {
        "status": "success",
        "message": (
            f"Collection {collection_id} has been cancelled. "
            f"{posts_so_far} posts were collected before cancellation. "
            "These posts are still available for analysis."
        ),
    }
