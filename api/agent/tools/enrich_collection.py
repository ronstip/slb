import logging
import threading

from api.deps import get_fs
from config.settings import get_settings

logger = logging.getLogger(__name__)


def enrich_collection(
    collection_id: str = "",
    post_ids: str = "",
    min_likes: int = 0,
) -> dict:
    """Run AI enrichment on collected posts to extract sentiment, emotion, themes, entities, and more.

    Supports two input modes:
    - Provide collection_id to enrich all qualifying posts in a collection.
    - Provide post_ids (comma-separated) to enrich specific posts.

    Enrichment uses Gemini (multimodal — analyzes text, images, and video).
    Posts are filtered by min_likes (default 0 = enrich all). This is required before
    analysis queries can return sentiment, theme, and entity data.

    If the collection has custom_fields defined in its config, those are extracted
    alongside the standard fields and stored in the custom_fields JSON column.

    IMPORTANT: Always get explicit user approval before running enrichment.

    Args:
        collection_id: The collection ID to enrich. Provide this OR post_ids.
        post_ids: Comma-separated post IDs to enrich. Provide this OR collection_id.
        min_likes: Minimum likes threshold for enrichment. Default 0 (enrich all).

    Returns:
        A dictionary confirming enrichment has started.
    """
    if not collection_id and not post_ids:
        return {
            "status": "error",
            "message": "Provide either collection_id or post_ids.",
        }

    settings = get_settings()

    if collection_id:
        fs = get_fs()
        status = fs.get_collection_status(collection_id)
        if not status:
            return {
                "status": "error",
                "message": f"Collection {collection_id} not found.",
            }

    if settings.is_dev:
        if post_ids:
            ids = [p.strip() for p in post_ids.split(",") if p.strip()]
            logger.info("DEV MODE: Running enrichment for %d posts in background", len(ids))
            from workers.enrichment.worker import run_enrichment_for_posts

            thread = threading.Thread(
                target=run_enrichment_for_posts,
                args=(ids,),
                kwargs={"min_likes": min_likes, "collection_id": collection_id},
                daemon=True,
            )
            thread.start()
            return {
                "status": "success",
                "message": f"Enrichment started for {len(ids)} specific posts.",
            }
        else:
            logger.info("DEV MODE: Running enrichment for collection %s in background", collection_id)
            from workers.enrichment.worker import run_enrichment

            thread = threading.Thread(
                target=run_enrichment,
                args=(collection_id,),
                kwargs={"min_likes": min_likes},
                daemon=True,
            )
            thread.start()
            return {
                "status": "success",
                "collection_id": collection_id,
                "message": (
                    f"Enrichment started for collection {collection_id}. "
                    "Use get_progress to check enrichment status. "
                    "Once complete, run queries to analyze the data."
                ),
            }
    else:
        _dispatch_enrichment_task(settings, collection_id, post_ids, min_likes)
        return {
            "status": "success",
            "message": "Enrichment task dispatched.",
        }


def _dispatch_enrichment_task(settings, collection_id: str, post_ids: str, min_likes: int = 0) -> None:
    """Dispatch enrichment worker via Cloud Tasks."""
    import json
    from google.cloud import tasks_v2

    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(
        settings.gcp_project_id,
        settings.gcp_region,
        settings.cloud_tasks_queue,
    )
    payload = {"collection_id": collection_id, "min_likes": min_likes}
    if post_ids:
        payload["post_ids"] = [p.strip() for p in post_ids.split(",") if p.strip()]

    worker_url = settings.worker_service_url.rstrip("/")
    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{worker_url}/enrichment/run",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload).encode(),
        }
    }
    client.create_task(parent=parent, task=task)
    logger.info("Dispatched Cloud Task for enrichment")
