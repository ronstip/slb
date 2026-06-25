"""Evaluate per-agent alerts against a finished agent run.

Hooked at agent-RUN completion (see `workers/agent_continuation.py::check_agent_completion`,
the `all_complete` branch) — NOT at per-collection completion. An agent run fans
out into one collection per source/channel; firing per-collection sent one email
per sub-collection (deduped, so the user saw several emails with disjoint posts).
Evaluating once, across ALL the run's collections, batches every match into a
single email. By this point every post in the run is fully enriched (sentiment /
emotion / themes / entities / brands / custom_fields all populated).

"New post" semantics fall out of the trigger point: the run completes once, and
its collections hold exactly the posts newly collected in that run. Cross-run /
overlapping duplicates are caught by the per-alert `alerted_posts` dedup ledger
so the same post never alerts twice.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

# Cap how many of a run's posts we pull for matching. Far above any realistic
# single-collection size; a guard against a pathological run, not a feature.
_MAX_ROWS = 5000

_LIST_FIELDS = ("themes", "entities", "detected_brands", "topic_ids")


def _normalize_post(row: dict) -> dict:
    """Coerce a BigQuery row into the dict shape `apply_widget_filters` expects.

    The dashboard read path runs each row through `assemble_dashboard_core`,
    which parses JSON-typed columns; the alert path skips that, so we normalize
    the few fields the filter engine reads: array dims must be lists and
    `custom_fields` must be a dict (BigQuery JSON may arrive as a string)."""
    post = dict(row)
    for f in _LIST_FIELDS:
        v = post.get(f)
        if v is None:
            post[f] = []
        elif not isinstance(v, list):
            post[f] = [v]
    cf = post.get("custom_fields")
    if isinstance(cf, str):
        try:
            cf = json.loads(cf)
        except (json.JSONDecodeError, TypeError):
            cf = None
    if not isinstance(cf, dict):
        cf = {}
    post["custom_fields"] = cf
    return post


def _recipients_for(alert: dict, fs) -> list[str]:
    """Explicit recipients, else fall back to the owning user's email."""
    recipients = [r for r in (alert.get("recipients") or []) if r]
    if recipients:
        return recipients
    user_id = alert.get("user_id")
    if user_id:
        user = fs.get_user(user_id) or {}
        email = (user.get("email") or "").strip()
        if email:
            return [email]
    return []


def _fetch_run_posts(collection_ids: list[str], agent_id: str, bq) -> list[dict]:
    from api.services.dashboard_service import build_dashboard_sql

    sql, params = build_dashboard_sql(list(collection_ids), agent_id, _MAX_ROWS)
    if not sql:
        return []
    rows = bq.query(sql, params)
    return [_normalize_post(r) for r in rows]


def evaluate_alerts_for_collection(collection_id: str, *, bq, fs) -> dict:
    """Single-collection entry point (manual re-run endpoint + legacy callers).

    Resolves the owning agent and delegates to ``evaluate_alerts_for_agent_run``
    over just this collection. The primary trigger is the agent-run hook, which
    passes the run's full collection set; this wrapper exists so an operator can
    re-evaluate one collection in isolation."""
    summary = {"collection_id": collection_id, "alerts_evaluated": 0, "alerts_triggered": 0, "emails_sent": 0}

    status = fs.get_collection_status(collection_id) or {}
    agent_id = status.get("agent_id")
    if not agent_id:
        logger.info("No agent_id for collection %s - skipping alert evaluation", collection_id)
        return summary

    return evaluate_alerts_for_agent_run(agent_id, [collection_id], bq=bq, fs=fs)


def evaluate_alerts_for_agent_run(
    agent_id: str, collection_ids: list[str], *, bq, fs
) -> dict:
    """Match a finished agent run's posts (across ALL its collections) against the
    agent's enabled alerts and email recipients on a match. One call per agent-run
    completion → at most one email per alert per run, batching matches from every
    collection. Returns a small summary dict. Never raises for per-alert failures -
    one bad alert must not block the others or the pipeline."""
    from datetime import datetime, timezone

    from api.services.dashboard_widget_filters import apply_widget_filters
    from config.settings import get_settings
    from workers.alerts.email import build_alert_email_html
    from workers.alerts.render_client import render_alert_widgets
    from workers.notifications.service import send_composed_html_email

    summary = {
        "agent_id": agent_id,
        "collection_ids": list(collection_ids),
        "alerts_evaluated": 0,
        "alerts_triggered": 0,
        "emails_sent": 0,
    }

    if not agent_id or not collection_ids:
        return summary

    alerts = fs.list_enabled_alerts_for_agent(agent_id)
    if not alerts:
        return summary

    posts = _fetch_run_posts(collection_ids, agent_id, bq)
    summary["posts_scanned"] = len(posts)
    if not posts:
        return summary

    settings = get_settings()
    app_url = settings.frontend_url

    for alert in alerts:
        summary["alerts_evaluated"] += 1
        alert_id = alert["alert_id"]
        try:
            matched = apply_widget_filters(posts, alert.get("filters"))
            if not matched:
                continue

            match_ids = [p.get("post_id") for p in matched if p.get("post_id")]
            unseen_ids = set(fs.filter_unseen_post_ids(alert_id, match_ids))
            if not unseen_ids:
                continue
            unseen = [p for p in matched if p.get("post_id") in unseen_ids]

            recipients = _recipients_for(alert, fs)
            if not recipients:
                logger.warning("Alert %s matched %d posts but has no recipients", alert_id, len(unseen))
                continue

            max_items = int(alert.get("max_items_per_email") or 10)
            alert_name = alert.get("name") or "Alert"

            # Render the alert's widgets to PNGs (empty on no widgets / failure /
            # unconfigured render service). The email always shows the post feed;
            # widget images, when present, sit above it.
            images = render_alert_widgets(alert_id, alert.get("widgets") or [])
            subject, html = build_alert_email_html(
                alert_name=alert_name,
                posts=unseen,
                total_matched=len(unseen),
                max_items=max_items,
                app_url=app_url,
                agent_id=agent_id,
                images=images or None,
            )

            sent_any = False
            for recipient in recipients:
                result = send_composed_html_email(
                    recipient_email=recipient, subject=subject, body_html=html
                )
                if result.get("status") == "success":
                    sent_any = True
                    summary["emails_sent"] += 1
                else:
                    logger.error("Alert %s email to %s failed: %s", alert_id, recipient, result.get("message"))

            if sent_any:
                # Mark every matched post seen (not just the rendered first N) so
                # the "+N more" tail can't re-alert on a later overlapping run.
                fs.mark_posts_alerted(alert_id, list(unseen_ids))
                fs.update_alert(
                    alert_id,
                    last_triggered_at=datetime.now(timezone.utc),
                    last_match_count=len(unseen),
                    trigger_count=int(alert.get("trigger_count") or 0) + 1,
                )
                summary["alerts_triggered"] += 1
        except Exception:
            logger.exception("Alert %s evaluation failed for agent %s run", alert_id, agent_id)

    logger.info("Alert evaluation for agent %s run: %s", agent_id, summary)
    return summary
