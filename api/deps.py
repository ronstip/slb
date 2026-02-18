"""Shared singleton dependencies for API endpoints."""

from config.settings import get_settings
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient

_fs: FirestoreClient | None = None
_bq: BQClient | None = None


def get_fs() -> FirestoreClient:
    """Return a singleton FirestoreClient (avoids re-creating on every request)."""
    global _fs
    if _fs is None:
        _fs = FirestoreClient(get_settings())
    return _fs


def get_bq() -> BQClient:
    """Return a singleton BQClient (avoids re-creating on every request)."""
    global _bq
    if _bq is None:
        _bq = BQClient(get_settings())
    return _bq
