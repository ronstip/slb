"""Schedule parsing and next-run computation for ongoing collections.

Extracted from workers/pipeline.py and api/services/collection_service.py
where this logic was duplicated.
"""

import re
from datetime import datetime, timedelta


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
        candidate = from_time + timedelta(hours=interval)
        return candidate.replace(second=0, microsecond=0)

    assert hour is not None and minute is not None
    candidate = from_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
    candidate += timedelta(days=interval)
    while candidate <= from_time:
        candidate += timedelta(days=1)
    return candidate


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
