"""GCS-backed L2 for the dashboard response-bytes cache.

The in-process bytes cache (``dashboard_response._BytesCache``) is per-instance.
On Cloud Run a second instance - spun up under burst traffic, after a cold
start, or right after a deploy - starts with an empty cache and pays the full
BigQuery cold miss (~14s on the 14K-post ``wc26brands`` share, measured). This
L2 stores the same gzip-compressed bodies in GCS, so any instance can serve a
body another instance already built (~100ms GCS read vs ~14s rebuild).

Keys are content-addressed: ``share_cache_key``/``data_cache_key`` already fold
in the data freshness stamp + share metadata, so a new stamp yields a NEW object
and stale ones are never read again. A bucket lifecycle rule (delete age > 1d)
reaps the garbage - see ``docs/bugs`` / deploy notes.

Best-effort by design: every operation swallows its own exceptions. A GCS hiccup
(missing bucket, permission, network) must never break or slow a dashboard
response - it silently degrades to the existing L1-only behaviour.
"""

from __future__ import annotations

import logging

from api.deps import get_gcs
from config.settings import get_settings

logger = logging.getLogger(__name__)

# Namespacing prefix inside the exports bucket. Objects are immutable
# (content-addressed key) so there is no per-object TTL; a bucket lifecycle rule
# on this prefix handles reaping.
_PREFIX = "dashboard-cache/"


def _blob(key: str):
    """Resolve the GCS blob for a cache key, or None when L2 is unavailable.

    Returns None (→ caller treats as miss / no-op) when the L2 is disabled by
    the kill switch or no exports bucket is configured.
    """
    settings = get_settings()
    if not settings.dashboard_cache_l2:
        return None
    bucket_name = settings.gcs_exports_bucket
    if not bucket_name:
        return None
    return get_gcs().bucket(bucket_name).blob(_PREFIX + key)


def l2_get(key: str) -> bytes | None:
    """Return the cached gzip body for ``key`` from GCS, or None on any miss.

    A missing object raises ``NotFound``; that and every other error map to a
    cache miss so the caller falls back to rebuilding the body.
    """
    try:
        blob = _blob(key)
        if blob is None:
            return None
        return blob.download_as_bytes()
    except Exception:  # noqa: BLE001 - NotFound or transient GCS error == miss
        return None


def l2_set(key: str, body: bytes) -> None:
    """Mirror a freshly-built gzip body to GCS. Best-effort; errors are logged."""
    try:
        blob = _blob(key)
        if blob is None:
            return
        # Store the gzip body as OPAQUE bytes - do NOT set content_encoding=gzip,
        # or GCS decompressive-transcoding would hand `download_as_bytes` the
        # decompressed content and corrupt our store-gzip / serve-gzip contract.
        # Only our code reads these objects and re-attaches the gzip header.
        blob.upload_from_string(body, content_type="application/octet-stream")
    except Exception:  # noqa: BLE001 - L2 write must never break the response
        logger.debug("dashboard L2 cache write failed for %s", key, exc_info=True)
