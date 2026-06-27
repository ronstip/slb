"""Ungated data endpoint for the headless watch-widget renderer.

The render service drives a headless browser to ``/embed/watch-widget?token=…``
(a frontend route). That page has no logged-in user, so it fetches its data here
using the opaque render token instead of a Firebase session. The token is scoped
to a single (watch, widget) pair plus the firing window, and the response carries
only that one widget config + the windowed scope_posts rows — nothing else is
reachable. Replaces the legacy /alert-render/payload.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from api.deps import get_bq, get_fs
from config.settings import get_settings
from workers.watches.evaluator import resolve_subject_agent_ids
from workers.watches.normalize import normalize_post
from workers.watches.render_token import RenderTokenError, verify_render_token

logger = logging.getLogger(__name__)

router = APIRouter()

# Cap posts pulled for a render. Widgets aggregate client-side; this bounds the
# payload and the BigQuery scan without changing what a typical widget shows.
_RENDER_MAX_ROWS = 2000


@router.get("/watch-render/payload")
async def watch_render_payload(token: str = Query(...)):
    """Return ``{widget, posts, watch_name, app_url}`` for one watch widget."""
    try:
        uid, watch_id, widget_index, win_start, win_end = verify_render_token(token)
    except RenderTokenError as exc:
        # 401: the token — not the request shape — is the problem.
        raise HTTPException(status_code=401, detail=f"Invalid render token: {exc}") from exc

    fs = get_fs()
    watch = fs.get_watch(uid, watch_id)
    if not watch:
        raise HTTPException(status_code=404, detail="Watch not found")

    widgets = (watch.get("action") or {}).get("widgets") or []
    if widget_index < 0 or widget_index >= len(widgets):
        raise HTTPException(status_code=404, detail="Widget not found")
    widget = widgets[widget_index]

    agent_ids = resolve_subject_agent_ids(watch, fs)
    agent_id = agent_ids[0] if agent_ids else None  # per_agent render (v1)

    posts: list[dict] = []
    if agent_id:
        from api.services.dashboard_service import build_scope_window_sql

        sql, params = build_scope_window_sql(agent_id, win_start, win_end, _RENDER_MAX_ROWS)
        if sql:
            posts = [normalize_post(r) for r in get_bq().query(sql, params)]

    return {
        "widget": widget,
        "posts": posts,
        "watch_name": watch.get("name") or "Watch",
        "app_url": get_settings().frontend_url,
    }
