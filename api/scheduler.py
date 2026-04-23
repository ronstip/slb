"""Background scheduler for recurring agents (dev mode).

In production, Cloud Scheduler calls POST /internal/scheduler/tick instead.
"""

import logging
import threading
import time

from config.settings import get_settings

logger = logging.getLogger(__name__)


class OngoingScheduler:
    """Daemon thread that checks for due recurring agents."""

    def __init__(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True, name="ongoing-scheduler")

    def start(self) -> None:
        self._thread.start()
        logger.info("OngoingScheduler started")

    def _run(self) -> None:
        from workers.shared.firestore_client import FirestoreClient

        settings = get_settings()
        fs = FirestoreClient(settings)
        ticks_since_stale_check = 0
        ticks_since_agent_check = 0

        while True:
            time.sleep(15)
            try:
                # Periodic stale pipeline recovery (every ~5 minutes = 20 ticks)
                ticks_since_stale_check += 1
                if ticks_since_stale_check >= 20:
                    ticks_since_stale_check = 0
                    try:
                        from workers.pipeline import recover_stale_pipelines
                        recovered = recover_stale_pipelines(max_age_minutes=60)
                        if recovered:
                            logger.info("Scheduler: recovered %d stale pipeline(s)", recovered)
                    except Exception:
                        logger.exception("Scheduler: stale pipeline recovery failed")

                    # Recover any pending BrightData snapshots from crashed pipelines
                    try:
                        from workers.recovery import recover_snapshots
                        recovered_snaps = recover_snapshots()
                        if recovered_snaps:
                            logger.info("Scheduler: recovered %d BD snapshot(s)", recovered_snaps)
                    except Exception:
                        logger.exception("Scheduler: snapshot recovery failed")

                # Check due recurring agents (every ~60 seconds = 4 ticks)
                ticks_since_agent_check += 1
                if ticks_since_agent_check >= 4:
                    ticks_since_agent_check = 0
                    try:
                        _check_due_agents(fs, settings)
                    except Exception:
                        logger.exception("Scheduler: recurring agent check failed")

            except Exception:
                logger.exception("OngoingScheduler tick failed")


def _check_due_agents(fs, settings) -> None:
    """Check for recurring agents that are due for their next run."""
    due_agents = fs.get_due_recurring_agents()
    if not due_agents:
        return

    logger.info("Scheduler: %d recurring agent(s) due", len(due_agents))

    for agent_doc in due_agents:
        agent_id = agent_doc.get("agent_id")
        if not agent_id:
            continue

        try:
            _dispatch_recurring_agent_run(fs, settings, agent_id, agent_doc)
        except Exception:
            logger.exception("Scheduler: failed to dispatch recurring agent %s", agent_id)


def _dispatch_recurring_agent_run(fs, settings, agent_id: str, agent: dict) -> None:
    """Create new collections for a recurring agent run and dispatch pipelines."""
    from api.services.agent_service import dispatch_agent_run

    fs.add_agent_log(agent_id, "Scheduled run triggered by scheduler", source="scheduler")
    run_id, collection_ids = dispatch_agent_run(agent_id, agent, trigger="scheduled")
    logger.info("Recurring agent %s: dispatched run %s with %d collections", agent_id, run_id, len(collection_ids))
