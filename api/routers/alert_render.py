"""Ungated data endpoint for the headless alert-widget renderer.

The render service drives a headless browser to ``/embed/alert-widget?token=…``
(a frontend route). That page has no logged-in user, so it fetches its data
here using the opaque render token instead of a Firebase session. The token is
scoped to a single (alert, widget) pair, and the response carries only that one
widget config + the posts needed to render it — nothing else is reachable.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from api.deps import get_bq, get_fs
from config.settings import get_settings
from workers.alerts.render_token import RenderTokenError, verify_render_token

logger = logging.getLogger(__name__)

router = APIRouter()

# Cap posts pulled for a render. Widgets aggregate client-side; this bounds the
# payload and the BigQuery scan without changing what a typical widget shows.
_RENDER_MAX_ROWS = 2000


@router.get("/alert-render/payload")
async def alert_render_payload(token: str = Query(...)):
    """Return ``{widget, posts, alert_name, app_url}`` for one alert widget."""
    try:
        alert_id, widget_index = verify_render_token(token)
    except RenderTokenError as exc:
        # 401: the token — not the request shape — is the problem.
        raise HTTPException(status_code=401, detail=f"Invalid render token: {exc}") from exc

    fs = get_fs()
    alert = fs.get_alert(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    widgets = alert.get("widgets") or []
    if widget_index < 0 or widget_index >= len(widgets):
        raise HTTPException(status_code=404, detail="Widget not found")
    widget = widgets[widget_index]

    agent = fs.get_agent(alert["agent_id"]) or {}
    collection_ids = list(agent.get("collection_ids") or [])

    posts: list[dict] = []
    if collection_ids:
        from api.services.dashboard_service import build_dashboard_sql
        from workers.alerts.evaluator import _normalize_post

        sql, params = build_dashboard_sql(collection_ids, alert["agent_id"], _RENDER_MAX_ROWS)
        if sql:
            posts = [_normalize_post(r) for r in get_bq().query(sql, params)]

    return {
        "widget": widget,
        "posts": posts,
        "alert_name": alert.get("name") or "Alert",
        "app_url": get_settings().frontend_url,
    }
