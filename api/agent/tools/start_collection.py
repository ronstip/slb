import json
import logging
import threading
from uuid import uuid4

from config.settings import get_settings
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)


def start_collection(
    config_json: str,
    original_question: str,
    user_id: str,
    session_id: str,
) -> dict:
    """Start a data collection experiment by creating the collection record and dispatching the worker.

    Call this tool ONLY after the user has approved the research design from
    design_research. Pass the config JSON exactly as returned by design_research.

    Args:
        config_json: The collection config as a JSON string. This is the "config"
            field from the design_research result.
        original_question: The user's original research question.
        user_id: The user's ID from the session context.
        session_id: The current session ID from the session context.

    Returns:
        A dictionary with the collection_id and status.
    """
    settings = get_settings()
    bq = BQClient(settings)
    fs = FirestoreClient(settings)

    collection_id = str(uuid4())

    # Parse config
    if isinstance(config_json, str):
        config = json.loads(config_json)
    else:
        config = config_json

    # Insert collection record into BigQuery
    bq.insert_rows(
        "collections",
        [
            {
                "collection_id": collection_id,
                "user_id": user_id,
                "session_id": session_id,
                "original_question": original_question,
                "config": json.dumps(config),
            }
        ],
    )

    # Create Firestore status document
    fs.create_collection_status(collection_id, user_id, config)

    # Dispatch worker
    if settings.is_dev:
        logger.info("DEV MODE: Running collection pipeline in background thread for %s", collection_id)
        thread = threading.Thread(
            target=_run_pipeline,
            args=(collection_id,),
            daemon=True,
        )
        thread.start()
    else:
        _dispatch_cloud_task(settings, collection_id)

    return {
        "status": "success",
        "collection_id": collection_id,
        "message": (
            f"Collection {collection_id} has been started. "
            "It will run in the background — use get_progress to check status. "
            "Enrichment will run automatically after collection completes."
        ),
    }


def _run_pipeline(collection_id: str) -> None:
    """Run collection then enrichment as a single pipeline (dev mode)."""
    from workers.collection.worker import run_collection
    from workers.shared.firestore_client import FirestoreClient
    from config.settings import get_settings

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
            from workers.enrichment.worker import run_enrichment
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
