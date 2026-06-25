"""Agent-facing tools to create and list dynamic email alerts in natural language.

An alert is a saved dashboard filter (`SocialWidgetFilters`) attached to an
agent; when a collection run finishes, posts matching the filter email the
recipients. The agent builds the SAME filter JSON it already produces for
dashboard widgets - sentiment/themes/brands/text-contains/engagement conditions,
all ANDed - so no new vocabulary is needed.
"""

import logging

from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)


def _resolve_user(tool_context: ToolContext | None):
    """Return a CurrentUser built from session state + the user's Firestore doc."""
    from api.auth.dependencies import CurrentUser
    from api.deps import get_fs

    state = tool_context.state if tool_context else {}
    user_id = state.get("user_id", "")
    org_id = state.get("org_id")
    email = ""
    if user_id:
        user_doc = get_fs().get_user(user_id) or {}
        email = user_doc.get("email", "") or ""
    return CurrentUser(uid=user_id, email=email, display_name=None, org_id=org_id, org_role=None)


def _active_agent_id(tool_context: ToolContext | None, agent_id: str | None) -> str | None:
    if agent_id:
        return agent_id
    state = tool_context.state if tool_context else {}
    return state.get("active_agent_id")


def create_alert(
    name: str,
    filters: dict,
    recipients: list[str] = None,
    max_items_per_email: int = 10,
    agent_id: str = None,
    tool_context: ToolContext = None,
) -> dict:
    """Create a dynamic email alert on an agent.

    WHEN TO USE: when the user wants to be emailed about NEW posts that match
    some condition - e.g. "email me when a new negative post about Nike mentions
    a recall". One alert = one saved filter; the email fires when a collection
    run brings in matching posts.

    Args:
        name: Short human label for the alert (e.g. "Nike negative recalls").
        filters: The condition, as the SAME dashboard `SocialWidgetFilters`
            object you build for widgets. Scalar dimensions are arrays
            (e.g. {"sentiment": ["negative"]}); advanced rules go in
            `conditions` (e.g. {"conditions": [{"field": "text",
            "operator": "contains", "value": "recall"}]}). All constraints are
            ANDed. Leave {} to match every new post.
        recipients: Email addresses to notify. Omit to default to the user's own
            email. Max 20.
        max_items_per_email: Cap on posts listed per email (1-50, default 10);
            extras collapse into a "+N more" line.
        agent_id: Target agent. Omit to use the active agent in this session.

    Returns:
        A dict with status and the created alert (or an error message).
    """
    from fastapi import HTTPException

    from api.schemas.alerts import AlertCreate
    from api.services import alert_service

    resolved_agent_id = _active_agent_id(tool_context, agent_id)
    if not resolved_agent_id:
        return {"status": "error", "message": "No agent selected. Set an active agent first."}

    try:
        body = AlertCreate(
            name=name,
            filters=filters or {},
            recipients=recipients or [],
            max_items_per_email=max_items_per_email,
        )
    except Exception as e:  # pydantic ValidationError -> friendly message
        return {"status": "error", "message": f"Invalid alert: {e}"}

    user = _resolve_user(tool_context)
    try:
        alert = alert_service.create_alert(user, resolved_agent_id, body)
    except HTTPException as e:
        return {"status": "error", "message": str(e.detail)}
    except Exception:
        logger.exception("create_alert tool failed")
        return {"status": "error", "message": "Failed to create alert."}

    return {
        "status": "success",
        "alert_id": alert["alert_id"],
        "message": (
            f"Alert **{alert['name']}** created. It will email "
            f"{', '.join(alert.get('recipients') or []) or 'you'} when new "
            "matching posts are collected."
        ),
        "alert": alert,
    }


def list_alerts(agent_id: str = None, tool_context: ToolContext = None) -> dict:
    """List the alerts configured on an agent.

    Args:
        agent_id: Target agent. Omit to use the active agent in this session.
    """
    from fastapi import HTTPException

    from api.services import alert_service

    resolved_agent_id = _active_agent_id(tool_context, agent_id)
    if not resolved_agent_id:
        return {"status": "error", "message": "No agent selected. Set an active agent first."}

    user = _resolve_user(tool_context)
    try:
        alerts = alert_service.list_alerts(user, resolved_agent_id)
    except HTTPException as e:
        return {"status": "error", "message": str(e.detail)}
    return {
        "status": "success",
        "count": len(alerts),
        "alerts": [
            {
                "alert_id": a["alert_id"],
                "name": a.get("name"),
                "enabled": a.get("enabled"),
                "recipients": a.get("recipients"),
                "filters": a.get("filters"),
                "trigger_count": a.get("trigger_count", 0),
            }
            for a in alerts
        ],
    }
