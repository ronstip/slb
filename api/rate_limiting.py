"""Shared rate limiter instance for use across routers."""

import hashlib

from fastapi import Request
from slowapi import Limiter


def _rate_limit_key(request: Request) -> str:
    """Key rate limiter by auth token hash (per-user) or IP (unauthenticated)."""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return hashlib.sha256(auth[7:].encode()).hexdigest()[:16]
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=_rate_limit_key)
