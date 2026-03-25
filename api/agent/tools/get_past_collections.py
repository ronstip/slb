import logging

from api.deps import get_fs

logger = logging.getLogger(__name__)


def fetch_user_collections(user_id: str, org_id: str = "", limit: int = 10) -> list[dict]:
    """Fetch recent collections for a user from Firestore.

    Internal helper reused by get_collection_details tool and user context loading.
    Returns a list of collection dicts sorted by created_at descending.
    """
    fs = get_fs()
    db = fs._db

    own_docs = list(
        db.collection("collection_status")
        .where("user_id", "==", user_id)
        .order_by("created_at", direction="DESCENDING")
        .limit(limit)
        .stream()
    )

    seen_ids = {doc.id for doc in own_docs}
    all_docs = list(own_docs)

    if org_id:
        try:
            org_docs = list(
                db.collection("collection_status")
                .where("org_id", "==", org_id)
                .order_by("created_at", direction="DESCENDING")
                .limit(limit)
                .stream()
            )
            for doc in org_docs:
                if doc.id not in seen_ids:
                    data = doc.to_dict()
                    if data.get("visibility") == "org":
                        all_docs.append(doc)
                        seen_ids.add(doc.id)
        except Exception as e:
            logger.error("Org collections query failed: %s", e)

    collections = []
    for doc in all_docs:
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
            "is_own": data.get("user_id") == user_id,
        })

    collections.sort(key=lambda c: c.get("created_at") or "", reverse=True)
    return collections[:limit]


def get_collection_details(collection_id: str) -> dict:
    """Get full details for a specific collection by ID.

    Use this when you need the complete configuration or run log for a
    collection you already know about from the Collections Library in your
    context. Typical reasons to call this:
    - Reusing a past config ("do the same thing for Red Bull")
    - Inspecting custom enrichment fields or exact keyword lists
    - Checking detailed run log / platform-level stats

    Use this when you need to look up a specific collection's details, or
    when the user asks about past collections.

    Args:
        collection_id: The ID of the collection to look up.

    Returns:
        A dictionary with full collection details including config,
        status, counts, run_log, and scheduling info.
    """
    try:
        fs = get_fs()
        status_doc = fs.get_collection_status(collection_id)
        if not status_doc:
            return {
                "status": "error",
                "message": f"Collection {collection_id} not found.",
            }

        config = status_doc.get("config") or {}
        created_at = status_doc.get("created_at")
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()

        return {
            "status": "success",
            "collection_id": collection_id,
            "collection_status": status_doc.get("status", "unknown"),
            "original_question": status_doc.get("original_question") or config.get("original_question", ""),
            "config": config,
            "posts_collected": status_doc.get("posts_collected", 0),
            "posts_enriched": status_doc.get("posts_enriched", 0),
            "posts_embedded": status_doc.get("posts_embedded", 0),
            "error_message": status_doc.get("error_message"),
            "created_at": created_at,
            "ongoing": status_doc.get("ongoing", False),
            "visibility": status_doc.get("visibility", "private"),
            "run_log": status_doc.get("run_log"),
        }

    except Exception as e:
        logger.exception("Failed to fetch collection details")
        return {
            "status": "error",
            "message": f"Failed to retrieve collection details: {e}",
        }
