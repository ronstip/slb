"""Internal/unauthenticated endpoints: scheduler tick and agent continuation.

Invoked by Cloud Scheduler and Cloud Tasks in production; no user-facing
auth. Access control is enforced at the GCP/IAM layer, not here.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from api.deps import get_fs
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/internal/scheduler/tick")
async def scheduler_tick():
    """Check for due recurring agents and dispatch them.

    Called by Cloud Scheduler in production (every 5 minutes).
    """
    settings = get_settings()
    fs = get_fs()

    from api.scheduler import _check_due_agents
    try:
        _check_due_agents(fs, settings)
    except Exception:
        # A failed tick shouldn't poison Cloud Scheduler retries — log and
        # return ok so the scheduler keeps its cadence.
        logger.exception("Scheduler tick: recurring agent check failed")

    return {"status": "ok"}


@router.post("/internal/agent/continue")
async def agent_continue(request: dict):
    """Continue an agent after all collections complete.

    Blocking: the continuation is awaited in-request so the Cloud Run
    instance stays alive for the duration (up to the sl-api service
    timeout, currently 3600s).

    Idempotency for Cloud Tasks retries (dispatch_deadline is 30 min, but
    real continuations commonly run 30-50 min, so retries land while the
    original attempt is still working):

    - ``continuation_ready`` is TRUE only before the first attempt enters.
      First attempt flips it to FALSE, then does the work.
    - A retry arriving while the original is alive sees ``continuation_ready=FALSE``
      and a fresh ``updated_at`` (the continuation touches it on every tool event).
      It skips.
    - A retry arriving after the original instance died (no exception, no
      completion — e.g. Cloud Run evicted the container) sees a stale
      ``updated_at``. It takes over.

    Staleness threshold is 5 min. Tool events in ``_emit_activity`` write
    to the agent log subcollection, which does NOT touch the parent doc,
    but ``update_todos`` tool calls and many other internal writes update
    the parent agent doc regularly. For a live run, ``updated_at`` is
    almost always < 5 min old.
    """
    agent_id = request.get("agent_id")
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id required")

    fs = get_fs()
    agent = fs.get_agent(agent_id)
    if not agent:
        return {"ok": True, "agent_id": agent_id, "skipped": True, "reason": "not_found"}

    if agent.get("status") != "running":
        logger.info(
            "Agent %s: skipping — status=%s (terminal)",
            agent_id, agent.get("status"),
        )
        return {"ok": True, "agent_id": agent_id, "skipped": True, "reason": "terminal"}

    if agent.get("continuation_ready"):
        fs.update_agent(agent_id, continuation_ready=False)
    else:
        # Retry: liveness check. If the previous attempt is still active,
        # skip; otherwise assume it's dead and take over.
        LIVENESS_WINDOW_MIN = 5
        updated_at = agent.get("updated_at")
        if isinstance(updated_at, str):
            try:
                updated_at = datetime.fromisoformat(updated_at)
            except ValueError:
                updated_at = None
        if updated_at and updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if updated_at and (now - updated_at) < timedelta(minutes=LIVENESS_WINDOW_MIN):
            logger.info(
                "Agent %s: skipping retry — previous attempt still active (updated %ss ago)",
                agent_id, int((now - updated_at).total_seconds()),
            )
            return {"ok": True, "agent_id": agent_id, "skipped": True, "reason": "in_flight"}
        logger.warning(
            "Agent %s: previous attempt appears dead (updated_at=%s) — taking over",
            agent_id, updated_at,
        )

    from workers.agent_continuation import _async_agent_continuation
    try:
        await _async_agent_continuation(agent_id)
    except Exception:
        # Continuation failed terminally — mark the agent so the UI shows
        # a clean failure state instead of a perpetual 'running'.
        logger.exception("Agent continuation failed for %s", agent_id)
        fs.update_agent(
            agent_id,
            status="failed",
            context_summary="Agent continuation failed after collection completion.",
        )
        return {"ok": False, "agent_id": agent_id, "error": "continuation_failed"}

    return {"ok": True, "agent_id": agent_id}
