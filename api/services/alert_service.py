"""Business logic for dynamic per-agent email alerts (CRUD + preview + test).

Access control mirrors the rest of the agent surface: an alert is a component of
its agent, so whoever `can_access_agent` may read/write its alerts. Filter
evaluation and the post shape reuse the dashboard engine verbatim.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException

from api.auth.dependencies import CurrentUser
from api.deps import get_bq, get_fs
from api.schemas.alerts import AlertCreate, AlertUpdate
from api.services.collection_service import can_access_agent

logger = logging.getLogger(__name__)

# How many of the agent's recent posts the preview scans.
_PREVIEW_MAX_ROWS = 1000
# How many matched samples the preview returns to the client.
_PREVIEW_SAMPLE = 20


def _require_agent(user: CurrentUser, agent_id: str) -> dict:
    fs = get_fs()
    agent = fs.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not can_access_agent(user, agent):
        raise HTTPException(status_code=403, detail="Access denied to this agent")
    return agent


def _require_alert(user: CurrentUser, alert_id: str) -> tuple[dict, dict]:
    fs = get_fs()
    alert = fs.get_alert(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    agent = _require_agent(user, alert["agent_id"])
    return alert, agent


def list_alerts(user: CurrentUser, agent_id: str) -> list[dict]:
    _require_agent(user, agent_id)
    return get_fs().list_alerts_for_agent(agent_id)


def create_alert(user: CurrentUser, agent_id: str, body: AlertCreate) -> dict:
    agent = _require_agent(user, agent_id)
    fs = get_fs()
    alert_id = uuid.uuid4().hex
    recipients = body.recipients or ([user.email] if user.email else [])
    data = {
        "agent_id": agent_id,
        "user_id": agent.get("user_id") or user.uid,
        "org_id": agent.get("org_id"),
        "name": body.name,
        "enabled": body.enabled,
        "filters": body.filters.model_dump(by_alias=True, exclude_none=True),
        "recipients": recipients,
        "max_items_per_email": body.max_items_per_email,
        "widgets": [w.model_dump(by_alias=True, exclude_none=True) for w in body.widgets],
        "created_by": "user",
    }
    fs.create_alert(alert_id, data)
    return fs.get_alert(alert_id)


def update_alert(user: CurrentUser, alert_id: str, patch: AlertUpdate) -> dict:
    _require_alert(user, alert_id)
    fs = get_fs()
    fields: dict = {}
    if patch.name is not None:
        fields["name"] = patch.name
    if patch.enabled is not None:
        fields["enabled"] = patch.enabled
    if patch.recipients is not None:
        fields["recipients"] = patch.recipients
    if patch.max_items_per_email is not None:
        fields["max_items_per_email"] = patch.max_items_per_email
    if patch.filters is not None:
        fields["filters"] = patch.filters.model_dump(by_alias=True, exclude_none=True)
    if patch.widgets is not None:
        fields["widgets"] = [w.model_dump(by_alias=True, exclude_none=True) for w in patch.widgets]
    if fields:
        fs.update_alert(alert_id, **fields)
    return fs.get_alert(alert_id)


def delete_alert(user: CurrentUser, alert_id: str) -> None:
    _require_alert(user, alert_id)
    get_fs().delete_alert(alert_id)


def preview_alert(user: CurrentUser, agent_id: str, filters: dict) -> dict:
    """Dry-run: count + sample of the agent's recent posts matching `filters`."""
    agent = _require_agent(user, agent_id)
    from api.services.dashboard_service import build_dashboard_sql
    from api.services.dashboard_widget_filters import apply_widget_filters
    from workers.alerts.evaluator import _normalize_post

    collection_ids = list(agent.get("collection_ids") or [])
    if not collection_ids:
        return {"matched_count": 0, "scanned_count": 0, "sample": []}

    sql, params = build_dashboard_sql(collection_ids, agent_id, _PREVIEW_MAX_ROWS)
    if not sql:
        return {"matched_count": 0, "scanned_count": 0, "sample": []}
    rows = [_normalize_post(r) for r in get_bq().query(sql, params)]
    matched = apply_widget_filters(rows, filters)

    sample = [
        {
            "post_id": p.get("post_id"),
            "platform": p.get("platform"),
            "channel_handle": p.get("channel_handle"),
            "sentiment": p.get("sentiment"),
            "posted_at": (p.get("posted_at") or "")[:10],
            "content": (p.get("content") or p.get("title") or "")[:280],
            "post_url": p.get("post_url"),
            # Carried so the test email's post cards can show thumbnails, like a real send.
            "media_refs": p.get("media_refs"),
            "thumbnail_url": p.get("thumbnail_url"),
            "thumbnail_gcs_uri": p.get("thumbnail_gcs_uri"),
        }
        for p in matched[:_PREVIEW_SAMPLE]
    ]
    return {"matched_count": len(matched), "scanned_count": len(rows), "sample": sample}


def send_test_email(user: CurrentUser, alert_id: str) -> dict:
    """Send a clearly-marked [TEST] email to the alert's recipients, showing any
    posts that currently match (so the user can sanity-check the filter)."""
    alert, agent = _require_alert(user, alert_id)
    from config.settings import get_settings
    from workers.alerts.email import build_alert_email_html
    from workers.alerts.render_client import render_alert_widgets
    from workers.notifications.service import send_composed_html_email

    recipients = [r for r in (alert.get("recipients") or []) if r] or (
        [user.email] if user.email else []
    )
    if not recipients:
        raise HTTPException(status_code=400, detail="Alert has no recipients to test.")

    preview = preview_alert(user, alert["agent_id"], alert.get("filters") or {})
    sample = preview["sample"]
    max_items = int(alert.get("max_items_per_email") or 10)
    app_url = get_settings().frontend_url
    alert_name = alert.get("name") or "Alert"

    # Same visual pipeline as the live evaluator, so "Send test" shows the real
    # email. Widgets render against the agent's current data (the render token is
    # scoped to the alert); falls back to the text body when there are no widgets
    # or the render service is unconfigured/unavailable.
    images = render_alert_widgets(alert_id, alert.get("widgets") or [])
    subject, html = build_alert_email_html(
        alert_name=alert_name,
        posts=sample,
        total_matched=preview["matched_count"],
        max_items=max_items,
        app_url=app_url,
        agent_id=alert["agent_id"],
        images=images or None,
    )

    subject = f"[TEST] {subject}"
    html = (
        '<p style="margin:0 0 16px;padding:10px 14px;background:#FBF1EC;'
        'border-radius:8px;font-size:13px;color:#6E665A;">'
        "This is a test of your alert. No new posts were actually triggered.</p>" + html
    )

    sent = 0
    last_error = ""
    for recipient in recipients:
        result = send_composed_html_email(recipient_email=recipient, subject=subject, body_html=html)
        if result.get("status") == "success":
            sent += 1
        else:
            last_error = result.get("message") or last_error
    if sent == 0:
        # Surface the underlying reason (e.g. SendGrid auth/config failure) rather
        # than an opaque 502 — an opaque error sent the user debugging alert logic
        # when the real cause was the SendGrid key. See docs/bugs/api-alerts-test-email-opaque-502.md.
        detail = f"Failed to send test email: {last_error}" if last_error else "Failed to send test email."
        raise HTTPException(status_code=502, detail=detail)
    return {"status": "success", "sent_to": recipients, "matched_count": preview["matched_count"]}
