import logging

from api.deps import get_fs

logger = logging.getLogger(__name__)


def get_past_collections(limit: int = 10) -> dict:
    """Retrieve recent past collections and their configurations.

    Use this to check if a similar collection already exists before designing
    a new one, or to reference a prior research design when the user says
    something like "do the same thing for Red Bull" or "reuse the last setup."

    Args:
        limit: Maximum number of recent collections to return. Default 10.

    Returns:
        A dictionary with recent collections including their configs,
        original questions, and status.
    """
    fs = get_fs()
    db = fs._db

    try:
        docs = (
            db.collection("collection_status")
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
            .stream()
        )

        collections = []
        for doc in docs:
            data = doc.to_dict()
            created_at = data.get("created_at")
            if hasattr(created_at, "isoformat"):
                created_at = created_at.isoformat()

            collections.append({
                "collection_id": doc.id,
                "status": data.get("status", "unknown"),
                "original_question": data.get("original_question"),
                "config": data.get("config"),
                "posts_collected": data.get("posts_collected", 0),
                "posts_enriched": data.get("posts_enriched", 0),
                "created_at": created_at,
            })

        if not collections:
            return {
                "status": "success",
                "collections": [],
                "message": "No past collections found.",
            }

        return {
            "status": "success",
            "collections": collections,
            "message": f"Found {len(collections)} recent collection(s).",
        }

    except Exception as e:
        logger.exception("Failed to fetch past collections")
        return {
            "status": "error",
            "message": f"Failed to retrieve past collections: {e}",
        }
