"""Agent CRUD service — creates, reads, updates agents in Firestore + BigQuery."""

import json
import logging
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from google.cloud.firestore_v1 import transforms

from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)


def _max_source_time_range_days(sources: list[dict]) -> int:
    """Broadest configured window across an agent's sources, in days.

    Used to derive the agent-level `data_start_date` default. MAX rather
    than MIN so the default window covers every source — users can narrow
    it from the Settings UI later.
    """
    days = [int(s.get("time_range_days") or 0) for s in (sources or [])]
    days = [d for d in days if d > 0]
    return max(days) if days else 90


def _compute_default_data_start_date(
    sources: list[dict], anchor: date | None = None
) -> str:
    """Anchor − MAX(source.time_range_days), as ISO date string."""
    anchor = anchor or datetime.now(timezone.utc).date()
    return (anchor - timedelta(days=_max_source_time_range_days(sources))).isoformat()


def _clean_source(s: dict) -> dict:
    src = {
        "platform": s.get("platform"),
        "keywords": list(s.get("keywords") or []),
        "n_posts": int(s.get("n_posts") or 0),
        "time_range_days": int(s.get("time_range_days") or 90),
        "geo_scope": s.get("geo_scope") or "global",
    }
    channels = s.get("channels")
    if channels:
        src["channels"] = list(channels)
    for k in ("start_date", "end_date"):
        v = s.get(k)
        if v:
            src[k] = v
    return src


def normalize_sources(data_scope: dict | None) -> list[dict]:
    """Return data_scope's sources as a flat list of single-platform dicts.

    Each source: {platform, keywords[], n_posts, time_range_days, geo_scope,
    channels?, start_date?, end_date?}.

    Accepts the new flat `sources` field, and falls back to expanding the
    legacy `searches` shape (multi-platform with optional `per_source`
    overrides) into one Source per platform. Idempotent.
    """
    if not data_scope:
        return []
    raw = data_scope.get("sources")
    if isinstance(raw, list):
        return [_clean_source(s) for s in raw if isinstance(s, dict) and s.get("platform")]

    out: list[dict] = []
    for search in (data_scope.get("searches") or []):
        if not isinstance(search, dict):
            continue
        platforms = search.get("platforms") or []
        if not platforms:
            continue
        per_source = search.get("per_source") or {}
        default_n = int(search.get("n_posts") or 0)
        default_split = default_n // max(len(platforms), 1) if default_n else 0
        for platform in platforms:
            override = per_source.get(platform) or {}
            if override.get("override"):
                merged = {
                    "platform": platform,
                    "keywords": override.get("keywords", search.get("keywords", [])),
                    "n_posts": override.get("n_posts", default_split),
                    "time_range_days": override.get("time_range_days", search.get("time_range_days", 90)),
                    "geo_scope": override.get("geo_scope", search.get("geo_scope", "global")),
                    "channels": override.get("channels", search.get("channels")),
                }
            else:
                merged = {
                    "platform": platform,
                    "keywords": search.get("keywords", []),
                    "n_posts": default_split,
                    "time_range_days": search.get("time_range_days", 90),
                    "geo_scope": search.get("geo_scope", "global"),
                    "channels": search.get("channels"),
                }
            for k in ("start_date", "end_date"):
                v = search.get(k)
                if v:
                    merged[k] = v
            out.append(_clean_source(merged))
    return out


def _normalize_data_scope(data_scope: dict | None) -> dict:
    """Return a copy of data_scope with `sources` populated and legacy
    `searches`/`per_source` stripped. Safe to call on already-normalized
    payloads.
    """
    if not data_scope:
        return {}
    out = dict(data_scope)
    out["sources"] = normalize_sources(out)
    out.pop("searches", None)
    return out


_ENRICHMENT_CONFIG_KEYS = ("custom_fields", "enrichment_context", "content_types")


def _normalize_enrichment_config(enrichment_config: dict | None) -> dict:
    """Return a copy with only the recognized enrichment keys, dropping empties."""
    if not enrichment_config:
        return {}
    out: dict = {}
    for k in _ENRICHMENT_CONFIG_KEYS:
        v = enrichment_config.get(k)
        if v:
            out[k] = v
    return out


_TOPICS_CONFIG_KEYS = (
    "algorithm_version",
    "window_days",
    "sample_size",
    "batch_size",
    "auto_regenerate_on_pipeline",
    "last_run_at",
    "last_run_stats",
)
_TOPICS_ALGORITHMS = {"brothers_v1", "llm_taxonomy_v2"}


def _normalize_topics_config(topics_config: dict | None) -> dict:
    """Strip unknown keys, validate ranges. Returns empty dict for falsy input
    so unset agents fall back to global settings + brothers_v1 default.
    NOT in VERSIONED_FIELDS — this is a presentation knob, not a data-shape
    change, so editing it must not bump agent.version.
    """
    if not topics_config:
        return {}
    out: dict = {}
    for k in _TOPICS_CONFIG_KEYS:
        v = topics_config.get(k)
        if v is None or v == "":
            continue
        if k == "algorithm_version" and v not in _TOPICS_ALGORITHMS:
            continue  # silently drop unknown algorithms
        if k in {"window_days", "sample_size", "batch_size"}:
            try:
                v = int(v)
            except (TypeError, ValueError):
                continue
            if v <= 0:
                continue
        if k == "auto_regenerate_on_pipeline":
            v = bool(v)
        out[k] = v
    return out


def create_agent(
    user_id: str,
    title: str,
    agent_type: str = "one_shot",
    data_scope: dict | None = None,
    enrichment_config: dict | None = None,
    schedule: dict | None = None,
    org_id: str | None = None,
    todos: list | None = None,
    status: str | None = "running",
    context: dict | None = None,
    constitution: dict | None = None,
    outputs: list[dict] | None = None,
    data_start_date: str | None = None,
    data_end_date: str | None = None,
) -> dict:
    """Create a new agent in Firestore and BigQuery. Returns the agent dict."""
    fs = get_fs()
    bq = get_bq()

    agent_id = str(uuid4())
    data_scope = _normalize_data_scope(data_scope)
    enrichment_config = _normalize_enrichment_config(enrichment_config)

    # Agent-level data window. Stored as ISO date strings (YYYY-MM-DD) so
    # they're human-editable in the Settings UI and compare cleanly against
    # BQ TIMESTAMP via implicit cast. Start defaults to today − MAX(source
    # time_range_days); end defaults to NULL meaning "no upper bound".
    if not data_start_date:
        data_start_date = _compute_default_data_start_date(
            data_scope.get("sources") or []
        )

    # Generate a single timestamp shared by Firestore and BigQuery so the
    # two stores agree on when the agent was created.
    now = datetime.now(timezone.utc)

    agent_data = {
        "agent_id": agent_id,
        "user_id": user_id,
        "org_id": org_id,
        "title": title,
        "agent_type": agent_type,
        "status": status,
        "data_scope": data_scope,
        "enrichment_config": enrichment_config,
        "outputs": outputs or [],
        "schedule": schedule,
        "todos": todos or [],
        "version": 1,
        "collection_ids": [],
        "artifact_ids": [],
        "data_start_date": data_start_date,
        "data_end_date": data_end_date,
        "created_at": now,
        "updated_at": now,
    }
    if constitution:
        agent_data["constitution"] = constitution
    if context:
        agent_data["context"] = context

    # Firestore (real-time state)
    fs.create_agent(agent_id, agent_data)

    # BigQuery (analytics) — append-only / SCD-style: scope_posts reads the
    # row with the most recent `created_at` to bound `posted_at`.
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
                "data_start_date": data_start_date,
                "created_at": now.isoformat(),
            }
        ],
    )

    logger.info("Created agent %s for user %s", agent_id, user_id)
    return agent_data


def _backfill_data_window(agent: dict) -> dict:
    """Lazy-backfill `data_start_date` for agents created before the field
    existed. Computes from the agent's `created_at` minus MAX(source
    time_range_days) and persists back to Firestore so the value sticks.
    `data_end_date` stays NULL by default (no upper bound).
    """
    if "data_start_date" in agent and agent["data_start_date"]:
        return agent
    sources = (agent.get("data_scope") or {}).get("sources") or []
    created_at = agent.get("created_at")
    anchor: date | None = None
    if isinstance(created_at, datetime):
        anchor = created_at.date()
    elif isinstance(created_at, str):
        try:
            anchor = datetime.fromisoformat(created_at.replace("Z", "+00:00")).date()
        except ValueError:
            anchor = None
    start = _compute_default_data_start_date(sources, anchor=anchor)
    agent["data_start_date"] = start
    agent.setdefault("data_end_date", None)
    # Preserve the agent's existing updated_at — this is a system-driven
    # backfill, not a user edit, so it must not bump the "Last Run" stamp.
    persisted_fields: dict = {"data_start_date": start, "data_end_date": None}
    existing_updated_at = agent.get("updated_at")
    if isinstance(existing_updated_at, datetime):
        persisted_fields["updated_at"] = existing_updated_at
    elif isinstance(existing_updated_at, str):
        try:
            persisted_fields["updated_at"] = datetime.fromisoformat(
                existing_updated_at.replace("Z", "+00:00")
            )
        except ValueError:
            pass
    try:
        get_fs().update_agent(agent["agent_id"], **persisted_fields)
    except Exception:
        # Backfill is best-effort — surface the value to the caller even
        # if the persist failed; it'll retry on the next read.
        logger.exception("Failed to persist data_start_date backfill for %s", agent.get("agent_id"))
    return agent


def get_agent(agent_id: str) -> dict | None:
    """Get an agent by ID from Firestore. data_scope.sources is normalized."""
    agent = get_fs().get_agent(agent_id)
    if agent is None:
        return None
    agent["data_scope"] = _normalize_data_scope(agent.get("data_scope"))
    agent = _backfill_data_window(agent)
    return agent


def list_agents(user_id: str, org_id: str | None = None) -> list[dict]:
    """List agents visible to the user. data_scope.sources is normalized."""
    agents = get_fs().list_user_agents(user_id, org_id)
    for agent in agents:
        agent["data_scope"] = _normalize_data_scope(agent.get("data_scope"))
        _backfill_data_window(agent)
    return agents


def _record_data_window_row(agent_id: str, agent_before: dict, fields: dict) -> None:
    """Append a fresh agents-table row in BigQuery when `data_start_date`
    changes, so the SCD-style table stays current. The row carries the
    agent's identity columns alongside the new `data_start_date` and a
    fresh `created_at` — `scope_posts` picks the latest `created_at` and
    uses its `data_start_date` to bound `posted_at`.

    No-op when `data_start_date` is absent from the update or unchanged.
    """
    if "data_start_date" not in fields:
        return
    new_start = fields.get("data_start_date")
    if new_start == agent_before.get("data_start_date"):
        return
    try:
        get_bq().insert_rows(
            "agents",
            [
                {
                    "agent_id": agent_id,
                    "user_id": agent_before.get("user_id", ""),
                    "org_id": agent_before.get("org_id"),
                    "title": agent_before.get("title", ""),
                    "data_scope": (
                        json.dumps(agent_before.get("data_scope"))
                        if agent_before.get("data_scope") else None
                    ),
                    "status": agent_before.get("status"),
                    "agent_type": agent_before.get("agent_type"),
                    "data_start_date": new_start,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ],
        )
    except Exception:
        # Never block the Firestore write on a BQ analytics append.
        logger.exception(
            "Failed to record data_start_date change for agent %s in BigQuery",
            agent_id,
        )


def update_agent(agent_id: str, **fields) -> None:
    """Update agent fields in Firestore. Appends a new BigQuery row if the
    update changes `data_start_date`."""
    fs = get_fs()
    agent_before = fs.get_agent(agent_id) if "data_start_date" in fields else None
    fs.update_agent(agent_id, **fields)
    if agent_before is not None:
        _record_data_window_row(agent_id, agent_before, fields)


VERSIONED_FIELDS = {"title", "todos", "context", "constitution", "outputs", "enrichment_config"}


def update_agent_with_version(agent_id: str, user_id: str, updates: dict) -> int:
    """Update agent and create a version snapshot if config fields changed.

    Returns the new version number.
    """
    fs = get_fs()
    agent = fs.get_agent(agent_id)
    if not agent:
        raise ValueError(f"Agent {agent_id} not found")

    if "data_scope" in updates:
        updates["data_scope"] = _normalize_data_scope(updates["data_scope"])
    if "enrichment_config" in updates:
        updates["enrichment_config"] = _normalize_enrichment_config(updates["enrichment_config"])
    if "topics_config" in updates:
        updates["topics_config"] = _normalize_topics_config(updates["topics_config"])

    needs_version = bool(VERSIONED_FIELDS & set(updates.keys()))
    current_version = agent.get("version") or 1
    new_version = current_version

    if needs_version:
        new_version = current_version + 1
        updates["version"] = new_version

        snapshot = {
            "title": updates.get("title", agent.get("title")),
            "data_scope": updates.get("data_scope", agent.get("data_scope")),
            "enrichment_config": updates.get("enrichment_config", agent.get("enrichment_config")),
            "todos": updates.get("todos", agent.get("todos")),
            "context": updates.get("context", agent.get("context")),
            "constitution": updates.get("constitution", agent.get("constitution")),
            "outputs": updates.get("outputs", agent.get("outputs")),
        }
        fs.create_agent_version(agent_id, new_version, snapshot, edited_by=user_id)

    fs.update_agent(agent_id, **updates)
    _record_data_window_row(agent_id, agent, updates)
    logger.info("Updated agent %s (version %d → %d)", agent_id, current_version, new_version)
    return new_version


def _build_base_extra_config(agent: dict) -> dict:
    """Collect the agent-wide enrichment/context fields that ride along with
    every collection request (custom_fields, enrichment_context, content_types,
    structured_context derived from constitution/context).
    """
    enrichment_config = agent.get("enrichment_config") or {}
    base_extra: dict = {}
    custom_fields = enrichment_config.get("custom_fields")
    if custom_fields:
        base_extra["custom_fields"] = custom_fields
    enrichment_context = enrichment_config.get("enrichment_context")
    if enrichment_context:
        base_extra["enrichment_context"] = enrichment_context
    content_types = enrichment_config.get("content_types")
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


def _source_to_collection_request(source: dict, description: str):
    from api.schemas.requests import CreateCollectionRequest
    return CreateCollectionRequest(
        description=description,
        platforms=[source["platform"]],
        keywords=source.get("keywords") or [],
        channel_urls=source.get("channels"),
        time_range_days=source.get("time_range_days", 90),
        geo_scope=source.get("geo_scope", "global"),
        n_posts=source.get("n_posts") or 0,
        include_comments=True,
    )


def run_agent_sources(
    agent_id: str,
    agent: dict,
    source_idx: int | None = None,
    platform: str | None = None,
) -> list[str]:
    """Re-collect data for selected sources without triggering the agent run.

    Targeting: ``source_idx`` selects one card; ``platform`` selects every
    card on that platform; both omitted refreshes every source on the agent.
    ``source_idx`` wins if both are passed.

    Each selected source becomes a fresh collection linked to the agent. No
    run record is created and the agent's status / todos are not changed —
    this is a data refresh, not an agent run.

    Returns the list of new collection IDs.
    """
    from api.services.collection_service import create_collection_from_request
    from google.cloud.firestore_v1 import transforms

    fs = get_fs()
    sources = normalize_sources(agent.get("data_scope"))
    if not sources:
        return []
    if source_idx is not None:
        if source_idx < 0 or source_idx >= len(sources):
            return []
        sources = [sources[source_idx]]
    elif platform is not None:
        sources = [s for s in sources if s.get("platform") == platform]
        if not sources:
            return []

    user_id = agent.get("user_id", "")
    org_id = agent.get("org_id")
    title = agent.get("title", "")
    base_extra = _build_base_extra_config(agent)
    description = f"{title} (data refresh)" if title else "Data refresh"

    agent_version = agent.get("version", 1)
    collection_ids: list[str] = []
    for source in sources:
        if not source.get("keywords") and not source.get("channels"):
            continue
        result = create_collection_from_request(
            request=_source_to_collection_request(source, description),
            user_id=user_id,
            org_id=org_id,
            extra_config=dict(base_extra),
        )
        cid = result["collection_id"]
        collection_ids.append(cid)
        fs.add_agent_collection(agent_id, cid)
        fs.update_collection_status(cid, agent_id=agent_id, agent_version=agent_version)

    if collection_ids:
        fs.update_agent(agent_id, collection_ids=transforms.ArrayUnion(collection_ids))
        log_agent_activity(
            agent_id,
            f"Source refresh — collecting from {len(collection_ids)} source(s)",
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
    from api.services.collection_service import create_collection_from_request
    from workers.pipeline.schedule_utils import compute_next_run_at
    from api.agent.workflow_template import build_workflow_template, progress_automated_steps

    fs = get_fs()

    data_scope = agent.get("data_scope") or {}
    sources = normalize_sources(data_scope)
    schedule = agent.get("schedule") or {}
    user_id = agent.get("user_id", "")
    org_id = agent.get("org_id")
    title = agent.get("title", "")
    agent_type = agent.get("agent_type", "one_shot")

    if not sources:
        logger.warning("Agent %s has no sources defined", agent_id)
        return "", []

    # Create a run record (stamped with current agent version)
    agent_version = agent.get("version", 1)
    run_id = fs.create_run(agent_id, trigger=trigger, agent_version=agent_version)

    # Update agent status to executing
    fs.update_agent(agent_id, status="running", active_run_id=run_id)

    base_extra = _build_base_extra_config(agent)
    description = title if agent_type == "one_shot" else f"{title} (scheduled run)"

    collection_ids = []
    for source in sources:
        if not source.get("keywords") and not source.get("channels"):
            continue
        result = create_collection_from_request(
            request=_source_to_collection_request(source, description),
            user_id=user_id,
            org_id=org_id,
            extra_config=dict(base_extra),
        )
        cid = result["collection_id"]
        collection_ids.append(cid)

        # Link collection to agent (both directions) and to run
        fs.add_agent_collection(agent_id, cid)
        fs.add_run_collection(agent_id, run_id, cid)
        fs.update_collection_status(cid, agent_id=agent_id, agent_version=agent_version)

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
