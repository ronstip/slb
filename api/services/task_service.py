"""Task CRUD service — creates, reads, updates tasks in Firestore + BigQuery."""

import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from google.cloud.firestore_v1 import transforms

from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)


def create_task(
    user_id: str,
    title: str,
    task_type: str = "one_shot",
    data_scope: dict | None = None,
    schedule: dict | None = None,
    org_id: str | None = None,
    session_id: str | None = None,
    todos: list | None = None,
    status: str = "approved",
) -> dict:
    """Create a new task in Firestore and BigQuery. Returns the task dict."""
    fs = get_fs()
    bq = get_bq()

    task_id = str(uuid4())

    task_data = {
        "task_id": task_id,
        "user_id": user_id,
        "org_id": org_id,
        "title": title,
        "task_type": task_type,
        "status": status,
        "data_scope": data_scope or {},
        "schedule": schedule,
        "todos": todos or [],
        "collection_ids": [],
        "artifact_ids": [],
        "session_id": session_id or "",
    }

    # Firestore (real-time state)
    fs.create_task(task_id, task_data)

    # BigQuery (analytics)
    bq.insert_rows(
        "tasks",
        [
            {
                "task_id": task_id,
                "user_id": user_id,
                "org_id": org_id,
                "title": title,
                "data_scope": json.dumps(data_scope) if data_scope else None,
                "status": status,
                "task_type": task_type,
            }
        ],
    )

    logger.info("Created task %s for user %s", task_id, user_id)
    return task_data


def get_task(task_id: str) -> dict | None:
    """Get a task by ID from Firestore."""
    return get_fs().get_task(task_id)


def list_tasks(user_id: str, org_id: str | None = None) -> list[dict]:
    """List tasks visible to the user."""
    return get_fs().list_user_tasks(user_id, org_id)


def update_task(task_id: str, **fields) -> None:
    """Update task fields in Firestore."""
    get_fs().update_task(task_id, **fields)


def delete_task(task_id: str) -> None:
    """Delete a task from Firestore."""
    get_fs().delete_task(task_id)


def dispatch_task_run(task_id: str, task: dict) -> list[str]:
    """Create collections from a task's data_scope and dispatch pipelines.

    Works for both one-shot re-runs and recurring task runs.
    Sets task status to 'executing' and returns the new collection_ids.
    """
    from api.schemas.requests import CreateCollectionRequest
    from api.services.collection_service import create_collection_from_request, _compute_next_run_at

    fs = get_fs()

    data_scope = task.get("data_scope") or {}
    searches = data_scope.get("searches", [])
    schedule = task.get("schedule") or {}
    user_id = task.get("user_id", "")
    org_id = task.get("org_id")
    session_id = task.get("session_id") or task.get("primary_session_id", "")
    title = task.get("title", "")
    task_type = task.get("task_type", "one_shot")

    if not searches:
        logger.warning("Task %s has no searches defined", task_id)
        return []

    # Update task status to executing
    fs.update_task(task_id, status="executing")

    collection_ids = []
    for search_def in searches:
        platforms = search_def.get("platforms", [])
        keywords = search_def.get("keywords", [])
        if not platforms or not keywords:
            continue

        req = CreateCollectionRequest(
            description=title if task_type == "one_shot" else f"{title} (scheduled run)",
            platforms=platforms,
            keywords=keywords,
            channel_urls=search_def.get("channels"),
            time_range_days=search_def.get("time_range_days", 90),
            geo_scope=search_def.get("geo_scope", "global"),
            n_posts=search_def.get("n_posts", 0),
            include_comments=True,
        )

        extra_config = {}
        custom_fields = data_scope.get("custom_fields")
        if custom_fields:
            extra_config["custom_fields"] = custom_fields

        result = create_collection_from_request(
            request=req,
            user_id=user_id,
            org_id=org_id,
            session_id=session_id,
            extra_config=extra_config,
        )
        cid = result["collection_id"]
        collection_ids.append(cid)

        # Link collection to task (both directions)
        fs.add_task_collection(task_id, cid)
        fs.update_collection_status(cid, task_id=task_id)

    # Update task with new collection IDs + next_run_at for recurring
    update_fields: dict = {
        "collection_ids": transforms.ArrayUnion(collection_ids),
    }
    if task_type == "recurring" and schedule.get("frequency"):
        now = datetime.now(timezone.utc)
        update_fields["next_run_at"] = _compute_next_run_at(schedule["frequency"], now)

    fs.update_task(task_id, **update_fields)

    logger.info("Dispatched task %s: created %d collections", task_id, len(collection_ids))
    log_task_activity(task_id, f"Task run dispatched — creating {len(collection_ids)} collection(s)", source="task_service")
    return collection_ids


def log_task_activity(
    task_id: str,
    message: str,
    source: str = "system",
    level: str = "info",
    metadata: dict | None = None,
) -> None:
    """Write a log entry to the task's activity log subcollection."""
    try:
        get_fs().add_task_log(task_id, message, source=source, level=level, metadata=metadata)
    except Exception:
        logger.warning("Failed to write task log for %s: %s", task_id, message, exc_info=True)
