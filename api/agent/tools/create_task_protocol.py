import json
import logging

logger = logging.getLogger(__name__)


def create_task_protocol(
    title: str,
    protocol: str,
    task_type: str = "one_shot",
    searches: str = "[]",
    schedule: str = "",
    custom_fields: str = "",
) -> dict:
    """Create a Task Protocol for user review and approval.

    Call this tool after you have gathered sufficient context about the user's
    task — through conversation, web searches, and clarifying questions. The
    protocol is a markdown document you write that defines what you'll do, why,
    and the concrete steps.

    The protocol appears as a compact card in chat. The user can view the full
    document in the Studio panel, then approve, edit, or reject it.

    After calling this tool, STOP. Wait for the user's decision.

    Args:
        title: A concise title for the task (e.g., "iPhone Launch Comparison").
        protocol: The full protocol as a markdown string. Write it naturally —
            typically covering What, Why, Approach (operational goals), Steps
            (concrete todos), and Data scope. See the protocol writing guide
            in your instructions.
        task_type: Either "one_shot" (default) or "recurring" (for monitoring
            tasks that re-run on a schedule).
        searches: JSON array of search definitions. Each search becomes a data
            collection. Format:
            [{"platforms": ["instagram", "tiktok"], "keywords": ["Nike"],
              "time_range_days": 90, "geo_scope": "global", "n_posts": 0}]
            For comparative tasks, include multiple searches (e.g., one per
            time window or competitor).
            Optional fields: channels, start_date, end_date.
        schedule: JSON object for recurring tasks. Format:
            {"frequency": "7d@09:00", "frequency_label": "Weekly on Mondays at 9:00 AM UTC",
             "auto_report": true}
            Leave empty for one-shot tasks.
        custom_fields: JSON array of custom enrichment fields. Format:
            [{"name": "purchase_intent", "type": "str", "description": "Whether post indicates intent to buy"}]
            Leave empty if no custom fields are needed.

    Returns:
        A dictionary with the protocol details for the frontend to render.
    """
    # Parse searches
    try:
        searches_list = json.loads(searches) if searches else []
    except (json.JSONDecodeError, TypeError):
        searches_list = []

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

    data_scope = {
        "searches": searches_list,
    }
    if custom_fields_list:
        data_scope["custom_fields"] = custom_fields_list

    # Extract first paragraph from protocol as summary
    summary = ""
    for line in protocol.split("\n"):
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            summary = stripped
            break

    return {
        "status": "needs_approval",
        "card_type": "task_protocol",
        "title": title,
        "task_type": task_type,
        "protocol": protocol,
        "data_scope": data_scope,
        "schedule": schedule_obj,
        "summary": summary,
        "message": (
            f"Task protocol ready: **{title}** ({task_type}). "
            "Review the protocol and approve to start."
        ),
    }
