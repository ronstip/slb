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
                        recovered = recover_stale_pipelines(
                            max_age_minutes=settings.pipeline_stall_threshold_minutes,
                        )
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

                    # Recover agents whose continuation died mid-flight.
                    try:
                        from workers.agent_continuation import recover_stuck_agents
                        recovered_agents = recover_stuck_agents()
                        if recovered_agents:
                            logger.info("Scheduler: recovered %d stuck agent(s)", recovered_agents)
                    except Exception:
                        logger.exception("Scheduler: stuck agent recovery failed")

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


def _check_due_watches(fs, settings) -> None:
    """Dispatch a Cloud Task per due Watch (docs/alerts/watch-system-spec.md §6).

    One task per watch keeps failures isolated. Each watch is 'claimed' by advancing
    its next_eval_at on dispatch so an overlapping tick can't double-dispatch while the
    eval is in flight; the evaluator then writes the authoritative next_eval_at.
    """
    from datetime import datetime, timedelta, timezone

    due = fs.get_due_watches()
    if not due:
        return
    logger.info("Scheduler: %d watch(es) due", len(due))

    now = datetime.now(timezone.utc)
    for watch in due:
        uid = watch.get("owner_uid")
        watch_id = watch.get("watch_id")
        if not uid or not watch_id:
            continue
        try:
            # Claim: push next_eval_at out so a concurrent tick won't re-pick this up.
            lease = now + timedelta(seconds=int(watch.get("eval_interval_sec") or 3600))
            fs.update_watch(uid, watch_id, next_eval_at=lease)
            _dispatch_watch_eval(fs, settings, uid, watch_id)
        except Exception:
            logger.exception("Scheduler: failed to dispatch watch %s/%s", uid, watch_id)


def _dispatch_watch_eval(fs, settings, uid: str, watch_id: str) -> None:
    """Dispatch (prod) or run inline (dev) a single watch evaluation."""
    payload = {"uid": uid, "watch_id": watch_id}
    if getattr(settings, "worker_service_url", None):
        from api.services.cloud_tasks import dispatch_worker_task
        dispatch_worker_task("/watches/evaluate", payload)
        return
    # Dev mode: run inline (no worker service configured).
    from api.deps import get_bq
    from workers.watches.runner import evaluate_watch_by_id
    try:
        evaluate_watch_by_id(uid, watch_id, bq=get_bq(), fs=fs)
    except Exception:
        logger.exception("Inline watch eval failed for %s/%s", uid, watch_id)


def _dispatch_recurring_agent_run(fs, settings, agent_id: str, agent: dict) -> None:
    """Create new collections for a recurring agent run and dispatch pipelines."""
    from api.services.agent_service import dispatch_agent_run

    fs.add_agent_log(agent_id, "Scheduled run triggered by scheduler", source="scheduler")
    run_id, collection_ids = dispatch_agent_run(agent_id, agent, trigger="scheduled")
    logger.info("Recurring agent %s: dispatched run %s with %d collections", agent_id, run_id, len(collection_ids))
