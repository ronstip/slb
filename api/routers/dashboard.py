"""Dashboard router — serves denormalized post data for client-side interactive dashboards."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.schemas.requests import DashboardDataRequest
from api.schemas.responses import DashboardDataResponse, DashboardKpis
from api.services.dashboard_service import (
    COLLECTION_NAMES_SQL,
    MAX_ROWS,
    build_dashboard_kpis_sql,
    build_dashboard_sql,
    build_post_response,
    derive_agent_id_for_collections,
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

    # Resolve agent context: explicit > derived from collections.
    agent_id = request.agent_id or derive_agent_id_for_collections(
        fs, request.collection_ids
    )

    # No agent context = collections never linked to an agent. We return an
    # empty dataset with collection names, since there's no agent-scoped view
    # to render. (Manual / pre-agent collections are not queryable here.)
    if not agent_id:
        name_rows = await asyncio.to_thread(
            bq.query, COLLECTION_NAMES_SQL, {"collection_ids": request.collection_ids}
        )
        collection_names = {
            r["collection_id"]: r.get("original_question", r["collection_id"])
            for r in name_rows
        }
        return DashboardDataResponse(
            posts=[],
            collection_names=collection_names,
            truncated=False,
            kpis=DashboardKpis(
                total_posts=0, total_views=0, total_likes=0,
                total_comments=0, total_shares=0,
            ),
        )

    # +1 to detect truncation
    posts_sql, posts_params = build_dashboard_sql(
        request.collection_ids, agent_id, MAX_ROWS + 1
    )
    kpis_sql, kpis_params = build_dashboard_kpis_sql(
        request.collection_ids, agent_id
    )

    rows, kpi_rows, name_rows = await asyncio.gather(
        asyncio.to_thread(bq.query, posts_sql, posts_params),
        asyncio.to_thread(bq.query, kpis_sql, kpis_params),
        asyncio.to_thread(bq.query, COLLECTION_NAMES_SQL, {"collection_ids": request.collection_ids}),
    )

    truncated = len(rows) > MAX_ROWS
    if truncated:
        rows = rows[:MAX_ROWS]

    collection_names = {
        r["collection_id"]: r.get("original_question", r["collection_id"])
        for r in name_rows
    }

    posts = [build_post_response(row) for row in rows]

    kpi_row = kpi_rows[0] if kpi_rows else {}
    kpis = DashboardKpis(
        total_posts=int(kpi_row.get("total_posts") or 0),
        total_views=int(kpi_row.get("total_views") or 0),
        total_likes=int(kpi_row.get("total_likes") or 0),
        total_comments=int(kpi_row.get("total_comments") or 0),
        total_shares=int(kpi_row.get("total_shares") or 0),
    )

    return DashboardDataResponse(
        posts=posts,
        collection_names=collection_names,
        truncated=truncated,
        kpis=kpis,
    )
