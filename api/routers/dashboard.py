"""Dashboard router — serves denormalized post data for client-side interactive dashboards."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.schemas.requests import DashboardDataRequest
from api.schemas.responses import DashboardDataResponse
from api.services.dashboard_service import (
    COLLECTION_NAMES_SQL,
    DASHBOARD_SQL,
    MAX_ROWS,
    build_post_response,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _can_access_collection(user: CurrentUser, status: dict) -> bool:
    if status.get("user_id") == user.uid:
        return True
    if (
        user.org_id
        and status.get("org_id") == user.org_id
        and status.get("visibility") == "org"
    ):
        return True
    return False


@router.post("/data", response_model=DashboardDataResponse)
async def get_dashboard_data(
    request: DashboardDataRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Fetch all posts (denormalized) for client-side dashboard filtering."""
    if not request.collection_ids:
        raise HTTPException(status_code=400, detail="collection_ids is required")

    fs = get_fs()

    # Validate access for each collection
    for cid in request.collection_ids:
        status = fs.get_collection_status(cid)
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if not _can_access_collection(user, status):
            raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    bq = get_bq()
    params = {"collection_ids": request.collection_ids}

    # Fetch posts + collection names in parallel
    sql = DASHBOARD_SQL.format(max_rows=MAX_ROWS + 1)  # +1 to detect truncation

    rows, name_rows = await asyncio.gather(
        asyncio.to_thread(bq.query, sql, params),
        asyncio.to_thread(bq.query, COLLECTION_NAMES_SQL, params),
    )

    truncated = len(rows) > MAX_ROWS
    if truncated:
        rows = rows[:MAX_ROWS]

    collection_names = {
        r["collection_id"]: r.get("original_question", r["collection_id"])
        for r in name_rows
    }

    posts = [build_post_response(row) for row in rows]

    return DashboardDataResponse(
        posts=posts,
        collection_names=collection_names,
        truncated=truncated,
    )
