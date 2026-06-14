"""In-process response cache for the dashboard data endpoints.

Both the authenticated dashboard (`/dashboard/data`) and the public share
(`/dashboard/shares/public/{token}`) recompute the *identical*
`(agent_id, collection_ids)` payload on every load - a ~2,780-row BigQuery read
plus per-row serialization that dominates load time. A share link is a viral
surface hit many times with the same data; the authed view is reloaded
constantly. Caching the assembled core makes repeat loads near-instant.

Invalidation is **passive**, keyed off a freshness stamp:

- The pipeline bumps ``collection_status.updated_at`` whenever post-state counts
  change (new posts, enrichment progress, refresh) - see
  ``workers/pipeline/runner.py`` ``_heartbeat_worker``. The max ``updated_at``
  across a dashboard's collections therefore moves exactly when its data changes
  and stays put when nothing runs.
- That stamp is part of the cache key. Static data keeps hitting the same key
  (cached for a long time); changed data produces a new key (instant miss ->
  recompute). No worker-side invalidation hook is needed, and it is correct
  across multiple Cloud Run instances because the stamp is read from Firestore.

The TTL is only a **memory-safety net** (bounds how long a stale-but-unchanged
entry, or an engagement-only refresh the stamp didn't catch, can linger), not the
primary freshness mechanism. Per-instance; each instance warms independently.
"""

import logging
import threading
import time
from collections.abc import Iterable

from cachetools import TTLCache

# Perf timing lines must surface in Cloud Run logs. Prod runs bare
# ``uvicorn api.main:app`` (see api/Dockerfile), which attaches log handlers only
# to uvicorn's own loggers - not the root - so app ``logger.info`` is dropped.
# uvicorn's error logger has a handler in every environment, so emitting the
# cache HIT/MISS + timing through it guarantees the prod-measurement step sees
# them. (Harmless no-op when uvicorn isn't the runner, e.g. unit tests.)
perf_logger = logging.getLogger("uvicorn.error")

# 1h safety net: real invalidation is the freshness stamp in the key. maxsize
# bounds memory - each entry is one agent's assembled payload (a few MB).
_DEFAULT_TTL = 3600
_DEFAULT_MAXSIZE = 128


def make_freshness_stamp(statuses: Iterable[dict | None]) -> str:
    """Derive a cache-busting stamp from a set of collection_status docs.

    Returns the max ``updated_at`` (as a string) across the given statuses, or
    ``""`` when none carry one. ``updated_at`` is an ISO-8601 string (or a
    datetime-like with ``isoformat``); ISO-8601 sorts lexicographically, so a
    plain ``max`` over the string forms yields the latest. An empty result is
    still a valid, stable key component - such data simply caches under "".
    """
    stamps: list[str] = []
    for status in statuses:
        if not status:
            continue
        value = status.get("updated_at")
        if value is None:
            continue
        if hasattr(value, "isoformat"):
            value = value.isoformat()
        stamps.append(str(value))
    return max(stamps) if stamps else ""


class DashboardCache:
    """Thread-safe TTL cache of assembled dashboard cores.

    Read/written from ``asyncio.to_thread`` workers, so access is guarded by a
    lock. Values are opaque to the cache - callers store a jsonable dict.
    """

    def __init__(
        self,
        maxsize: int = _DEFAULT_MAXSIZE,
        ttl: float = _DEFAULT_TTL,
        timer=time.monotonic,
    ):
        self._cache: TTLCache = TTLCache(maxsize=maxsize, ttl=ttl, timer=timer)
        self._lock = threading.Lock()

    @staticmethod
    def _key(agent_id: str, collection_ids: list[str], stamp: str) -> tuple:
        # Normalize collection order so two requests for the same set share an
        # entry regardless of how the ids were ordered upstream.
        return (agent_id, tuple(sorted(collection_ids)), stamp)

    def get(self, agent_id: str, collection_ids: list[str], stamp: str) -> dict | None:
        with self._lock:
            return self._cache.get(self._key(agent_id, collection_ids, stamp))

    def set(
        self, agent_id: str, collection_ids: list[str], stamp: str, core: dict
    ) -> None:
        with self._lock:
            self._cache[self._key(agent_id, collection_ids, stamp)] = core

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


# Process-wide singleton shared by both dashboard endpoints.
_default = DashboardCache()


def get_core(agent_id: str, collection_ids: list[str], stamp: str) -> dict | None:
    return _default.get(agent_id, collection_ids, stamp)


def set_core(
    agent_id: str, collection_ids: list[str], stamp: str, core: dict
) -> None:
    _default.set(agent_id, collection_ids, stamp, core)


# Separate cache for the data-tab feed KPI bundle (POST /feed?include_kpis).
# Same passive-invalidation contract as the dashboard cache, but the data tab
# adds server-side filters (platform / sentiment / date / topic), so the filter
# signature is folded into the freshness stamp - the default unfiltered view
# (the common case) shares one entry; each distinct filter combo gets its own.
# A separate instance so feed KPIs and dashboard cores don't evict each other.
_feed_kpis = DashboardCache(maxsize=256)


def get_feed_kpis(
    agent_id: str, collection_ids: list[str], stamp: str, filter_sig: str
) -> dict | None:
    return _feed_kpis.get(agent_id, collection_ids, f"{stamp}|{filter_sig}")


def set_feed_kpis(
    agent_id: str, collection_ids: list[str], stamp: str, filter_sig: str, core: dict
) -> None:
    _feed_kpis.set(agent_id, collection_ids, f"{stamp}|{filter_sig}", core)
