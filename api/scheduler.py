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
        ticks_since_stale_check = 0

        while True:
            time.sleep(15)
            try:
                # Periodic stale pipeline recovery (every ~5 minutes = 20 ticks)
                ticks_since_stale_check += 1
                if ticks_since_stale_check >= 20:
                    ticks_since_stale_check = 0
                    try:
                        from workers.pipeline_v2.pipeline import recover_stale_pipelines
                        recovered = recover_stale_pipelines(max_age_minutes=60)
                        if recovered:
                            logger.info("Scheduler: recovered %d stale pipeline(s)", recovered)
                    except Exception:
                        logger.exception("Scheduler: stale pipeline recovery failed")

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
