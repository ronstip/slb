"""Schedule parsing and next-run computation for ongoing collections.

Extracted from workers/pipeline.py and api/services/collection_service.py
where this logic was duplicated.
"""

import re
from datetime import datetime, timedelta, timezone

# Agent statuses that mean a run is actively in flight. A recurring agent in
# any of these must NOT be dispatched again — that would start a second
# concurrent run on top of the live one.
ACTIVE_STATUSES = frozenset(
    {
        "running",
        "executing",
        "analyzing",
        "collecting",
        "enriching",
        "processing",
        "building",
        "queued",
        "in_progress",
    }
)


def parse_schedule(schedule: str | None) -> tuple[str, int, int | None, int | None]:
    """Return (unit, interval, hour_utc, minute_utc) for a schedule string.

    Supported formats:
      "daily"         -> ("d", 1, 9, 0)
      "weekly"        -> ("d", 7, 9, 0)
      "Nm"            -> ("m", N, None, None)   e.g. "30m"
      "Nh"            -> ("h", N, None, None)   e.g. "2h"
      "Nd@HH:MM"      -> ("d", N, HH, MM)      e.g. "1d@09:00"
    """
    if not schedule or schedule == "daily":
        return ("d", 1, 9, 0)
    if schedule == "weekly":
        return ("d", 7, 9, 0)
    m = re.match(r"^(\d+)m$", schedule)
    if m:
        return ("m", int(m.group(1)), None, None)
    m = re.match(r"^(\d+)h$", schedule)
    if m:
        return ("h", int(m.group(1)), None, None)
    m = re.match(r"^(\d+)d@(\d{2}):(\d{2})$", schedule)
    if m:
        return ("d", int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return ("d", 1, 9, 0)


def compute_next_run_at(schedule: str | None, from_time: datetime) -> datetime:
    """Return the next future run datetime for the given schedule."""
    unit, interval, hour, minute = parse_schedule(schedule)

    if unit == "m":
        candidate = from_time + timedelta(minutes=interval)
        return candidate.replace(second=0, microsecond=0)
    if unit == "h":
        # Align to the top of the hour: a schedule set at 14:42 first runs at
        # ~15:00, then every `interval` hours on the hour. Truncate to the
        # current hour, then advance — so an on-the-hour from_time still rolls
        # forward (14:00 -> 15:00) instead of returning itself.
        base = from_time.replace(minute=0, second=0, microsecond=0)
        return base + timedelta(hours=interval)

    assert hour is not None and minute is not None
    candidate = from_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
    candidate += timedelta(days=interval)
    while candidate <= from_time:
        candidate += timedelta(days=1)
    return candidate


def is_recurring_agent_due(agent: dict, now: datetime) -> bool:
    """Return True if this recurring agent should be dispatched at ``now``.

    Eligible when the agent is recurring, not paused, not archived, not
    currently mid-run, and its ``next_run_at`` is in the past.

    This is the gate for the schedule mechanism (``get_due_recurring_agents``).
    It deliberately uses a *denylist* of in-flight / disabled statuses rather
    than an allowlist: a recurring agent rests in a variety of terminal
    statuses ("success", "completed") and can be stranded in "failed" by a
    transient error. An allowlist of only ("success",) silently excluded all
    of those, so schedules never fired again after the first run. A recurring
    monitor is expected to keep trying on schedule, including a retry after a
    failed run.
    """
    if agent.get("agent_type") != "recurring":
        return False
    if agent.get("paused"):
        return False

    status = agent.get("status")
    if status in ACTIVE_STATUSES or status == "archived":
        return False

    next_run_at = agent.get("next_run_at")
    if next_run_at is None or not hasattr(next_run_at, "isoformat"):
        return False
    if getattr(next_run_at, "tzinfo", None) is None:
        next_run_at = next_run_at.replace(tzinfo=timezone.utc)
    return next_run_at <= now


def is_valid_schedule(schedule: str | None) -> bool:
    """Return True if the schedule string is a recognized format."""
    if not schedule:
        return False
    if schedule in ("daily", "weekly"):
        return True
    return bool(
        re.match(r"^(\d+)m$", schedule)
        or re.match(r"^(\d+)h$", schedule)
        or re.match(r"^(\d+)d@(\d{2}):(\d{2})$", schedule)
    )
