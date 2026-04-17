import logging

from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)


def set_active_agent(
    agent_id: str,
    tool_context: ToolContext = None,
) -> dict:
    """Set the active agent context for the current session.

    This loads the agent's collections into the working set and makes the
    agent's artifacts available in context. Use this when the user wants
    to work on a specific agent or when resuming work on a previously
    created agent.

    Args:
        agent_id: The agent ID to activate.

    Returns:
        A dictionary with the agent details and its collections.
    """
    from api.deps import get_fs

    fs = get_fs()
    agent = fs.get_agent(agent_id)
    if not agent:
        return {"status": "error", "message": f"Agent {agent_id} not found"}

    # Access check
    state = tool_context.state if tool_context else {}
    user_id = state.get("user_id", "")
    org_id = state.get("org_id")
    if agent.get("user_id") != user_id and agent.get("org_id") != org_id:
        return {"status": "error", "message": "Access denied to this agent"}

    # Set agent context in session state
    data_scope = agent.get("data_scope", {})
    if tool_context:
        tool_context.state["active_agent_id"] = agent_id
        tool_context.state["active_agent_title"] = agent.get("title", "")
        tool_context.state["active_agent_status"] = agent.get("status", "")
        tool_context.state["active_agent_type"] = agent.get("agent_type", "one_shot")
        tool_context.state["active_agent_data_scope"] = data_scope
        tool_context.state["active_agent_constitution"] = agent.get("constitution")
        tool_context.state["active_agent_context"] = agent.get("context")

        # Set working collections from the agent
        collection_ids = agent.get("collection_ids", [])
        tool_context.state["agent_selected_sources"] = collection_ids
        if collection_ids:
            tool_context.state["active_collection_id"] = collection_ids[0]

    # Link this session to the agent if not already
    session_id = state.get("session_id", "")
    if session_id and session_id not in (agent.get("session_ids") or []):
        fs.add_agent_session(agent_id, session_id)

    # Build data_scope summary for agent awareness
    data_scope_summary = {
        "enrichment_context": data_scope.get("enrichment_context", ""),
        "custom_fields": data_scope.get("custom_fields", []),
        "searches": [
            {
                "keywords": s.get("keywords", []),
                "platforms": s.get("platforms", []),
                "time_range_days": s.get("time_range_days"),
                "start_date": s.get("start_date"),
                "end_date": s.get("end_date"),
            }
            for s in data_scope.get("searches", [])
            if isinstance(s, dict)
        ],
    }

    return {
        "status": "success",
        "agent_id": agent_id,
        "title": agent.get("title", ""),
        "agent_status": agent.get("status", ""),
        "agent_type": agent.get("agent_type", "one_shot"),
        "collection_ids": agent.get("collection_ids", []),
        "artifact_ids": agent.get("artifact_ids", []),
        "todos": agent.get("todos", []),
        "data_scope": data_scope_summary,
        "message": f"Now working on agent: **{agent.get('title', 'Untitled')}**",
    }
