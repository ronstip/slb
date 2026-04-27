"""Admin router — Super admin endpoints for platform-wide analytics."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from api.auth.admin import is_super_admin_email, require_super_admin
from api.auth.dependencies import CurrentUser, get_current_user, get_real_user
from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_user(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Dependency that enforces super admin access."""
    require_super_admin(user)
    return user


def _real_admin_user(user: CurrentUser = Depends(get_real_user)) -> CurrentUser:
    """Enforces super admin status on the REAL caller, ignoring impersonation.

    Used by impersonation endpoints so they always resolve against the true
    Firebase-authenticated super admin, even if an impersonation header is
    set (e.g. stop-impersonation while a session is active).
    """
    require_super_admin(user)
    return user


# ---------------------------------------------------------------------------
# Admin check
# ---------------------------------------------------------------------------


@router.get("/check")
async def admin_check(user: CurrentUser = Depends(_admin_user)):
    """Verify the current user has super admin access."""
    return {"is_admin": True}


# ---------------------------------------------------------------------------
# Overview — platform-wide KPIs
# ---------------------------------------------------------------------------


@router.get("/overview")
async def admin_overview(user: CurrentUser = Depends(_admin_user)):
    """Platform-wide KPIs: total users, active users, queries, collections, posts, revenue."""
    fs = get_fs()
    bq = get_bq()

    # Firestore queries (run in thread pool)
    all_users, all_orgs, all_purchases = await asyncio.gather(
        asyncio.to_thread(fs.list_all_users),
        asyncio.to_thread(fs.list_all_orgs),
        asyncio.to_thread(fs.get_all_credit_purchases),
    )

    total_users = len(all_users)

    # Revenue from purchases
    total_revenue_cents = sum(p.get("amount_cents", 0) for p in all_purchases)
    total_credits_purchased = sum(p.get("credits", 0) for p in all_purchases)

    # Credits outstanding (sum of credits_remaining across users + orgs)
    credits_outstanding = sum(u.get("credits_remaining", 0) for u in all_users)
    credits_outstanding += sum(o.get("credits_remaining", 0) for o in all_orgs)

    # Get real totals from source-of-truth tables (not just usage_events)
    now = datetime.now(timezone.utc)
    thirty_days_ago = (now - timedelta(days=30)).strftime("%Y-%m-%d")

    # Total posts + collections from BQ (the actual data)
    # Active users from usage_events (only tracks since tracking was enabled)
    try:
        real_totals, active_users_rows = await asyncio.gather(
            asyncio.to_thread(
                bq.query,
                """
                SELECT
                    (SELECT COUNT(*) FROM social_listening.posts) AS total_posts,
                    (SELECT COUNT(*) FROM social_listening.collections) AS total_collections,
                    (
                        SELECT COUNTIF(p.posted_at BETWEEN c.time_range_start AND c.time_range_end)
                        FROM social_listening.posts p
                        JOIN social_listening.collections c USING (collection_id)
                    ) AS total_posts_in_range,
                    (
                        SELECT COUNT(*)
                        FROM social_listening.enriched_posts
                        WHERE is_related_to_task = TRUE
                    ) AS total_posts_related
                """,
            ),
            asyncio.to_thread(
                bq.query,
                """
                SELECT
                    COUNT(DISTINCT CASE WHEN event_type = 'chat_message' THEN user_id END) AS active_users_30d,
                    COUNTIF(event_type = 'chat_message') AS total_queries
                FROM social_listening.usage_events
                WHERE created_at >= TIMESTAMP(@start_date)
                """,
                {"start_date": thirty_days_ago},
            ),
        )
        totals = real_totals[0] if real_totals else {}
        active = active_users_rows[0] if active_users_rows else {}
    except Exception as e:
        logger.warning("BQ overview query failed: %s", e)
        totals = {}
        active = {}

    # Also sum posts from Firestore collection_status as a cross-check
    all_collections_fs = await asyncio.to_thread(fs.list_all_collection_statuses, 1000)
    fs_total_posts = sum(c.get("posts_collected", 0) for c in all_collections_fs)

    total_posts = totals.get("total_posts", 0) or fs_total_posts
    total_posts_related = totals.get("total_posts_related", 0)
    avg_relevancy_pct = (
        round(total_posts_related / total_posts * 100, 1) if total_posts else 0.0
    )

    return {
        "total_users": total_users,
        "total_orgs": len(all_orgs),
        "active_users_30d": active.get("active_users_30d", 0),
        "total_queries": active.get("total_queries", 0),
        "total_collections": totals.get("total_collections", 0) or len(all_collections_fs),
        "total_posts": total_posts,
        "total_posts_in_range": totals.get("total_posts_in_range", 0),
        "total_posts_related": total_posts_related,
        "avg_relevancy_pct": avg_relevancy_pct,
        "total_revenue_cents": total_revenue_cents,
        "total_credits_purchased": total_credits_purchased,
        "credits_outstanding": credits_outstanding,
    }


# ---------------------------------------------------------------------------
# Users — list + detail
# ---------------------------------------------------------------------------


@router.get("/users")
async def admin_users(
    sort_by: str = Query("created_at", pattern="^(created_at|last_login_at|email|queries_used|collections_created|posts_collected)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str = Query("", description="Search by email or display name"),
    exclude_super_admins: bool = Query(False, description="Hide super admins from results"),
    user: CurrentUser = Depends(_admin_user),
):
    """List all platform users with their usage counters."""
    fs = get_fs()

    all_users, all_collections_fs = await asyncio.gather(
        asyncio.to_thread(fs.list_all_users),
        asyncio.to_thread(fs.list_all_collection_statuses, 1000),
    )

    if exclude_super_admins:
        all_users = [u for u in all_users if not is_super_admin_email(u.get("email"))]

    # Build per-user posts/collections counts from collection_status (source of truth)
    user_posts_map: dict[str, int] = {}
    user_collections_map: dict[str, int] = {}
    for c in all_collections_fs:
        uid = c.get("user_id", "")
        if uid:
            user_posts_map[uid] = user_posts_map.get(uid, 0) + c.get("posts_collected", 0)
            user_collections_map[uid] = user_collections_map.get(uid, 0) + 1

    # Fetch usage counters for query counts — single batched round-trip
    # instead of one Firestore read per user (N+1).
    try:
        usage_map = await asyncio.to_thread(
            fs.get_usage_many, [u["uid"] for u in all_users]
        )
    except Exception:
        logger.exception("Batch usage fetch failed — continuing with empty usage")
        usage_map = {}

    # Merge usage into user records
    users = []
    for u in all_users:
        uid = u["uid"]
        usage = usage_map.get(uid, {})
        users.append({
            "uid": uid,
            "email": u.get("email", ""),
            "display_name": u.get("display_name"),
            "photo_url": u.get("photo_url"),
            "org_id": u.get("org_id"),
            "org_role": u.get("org_role"),
            "created_at": u.get("created_at", ""),
            "last_login_at": u.get("last_login_at", ""),
            "queries_used": usage.get("queries_used", 0),
            "collections_created": user_collections_map.get(uid, 0),
            "posts_collected": user_posts_map.get(uid, 0),
            "credits_remaining": u.get("credits_remaining", 0),
        })

    # Search filter
    if search:
        search_lower = search.lower()
        users = [
            u for u in users
            if search_lower in (u.get("email") or "").lower()
            or search_lower in (u.get("display_name") or "").lower()
        ]

    # Sort
    reverse = order == "desc"
    users.sort(key=lambda u: u.get(sort_by) or "", reverse=reverse)

    total = len(users)
    users = users[offset : offset + limit]

    return {"users": users, "total": total}


@router.get("/users/{user_id}")
async def admin_user_detail(
    user_id: str,
    user: CurrentUser = Depends(_admin_user),
):
    """Detailed view of a single user: profile, usage, credits, recent events."""
    fs = get_fs()
    bq = get_bq()

    user_doc, usage, user_collections = await asyncio.gather(
        asyncio.to_thread(fs.get_user, user_id),
        asyncio.to_thread(fs.get_usage, user_id),
        asyncio.to_thread(fs.list_all_collection_statuses, 1000),
    )

    if not user_doc:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")

    # Aggregate posts/collections from collection_status (source of truth)
    user_total_posts = sum(
        c.get("posts_collected", 0) for c in user_collections if c.get("user_id") == user_id
    )
    user_total_collections = sum(
        1 for c in user_collections if c.get("user_id") == user_id
    )

    # Convert timestamps
    for key in ("created_at", "last_login_at"):
        if key in user_doc and hasattr(user_doc[key], "isoformat"):
            user_doc[key] = user_doc[key].isoformat()

    # Credit balance (check org first)
    org_id = user_doc.get("org_id")
    if org_id:
        org = await asyncio.to_thread(fs.get_org, org_id)
        credits_remaining = org.get("credits_remaining", 0) if org else 0
    else:
        credits_remaining = user_doc.get("credits_remaining", 0)

    # Recent events from BigQuery
    try:
        recent_events = await asyncio.to_thread(
            bq.query,
            """
            SELECT event_id, event_type, session_id, collection_id, metadata, created_at
            FROM social_listening.usage_events
            WHERE user_id = @uid
            ORDER BY created_at DESC
            LIMIT 50
            """,
            {"uid": user_id},
        )
    except Exception as e:
        logger.warning("BQ recent events query failed for %s: %s", user_id, e)
        recent_events = []

    # Usage trend (last 30 days)
    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=30)
    try:
        daily_logs = await asyncio.to_thread(fs.get_usage_daily, user_id, start_date, now)
    except Exception:
        daily_logs = {}

    trend = []
    for i in range(30):
        day = start_date + timedelta(days=i + 1)
        day_str = day.strftime("%Y-%m-%d")
        entry = daily_logs.get(day_str, {})
        trend.append({
            "date": day_str,
            "queries": entry.get("queries", 0),
            "collections": entry.get("collections", 0),
            "posts": entry.get("posts", 0),
        })

    return {
        "uid": user_id,
        "email": user_doc.get("email", ""),
        "display_name": user_doc.get("display_name"),
        "photo_url": user_doc.get("photo_url"),
        "org_id": org_id,
        "org_role": user_doc.get("org_role"),
        "created_at": user_doc.get("created_at", ""),
        "last_login_at": user_doc.get("last_login_at", ""),
        "queries_used": usage.get("queries_used", 0),
        "collections_created": user_total_collections,
        "posts_collected": user_total_posts,
        "credits_remaining": credits_remaining,
        "recent_events": recent_events,
        "usage_trend": trend,
    }


# ---------------------------------------------------------------------------
# Activity — daily breakdown by event type
# ---------------------------------------------------------------------------


@router.get("/activity")
async def admin_activity(
    days: int = Query(30, ge=1, le=365),
    user: CurrentUser = Depends(_admin_user),
):
    """Daily activity breakdown by event type (from BigQuery usage_events)."""
    bq = get_bq()

    start_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    try:
        rows = await asyncio.to_thread(
            bq.query,
            """
            SELECT
                FORMAT_TIMESTAMP('%Y-%m-%d', created_at) AS date,
                event_type,
                COUNT(*) AS count
            FROM social_listening.usage_events
            WHERE created_at >= TIMESTAMP(@start_date)
            GROUP BY date, event_type
            ORDER BY date
            """,
            {"start_date": start_date},
        )
    except Exception as e:
        logger.warning("BQ activity query failed: %s", e)
        rows = []

    return {"points": rows}


# ---------------------------------------------------------------------------
# Collections — platform-wide
# ---------------------------------------------------------------------------


@router.get("/collections")
async def admin_collections(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status_filter: str = Query("", description="Filter by status"),
    user: CurrentUser = Depends(_admin_user),
):
    """List all collections platform-wide with status and user info."""
    fs = get_fs()

    all_collections = await asyncio.to_thread(fs.list_all_collection_statuses, limit=500)

    # Get unique user_ids to resolve emails
    user_ids = list({c.get("user_id", "") for c in all_collections if c.get("user_id")})
    user_map: dict[str, dict] = {}
    if user_ids:
        async def _get_user(uid: str) -> tuple[str, dict]:
            try:
                doc = await asyncio.to_thread(fs.get_user, uid)
                return uid, doc or {}
            except Exception:
                return uid, {}

        results = await asyncio.gather(*[_get_user(uid) for uid in user_ids])
        user_map = dict(results)

    collections = []
    for c in all_collections:
        uid = c.get("user_id", "")
        user_doc = user_map.get(uid, {})
        config = c.get("config") or {}
        platforms = config.get("platforms", [])

        run_log = c.get("run_log") or {}
        funnel = run_log.get("funnel") or {}
        posts_stored = funnel.get("worker_posts_stored")  # None if no funnel data yet
        bd_raw_records = funnel.get("bd_raw_records")  # None if no funnel data yet

        collections.append({
            "collection_id": c.get("collection_id", ""),
            "user_id": uid,
            "user_email": user_doc.get("email", ""),
            "org_id": c.get("org_id"),
            "original_question": config.get("original_question", ""),
            "status": c.get("status", "unknown"),
            "posts_collected": c.get("posts_collected", 0),
            "posts_enriched": c.get("posts_enriched", 0),
            "posts_embedded": c.get("posts_embedded", 0),
            "posts_stored": posts_stored,
            "bd_raw_records": bd_raw_records,
            "platforms": platforms if isinstance(platforms, list) else [],
            "created_at": c.get("created_at", ""),
            "error_message": c.get("error_message"),
        })

    # Filter by status
    if status_filter:
        collections = [c for c in collections if c["status"] == status_filter]

    total = len(collections)
    collections = collections[offset : offset + limit]

    # Overlay BQ ground truth for stored/enriched/embedded on the visible page.
    # Firestore counters lag (worker_posts_stored is written only at crawl-complete;
    # posts_enriched drifts across runner restarts/continuations). A single grouped
    # query gives authoritative counts for the visible rows.
    visible_ids = [c["collection_id"] for c in collections if c.get("collection_id")]
    if visible_ids:
        try:
            bq = get_bq()
            rows = await asyncio.to_thread(
                bq.query,
                "SELECT p.collection_id AS collection_id, "
                "COUNT(DISTINCT p.post_id) AS stored, "
                "COUNTIF(p.posted_at BETWEEN c.time_range_start AND c.time_range_end) AS in_range, "
                "COUNT(DISTINCT e.post_id) AS enriched, "
                "COUNT(DISTINCT IF(e.is_related_to_task = TRUE, e.post_id, NULL)) AS related, "
                "COUNT(DISTINCT em.post_id) AS embedded "
                "FROM social_listening.posts p "
                "JOIN social_listening.collections c USING (collection_id) "
                "LEFT JOIN social_listening.enriched_posts e USING (post_id) "
                "LEFT JOIN social_listening.post_embeddings em USING (post_id) "
                "WHERE p.collection_id IN UNNEST(@ids) "
                "GROUP BY p.collection_id",
                {"ids": visible_ids},
            )
            bq_by_id = {r["collection_id"]: r for r in rows}
            for c in collections:
                r = bq_by_id.get(c["collection_id"])
                if r is None:
                    continue
                # BQ is authoritative — overwrite even if Firestore has a value.
                c["posts_stored"] = int(r["stored"])
                c["posts_enriched"] = int(r["enriched"])
                c["posts_embedded"] = int(r["embedded"])
                c["posts_in_range"] = int(r["in_range"])
                c["posts_related"] = int(r["related"])
                stored = int(r["stored"])
                c["relevancy_pct"] = round(int(r["related"]) / stored * 100, 1) if stored else 0.0
        except Exception:
            logger.exception("BQ count overlay failed for admin collections list")

    # Compute aggregate funnel stats across all collections
    funnel_summary = {
        "total_bd_raw_records": 0,
        "total_bd_error_items": 0,
        "total_bd_dedup": 0,
        "total_bd_parse_failures": 0,
        "total_posts_stored": 0,
        "total_posts_collected_fs": 0,
    }
    for c in all_collections:
        run_log = c.get("run_log") or {}
        funnel = run_log.get("funnel") or {}
        funnel_summary["total_bd_raw_records"] += funnel.get("bd_raw_records", 0)
        funnel_summary["total_bd_error_items"] += funnel.get("bd_error_items_filtered", 0)
        funnel_summary["total_bd_dedup"] += (
            funnel.get("bd_cross_keyword_dedup", 0)
            + funnel.get("worker_in_memory_dedup", 0)
            + funnel.get("worker_bq_dedup", 0)
        )
        funnel_summary["total_bd_parse_failures"] += funnel.get("bd_parse_failures", 0)
        funnel_summary["total_posts_stored"] += funnel.get("worker_posts_stored", 0)
        funnel_summary["total_posts_collected_fs"] += c.get("posts_collected", 0)

    return {"collections": collections, "total": total, "funnel_summary": funnel_summary}


@router.get("/collections/{collection_id}/audit")
async def admin_collection_audit(
    collection_id: str,
    user: CurrentUser = Depends(_admin_user),
):
    """Audit data for a single collection: funnel breakdown, snapshots, BQ vs Firestore counts."""
    fs = get_fs()
    bq = get_bq()

    status = await asyncio.to_thread(fs.get_collection_status, collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")

    run_log = status.get("run_log") or {}
    funnel = run_log.get("funnel") or {}

    # Get all snapshots for this collection
    snapshots = await asyncio.to_thread(fs.get_collection_snapshots, collection_id)

    # Count actual distinct posts in BQ
    stored_posts_bq = None
    try:
        rows = await asyncio.to_thread(
            bq.query,
            "SELECT COUNT(DISTINCT post_id) as stored_posts "
            "FROM social_listening.posts WHERE collection_id = @collection_id",
            {"collection_id": collection_id},
        )
        stored_posts_bq = rows[0]["stored_posts"] if rows else 0
    except Exception as e:
        logger.warning("BQ post count query failed for %s: %s", collection_id, e)

    # Compute discrepancy indicators
    bd_raw = funnel.get("bd_raw_records", 0)
    posts_stored = funnel.get("worker_posts_stored", 0)
    discrepancy_pct = round((1 - posts_stored / bd_raw) * 100, 1) if bd_raw > 0 else 0

    return {
        "collection_id": collection_id,
        "status": status.get("status"),
        "error_message": status.get("error_message"),
        "posts_collected_firestore": status.get("posts_collected", 0),
        "posts_enriched": status.get("posts_enriched", 0),
        "posts_stored_bq": stored_posts_bq,
        "discrepancy_pct": discrepancy_pct,
        "funnel": funnel,
        "snapshots": snapshots,
        "run_log": run_log,
    }


# ---------------------------------------------------------------------------
# Revenue
# ---------------------------------------------------------------------------


@router.get("/revenue")
async def admin_revenue(
    days: int = Query(90, ge=1, le=365),
    user: CurrentUser = Depends(_admin_user),
):
    """Revenue metrics: total, daily breakdown, recent purchases."""
    fs = get_fs()

    purchases = await asyncio.to_thread(fs.get_all_credit_purchases)

    # Convert timestamps for filtering
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_str = cutoff.isoformat()

    filtered = [
        p for p in purchases
        if (p.get("purchased_at") or "") >= cutoff_str
    ]

    total_revenue_cents = sum(p.get("amount_cents", 0) for p in filtered)
    total_purchases = len(filtered)
    avg_purchase_cents = total_revenue_cents // total_purchases if total_purchases else 0

    # Daily aggregation
    daily_map: dict[str, dict] = {}
    for p in filtered:
        purchased_at = p.get("purchased_at", "")
        day = purchased_at[:10] if len(purchased_at) >= 10 else "unknown"
        if day not in daily_map:
            daily_map[day] = {"date": day, "revenue_cents": 0, "purchases": 0}
        daily_map[day]["revenue_cents"] += p.get("amount_cents", 0)
        daily_map[day]["purchases"] += 1

    daily_revenue = sorted(daily_map.values(), key=lambda d: d["date"])

    # Recent purchases (last 20)
    recent = filtered[:20]
    recent_purchases = [
        {
            "purchased_at": p.get("purchased_at", ""),
            "credits": p.get("credits", 0),
            "amount_cents": p.get("amount_cents", 0),
            "user_id": p.get("user_id"),
            "org_id": p.get("org_id"),
            "purchased_by_name": p.get("purchased_by_name"),
        }
        for p in recent
    ]

    return {
        "total_revenue_cents": total_revenue_cents,
        "total_purchases": total_purchases,
        "avg_purchase_cents": avg_purchase_cents,
        "daily_revenue": daily_revenue,
        "recent_purchases": recent_purchases,
    }


# ---------------------------------------------------------------------------
# Impersonation — "View as User" for super admins
# ---------------------------------------------------------------------------


class ImpersonateStartRequest(BaseModel):
    target_uid: str


def _write_audit_entry(
    event: str,
    real_user: CurrentUser,
    target_uid: str | None,
    target_email: str | None,
    request: Request,
) -> None:
    """Append an entry to the impersonation_audit Firestore collection.

    Best-effort — failures are logged but do not block the request.
    """
    try:
        fs = get_fs()
        client_host = request.client.host if request.client else None
        entry = {
            "event": event,
            "real_uid": real_user.uid,
            "real_email": real_user.email,
            "target_uid": target_uid,
            "target_email": target_email,
            "occurred_at": datetime.now(timezone.utc),
            "ip": client_host,
            "user_agent": request.headers.get("user-agent", ""),
        }
        fs._db.collection("impersonation_audit").add(entry)
    except Exception:
        logger.exception("Failed to write impersonation audit entry")


@router.post("/impersonate/start", status_code=204)
async def impersonate_start(
    body: ImpersonateStartRequest,
    request: Request,
    real_user: CurrentUser = Depends(_real_admin_user),
):
    """Begin an impersonation session. Writes an audit log entry.

    This endpoint does NOT mutate server state — the actual impersonation
    is performed per-request via the `X-Impersonate-User-Id` header. This
    call exists to validate the target and record the start event.
    """
    target_uid = (body.target_uid or "").strip()
    if not target_uid:
        raise HTTPException(status_code=400, detail="target_uid is required")
    if target_uid == real_user.uid:
        raise HTTPException(status_code=400, detail="Cannot impersonate yourself")

    fs = get_fs()
    target_doc = await asyncio.to_thread(fs.get_user, target_uid)
    if not target_doc:
        raise HTTPException(status_code=404, detail="User not found")

    target_email = target_doc.get("email", "") or ""
    if is_super_admin_email(target_email):
        raise HTTPException(status_code=403, detail="Cannot impersonate another super admin")

    _write_audit_entry("start", real_user, target_uid, target_email, request)
    logger.info(
        "Impersonation START: %s -> %s (%s)",
        real_user.email, target_email, target_uid,
    )


@router.post("/impersonate/stop", status_code=204)
async def impersonate_stop(
    request: Request,
    real_user: CurrentUser = Depends(_real_admin_user),
):
    """End an impersonation session. Writes an audit log entry.

    Accepts requests regardless of whether an impersonation header is
    currently set — the frontend fires this during teardown.
    """
    target_uid = request.headers.get("X-Impersonate-User-Id", "").strip() or None
    target_email: str | None = None
    if target_uid:
        try:
            fs = get_fs()
            target_doc = await asyncio.to_thread(fs.get_user, target_uid)
            if target_doc:
                target_email = target_doc.get("email") or None
        except Exception:
            logger.warning(
                "impersonate_stop: target user lookup failed for uid=%s",
                target_uid,
                exc_info=True,
            )

    _write_audit_entry("stop", real_user, target_uid, target_email, request)
    logger.info("Impersonation STOP: %s", real_user.email)
