import logging

from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)


def set_active_task(
    task_id: str,
    tool_context: ToolContext = None,
) -> dict:
    """Set the active task context for the current session.

    This loads the task's collections into the working set and makes the
    task's artifacts available in context. Use this when the user wants
    to work on a specific task or when resuming work on a previously
    created task.

    Args:
        task_id: The task ID to activate.

    Returns:
        A dictionary with the task details and its collections.
    """
    from api.deps import get_fs

    fs = get_fs()
    task = fs.get_task(task_id)
    if not task:
        return {"status": "error", "message": f"Task {task_id} not found"}

    # Access check
    state = tool_context.state if tool_context else {}
    user_id = state.get("user_id", "")
    org_id = state.get("org_id")
    if task.get("user_id") != user_id and task.get("org_id") != org_id:
        return {"status": "error", "message": "Access denied to this task"}

    # Set task context in session state
    if tool_context:
        tool_context.state["active_task_id"] = task_id
        tool_context.state["active_task_title"] = task.get("title", "")
        tool_context.state["active_task_status"] = task.get("status", "")
        tool_context.state["active_task_type"] = task.get("task_type", "one_shot")

        # Set working collections from the task
        collection_ids = task.get("collection_ids", [])
        tool_context.state["agent_selected_sources"] = collection_ids
        if collection_ids:
            tool_context.state["active_collection_id"] = collection_ids[0]

    # Link this session to the task if not already
    session_id = state.get("session_id", "")
    if session_id and session_id not in (task.get("session_ids") or []):
        fs.add_task_session(task_id, session_id)

    return {
        "status": "success",
        "task_id": task_id,
        "title": task.get("title", ""),
        "task_status": task.get("status", ""),
        "task_type": task.get("task_type", "one_shot"),
        "collection_ids": task.get("collection_ids", []),
        "artifact_ids": task.get("artifact_ids", []),
        "todos": task.get("todos", []),
        "message": f"Now working on task: **{task.get('title', 'Untitled')}**",
    }
