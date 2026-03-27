"""Start a task — create it and dispatch data collection.

This is the lightweight replacement for create_task_protocol.
The agent calls this AFTER getting user approval via ask_user.
"""

import json
import logging

from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)


def start_task(
    title: str,
    searches: str,
    task_type: str = "one_shot",
    schedule: str = "",
    custom_fields: str = "",
    enrichment_context: str = "",
    tool_context: ToolContext = None,
) -> dict:
    """Start a new task — create it and dispatch data collection.

    Call this AFTER the user approves your collection plan (via ask_user).
    This creates the task, links it to the current session, and starts
    data collection immediately.

    Args:
        title: A concise title for the task (e.g., "NBA TikTok Exposure").
        searches: JSON array of search definitions. Each search becomes a
            data collection. Format:
            [{"platforms": ["tiktok"], "keywords": ["NBA highlights"],
              "time_range_days": 1, "n_posts": 500, "geo_scope": "global"}]
            Optional fields per search: channels, start_date, end_date.
        task_type: "one_shot" (default) or "recurring".
        schedule: JSON object for recurring tasks. Format:
            {"frequency": "7d@09:00", "frequency_label": "Weekly at 9 AM UTC",
             "auto_report": true}
            Leave empty for one-shot tasks.
        custom_fields: JSON array of custom enrichment fields. Format:
            [{"name": "purchase_intent", "type": "str",
              "description": "Whether post indicates intent to buy"}]
            Leave empty if not needed.
        enrichment_context: A concise description of what makes posts relevant
            to this task. Used during enrichment to judge post relevance.
            Example: "Posts about Nike brand perception in the running shoe
            market. Relevant: product reviews, athlete endorsements.
            Irrelevant: general sports news, unrelated apparel."
            Leave empty if not needed — falls back to search keyword.

    Returns:
        A dict with task_id, collection_ids, and status.
    """
    # Parse searches
    try:
        searches_list = json.loads(searches) if isinstance(searches, str) else searches
    except (json.JSONDecodeError, TypeError):
        return {"status": "error", "message": "Invalid JSON in searches parameter"}

    if not searches_list or not isinstance(searches_list, list):
        return {"status": "error", "message": "searches must be a non-empty JSON array"}

    # Validate at least one search has platforms + keywords
    valid = any(
        s.get("platforms") and s.get("keywords")
        for s in searches_list
        if isinstance(s, dict)
    )
    if not valid:
        return {
            "status": "error",
            "message": "Each search must have at least platforms and keywords",
        }

    # Parse schedule
    try:
        schedule_obj = json.loads(schedule) if schedule else None
    except (json.JSONDecodeError, TypeError):
        schedule_obj = None

    # Parse custom fields
    try:
        custom_fields_list = json.loads(custom_fields) if custom_fields else None
    except (json.JSONDecodeError, TypeError):
        custom_fields_list = None

    # Build data scope
    data_scope = {"searches": searches_list}
    if custom_fields_list:
        data_scope["custom_fields"] = custom_fields_list
    if enrichment_context:
        data_scope["enrichment_context"] = enrichment_context

    # Get identity from session state
    state = tool_context.state if tool_context else {}
    user_id = state.get("user_id", "")
    org_id = state.get("org_id")
    session_id = state.get("session_id", "")

    if not user_id:
        return {"status": "error", "message": "No authenticated user in session"}

    # Snapshot current todos
    todos_snapshot = state.get("todos", [])

    # Create task
    from api.services.task_service import create_task, dispatch_task_run

    task = create_task(
        user_id=user_id,
        title=title,
        task_type=task_type,
        data_scope=data_scope,
        schedule=schedule_obj,
        org_id=org_id,
        session_id=session_id,
        todos=todos_snapshot,
        status="approved",
    )
    task_id = task["task_id"]

    # Link session to task
    if session_id:
        from api.deps import get_fs
        get_fs().save_session(session_id, {"task_id": task_id})

    # Dispatch collections
    collection_ids = dispatch_task_run(task_id, task)

    n = len(collection_ids)
    return {
        "status": "success",
        "task_id": task_id,
        "collection_ids": collection_ids,
        "message": (
            f"Task **{title}** started — {n} collection(s) dispatched. "
            "The UI shows live progress. Continue with your next steps when data is ready."
        ),
    }
