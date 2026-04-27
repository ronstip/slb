"""Time-range gate — single source of truth for filtering posts by an agent's
configured date window.

Read by the pipeline before posts enter the enrichment/embedding state machine.
The matching SQL gate (`posted_at BETWEEN c.time_range_start AND c.time_range_end`)
lives in `bigquery/export_queries/underlying_data.sql` and `dashboard_service.py`
— both read from the same `collections.time_range_start/end` columns.
"""

from datetime import datetime, timezone


def parse_time_range(config: dict) -> tuple[datetime, datetime] | None:
    """Pull (start, end) from collection config; None if missing/malformed."""
    tr = (config or {}).get("time_range") or {}
    start_raw = tr.get("start")
    end_raw = tr.get("end")
    if not start_raw or not end_raw:
        return None
    try:
        start = _parse_iso(start_raw)
        end = _parse_iso(end_raw)
    except ValueError:
        return None
    return start, end


def is_in_range(post, time_range: tuple[datetime, datetime]) -> bool:
    """In-range iff posted_at is set AND start <= posted_at <= end.

    Posts with no posted_at are out of range — we can't verify, we drop.
    """
    posted_at = getattr(post, "posted_at", None)
    if posted_at is None:
        return False
    if isinstance(posted_at, str):
        try:
            posted_at = _parse_iso(posted_at)
        except ValueError:
            return False
    if posted_at.tzinfo is None:
        posted_at = posted_at.replace(tzinfo=timezone.utc)
    start, end = time_range
    return start <= posted_at <= end


def partition_by_time_range(posts: list, config: dict) -> tuple[list, list]:
    """Returns (in_range, out_of_range). If no time_range in config, all posts
    pass through as in-range — gate is opt-in via config."""
    time_range = parse_time_range(config)
    if time_range is None:
        return list(posts), []
    in_range: list = []
    out_of_range: list = []
    for p in posts:
        (in_range if is_in_range(p, time_range) else out_of_range).append(p)
    return in_range, out_of_range


def _parse_iso(value: str) -> datetime:
    """Parse an ISO-8601 timestamp; tolerate trailing 'Z'."""
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
