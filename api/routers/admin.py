"""Admin router — Super admin endpoints for platform-wide analytics."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from api.auth.admin import require_super_admin
from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_user(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Dependency that enforces super admin access."""
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
                    (SELECT COUNT(*) FROM social_listening.collections) AS total_collections
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

    return {
        "total_users": total_users,
        "total_orgs": len(all_orgs),
        "active_users_30d": active.get("active_users_30d", 0),
        "total_queries": active.get("total_queries", 0),
        "total_collections": totals.get("total_collections", 0) or len(all_collections_fs),
        "total_posts": totals.get("total_posts", 0) or fs_total_posts,
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
    user: CurrentUser = Depends(_admin_user),
):
    """List all platform users with their usage counters."""
    fs = get_fs()

    all_users, all_collections_fs = await asyncio.gather(
        asyncio.to_thread(fs.list_all_users),
        asyncio.to_thread(fs.list_all_collection_statuses, 1000),
    )

    # Build per-user posts/collections counts from collection_status (source of truth)
    user_posts_map: dict[str, int] = {}
    user_collections_map: dict[str, int] = {}
    for c in all_collections_fs:
        uid = c.get("user_id", "")
        if uid:
            user_posts_map[uid] = user_posts_map.get(uid, 0) + c.get("posts_collected", 0)
            user_collections_map[uid] = user_collections_map.get(uid, 0) + 1

    # Fetch usage counters for query counts
    async def _get_user_usage(uid: str) -> tuple[str, dict]:
        try:
            usage = await asyncio.to_thread(fs.get_usage, uid)
            return uid, usage
        except Exception:
            return uid, {}

    usage_results = await asyncio.gather(
        *[_get_user_usage(u["uid"]) for u in all_users]
    )
    usage_map = dict(usage_results)

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

        collections.append({
            "collection_id": c.get("collection_id", ""),
            "user_id": uid,
            "user_email": user_doc.get("email", ""),
            "org_id": c.get("org_id"),
            "original_question": config.get("original_question", ""),
            "status": c.get("status", "unknown"),
            "posts_collected": c.get("posts_collected", 0),
            "posts_enriched": c.get("posts_enriched", 0),
            "platforms": platforms if isinstance(platforms, list) else [],
            "ongoing": c.get("ongoing", False),
            "created_at": c.get("created_at", ""),
            "error_message": c.get("error_message"),
        })

    # Filter by status
    if status_filter:
        collections = [c for c in collections if c["status"] == status_filter]

    total = len(collections)
    collections = collections[offset : offset + limit]

    return {"collections": collections, "total": total}


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
