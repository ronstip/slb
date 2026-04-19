"""Show Topics Tool — renders topic clusters inline in chat via tool result."""

import logging

logger = logging.getLogger(__name__)


def show_topics(agent_id: str) -> dict:
    """Display topic clusters inline in the chat.

    WHEN TO USE: When the user asks about topics, or after topic clustering
    completes for an agent. Shows an interactive topic widget.

    Args:
        agent_id: The agent whose topics to display.
    """
    if not agent_id:
        return {"status": "error", "message": "agent_id is required."}

    return {
        "status": "success",
        "display": "topics",
        "agent_id": agent_id,
    }
