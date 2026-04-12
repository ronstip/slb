"""Start an agent — create it and dispatch data collection.

This is the lightweight replacement for create_task_protocol.
The agent calls this AFTER getting user approval via ask_user.
"""

import json
import logging

from google.adk.tools.tool_context import ToolContext
from pydantic import ValidationError

from workers.enrichment.schema import CustomFieldDef

logger = logging.getLogger(__name__)


def start_agent(
    title: str,
    searches: str,
    agent_type: str = "one_shot",
    schedule: str = "",
    custom_fields: str = "",
    enrichment_context: str = "",
    existing_collection_ids: str = "",
    tool_context: ToolContext = None,
) -> dict:
    """Start a new agent — create it and dispatch data collection.

    Call this AFTER the user approves your collection plan (via ask_user).
    This creates the agent, links it to the current session, and starts
    data collection immediately.

    Args:
        title: A concise title for the agent (e.g., "NBA TikTok Exposure").
        searches: JSON array of search definitions. Each search becomes a
            NEW data collection. Format:
            [{"platforms": ["tiktok"], "keywords": ["NBA highlights"],
              "time_range_days": 1, "n_posts": 500, "geo_scope": "global"}]
            Optional fields per search: channels, start_date, end_date.
            May be an empty array ("[]") if existing_collection_ids is set.
        agent_type: "one_shot" (default) or "recurring".
        schedule: JSON object for recurring agents. Format:
            {"frequency": "7d@09:00", "frequency_label": "Weekly at 9 AM UTC",
             "auto_report": true}
            Leave empty for one-shot agents.
        custom_fields: JSON array of custom enrichment fields. Each object has:
            "name" (snake_case), "type" (str/bool/int/float/list[str]/literal),
            "description". For type "literal", include "options" array.
            Example: [{"name": "purchase_intent", "type": "literal",
              "options": ["high", "medium", "low", "none"],
              "description": "Level of purchase intent"}]
            Leave empty if not needed.
        enrichment_context: A concise description of what makes posts relevant
            to this agent. Used during enrichment to judge post relevance.
            Leave empty if not needed — falls back to search keyword.
        existing_collection_ids: JSON array of collection IDs to attach to the
            new agent without re-collecting. Use this when the user wants to
            reuse one or more already-created collections as sources for the
            new agent. May be combined with `searches`.
            Leave empty if no existing collections should be attached.

    Returns:
        A dict with agent_id, run_id, collection_ids, and status.
    """
    # Parse searches
    try:
        searches_list = json.loads(searches) if searches else []
    except (json.JSONDecodeError, TypeError):
        return {"status": "error", "message": "Invalid JSON in searches parameter"}

    if not isinstance(searches_list, list):
        return {"status": "error", "message": "searches must be a JSON array"}

    # Parse existing_collection_ids
    try:
        existing_ids: list[str] = (
            json.loads(existing_collection_ids) if existing_collection_ids else []
        )
    except (json.JSONDecodeError, TypeError):
        return {"status": "error", "message": "Invalid JSON in existing_collection_ids parameter"}

    if not isinstance(existing_ids, list) or not all(isinstance(c, str) for c in existing_ids):
        return {
            "status": "error",
            "message": "existing_collection_ids must be a JSON array of strings",
        }

    if not searches_list and not existing_ids:
        return {
            "status": "error",
            "message": "Provide at least one new search or at least one existing_collection_ids entry",
        }

    # Validate at least one search has platforms + (keywords or channels)
    if searches_list:
        valid = any(
            s.get("platforms") and (s.get("keywords") or s.get("channels"))
            for s in searches_list
            if isinstance(s, dict)
        )
        if not valid:
            return {
                "status": "error",
                "message": "Each search must have at least platforms and keywords (or channels for URL-based platforms like Facebook Groups)",
            }

    # Parse schedule
    try:
        schedule_obj = json.loads(schedule) if schedule else None
    except (json.JSONDecodeError, TypeError):
        schedule_obj = None

    # Parse and validate custom fields
    custom_fields_list = None
    if custom_fields:
        try:
            raw = json.loads(custom_fields) if isinstance(custom_fields, str) else custom_fields
            custom_fields_list = [CustomFieldDef(**f).model_dump(exclude_none=True) for f in raw]
        except (json.JSONDecodeError, ValidationError, TypeError) as e:
            logger.warning("Invalid custom_fields in start_agent: %s", e)
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

    # Create agent
    from api.deps import get_fs
    from api.services.agent_service import create_agent, dispatch_agent_run

    agent = create_agent(
        user_id=user_id,
        title=title,
        agent_type=agent_type,
        data_scope=data_scope,
        schedule=schedule_obj,
        org_id=org_id,
        todos=todos_snapshot,
        status="approved",
    )
    agent_id = agent["agent_id"]
    fs = get_fs()

    # Link session to agent
    if session_id:
        fs.add_agent_session(agent_id, session_id)

    # Attach existing collections (ownership-checked)
    attached_existing: list[str] = []
    for cid in existing_ids:
        status_doc = fs.get_collection_status(cid)
        if not status_doc:
            logger.warning("start_agent: existing collection %s not found — skipping", cid)
            continue
        owner_id = status_doc.get("user_id")
        owner_org = status_doc.get("org_id")
        if owner_id != user_id and not (org_id and owner_org == org_id):
            logger.warning(
                "start_agent: user %s not permitted to attach collection %s", user_id, cid
            )
            continue
        fs.add_agent_collection(agent_id, cid)
        fs.update_collection_status(cid, agent_id=agent_id)
        attached_existing.append(cid)

    # Dispatch new collections from searches (if any)
    run_id = ""
    dispatched_ids: list[str] = []
    if searches_list:
        fresh_agent = fs.get_agent(agent_id) or agent
        run_id, dispatched_ids = dispatch_agent_run(agent_id, fresh_agent, trigger="manual")
    elif attached_existing:
        if agent_type == "one_shot":
            fs.update_agent(agent_id, status="completed")

    all_ids = list(dict.fromkeys(attached_existing + dispatched_ids))
    n_new = len(dispatched_ids)
    n_existing = len(attached_existing)

    parts = []
    if n_new:
        parts.append(f"{n_new} new collection(s) dispatched")
    if n_existing:
        parts.append(f"{n_existing} existing collection(s) attached")
    summary = ", ".join(parts) or "no collections"

    return {
        "status": "success",
        "agent_id": agent_id,
        "run_id": run_id,
        "collection_ids": all_ids,
        "message": (
            f"Agent **{title}** started — {summary}. "
            "The UI shows live progress. Continue with your next steps when data is ready."
        ),
    }
