"""Shared collection creation logic used by both the agent tool and the REST API."""

import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from api.deps import get_bq, get_fs
from api.schemas.requests import CreateCollectionRequest
from config.settings import get_settings

logger = logging.getLogger(__name__)

def _parse_schedule(schedule: str | None) -> tuple[int, int, int]:
    """Return (interval_days, hour_utc, minute_utc) for a schedule string.

    Supported formats:
      "daily"         → every 1 day  at 09:00 UTC  (legacy)
      "weekly"        → every 7 days at 09:00 UTC  (legacy)
      "Nd@HH:MM"      → every N days at HH:MM UTC  (e.g. "1d@04:00", "7d@09:30")
    """
    if not schedule or schedule == "daily":
        return (1, 9, 0)
    if schedule == "weekly":
        return (7, 9, 0)
    import re
    m = re.match(r"^(\d+)d@(\d{2}):(\d{2})$", schedule)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return (1, 9, 0)


def _compute_next_run_at(schedule: str | None, from_time: datetime) -> datetime:
    """Return the next run datetime for the given schedule, starting from from_time."""
    interval_days, hour, minute = _parse_schedule(schedule)
    base = from_time + timedelta(days=interval_days)
    return base.replace(hour=hour, minute=minute, second=0, microsecond=0)


def create_collection_from_request(
    request: CreateCollectionRequest,
    user_id: str,
    org_id: str | None = None,
) -> dict:
    """Create a collection from a frontend modal request.

    This replicates the logic from start_collection tool but is callable
    from the REST API without going through the agent.
    """
    settings = get_settings()
    bq = get_bq()
    fs = get_fs()

    collection_id = str(uuid4())

    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=request.time_range_days)

    config = {
        "platforms": request.platforms,
        "keywords": request.keywords,
        "channel_urls": request.channel_urls or [],
        "time_range": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d"),
        },
        "max_calls": request.max_calls,
        "include_comments": request.include_comments,
        "geo_scope": request.geo_scope,
        "ongoing": request.ongoing,
        "schedule": request.schedule if request.ongoing else None,
    }

    # Insert collection record into BigQuery
    bq.insert_rows(
        "collections",
        [
            {
                "collection_id": collection_id,
                "user_id": user_id,
                "org_id": org_id,
                "session_id": "",
                "original_question": request.description,
                "config": json.dumps(config),
            }
        ],
    )

    # Create Firestore status document
    fs.create_collection_status(collection_id, user_id, config, org_id=org_id)

    # Dispatch worker
    if settings.is_dev:
        logger.info(
            "DEV MODE: Running collection pipeline in background thread for %s",
            collection_id,
        )
        thread = threading.Thread(
            target=_run_pipeline,
            args=(collection_id,),
            daemon=True,
        )
        thread.start()
    else:
        _dispatch_cloud_task(settings, collection_id)

    return {
        "collection_id": collection_id,
        "status": "pending",
    }


def _run_pipeline(collection_id: str) -> None:
    """Run collection then enrichment as a single pipeline (dev mode)."""
    from google.cloud.firestore_v1 import transforms
    from workers.collection.worker import run_collection
    from workers.enrichment.worker import run_enrichment
    from workers.shared.firestore_client import FirestoreClient

    try:
        run_collection(collection_id)
    except Exception:
        logger.exception("Collection pipeline failed for %s", collection_id)
        return

    # Auto-trigger enrichment after successful collection
    settings = get_settings()
    fs = FirestoreClient(settings)
    status = fs.get_collection_status(collection_id)
    if not status or status.get("status") not in ("completed", "collecting"):
        # cancelled or failed during collection
        return

    try:
        config = status.get("config") or {}
        min_likes = config.get("min_likes", 0)
        run_enrichment(collection_id, min_likes=min_likes)
    except Exception:
        logger.exception("Enrichment pipeline failed for %s", collection_id)
        return

    # Compute and persist statistical signature (non-fatal)
    try:
        from api.services.statistical_signature_service import refresh_statistical_signature

        bq = get_bq()
        refresh_statistical_signature(collection_id, bq, fs)
    except Exception:
        logger.exception("Statistical signature computation failed for %s", collection_id)

    # After enrichment, decide final status based on ongoing flag
    status = fs.get_collection_status(collection_id)
    config = (status or {}).get("config") or {}
    if config.get("ongoing"):
        schedule = config.get("schedule", "daily")
        now = datetime.now(timezone.utc)
        next_run_at = _compute_next_run_at(schedule, now)

        # Build new run_history entry
        run_entry = {
            "run_at": now.isoformat(),
            "posts_added": (status or {}).get("posts_collected", 0),
            "status": "completed",
        }
        # Use Firestore ArrayUnion to append; cap is handled separately if needed
        fs.update_collection_status(
            collection_id,
            status="monitoring",
            last_run_at=now,
            next_run_at=next_run_at,
            total_runs=transforms.Increment(1),
            run_history=transforms.ArrayUnion([run_entry]),
        )
        logger.info(
            "Ongoing collection %s set to monitoring; next run at %s",
            collection_id,
            next_run_at.isoformat(),
        )
    else:
        fs.update_collection_status(collection_id, status="completed")


def trigger_collection_now(collection_id: str) -> None:
    """Immediately trigger the next run of an ongoing collection."""
    from workers.shared.firestore_client import FirestoreClient

    settings = get_settings()
    fs = FirestoreClient(settings)
    status = fs.get_collection_status(collection_id)
    if not status:
        raise ValueError(f"Collection {collection_id} not found")
    if not status.get("ongoing"):
        raise ValueError(f"Collection {collection_id} is not an ongoing collection")
    if status.get("status") != "monitoring":
        raise ValueError(
            f"Collection {collection_id} is not in monitoring state (current: {status.get('status')})"
        )

    # Claim the collection before dispatching to prevent scheduler double-trigger
    fs.update_collection_status(collection_id, status="collecting")

    if settings.is_dev:
        thread = threading.Thread(target=_run_pipeline, args=(collection_id,), daemon=True)
        thread.start()
    else:
        _dispatch_cloud_task(settings, collection_id)

    logger.info("Manually triggered run for ongoing collection %s", collection_id)


def update_collection_mode(
    collection_id: str,
    ongoing: bool,
    schedule: str | None,
) -> None:
    """Switch a collection between ongoing and normal mode."""
    from workers.shared.firestore_client import FirestoreClient

    settings = get_settings()
    bq = get_bq()
    fs = FirestoreClient(settings)

    status_doc = fs.get_collection_status(collection_id)
    if not status_doc:
        raise ValueError(f"Collection {collection_id} not found")

    # Update config in BigQuery
    rows = bq.query(
        "SELECT config FROM social_listening.collections WHERE collection_id = @collection_id",
        {"collection_id": collection_id},
    )
    if not rows:
        raise ValueError(f"Collection {collection_id} not found in BigQuery")

    config = rows[0]["config"]
    if isinstance(config, str):
        config = json.loads(config)
    config = dict(config)
    config["ongoing"] = ongoing
    config["schedule"] = schedule if ongoing else None

    bq.query(
        "UPDATE social_listening.collections SET config = @config WHERE collection_id = @collection_id",
        {"collection_id": collection_id, "config": json.dumps(config)},
    )

    if ongoing:
        now = datetime.now(timezone.utc)
        next_run_at = _compute_next_run_at(schedule, now)
        fs.update_collection_status(
            collection_id,
            ongoing=True,
            status="monitoring",
            next_run_at=next_run_at,
        )
        logger.info(
            "Collection %s switched to ongoing (%s); next run at %s",
            collection_id,
            schedule,
            next_run_at.isoformat(),
        )
    else:
        fs.update_collection_status(
            collection_id,
            ongoing=False,
            status="completed",
            next_run_at=None,
        )
        logger.info("Collection %s switched to normal (monitoring stopped)", collection_id)


def _dispatch_cloud_task(settings, collection_id: str) -> None:
    """Dispatch collection worker via Cloud Tasks."""
    from google.cloud import tasks_v2

    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(
        settings.gcp_project_id,
        settings.gcp_region,
        settings.cloud_tasks_queue,
    )
    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"https://collection-worker-{settings.gcp_project_id}.run.app/run",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"collection_id": collection_id}).encode(),
        }
    }
    client.create_task(parent=parent, task=task)
    logger.info("Dispatched Cloud Task for collection %s", collection_id)
