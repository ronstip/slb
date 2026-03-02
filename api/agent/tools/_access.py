"""Shared access validation for collection-scoped agent tools.

All tools that accept collection_id or collection_ids should validate
ownership before operating on the data. This module provides a single
validation function used by both the before_tool_callback and individual
tools that need inline checks.
"""

import logging
from typing import Optional

from api.deps import get_fs

logger = logging.getLogger(__name__)


def validate_collection_access(
    collection_ids: list[str],
    user_id: str,
    org_id: Optional[str],
) -> list[str]:
    """Validate that the user can access all given collection IDs.

    Access rules:
    - Owner (user_id matches) → always allowed
    - Org member (org_id matches + visibility='org') → allowed

    Args:
        collection_ids: Collection IDs to validate.
        user_id: The authenticated user's ID.
        org_id: The user's organization ID (may be None).

    Returns:
        The list of accessible collection IDs.

    Raises:
        ValueError: If any collection IDs are not accessible. The error
            message lists the denied IDs.
    """
    if not collection_ids:
        return []

    fs = get_fs()
    db = fs._db

    denied: list[str] = []

    # Batch-read collection_status docs
    doc_refs = [db.collection("collection_status").document(cid) for cid in collection_ids]
    docs = db.get_all(doc_refs)

    for doc in docs:
        if not doc.exists:
            denied.append(doc.id)
            continue

        data = doc.to_dict()

        # Owner check
        if data.get("user_id") == user_id:
            continue

        # Org-shared check
        if (
            org_id
            and data.get("org_id") == org_id
            and data.get("visibility") == "org"
        ):
            continue

        denied.append(doc.id)

    if denied:
        raise ValueError(
            f"Access denied for collection(s): {', '.join(denied)}. "
            "You can only access your own collections or collections shared with your organization."
        )

    return list(collection_ids)
