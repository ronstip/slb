"""Collection pipeline — post-level DAG.

Public API (backward-compatible with the pre-rename `workers.pipeline` module):
- `run_pipeline(collection_id, continuation=False)` — synchronous entry point
- `dispatch_collection_pipeline(collection_id, continuation=False)` — dev-mode thread dispatch or prod Cloud Task dispatch
- `recover_stale_pipelines(max_age_minutes=10)` — scheduler-driven recovery
"""

import json
import logging
import threading

from config.settings import get_settings

logger = logging.getLogger(__name__)


def run_pipeline(collection_id: str, continuation: bool = False) -> None:
    """Run the post-level DAG pipeline for a collection.

    When `continuation=True`, the runner skips the crawl phase and picks up
    remaining non-terminal posts — used when the prior run hit the soft
    timeout and self-rescheduled.
    """
    from workers.pipeline.runner import PipelineRunner
    PipelineRunner(collection_id, continuation=continuation).run()


def dispatch_collection_pipeline(collection_id: str, continuation: bool = False) -> None:
    """Dispatch the pipeline for a collection (dev thread or prod Cloud Task)."""
    settings = get_settings()
    if settings.is_dev:
        thread = threading.Thread(
            target=run_pipeline,
            args=(collection_id,),
            kwargs={"continuation": continuation},
            daemon=True,
        )
        thread.start()
        logger.info(
            "Dispatched pipeline thread for %s (continuation=%s)", collection_id, continuation,
        )
        return

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
        "body": json.dumps({"collection_id": collection_id, "continuation": continuation}).encode(),
    }
    if settings.cloud_tasks_service_account:
        http_request["oidc_token"] = {
            "service_account_email": settings.cloud_tasks_service_account,
            "audience": worker_url,
        }
    task = {
        "http_request": http_request,
        "dispatch_deadline": {"seconds": 1800},
    }
    client.create_task(parent=parent, task=task)
    logger.info(
        "Dispatched Cloud Task pipeline for %s (continuation=%s)", collection_id, continuation,
    )


def recover_stale_pipelines(max_age_minutes: int = 10) -> int:
    """Detect and recover pipelines stuck in active states.

    If the collection has partial data (posts_collected > 0), mark as
    success-with-partial so the agent continuation can still run analysis.
    Otherwise mark as failed.

    Returns the number of collections recovered. Called periodically by the
    scheduler to catch orphaned pipelines left behind by process crashes.
    """
    from workers.shared.firestore_client import FirestoreClient

    settings = get_settings()
    fs = FirestoreClient(settings)
    stale = fs.get_stale_pipelines(max_age_minutes=max_age_minutes)

    if not stale:
        return 0

    recovered = 0
    for entry in stale:
        cid = entry["collection_id"]
        try:
            posts_collected = entry.get("posts_collected", 0) or 0
            posts_enriched = entry.get("posts_enriched", 0) or 0

            if posts_collected > 0:
                status = "success"
                if posts_enriched > 0:
                    error_message = (
                        f"Pipeline was interrupted with {posts_collected} posts collected "
                        f"and {posts_enriched} enriched. Partial data is available."
                    )
                else:
                    error_message = (
                        f"Pipeline was interrupted after collecting {posts_collected} posts. "
                        f"Partial data is available."
                    )
            else:
                status = "failed"
                error_message = (
                    f"Pipeline was stuck in '{entry['status']}' for over "
                    f"{max_age_minutes} minutes with no progress."
                )

            fs.update_collection_status(
                cid, status=status, error_message=error_message,
            )

            task_id = entry.get("task_id")
            if task_id:
                try:
                    fs.add_task_log(
                        task_id,
                        f"Collection {cid[:8]} recovered with {posts_collected} posts (pipeline was interrupted)",
                        source="recovery", level="warning",
                    )
                except Exception:
                    logger.debug(
                        "Failed to add task log for recovered pipeline %s", cid, exc_info=True,
                    )

            try:
                from workers.agent_continuation import check_agent_completion
                check_agent_completion(cid)
            except Exception:
                logger.exception("Agent continuation check failed for recovered pipeline %s", cid)

            logger.warning(
                "Recovered stale pipeline %s (was %s, posts=%d) → %s",
                cid, entry["status"], posts_collected, status,
            )
            recovered += 1
        except Exception:
            logger.exception("Failed to recover stale pipeline %s", cid)

    return recovered
