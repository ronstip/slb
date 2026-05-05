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

    # Discipline rule (Phase 2): exactly ONE todo may be in_progress at a
    # time. Enforced here rather than in the prompt because gemini-3-flash
    # over-fits when the same rule appears as prompt text and stops calling
    # update_todos at all (Phase 1 retrospective).
    in_progress_ids = [t["id"] for t in validated if t["status"] == "in_progress"]
    if len(in_progress_ids) > 1:
        return {
            "status": "error",
            "message": (
                f"Exactly ONE todo may be 'in_progress' at a time — you marked "
                f"{len(in_progress_ids)}: {in_progress_ids}. Mark all but one "
                "as 'pending' or 'completed' and call update_todos again."
            ),
        }

    # Merge with existing automated steps managed by the system.
    # Automated steps (collect, enrich) are ALWAYS preserved — even if the
    # agent explicitly includes a conflicting ID, the system version wins.
    if tool_context:
        existing = tool_context.state.get("todos") or []
        automated = [t for t in existing if t.get("automated")]
        automated_ids = {t["id"] for t in automated}

        # Discipline rule (Phase 2): completed is sticky. Once a todo is
        # marked completed, it cannot transition back to pending or
        # in_progress — that pattern is the agent re-doing finished work.
        prior_completed = {
            t["id"] for t in existing
            if t.get("status") == "completed" and not t.get("automated")
        }
        regressed = [
            t["id"] for t in validated
            if t["id"] in prior_completed and t["status"] != "completed"
        ]
        if regressed:
            return {
                "status": "error",
                "message": (
                    f"Todos {regressed} were already completed and cannot be "
                    "re-opened. If the previous step actually wasn't done, "
                    "add a new todo with a fresh id describing what's left."
                ),
            }

        # Strip any agent items that collide with automated IDs
        validated = [t for t in validated if t["id"] not in automated_ids]
        validated = automated + validated
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
