"""Classify whether an agent is stuck.

Pure logic - no IO. Used by the watchdog to decide which agents to retry,
and tested independently of Firestore.
"""

from datetime import datetime, timedelta, timezone

SIGNAL_ORPHANED_RUNNING = "orphaned_running"
SIGNAL_TERMINAL_INCONSISTENT = "terminal_inconsistent"
SIGNAL_MISSED_HANDOFF = "missed_handoff"


def _parse_ts(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            ts = datetime.fromisoformat(value)
        except ValueError:
            return None
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    return None


def classify_stuck(
    agent: dict,
    collection_statuses: list[dict] | None = None,
    *,
    now: datetime,
    stale_minutes: int = 10,
) -> str | None:
    """Decide whether `agent` is stuck, and which signal explains it.

    Signals (in priority order):
      - ``terminal_inconsistent``: status=success but completed_at missing.
        The continuation handoff was skipped entirely; analyze/report never
        ran. Caught agent 140a3591 (2026-05-18); see
        [docs/bugs/api-agent-stuck-terminal-inconsistent.md].
      - ``orphaned_running``: status=running, continuation entered
        (continuation_ready_at set) but the doc has not updated for
        ``stale_minutes`` - the continuation process died. When
        ``collection_statuses`` are provided and not all terminal, the run is
        still collecting/enriching (which doesn't bump the agent doc), so it
        is NOT orphaned - guards against a stale ``continuation_ready_at``
        carried over from a prior run. Caught agent f9022b29 (2026-06-16);
        see [docs/bugs/api-agent-false-orphaned-running.md].
      - ``missed_handoff``: status=running, all collections terminal, but
        continuation_ready_at was never set. Requires ``collection_statuses``
        to verify; returns None if not provided.

    Returns the signal name or None.
    """
    status = agent.get("status")
    updated_at = _parse_ts(agent.get("updated_at"))
    cutoff = now - timedelta(minutes=stale_minutes)

    if status == "success" and agent.get("completed_at") is None:
        if agent.get("collection_ids"):
            if updated_at is None or updated_at < cutoff:
                return SIGNAL_TERMINAL_INCONSISTENT
        return None

    if status == "running":
        if agent.get("continuation_ready_at"):
            if updated_at is not None and updated_at < cutoff:
                # Still collecting/enriching -> not orphaned, even if the doc
                # looks idle (enrichment writes logs to a subcollection, not
                # the agent doc). Only treat as orphaned once all collections
                # are terminal, i.e. continuation genuinely should have run.
                if collection_statuses is not None and agent.get("collection_ids"):
                    terminal = {"success", "failed"}
                    all_terminal = all(
                        (cs or {}).get("status") in terminal
                        for cs in collection_statuses
                    )
                    if not all_terminal:
                        return None
                return SIGNAL_ORPHANED_RUNNING
            return None

        if collection_statuses and agent.get("collection_ids"):
            terminal = {"success", "failed"}
            all_terminal = all(
                (cs or {}).get("status") in terminal for cs in collection_statuses
            )
            if all_terminal and (updated_at is None or updated_at < cutoff):
                return SIGNAL_MISSED_HANDOFF

    return None
