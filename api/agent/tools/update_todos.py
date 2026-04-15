import json
import logging

from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)

VALID_STATUSES = {"pending", "in_progress", "completed"}


def update_todos(
    todos: str,
    tool_context: ToolContext = None,
) -> dict:
    """Create or update your todo list for tracking multi-step work.

    Use this tool to plan and track progress on complex tasks. Call it
    BEFORE starting multi-step work to create your plan, then call it
    again as you complete each step.

    This replaces the entire todo list each time — send the full list
    with updated statuses.

    Args:
        todos: JSON array of todo items. Each item must have:
            - id: A short string identifier (e.g. "1", "2", "3")
            - content: What needs to be done
            - status: One of "pending", "in_progress", or "completed"

            Example:
            [
                {"id": "1", "content": "Query sentiment by platform", "status": "completed"},
                {"id": "2", "content": "Compare themes across platforms", "status": "in_progress"},
                {"id": "3", "content": "Create visualization", "status": "pending"}
            ]

    Returns:
        A progress summary with the current step to work on next.
    """
    # Parse
    try:
        items = json.loads(todos) if isinstance(todos, str) else todos
    except (json.JSONDecodeError, TypeError):
        return {"status": "error", "message": "Invalid JSON in todos parameter"}

    if not isinstance(items, list):
        return {"status": "error", "message": "todos must be a JSON array"}

    # Validate
    validated = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id", ""))
        content = str(item.get("content", ""))
        status = item.get("status", "pending")
        if not item_id or not content:
            continue
        if status not in VALID_STATUSES:
            status = "pending"
        validated.append({"id": item_id, "content": content, "status": status})

    if not validated:
        return {"status": "error", "message": "No valid todo items provided"}

    # Merge with existing automated/completed steps that the agent may not know about.
    # Automated steps (collect, enrich) are managed by the system — preserve them
    # even if the agent omits them from its update.
    if tool_context:
        existing = tool_context.state.get("todos") or []
        agent_ids = {t["id"] for t in validated}
        preserved = [
            t for t in existing
            if t.get("id") not in agent_ids
            and (t.get("automated") or t.get("status") == "completed")
        ]
        validated = preserved + validated
        tool_context.state["todos"] = validated

    # Compute progress
    completed = sum(1 for t in validated if t["status"] == "completed")
    total = len(validated)
    current = next(
        (t for t in validated if t["status"] in ("pending", "in_progress")),
        None,
    )

    result = {
        "status": "success",
        "progress": f"{completed}/{total} completed",
        "todos": validated,
    }

    if current:
        result["current"] = current["content"]
        result["message"] = f"Todo list updated ({completed}/{total} done). Now work on: {current['content']}"
    elif completed == total:
        result["message"] = f"All {total} todos completed. Summarize your results for the user."
    else:
        result["message"] = f"Todo list updated ({completed}/{total} done)."

    return result
