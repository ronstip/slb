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

def _parse_schedule(schedule: str | None) -> tuple[str, int, int | None, int | None]:
    """Return (unit, interval, hour_utc, minute_utc) for a schedule string.

    Supported formats:
      "daily"         → ("d", 1, 9, 0)        (legacy)
      "weekly"        → ("d", 7, 9, 0)        (legacy)
      "Nm"            → ("m", N, None, None)   (e.g. "30m" = every 30 minutes)
      "Nh"            → ("h", N, None, None)   (e.g. "2h"  = every 2 hours)
      "Nd@HH:MM"      → ("d", N, HH, MM)      (e.g. "1d@09:00" = daily at 09:00)
    """
    import re
    if not schedule or schedule == "daily":
        return ("d", 1, 9, 0)
    if schedule == "weekly":
        return ("d", 7, 9, 0)
    # Minutes: "30m"
    m = re.match(r"^(\d+)m$", schedule)
    if m:
        return ("m", int(m.group(1)), None, None)
    # Hours: "2h"
    m = re.match(r"^(\d+)h$", schedule)
    if m:
        return ("h", int(m.group(1)), None, None)
    # Days: "1d@09:00"
    m = re.match(r"^(\d+)d@(\d{2}):(\d{2})$", schedule)
    if m:
        return ("d", int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return ("d", 1, 9, 0)


def is_valid_schedule(schedule: str | None) -> bool:
    """Return True if the schedule string is a recognized format."""
    if not schedule:
        return False
    if schedule in ("daily", "weekly"):
        return True
    import re
    return bool(
        re.match(r"^(\d+)m$", schedule)
        or re.match(r"^(\d+)h$", schedule)
        or re.match(r"^(\d+)d@(\d{2}):(\d{2})$", schedule)
    )


def _compute_next_run_at(schedule: str | None, from_time: datetime) -> datetime:
    """Return the next future run datetime for the given schedule."""
    unit, interval, hour, minute = _parse_schedule(schedule)

    if unit == "m":
        candidate = from_time + timedelta(minutes=interval)
        return candidate.replace(second=0, microsecond=0)

    if unit == "h":
        candidate = from_time + timedelta(hours=interval)
        return candidate.replace(second=0, microsecond=0)

    # Days: pin to specific time of day
    assert hour is not None and minute is not None
    candidate = from_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
    candidate += timedelta(days=interval)
    # Safety: ensure candidate is in the future
    while candidate <= from_time:
        candidate += timedelta(days=1)
    return candidate


def create_collection_from_request(
    request: CreateCollectionRequest,
    user_id: str,
    org_id: str | None = None,
    session_id: str = "",
    extra_config: dict | None = None,
) -> dict:
    """Create a collection, insert records, and dispatch the worker.

    Used by both the REST endpoint and the agent start_collection tool.
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
        "max_posts_per_keyword": request.max_posts_per_keyword or request.max_calls * 10,
        "include_comments": request.include_comments,
        "geo_scope": request.geo_scope,
        "ongoing": request.ongoing,
        "schedule": request.schedule if request.ongoing else None,
    }
    if request.vendor_config:
        config["vendor_config"] = request.vendor_config.model_dump(exclude_none=True)
    if extra_config:
        config.update(extra_config)

    # Pull enrichment config from request (frontend direct-start path).
    # setdefault so extra_config (agent path) takes precedence.
    if request.custom_fields:
        config.setdefault("custom_fields", request.custom_fields)
    if request.video_params:
        config.setdefault("video_params", request.video_params)
    if request.reasoning_level:
        config.setdefault("reasoning_level", request.reasoning_level)
    if request.min_likes is not None:
        config.setdefault("min_likes", request.min_likes)

    # Insert collection record into BigQuery
    bq.insert_rows(
        "collections",
        [
            {
                "collection_id": collection_id,
                "user_id": user_id,
                "org_id": org_id,
                "session_id": session_id,
                "original_question": request.description,
                "config": json.dumps(config),
            }
        ],
    )

    # Create Firestore status document
    fs.create_collection_status(collection_id, user_id, config, org_id=org_id)

    # Track usage
    from api.services.usage_service import track_collection_created
    track_collection_created(user_id, org_id, collection_id, session_id=session_id)

    # Dispatch worker
    if settings.is_dev:
        logger.info(
            "DEV MODE: Running collection pipeline in background thread for %s",
            collection_id,
        )
        from workers.pipeline import run_pipeline
        thread = threading.Thread(
            target=run_pipeline,
            args=(collection_id,),
            daemon=True,
        )
        thread.start()
    else:
        _dispatch_cloud_task(settings, collection_id)

    return {
        "collection_id": collection_id,
        "status": "pending",
        "config": config,
    }



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

    # Atomically claim to prevent scheduler double-trigger
    if not fs.claim_for_run(collection_id):
        raise ValueError(
            f"Collection {collection_id} is already being processed by another trigger"
        )

    if settings.is_dev:
        from workers.pipeline import run_pipeline
        thread = threading.Thread(target=run_pipeline, args=(collection_id,), daemon=True)
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
            config=config,
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
            config=config,
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
    worker_url = settings.worker_service_url.rstrip("/")
    http_request = {
        "http_method": tasks_v2.HttpMethod.POST,
        "url": f"{worker_url}/collection/run",
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"collection_id": collection_id}).encode(),
    }
    if settings.cloud_tasks_service_account:
        http_request["oidc_token"] = {
            "service_account_email": settings.cloud_tasks_service_account,
            "audience": worker_url,
        }
    task = {"http_request": http_request}
    client.create_task(parent=parent, task=task)
    logger.info("Dispatched Cloud Task for collection %s", collection_id)
