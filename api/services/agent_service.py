"""Agent CRUD service — creates, reads, updates agents in Firestore + BigQuery."""

import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from google.cloud.firestore_v1 import transforms

from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)


def create_agent(
    user_id: str,
    title: str,
    agent_type: str = "one_shot",
    data_scope: dict | None = None,
    schedule: dict | None = None,
    org_id: str | None = None,
    todos: list | None = None,
    status: str = "approved",
) -> dict:
    """Create a new agent in Firestore and BigQuery. Returns the agent dict."""
    fs = get_fs()
    bq = get_bq()

    agent_id = str(uuid4())

    agent_data = {
        "agent_id": agent_id,
        "user_id": user_id,
        "org_id": org_id,
        "title": title,
        "agent_type": agent_type,
        "status": status,
        "data_scope": data_scope or {},
        "schedule": schedule,
        "todos": todos or [],
        "collection_ids": [],
        "artifact_ids": [],
    }

    # Firestore (real-time state)
    fs.create_agent(agent_id, agent_data)

    # BigQuery (analytics)
    bq.insert_rows(
        "agents",
        [
            {
                "agent_id": agent_id,
                "user_id": user_id,
                "org_id": org_id,
                "title": title,
                "data_scope": json.dumps(data_scope) if data_scope else None,
                "status": status,
                "agent_type": agent_type,
            }
        ],
    )

    logger.info("Created agent %s for user %s", agent_id, user_id)
    return agent_data


def get_agent(agent_id: str) -> dict | None:
    """Get an agent by ID from Firestore."""
    return get_fs().get_agent(agent_id)


def list_agents(user_id: str, org_id: str | None = None) -> list[dict]:
    """List agents visible to the user."""
    return get_fs().list_user_agents(user_id, org_id)


def update_agent(agent_id: str, **fields) -> None:
    """Update agent fields in Firestore."""
    get_fs().update_agent(agent_id, **fields)


def dispatch_agent_run(
    agent_id: str,
    agent: dict,
    trigger: str = "manual",
) -> tuple[str, list[str]]:
    """Create a run, dispatch collections from the agent's data_scope.

    Returns (run_id, collection_ids).
    """
    from api.schemas.requests import CreateCollectionRequest
    from api.services.collection_service import create_collection_from_request
    from workers.pipeline_v2.schedule_utils import compute_next_run_at

    fs = get_fs()

    data_scope = agent.get("data_scope") or {}
    searches = data_scope.get("searches", [])
    schedule = agent.get("schedule") or {}
    user_id = agent.get("user_id", "")
    org_id = agent.get("org_id")
    title = agent.get("title", "")
    agent_type = agent.get("agent_type", "one_shot")

    if not searches:
        logger.warning("Agent %s has no searches defined", agent_id)
        return "", []

    # Create a run record
    run_id = fs.create_run(agent_id, trigger=trigger)

    # Update agent status to executing
    fs.update_agent(agent_id, status="executing", active_run_id=run_id)

    collection_ids = []
    for search_def in searches:
        platforms = search_def.get("platforms", [])
        keywords = search_def.get("keywords", [])
        channels = search_def.get("channels")
        if not platforms or (not keywords and not channels):
            continue

        req = CreateCollectionRequest(
            description=title if agent_type == "one_shot" else f"{title} (scheduled run)",
            platforms=platforms,
            keywords=keywords,
            channel_urls=channels,
            time_range_days=search_def.get("time_range_days", 90),
            geo_scope=search_def.get("geo_scope", "global"),
            n_posts=search_def.get("n_posts", 0),
            include_comments=True,
        )

        extra_config = {}
        custom_fields = data_scope.get("custom_fields")
        if custom_fields:
            extra_config["custom_fields"] = custom_fields
        enrichment_context = data_scope.get("enrichment_context")
        if enrichment_context:
            extra_config["enrichment_context"] = enrichment_context
        city = search_def.get("city")
        if city:
            extra_config["city"] = city

        result = create_collection_from_request(
            request=req,
            user_id=user_id,
            org_id=org_id,
            extra_config=extra_config,
        )
        cid = result["collection_id"]
        collection_ids.append(cid)

        # Link collection to agent (both directions) and to run
        fs.add_agent_collection(agent_id, cid)
        fs.add_run_collection(agent_id, run_id, cid)
        fs.update_collection_status(cid, agent_id=agent_id)

    # Update agent-level denormalized collection_ids + next_run_at for recurring
    now = datetime.now(timezone.utc)
    update_fields: dict = {
        "collection_ids": transforms.ArrayUnion(collection_ids),
    }
    if agent_type == "recurring" and schedule.get("frequency"):
        update_fields["next_run_at"] = compute_next_run_at(schedule["frequency"], now)

    fs.update_agent(agent_id, **update_fields)

    logger.info("Dispatched agent %s run %s: created %d collections", agent_id, run_id, len(collection_ids))
    log_agent_activity(agent_id, f"Run dispatched — creating {len(collection_ids)} collection(s)", source="agent_service")
    return run_id, collection_ids


def log_agent_activity(
    agent_id: str,
    message: str,
    source: str = "system",
    level: str = "info",
    metadata: dict | None = None,
) -> None:
    """Write a log entry to the agent's activity log subcollection."""
    try:
        get_fs().add_agent_log(agent_id, message, source=source, level=level, metadata=metadata)
    except Exception:
        logger.warning("Failed to write agent log for %s: %s", agent_id, message, exc_info=True)
