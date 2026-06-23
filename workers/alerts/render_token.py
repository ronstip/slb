"""Short-lived signed tokens that let the headless renderer fetch ONE alert
widget's data without a user login.

The token is opaque to the browser — it carries only ``alert_id`` + widget index
+ an expiry, signed with ``settings.alert_render_secret`` (HMAC-SHA256). The
ungated ``/alert-render/payload`` endpoint is the only thing that verifies it,
and it scopes the response to exactly that one widget. No secret ever reaches
the browser.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from config.settings import get_settings

# Default token lifetime. Generous enough to cover render-service queueing +
# Chromium cold start, short enough that a leaked URL is useless within minutes.
DEFAULT_TTL_SECONDS = 600


class RenderTokenError(Exception):
    """Token is missing, malformed, tampered, expired, or unverifiable."""


def _secret() -> bytes:
    secret = get_settings().alert_render_secret
    if not secret:
        raise RenderTokenError("alert_render_secret is not configured")
    return secret.encode("utf-8")


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def mint_render_token(alert_id: str, widget_index: int, *, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> str:
    """Return ``<payload>.<sig>`` granting read of one widget for ``ttl_seconds``."""
    payload = {"a": alert_id, "w": int(widget_index), "exp": int(time.time()) + int(ttl_seconds)}
    body = _b64e(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    sig = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def verify_render_token(token: str) -> tuple[str, int]:
    """Validate a token and return ``(alert_id, widget_index)``.

    Raises ``RenderTokenError`` on any problem (tamper, expiry, bad shape).
    """
    if not token or token.count(".") != 1:
        raise RenderTokenError("malformed token")
    body, sig = token.split(".", 1)
    expected = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        raise RenderTokenError("bad signature")
    try:
        payload = json.loads(_b64d(body))
    except Exception as exc:  # noqa: BLE001 - any decode failure is a bad token
        raise RenderTokenError("undecodable payload") from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise RenderTokenError("token expired")
    return str(payload["a"]), int(payload["w"])
