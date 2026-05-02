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
    status: str | None = "running",
    context: dict | None = None,
    constitution: dict | None = None,
    outputs: list[dict] | None = None,
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
        "outputs": outputs or [],
        "schedule": schedule,
        "todos": todos or [],
        "version": 1,
        "collection_ids": [],
        "artifact_ids": [],
    }
    if constitution:
        agent_data["constitution"] = constitution
    if context:
        agent_data["context"] = context

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


VERSIONED_FIELDS = {"title", "data_scope", "todos", "context", "constitution", "outputs"}


def update_agent_with_version(agent_id: str, user_id: str, updates: dict) -> int:
    """Update agent and create a version snapshot if config fields changed.

    Returns the new version number.
    """
    fs = get_fs()
    agent = fs.get_agent(agent_id)
    if not agent:
        raise ValueError(f"Agent {agent_id} not found")

    needs_version = bool(VERSIONED_FIELDS & set(updates.keys()))
    current_version = agent.get("version") or 1
    new_version = current_version

    if needs_version:
        new_version = current_version + 1
        updates["version"] = new_version

        snapshot = {
            "title": updates.get("title", agent.get("title")),
            "data_scope": updates.get("data_scope", agent.get("data_scope")),
            "todos": updates.get("todos", agent.get("todos")),
            "context": updates.get("context", agent.get("context")),
            "constitution": updates.get("constitution", agent.get("constitution")),
            "outputs": updates.get("outputs", agent.get("outputs")),
        }
        fs.create_agent_version(agent_id, new_version, snapshot, edited_by=user_id)

    fs.update_agent(agent_id, **updates)
    logger.info("Updated agent %s (version %d → %d)", agent_id, current_version, new_version)
    return new_version


def resolve_source_config(search_def: dict, platform: str) -> dict | None:
    """Resolve effective collection config for one (search, platform).

    Returns a dict of resolved fields (keywords/channels/n_posts/geo_scope/
    time_range_days), or None if the source has no keywords AND no channels
    (nothing to collect).
    """
    platforms = search_def.get("platforms", []) or []
    if platform not in platforms:
        return None
    per_source = search_def.get("per_source") or {}
    default_keywords = search_def.get("keywords", []) or []
    default_channels = search_def.get("channels")
    default_time_range = search_def.get("time_range_days", 90)
    default_geo = search_def.get("geo_scope", "global")
    default_n_posts = search_def.get("n_posts", 0) or 0
    platform_count = max(len(platforms), 1)
    default_split = default_n_posts // platform_count if default_n_posts else 0

    src = per_source.get(platform) or {}
    if src.get("override"):
        keywords = src.get("keywords", default_keywords)
        channels = src.get("channels", default_channels)
        time_range_days = src.get("time_range_days", default_time_range)
        geo_scope = src.get("geo_scope", default_geo)
        n_posts = src.get("n_posts", default_split)
    else:
        keywords = default_keywords
        channels = default_channels
        time_range_days = default_time_range
        geo_scope = default_geo
        n_posts = default_split

    if not keywords and not channels:
        return None

    return {
        "keywords": keywords or [],
        "channels": channels,
        "time_range_days": time_range_days,
        "geo_scope": geo_scope,
        "n_posts": n_posts or 0,
    }


def _build_base_extra_config(agent: dict) -> dict:
    """Collect the agent-wide enrichment/context fields that ride along with
    every collection request (custom_fields, enrichment_context, content_types,
    structured_context derived from constitution/context).
    """
    data_scope = agent.get("data_scope") or {}
    base_extra: dict = {}
    custom_fields = data_scope.get("custom_fields")
    if custom_fields:
        base_extra["custom_fields"] = custom_fields
    enrichment_context = data_scope.get("enrichment_context")
    if enrichment_context:
        base_extra["enrichment_context"] = enrichment_context
    content_types = data_scope.get("content_types")
    if content_types:
        base_extra["content_types"] = content_types
    agent_constitution = agent.get("constitution")
    if agent_constitution:
        from api.schemas.agent_constitution import constitution_to_enrichment_string
        structured_ctx = constitution_to_enrichment_string(agent_constitution)
        if structured_ctx:
            base_extra["structured_context"] = structured_ctx
    else:
        agent_context = agent.get("context")
        if agent_context:
            from api.schemas.agent_context import context_to_enrichment_string
            structured_ctx = context_to_enrichment_string(agent_context)
            if structured_ctx:
                base_extra["structured_context"] = structured_ctx
    return base_extra


def run_agent_sources(
    agent_id: str,
    agent: dict,
    targets: list[tuple[int, str]] | None = None,
) -> list[str]:
    """Re-collect data for one or more sources without triggering the agent run.

    `targets` is a list of (search_idx, platform). When None, runs every source
    in the agent. Each call creates a fresh collection per source, links it to
    the agent, and dispatches the collection pipeline. No run record is created
    and the agent's status / todos are not changed — this is a data refresh.

    Returns the list of new collection IDs.
    """
    from api.schemas.requests import CreateCollectionRequest
    from api.services.collection_service import create_collection_from_request
    from google.cloud.firestore_v1 import transforms

    fs = get_fs()
    data_scope = agent.get("data_scope") or {}
    searches = data_scope.get("searches", []) or []
    user_id = agent.get("user_id", "")
    org_id = agent.get("org_id")
    title = agent.get("title", "")

    # Build the (search_idx, platform) targets if not provided.
    if targets is None:
        targets = [
            (idx, platform)
            for idx, search in enumerate(searches)
            for platform in (search.get("platforms") or [])
        ]
    if not targets:
        return []

    base_extra = _build_base_extra_config(agent)
    description = f"{title} (data refresh)" if title else "Data refresh"

    collection_ids: list[str] = []
    for search_idx, platform in targets:
        if search_idx < 0 or search_idx >= len(searches):
            continue
        search_def = searches[search_idx]
        resolved = resolve_source_config(search_def, platform)
        if resolved is None:
            continue

        req = CreateCollectionRequest(
            description=description,
            platforms=[platform],
            keywords=resolved["keywords"],
            channel_urls=resolved["channels"],
            time_range_days=resolved["time_range_days"],
            geo_scope=resolved["geo_scope"],
            n_posts=resolved["n_posts"],
            include_comments=True,
        )
        extra_config = dict(base_extra)
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

        fs.add_agent_collection(agent_id, cid)
        fs.update_collection_status(cid, agent_id=agent_id)

    if collection_ids:
        fs.update_agent(agent_id, collection_ids=transforms.ArrayUnion(collection_ids))
        log_agent_activity(
            agent_id,
            f"Source refresh — collecting from {len(collection_ids)} platform(s)",
            source="agent_service",
        )
    return collection_ids


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
    from workers.pipeline.schedule_utils import compute_next_run_at
    from api.agent.workflow_template import build_workflow_template, progress_automated_steps

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

    # Create a run record (stamped with current agent version)
    agent_version = agent.get("version", 1)
    run_id = fs.create_run(agent_id, trigger=trigger, agent_version=agent_version)

    # Update agent status to executing
    fs.update_agent(agent_id, status="running", active_run_id=run_id)

    base_extra = _build_base_extra_config(agent)
    description = title if agent_type == "one_shot" else f"{title} (scheduled run)"

    collection_ids = []
    for search_def in searches:
        for platform in (search_def.get("platforms") or []):
            resolved = resolve_source_config(search_def, platform)
            if resolved is None:
                continue

            req = CreateCollectionRequest(
                description=description,
                platforms=[platform],
                keywords=resolved["keywords"],
                channel_urls=resolved["channels"],
                time_range_days=resolved["time_range_days"],
                geo_scope=resolved["geo_scope"],
                n_posts=resolved["n_posts"],
                include_comments=True,
            )

            extra_config = dict(base_extra)
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

    # Build fresh workflow template for each run.
    # Preserve custom steps from previous runs (user-added) but reset all statuses.
    fresh_todos = build_workflow_template(data_scope, agent_type, agent=agent)
    old_todos = agent.get("todos") or []
    custom_steps = [
        {**t, "status": "pending"}
        for t in old_todos
        if t.get("custom")
    ]
    if custom_steps:
        # Insert custom steps before the deliver phase (last standard step)
        deliver_idx = next(
            (i for i, t in enumerate(fresh_todos) if t.get("phase") == "deliver"),
            len(fresh_todos),
        )
        fresh_todos = fresh_todos[:deliver_idx] + custom_steps + fresh_todos[deliver_idx:]
    todos = progress_automated_steps(fresh_todos, "collect_started", "in_progress")
    fs.update_agent(agent_id, todos=todos)

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
