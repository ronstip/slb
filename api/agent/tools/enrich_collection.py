import logging
import threading

from config.settings import get_settings
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)


def enrich_collection(
    collection_id: str = "",
    post_ids: str = "",
) -> dict:
    """Run AI enrichment on collected posts to extract sentiment, themes, and generate embeddings.

    Supports two input modes:
    - Provide collection_id to enrich all qualifying posts in a collection.
    - Provide post_ids (comma-separated) to enrich specific posts.

    Enrichment uses BQ integrated LLMs (AI.GENERATE_TEXT and AI.GENERATE_EMBEDDING).
    Only posts with >= 30 likes will be enriched. This is required before get_insights
    can return sentiment, theme, and entity data.

    Args:
        collection_id: The collection ID to enrich. Provide this OR post_ids.
        post_ids: Comma-separated post IDs to enrich. Provide this OR collection_id.

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
        fs = FirestoreClient(settings)
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
                daemon=True,
            )
            thread.start()
            return {
                "status": "success",
                "collection_id": collection_id,
                "message": (
                    f"Enrichment started for collection {collection_id}. "
                    "Use get_progress to check enrichment status. "
                    "Once complete, use get_insights for full analysis."
                ),
            }
    else:
        _dispatch_enrichment_task(settings, collection_id, post_ids)
        return {
            "status": "success",
            "message": "Enrichment task dispatched.",
        }


def _dispatch_enrichment_task(settings, collection_id: str, post_ids: str) -> None:
    """Dispatch enrichment worker via Cloud Tasks."""
    import json
    from google.cloud import tasks_v2

    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(
        settings.gcp_project_id,
        settings.gcp_region,
        settings.cloud_tasks_queue,
    )
    payload = {"collection_id": collection_id}
    if post_ids:
        payload["post_ids"] = [p.strip() for p in post_ids.split(",") if p.strip()]

    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"https://enrichment-worker-{settings.gcp_project_id}.run.app/run",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload).encode(),
        }
    }
    client.create_task(parent=parent, task=task)
    logger.info("Dispatched Cloud Task for enrichment")
