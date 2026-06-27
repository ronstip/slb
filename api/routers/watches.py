"""Watch (agentic alerting) CRUD + backtest preview. User-owned, gated (see main.py).

Supersedes api/routers/alerts.py; the alert endpoints remain as compatibility shims
during migration. See docs/alerts/watch-system-spec.md.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends

from api.auth.dependencies import CurrentUser, get_current_user
from pydantic import BaseModel, Field

from api.schemas.watches import Subject, WatchCreate, WatchUpdate
from api.services import watch_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/watches")
async def list_watches_endpoint(user: CurrentUser = Depends(get_current_user)):
    watches = await asyncio.to_thread(watch_service.list_watches, user)
    return {"watches": watches}


@router.post("/watches")
async def create_watch_endpoint(body: WatchCreate, user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(watch_service.create_watch, user, body)


class WatchCompileRequest(BaseModel):
    nl_text: str = Field(min_length=1)
    subject: Subject = Field(default_factory=Subject)


@router.post("/watches/compile")
async def compile_watch_endpoint(body: WatchCompileRequest, user: CurrentUser = Depends(get_current_user)):
    """NL → reviewable Watch draft (or clarifying questions). Does not save."""
    return await asyncio.to_thread(watch_service.compile_watch_nl, user, body.nl_text, body.subject)


@router.post("/watches/preview")
async def preview_watch_endpoint(body: WatchCreate, user: CurrentUser = Depends(get_current_user)):
    """Backtest a structured condition over the current window: value + would-fire."""
    return await asyncio.to_thread(watch_service.preview_watch, user, body)


@router.patch("/watches/{watch_id}")
async def update_watch_endpoint(
    watch_id: str, body: WatchUpdate, user: CurrentUser = Depends(get_current_user)
):
    return await asyncio.to_thread(watch_service.update_watch, user, watch_id, body)


@router.delete("/watches/{watch_id}")
async def delete_watch_endpoint(watch_id: str, user: CurrentUser = Depends(get_current_user)):
    await asyncio.to_thread(watch_service.delete_watch, user, watch_id)
    return {"status": "deleted", "watch_id": watch_id}
