"""Background scheduler for ongoing collections (dev mode).

In production, Cloud Scheduler calls POST /internal/scheduler/tick instead.
"""

import logging
import threading
import time

from config.settings import get_settings

logger = logging.getLogger(__name__)


class OngoingScheduler:
    """Daemon thread that checks for due ongoing collections and recurring tasks."""

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
        ticks_since_task_check = 0

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

                # Check due ongoing collections
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

                # Check due recurring tasks (every ~60 seconds = 4 ticks)
                ticks_since_task_check += 1
                if ticks_since_task_check >= 4:
                    ticks_since_task_check = 0
                    try:
                        _check_due_tasks(fs, settings)
                    except Exception:
                        logger.exception("Scheduler: recurring task check failed")

            except Exception:
                logger.exception("OngoingScheduler tick failed")


def _check_due_tasks(fs, settings) -> None:
    """Check for recurring tasks that are due for their next run."""
    from datetime import datetime, timezone

    due_tasks = fs.get_due_recurring_tasks()
    if not due_tasks:
        return

    logger.info("Scheduler: %d recurring task(s) due", len(due_tasks))

    for task_doc in due_tasks:
        task_id = task_doc.get("task_id")
        if not task_id:
            continue

        try:
            _dispatch_recurring_task_run(fs, settings, task_id, task_doc)
        except Exception:
            logger.exception("Scheduler: failed to dispatch recurring task %s", task_id)


def _dispatch_recurring_task_run(fs, settings, task_id: str, task: dict) -> None:
    """Create new collections for a recurring task run and dispatch pipelines."""
    from api.services.task_service import dispatch_task_run

    fs.add_task_log(task_id, "Scheduled run triggered by scheduler", source="scheduler")
    collection_ids = dispatch_task_run(task_id, task)
    logger.info("Recurring task %s: dispatched %d collections", task_id, len(collection_ids))
