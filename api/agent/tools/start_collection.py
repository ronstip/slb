import json
import logging
from datetime import datetime

from api.schemas.requests import CreateCollectionRequest
from api.services.collection_service import create_collection_from_request

logger = logging.getLogger(__name__)

# Enrichment-only config keys that design_research produces
_EXTRA_CONFIG_KEYS = ("video_params", "reasoning_level", "min_likes", "custom_fields", "n_posts")


def start_collection(
    config_json: str,
    original_question: str,
    user_id: str,
    session_id: str,
    org_id: str = "",
) -> dict:
    """Start a data collection experiment by creating the collection record and dispatching the worker.

    Call this tool ONLY after the user has approved the research design from
    design_research. Pass the config JSON exactly as returned by design_research.

    Args:
        config_json: The collection config as a JSON string. This is the "config"
            field from the design_research result.
        original_question: The user's original research question.
        user_id: The user's ID from the session context.
        session_id: The current session ID from the session context.
        org_id: The user's organization ID from the session context (may be empty).

    Returns:
        A dictionary with the collection_id and status.
    """
    # Parse config from design_research
    if isinstance(config_json, str):
        config = json.loads(config_json)
    else:
        config = config_json

    # Convert time_range {start, end} dates -> time_range_days int
    time_range = config.get("time_range", {})
    start_str = time_range.get("start")
    end_str = time_range.get("end")
    if start_str and end_str:
        start_dt = datetime.strptime(start_str, "%Y-%m-%d")
        end_dt = datetime.strptime(end_str, "%Y-%m-%d")
        time_range_days = max(1, (end_dt - start_dt).days)
    else:
        time_range_days = 90

    # Extract enrichment-only fields into extra_config
    extra_config = {k: config[k] for k in _EXTRA_CONFIG_KEYS if k in config}

    # Build request matching the REST endpoint schema
    request = CreateCollectionRequest(
        description=original_question,
        platforms=config.get("platforms", []),
        keywords=config.get("keywords", []),
        channel_urls=config.get("channel_urls") or None,
        time_range_days=time_range_days,
        geo_scope=config.get("geo_scope", "global"),
        n_posts=config.get("n_posts", 0),
        include_comments=config.get("include_comments", True),
        ongoing=config.get("ongoing", False),
        schedule=config.get("schedule"),
    )

    resolved_org_id = org_id if org_id else None

    # Delegate to the shared service function (same path as POST /collections)
    result = create_collection_from_request(
        request,
        user_id=user_id,
        org_id=resolved_org_id,
        session_id=session_id,
        extra_config=extra_config or None,
    )

    return {
        "status": "success",
        "collection_id": result["collection_id"],
        "config": result["config"],
        "message": (
            f"Collection {result['collection_id']} started. "
            "The UI is showing live progress to the user. "
            "You do NOT need to check progress — confirm to the user and move on."
        ),
    }
