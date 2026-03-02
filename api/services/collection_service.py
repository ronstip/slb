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

    # Track usage
    from api.services.usage_service import track_collection_created
    track_collection_created(user_id, org_id, collection_id)

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


def _post_to_enrichment_data(post):
    """Convert a collection Post model to enrichment PostData (in-memory, no BQ read)."""
    from workers.enrichment.schema import MediaRef, PostData

    media_refs = []
    for ref in (post.media_refs or []):
        if isinstance(ref, dict) and ref.get("gcs_uri"):
            media_refs.append(MediaRef(
                gcs_uri=ref["gcs_uri"],
                media_type=ref.get("media_type", "image"),
                content_type=ref.get("content_type", "application/octet-stream"),
            ))

    return PostData(
        post_id=post.post_id,
        platform=post.platform,
        channel_handle=post.channel_handle,
        posted_at=post.posted_at.isoformat() if post.posted_at else None,
        title=post.title,
        content=post.content,
        media_refs=media_refs,
    )


def _run_pipeline(collection_id: str) -> None:
    """Run collection + parallel enrichment + embedding pipeline."""
    from concurrent.futures import ThreadPoolExecutor

    from google.cloud.firestore_v1 import transforms

    from workers.collection.worker import run_collection
    from workers.enrichment.worker import (
        run_enrichment_inline,
        update_enrichment_counts,
    )
    from workers.shared.firestore_client import FirestoreClient

    from workers.enrichment.schema import CustomFieldDef

    settings = get_settings()
    fs = FirestoreClient(settings)

    # Load custom field definitions from collection config
    status_doc = fs.get_collection_status(collection_id)
    custom_fields_defs = None
    if status_doc:
        config = status_doc.get("config") or {}
        raw_cf = config.get("custom_fields")
        if raw_cf:
            custom_fields_defs = [CustomFieldDef(**f) for f in raw_cf]

    # Thread pool for parallel enrichment batches
    enrichment_executor = ThreadPoolExecutor(max_workers=3)
    enrichment_futures = []

    def on_batch_complete(new_posts):
        """Callback from collection worker — fire enrichment for this batch."""
        post_data = [_post_to_enrichment_data(p) for p in new_posts]
        future = enrichment_executor.submit(
            run_enrichment_inline, post_data, collection_id, custom_fields_defs,
        )
        enrichment_futures.append(future)

    # Step 1: Collection (enrichment fires in parallel per batch via callback)
    try:
        run_collection(collection_id, on_batch_complete=on_batch_complete)
    except Exception:
        logger.exception("Collection pipeline failed for %s", collection_id)
        enrichment_executor.shutdown(wait=False)
        return

    # Check if collection was cancelled
    status = fs.get_collection_status(collection_id)
    if not status or status.get("status") not in ("completed", "collecting"):
        enrichment_executor.shutdown(wait=False)
        return

    # Step 2: Wait for all enrichment batches to complete
    enrichment_failed = False
    for future in enrichment_futures:
        try:
            future.result()
        except Exception:
            logger.exception("Enrichment batch failed for %s", collection_id)
            enrichment_failed = True
    enrichment_executor.shutdown()

    if enrichment_failed:
        fs.update_collection_status(
            collection_id, status="failed", error_message="One or more enrichment batches failed",
        )
        return

    # Step 3: Update enrichment counts in Firestore
    try:
        update_enrichment_counts(collection_id)
    except Exception:
        logger.exception("Failed to update enrichment counts for %s", collection_id)

    # Step 4: Embedding (BQ-native, unchanged)
    try:
        bq = get_bq()
        bq.query_from_file("batch_queries/batch_embed.sql", {
            "collection_id": collection_id,
            "post_ids": [],
        })
    except Exception:
        logger.exception("Embedding failed for %s", collection_id)

    # Step 5: Compute and persist statistical signature (non-fatal)
    try:
        from api.services.statistical_signature_service import refresh_statistical_signature

        bq = get_bq()
        refresh_statistical_signature(collection_id, bq, fs)
    except Exception:
        logger.exception("Statistical signature computation failed for %s", collection_id)

    # Step 6: Decide final status based on ongoing flag
    status = fs.get_collection_status(collection_id)
    config = (status or {}).get("config") or {}
    if config.get("ongoing"):
        schedule = config.get("schedule", "daily")
        now = datetime.now(timezone.utc)
        next_run_at = _compute_next_run_at(schedule, now)

        run_entry = {
            "run_at": now.isoformat(),
            "posts_added": (status or {}).get("posts_collected", 0),
            "status": "completed",
        }
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
    worker_url = settings.worker_service_url.rstrip("/")
    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{worker_url}/collection/run",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"collection_id": collection_id}).encode(),
        }
    }
    client.create_task(parent=parent, task=task)
    logger.info("Dispatched Cloud Task for collection %s", collection_id)
