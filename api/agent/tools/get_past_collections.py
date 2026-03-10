import logging

from api.deps import get_fs

logger = logging.getLogger(__name__)


def fetch_user_collections(user_id: str, org_id: str = "", limit: int = 10) -> list[dict]:
    """Fetch recent collections for a user from Firestore.

    Internal helper reused by get_past_collections tool and user context loading.
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


def get_past_collections(user_id: str, org_id: str = "", limit: int = 10) -> dict:
    """Retrieve recent past collections for the current user.

    Returns the user's own collections plus any org-shared collections
    (visibility='org') within the same organization.

    Use this to check if a similar collection already exists before designing
    a new one, or to reference a prior research design when the user says
    something like "do the same thing for Red Bull" or "reuse the last setup."

    Args:
        user_id: The authenticated user's ID (from session context).
        org_id: The user's organization ID. Empty string if none.
        limit: Maximum number of recent collections to return. Default 10.

    Returns:
        A dictionary with recent collections including their configs,
        original questions, and status.
    """
    try:
        collections = fetch_user_collections(user_id, org_id, limit)

        if not collections:
            return {
                "status": "success",
                "collections": [],
                "message": "No past collections found.",
            }

        return {
            "status": "success",
            "collections": collections,
            "message": f"Found {len(collections)} collection(s).",
        }

    except Exception as e:
        logger.exception("Failed to fetch past collections")
        return {
            "status": "error",
            "message": f"Failed to retrieve past collections: {e}",
        }
