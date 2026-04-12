import logging

from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)


def get_agent_status(
    agent_id: str,
    tool_context: ToolContext = None,
) -> dict:
    """Get the current status and details of an agent.

    Returns the agent's status, todos, collection progress, and artifact
    count. Use this to check on an agent's progress or to load context
    about an agent before continuing work on it.

    Args:
        agent_id: The agent ID to check.

    Returns:
        A dictionary with the agent status and details.
    """
    from api.deps import get_fs

    fs = get_fs()
    agent = fs.get_agent(agent_id)
    if not agent:
        return {"status": "error", "message": f"Agent {agent_id} not found"}

    # Get collection statuses
    collection_statuses = []
    for cid in agent.get("collection_ids", []):
        cstatus = fs.get_collection_status(cid)
        if cstatus:
            collection_statuses.append({
                "collection_id": cid,
                "status": cstatus.get("status", "unknown"),
                "posts_collected": cstatus.get("posts_collected", 0),
                "posts_enriched": cstatus.get("posts_enriched", 0),
            })

    # Check if all collections are complete
    all_complete = all(
        cs["status"] == "success"
        for cs in collection_statuses
    ) if collection_statuses else False

    return {
        "status": "success",
        "agent_id": agent.get("agent_id"),
        "title": agent.get("title", ""),
        "agent_status": agent.get("status", "unknown"),
        "agent_type": agent.get("agent_type", "one_shot"),
        "todos": agent.get("todos", []),
        "collections": collection_statuses,
        "all_collections_complete": all_complete,
        "artifact_count": len(agent.get("artifact_ids", [])),
        "created_at": agent.get("created_at"),
    }
