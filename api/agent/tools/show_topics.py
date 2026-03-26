"""Show Topics Tool — renders topic clusters inline in chat via tool result."""

import logging

logger = logging.getLogger(__name__)


def show_topics(collection_id: str) -> dict:
    """Display topic clusters inline in the chat.

    WHEN TO USE: When the user asks about topics, or after topic clustering
    completes for a collection. Shows an interactive topic widget.

    Args:
        collection_id: The collection whose topics to display.
    """
    if not collection_id:
        return {"status": "error", "message": "collection_id is required."}

    return {
        "status": "success",
        "display": "topics",
        "collection_id": collection_id,
    }
