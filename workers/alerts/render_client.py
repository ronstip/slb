"""Turn an alert's dashboard widgets into hosted PNG image URLs.

For each widget: mint a scoped render token, ask the render service to
screenshot the chrome-less embed page, upload the PNG to the media bucket, and
return its public ``/media/...`` URL. Any failure is logged and that widget is
skipped — a broken render must never block the email (the caller falls back to
the text body when no images come back).

Channel-agnostic by design: the same image URLs will feed Slack/Teams/WhatsApp.
"""

from __future__ import annotations

import logging
import uuid

import requests

from config.settings import get_settings
from workers.alerts.render_token import mint_render_token

logger = logging.getLogger(__name__)

# Logical capture size (the service renders at 2x for retina). Width matches the
# email body; tall widgets (feeds/tables) get more height.
_WIDTH = 1000
_TALL_CHARTS = {"data-table", "table"}
_TALL_AGGS = {"posts", "media", "embeds"}
_RENDER_TIMEOUT = (10, 60)  # (connect, read) seconds


def _media_base(settings) -> str:
    """Absolute base for the public ``/media`` proxy (API host)."""
    base = (settings.api_service_url or "").rstrip("/")
    return base or "http://localhost:8000"


def _dims(widget: dict) -> tuple[int, int]:
    tall = (widget.get("chartType") in _TALL_CHARTS) or (widget.get("aggregation") in _TALL_AGGS)
    return _WIDTH, 580 if tall else 440


def render_alert_widgets(alert_id: str, widgets: list[dict], *, gcs=None) -> list[dict]:
    """Return ``[{title, image_url, width, height}, …]`` for renderable widgets.

    Empty when the feature is unconfigured (no render service / secret) or every
    render failed — the caller then sends the text email.
    """
    settings = get_settings()
    if not widgets or not settings.render_service_url or not settings.alert_render_secret:
        return []

    if gcs is None:
        from workers.shared.gcs_client import GCSClient

        gcs = GCSClient(settings)

    frontend = settings.frontend_url.rstrip("/")
    render_url = settings.render_service_url.rstrip("/") + "/render"
    media_base = _media_base(settings)
    headers = {"x-render-token": settings.render_service_token} if settings.render_service_token else {}

    out: list[dict] = []
    for idx, widget in enumerate(widgets):
        try:
            token = mint_render_token(alert_id, idx)
            width, height = _dims(widget)
            embed_url = f"{frontend}/embed/alert-widget?token={token}&w={width}&h={height}"
            resp = requests.post(
                render_url,
                json={"url": embed_url, "width": width, "height": height},
                headers=headers,
                timeout=_RENDER_TIMEOUT,
            )
            resp.raise_for_status()
            key = f"{idx}-{uuid.uuid4().hex[:8]}"
            blob_path = gcs.upload_alert_render(alert_id, key, resp.content)
            out.append(
                {
                    "title": widget.get("title") or "",
                    "image_url": f"{media_base}/media/{blob_path}",
                    "width": width,
                    "height": height,
                }
            )
        except requests.exceptions.ConnectionError:
            # Render service unreachable (e.g. not running in dev). Expected and
            # recoverable — the caller falls back to the post feed. Warn, don't
            # raise to Sentry.
            logger.warning(
                "Alert %s: render service unreachable at %s — falling back to text",
                alert_id,
                render_url,
            )
            return out
        except Exception:
            logger.exception("Alert %s: widget %d render failed", alert_id, idx)
    return out
