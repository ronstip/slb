"""Service Window evaluation (spec §3a).

The 24h window after a User's last inbound message, during which the Concierge
may send free-form text. Evaluated **lazily at send time** so no scheduler is
required for correctness: ``now - last_inbound_at <= 24h`` ⇒ open.
"""

from datetime import datetime, timedelta, timezone

WINDOW = timedelta(hours=24)


def _as_aware(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_window_open(last_inbound_at, now=None) -> bool:
    """True iff within 24h of the last inbound message. No inbound ⇒ closed."""
    dt = _as_aware(last_inbound_at)
    if dt is None:
        return False
    now = now or datetime.now(timezone.utc)
    return (now - dt) <= WINDOW
