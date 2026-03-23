"""Task CRUD service — creates, reads, updates tasks in Firestore + BigQuery."""

import json
import logging
from uuid import uuid4

from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)


def create_task(
    user_id: str,
    seed: str,
    title: str,
    task_type: str = "one_shot",
    protocol: str = "",
    data_scope: dict | None = None,
    schedule: dict | None = None,
    org_id: str | None = None,
    session_id: str | None = None,
    status: str = "seed",
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
        "seed": seed,
        "task_type": task_type,
        "status": status,
        "protocol": protocol,
        "data_scope": data_scope or {},
        "schedule": schedule,
        "collection_ids": [],
        "artifact_ids": [],
        "session_ids": [session_id] if session_id else [],
        "primary_session_id": session_id or "",
        "run_count": 0,
        "run_history": [],
        "context_summary": "",
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
                "seed": seed,
                "protocol": protocol,
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
