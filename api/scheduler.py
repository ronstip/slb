"""Background scheduler for ongoing collections (dev mode).

In production, Cloud Scheduler calls POST /internal/scheduler/tick instead.
"""

import logging
import threading
import time

from config.settings import get_settings

logger = logging.getLogger(__name__)


class OngoingScheduler:
    """Daemon thread that checks for due ongoing collections every 60 seconds."""

    def __init__(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True, name="ongoing-scheduler")

    def start(self) -> None:
        self._thread.start()
        logger.info("OngoingScheduler started")

    def _run(self) -> None:
        from workers.pipeline import run_pipeline as _run_pipeline
        from workers.shared.firestore_client import FirestoreClient

        settings = get_settings()
        fs = FirestoreClient(settings)

        while True:
            time.sleep(15)
            try:
                due = fs.get_due_ongoing_collections()
                if due:
                    logger.info("Scheduler: %d ongoing collection(s) due for next run", len(due))
                for doc in due:
                    collection_id = doc["collection_id"]
                    # Atomically claim (prevents race with manual trigger or concurrent tick)
                    if not fs.claim_for_run(collection_id):
                        logger.info("Scheduler: collection %s already claimed, skipping", collection_id)
                        continue
                    thread = threading.Thread(
                        target=_run_pipeline,
                        args=(collection_id,),
                        daemon=True,
                        name=f"pipeline-{collection_id[:8]}",
                    )
                    thread.start()
                    logger.info("Scheduler: dispatched pipeline for collection %s", collection_id)
            except Exception:
                logger.exception("OngoingScheduler tick failed")
