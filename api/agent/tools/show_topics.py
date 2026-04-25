"""Show Topics Tool — renders topic clusters inline in chat via tool result."""

import logging

from api.deps import get_fs

logger = logging.getLogger(__name__)


def show_topics(agent_id: str) -> dict:
    """Render the topics widget inline in chat. Call AT MOST ONCE per turn.

    The widget fetches and renders topics on the client. This tool only signals
    the UI to display it — it does NOT need to be retried, polled, or re-called
    to "verify" the render. Once you receive `status: "success"`, the user has
    seen the widget. Move on to the next step.

    If `topic_count` is 0, the agent has no topics yet — tell the user that
    instead of calling this again.

    Args:
        agent_id: The agent whose topics to display.
    """
    if not agent_id:
        return {"status": "error", "message": "agent_id is required."}

    try:
        fs = get_fs()
        topics_ref = fs._db.collection("agents").document(agent_id).collection("topics")
        topic_count = sum(1 for _ in topics_ref.stream())
    except Exception:
        logger.exception("show_topics: failed to count topics for agent %s", agent_id)
        topic_count = None

    if topic_count == 0:
        return {
            "status": "success",
            "display": "topics",
            "agent_id": agent_id,
            "topic_count": 0,
            "rendered": True,
            "message": (
                "No topics exist for this agent yet. The widget rendered an "
                "empty state. Do NOT call show_topics again — explain to the "
                "user that topics aren't available."
            ),
        }

    return {
        "status": "success",
        "display": "topics",
        "agent_id": agent_id,
        "topic_count": topic_count,
        "rendered": True,
        "message": (
            f"Topics widget rendered with {topic_count} topics. The user can "
            "see it. Do NOT call show_topics again this turn."
        ),
    }
