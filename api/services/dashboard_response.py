"""Compressed-response cache for the dashboard data endpoints (P0b).

The dashboard core cache (``dashboard_cache.py``) removes BigQuery from warm
hits, but each warm hit still re-serializes (orjson) and re-compresses (gzip)
the assembled payload before sending. orjson is cheap (~30ms on an 11.5MB slim
payload); gzip at Starlette's default level 9 is the bulk of warm CPU (~366ms
slim / ~1s on a 25MB full payload measured on the 8.5K-post `wc26brands` share)
and it blocks the worker thread - expensive when a public share link is hit
concurrently. This caches the gzip-compressed body so a warm hit is a key
lookup + send, bypassing both orjson and gzip.

We bypass ``GZipMiddleware`` by setting ``Content-Encoding: gzip`` ourselves;
Starlette (0.52) forwards a body that already carries a content-encoding header
verbatim, so there is no double compression. Identity (non-gzip) clients are
served a fresh orjson body and are NOT cached - that path is rare (curl with
``Accept-Encoding: identity``, the odd crawler) and orjson alone is cheap.

CORRECTNESS - the cache key must capture EVERYTHING the body depends on. The
core freshness stamp covers posts/topics/kpis/collection_names, but the SHARE
response also embeds per-dashboard metadata (title, layout, filter-bar config,
reportConfig) that changes independently of the post data. So the share key
folds a hash of that metadata in via :func:`share_cache_key`. A key that omitted
it (the original handoff's ``cache_key + report_config hash + slim``) would
serve a stale layout after an owner edit. See
docs/handoff-dashboard-payload-scalability.md.
"""

import asyncio
import gzip
import hashlib
import threading
import time
from typing import Any

import orjson
from cachetools import TTLCache
from fastapi import Response
from fastapi.responses import ORJSONResponse

from api.services.dashboard_cache_l2 import l2_get, l2_set

# Level 6 ~matches level 9's ratio on JSON (2.65MB vs 2.62MB on the real slim
# payload) at ~40% less CPU. The compress runs once per (data, config) on a
# cache miss; every warm hit then serves the stored bytes.
_GZIP_LEVEL = 6

# 1h safety net (mirrors the core cache); real invalidation is the freshness
# stamp + metadata hash folded into the key. maxsize bounds memory - each entry
# is one compressed payload (~2.6MB slim / ~6.5MB full), so 64 caps this cache
# in the same order of magnitude as the core dict cache.
_DEFAULT_TTL = 3600
_DEFAULT_MAXSIZE = 64


class _BytesCache:
    """Thread-safe TTL cache of gzip-compressed response bodies.

    Written from ``asyncio.to_thread``-free request handlers but still touched
    concurrently across requests, so access is lock-guarded like the core cache.
    """

    def __init__(
        self,
        maxsize: int = _DEFAULT_MAXSIZE,
        ttl: float = _DEFAULT_TTL,
        timer=time.monotonic,
    ):
        self._cache: TTLCache = TTLCache(maxsize=maxsize, ttl=ttl, timer=timer)
        self._lock = threading.Lock()

    def get(self, key: str) -> bytes | None:
        with self._lock:
            return self._cache.get(key)

    def set(self, key: str, body: bytes) -> None:
        with self._lock:
            self._cache[key] = body

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


# Process-wide singleton shared by both dashboard endpoints.
_default = _BytesCache()


def get_encoded(key: str) -> bytes | None:
    return _default.get(key)


def set_encoded(key: str, body: bytes) -> None:
    _default.set(key, body)


def clear_encoded() -> None:
    _default.clear()


def stable_hash(*parts: Any) -> str:
    """Deterministic short hash of jsonable parts, for cache keys.

    Uses orjson with sorted keys so dict ordering can never change the digest -
    two equal-but-differently-ordered configs share a cache entry.
    """
    h = hashlib.blake2b(digest_size=16)
    for part in parts:
        h.update(orjson.dumps(part, option=orjson.OPT_SORT_KEYS))
        h.update(b"\x00")
    return h.hexdigest()


def data_cache_key(
    agent_id: str,
    collection_ids: list[str],
    stamp: str,
    report_config: dict | None,
    slim: bool,
) -> str:
    """Key for ``POST /dashboard/data``.

    The body is ``{**core, "posts": transform(core.posts, report_config)[slim]}``.
    Everything but ``posts`` comes from the core (already keyed by
    ``agent_id + collections + stamp``); ``posts`` additionally depends on the
    report config and the slim flag. Collection order is normalized so two
    requests for the same set share an entry.
    """
    return "data|" + stable_hash(
        agent_id, sorted(collection_ids), stamp, report_config, bool(slim)
    )


def share_cache_key(
    token: str,
    stamp: str,
    slim: bool,
    metadata: dict,
    agg_enabled: bool = False,
) -> str:
    """Key for ``GET /dashboard/shares/public/{token}``.

    Beyond the core (covered by ``stamp``) and ``slim``, the share body embeds
    per-dashboard metadata that the freshness stamp does NOT track - title,
    layout, filter-bar config, orientation, reportScope, filterBarHidden,
    reportConfig. ``metadata`` must carry exactly those, so an owner edit busts
    the cache. ``token`` namespaces and also covers the static ``created_at``.

    ``agg_enabled`` (P2) toggles the server-aggregated ``widgetData`` map in the
    body, so a flagged and an unflagged request must never share a cache entry.
    The server series themselves are deterministic from data (``stamp``) +
    layout/reportConfig (in ``metadata``), so the flag is the only extra input.
    """
    return "share|" + stable_hash(token, stamp, bool(slim), metadata, bool(agg_enabled))


def _gzip_response(body: bytes) -> Response:
    """Wrap already-gzipped bytes in a Response with the headers that stop
    GZipMiddleware from re-compressing them."""
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Encoding": "gzip",
            "Content-Length": str(len(body)),
            "Vary": "Accept-Encoding",
        },
    )


async def cached_gzip_response_async(
    cache_key: str, accept_encoding: str
) -> Response | None:
    """Two-level warm-body lookup: in-process L1, then GCS L2 (run off-loop).

    Lets a handler short-circuit BEFORE building (and aggregating) the payload:
    when the client accepts gzip and the key is warm in either tier, the stored
    compressed body is everything we need. On an L1 miss it consults the shared
    GCS L2 so a fresh instance can serve a body another instance already built
    instead of rebuilding it from BigQuery; an L2 hit warms L1 for next time.
    The GCS read runs in a thread so it never blocks the event loop. Returns
    None when the client can't take gzip or neither tier has the body - the
    caller must then build the payload and call :func:`gzipped_json_response`.
    """
    if "gzip" not in accept_encoding.lower():
        return None
    body = get_encoded(cache_key)
    if body is None:
        body = await asyncio.to_thread(l2_get, cache_key)
        if body is not None:
            set_encoded(cache_key, body)  # warm L1 from L2
    if body is None:
        return None
    return _gzip_response(body)


async def store_encoded_l2(cache_key: str, accept_encoding: str) -> None:
    """Mirror the just-built L1 body to the GCS L2, off the event loop.

    Called after a miss-fill: ``gzipped_json_response`` has already stored the
    compressed body in L1 under this key, so we read it back and push it to GCS
    for sibling instances. Awaited (the write is ~50ms and the request that
    triggered it already paid the multi-second miss), best-effort inside l2_set.
    """
    if "gzip" not in accept_encoding.lower():
        return
    body = get_encoded(cache_key)
    if body is None:
        return
    await asyncio.to_thread(l2_set, cache_key, body)


def gzipped_json_response(payload: dict, cache_key: str, accept_encoding: str) -> Response:
    """JSON response that serves a cached gzip body to gzip-capable clients.

    Gzip-capable clients get the cached compressed bytes (or a fresh compress on
    a miss, then cached) with ``Content-Encoding: gzip`` set so GZipMiddleware
    leaves the body untouched. Identity clients get a fresh, uncached orjson body
    - GZipMiddleware won't compress it (they didn't ask) and orjson is cheap.
    """
    if "gzip" in accept_encoding.lower():
        body = get_encoded(cache_key)
        if body is None:
            body = gzip.compress(orjson.dumps(payload), compresslevel=_GZIP_LEVEL)
            set_encoded(cache_key, body)
        return _gzip_response(body)
    return ORJSONResponse(payload)
