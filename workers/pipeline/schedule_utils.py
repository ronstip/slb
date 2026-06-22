"""Schedule parsing and next-run computation for ongoing collections.

Extracted from workers/pipeline.py and api/services/collection_service.py
where this logic was duplicated.
"""

import re
from datetime import datetime, timedelta, timezone

# A recurring agent rests at "success" after a normal run (set by
# agent_continuation); "None" covers never-run agents. Every other status means
# the agent is mid-run, archived, or failed — none of which should auto-start a
# new run. (Deliberately an allowlist: broadening it to also reschedule
# "failed"/legacy "completed" agents resurrects dormant agents and hourly-
# retries genuinely-broken ones — see docs/bugs/api-recurring-schedule-never-fires.md.)
SCHEDULABLE_STATUSES = frozenset({None, "success"})


# A day schedule carries one or more clock times: "1d@09:00" (daily) or
# "1d@09:00,21:00" (twice a day). The list generalises the original single-time
# form — "N times a day" is just more entries.
_DAY_RE = re.compile(r"^(\d+)d@(\d{2}:\d{2}(?:,\d{2}:\d{2})*)$")


def parse_day_times(schedule: str | None) -> tuple[int, list[tuple[int, int]]]:
    """Return (interval_days, [(hour_utc, minute_utc), ...]) for a day schedule.

    Times are sorted ascending. Non-day schedules return interval 1 with the
    default 09:00 slot — callers gate on unit before using this.
    """
    if not schedule or schedule == "daily":
        return (1, [(9, 0)])
    if schedule == "weekly":
        return (7, [(9, 0)])
    m = _DAY_RE.match(schedule)
    if m:
        times = sorted(
            (int(h), int(mm))
            for h, mm in (part.split(":") for part in m.group(2).split(","))
        )
        return (int(m.group(1)), times)
    return (1, [(9, 0)])


def parse_schedule(schedule: str | None) -> tuple[str, int, int | None, int | None]:
    """Return (unit, interval, hour_utc, minute_utc) for a schedule string.

    Supported formats:
      "daily"           -> ("d", 1, 9, 0)
      "weekly"          -> ("d", 7, 9, 0)
      "Nm"              -> ("m", N, None, None)   e.g. "30m"
      "Nh"              -> ("h", N, None, None)   e.g. "2h"
      "Nd@HH:MM"        -> ("d", N, HH, MM)      e.g. "1d@09:00"
      "Nd@HH:MM,HH:MM"  -> ("d", N, HH, MM)      e.g. "1d@09:00,21:00"

    For multi-time day schedules, the hour/minute reflect the first (earliest)
    slot; use ``parse_day_times`` for the full list.
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
    if _DAY_RE.match(schedule):
        interval, times = parse_day_times(schedule)
        return ("d", interval, times[0][0], times[0][1])
    return ("d", 1, 9, 0)


def compute_next_run_at(schedule: str | None, from_time: datetime) -> datetime:
    """Return the next future run datetime for the given schedule."""
    unit, interval, _, _ = parse_schedule(schedule)

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

    interval, times = parse_day_times(schedule)
    candidates: list[datetime] = []
    for hour, minute in times:
        candidate = from_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if len(times) > 1:
            # Multi-time (twice-a-day): the soonest of the day's slots that is
            # still in the future — today's later slot, or tomorrow's first one.
            # No forced full-day skip, or the second slot would never fire.
            while candidate <= from_time:
                candidate += timedelta(days=interval)
        else:
            # Single-time daily/weekly: always at least one interval ahead
            # (preserves long-standing behaviour — never double-runs the day
            # the schedule is set, and lands weekly ~a week out).
            candidate += timedelta(days=interval)
            while candidate <= from_time:
                candidate += timedelta(days=1)
        candidates.append(candidate)
    return min(candidates)


def is_recurring_agent_due(agent: dict, now: datetime) -> bool:
    """Return True if this recurring agent should be dispatched at ``now``.

    Eligible when the agent is recurring, not paused, rests at a schedulable
    status (``success`` or never-run), and its ``next_run_at`` is in the past.

    This is the gate for the schedule mechanism (``get_due_recurring_agents``).
    """
    if agent.get("agent_type") != "recurring":
        return False
    if agent.get("paused"):
        return False
    if agent.get("status") not in SCHEDULABLE_STATUSES:
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
        or _DAY_RE.match(schedule)
    )
