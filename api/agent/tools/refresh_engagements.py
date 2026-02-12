import logging

from config.settings import get_settings

logger = logging.getLogger(__name__)


def refresh_engagements(collection_id: str) -> dict:
    """Re-fetch the latest engagement metrics and comments for a collection.

    Call this tool when the user wants updated metrics (likes, views, comments)
    for posts that were already collected. This fetches fresh data from the
    social platforms and stores new snapshots.

    Args:
        collection_id: The collection ID to refresh engagements for.

    Returns:
        A dictionary confirming the refresh was dispatched.
    """
    settings = get_settings()

    if settings.is_dev:
        logger.info("DEV MODE: Running engagement refresh inline for %s", collection_id)
        from workers.engagement.worker import refresh_engagements as _refresh

        try:
            _refresh({"input_type": "collection_id", "collection_id": collection_id})
            return {
                "status": "success",
                "message": f"Engagement data refreshed for collection {collection_id}. Use get_insights to see updated results.",
            }
        except Exception as e:
            logger.exception("Inline engagement refresh failed for %s", collection_id)
            return {
                "status": "error",
                "message": f"Engagement refresh failed: {e}",
            }
    else:
        _dispatch_engagement_task(settings, collection_id)
        return {
            "status": "success",
            "message": f"Engagement refresh dispatched for collection {collection_id}. This may take a few minutes.",
        }


def _dispatch_engagement_task(settings, collection_id: str) -> None:
    """Dispatch engagement worker via Cloud Tasks."""
    import json

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
            "url": f"https://engagement-worker-{settings.gcp_project_id}.run.app/run",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(
                {"input_type": "collection_id", "collection_id": collection_id}
            ).encode(),
        }
    }
    client.create_task(parent=parent, task=task)
    logger.info("Dispatched Cloud Task for engagement refresh %s", collection_id)
