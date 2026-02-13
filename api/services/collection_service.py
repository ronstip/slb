"""Shared collection creation logic used by both the agent tool and the REST API."""

import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from api.schemas.requests import CreateCollectionRequest
from config.settings import get_settings
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)


def create_collection_from_request(request: CreateCollectionRequest) -> dict:
    """Create a collection from a frontend modal request.

    This replicates the logic from start_collection tool but is callable
    from the REST API without going through the agent.
    """
    settings = get_settings()
    bq = BQClient(settings)
    fs = FirestoreClient(settings)

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
        "max_posts_per_platform": request.max_posts_per_platform,
        "include_comments": request.include_comments,
        "geo_scope": request.geo_scope,
    }

    # Insert collection record into BigQuery
    bq.insert_rows(
        "collections",
        [
            {
                "collection_id": collection_id,
                "user_id": request.user_id,
                "session_id": "",
                "original_question": request.description,
                "config": json.dumps(config),
            }
        ],
    )

    # Create Firestore status document
    fs.create_collection_status(collection_id, request.user_id, config)

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
    from workers.collection.worker import run_collection
    from workers.enrichment.worker import run_enrichment

    try:
        run_collection(collection_id)
    except Exception:
        logger.exception("Collection pipeline failed for %s", collection_id)
        return

    # Auto-trigger enrichment after successful collection
    settings = get_settings()
    fs = FirestoreClient(settings)
    status = fs.get_collection_status(collection_id)
    if status and status.get("status") == "completed":
        try:
            run_enrichment(collection_id)
        except Exception:
            logger.exception("Enrichment pipeline failed for %s", collection_id)


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
