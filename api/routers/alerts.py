"""Dynamic per-agent email alerts: CRUD, preview (dry-run), and test-send.

Alerts reuse the dashboard `SocialWidgetFilters` object as their condition, so
the frontend filter builder and the agent's JSON both transfer unchanged. All
endpoints are gated (see main.py) and access-checked per owning agent.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends

from api.auth.dependencies import CurrentUser, get_current_user
from api.schemas.alerts import AlertCreate, AlertPreviewRequest, AlertUpdate
from api.services import alert_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/agents/{agent_id}/alerts")
async def list_alerts_endpoint(agent_id: str, user: CurrentUser = Depends(get_current_user)):
    """List all alerts configured on an agent."""
    alerts = await asyncio.to_thread(alert_service.list_alerts, user, agent_id)
    return {"alerts": alerts}


@router.post("/agents/{agent_id}/alerts")
async def create_alert_endpoint(
    agent_id: str, body: AlertCreate, user: CurrentUser = Depends(get_current_user)
):
    """Create a new alert on an agent."""
    return await asyncio.to_thread(alert_service.create_alert, user, agent_id, body)


@router.post("/agents/{agent_id}/alerts/preview")
async def preview_alert_endpoint(
    agent_id: str, body: AlertPreviewRequest, user: CurrentUser = Depends(get_current_user)
):
    """Dry-run a filter against the agent's recent posts: count + sample."""
    filters = body.filters.model_dump(by_alias=True, exclude_none=True)
    return await asyncio.to_thread(alert_service.preview_alert, user, agent_id, filters)


@router.patch("/alerts/{alert_id}")
async def update_alert_endpoint(
    alert_id: str, body: AlertUpdate, user: CurrentUser = Depends(get_current_user)
):
    """Partial-update an alert (name / enabled / recipients / filters / cap)."""
    return await asyncio.to_thread(alert_service.update_alert, user, alert_id, body)


@router.delete("/alerts/{alert_id}")
async def delete_alert_endpoint(alert_id: str, user: CurrentUser = Depends(get_current_user)):
    """Delete an alert and its dedup ledger."""
    await asyncio.to_thread(alert_service.delete_alert, user, alert_id)
    return {"status": "deleted", "alert_id": alert_id}


@router.post("/alerts/{alert_id}/test")
async def test_alert_endpoint(alert_id: str, user: CurrentUser = Depends(get_current_user)):
    """Send a [TEST] notification to the alert's recipients."""
    return await asyncio.to_thread(alert_service.send_test_email, user, alert_id)
