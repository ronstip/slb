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
        "n_posts": request.n_posts,
        "max_posts_per_keyword": (
            __import__("math").ceil(request.n_posts / (max(len(request.platforms), 1) * max(len(request.keywords), 1)))
            if request.n_posts > 0 else None
        ),
        "include_comments": request.include_comments,
        "geo_scope": request.geo_scope,
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
    task = {
        "http_request": http_request,
        # Match the Cloud Run worker timeout (3600s) so Cloud Tasks doesn't
        # time out and retry before the pipeline finishes.
        "dispatch_deadline": {"seconds": 3600},
    }
    client.create_task(parent=parent, task=task)
    logger.info("Dispatched Cloud Task for collection %s", collection_id)
