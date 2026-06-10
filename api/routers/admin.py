"""Admin router - Super admin endpoints for platform-wide analytics."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from api.auth.admin import is_super_admin_email, require_super_admin
from api.auth.dependencies import CurrentUser, get_current_user, get_real_user
from api.deps import get_bq, get_fs
from api.services.logging_utils import redact_email
from config import cost_rates

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
# Overview - platform-wide KPIs
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

    # §E: outstanding wallet liability - sum of remaining $ balances (USD micros).
    credit_outstanding_micros = sum(
        int((u.get("credit") or {}).get("balance_micros", 0)) for u in all_users
    )

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
                        SELECT COUNTIF(is_related_to_task = TRUE)
                        FROM (
                            SELECT *, ROW_NUMBER() OVER (
                                PARTITION BY post_id
                                ORDER BY agent_version DESC NULLS LAST, enriched_at DESC
                            ) AS _rn
                            FROM social_listening.enriched_posts
                        )
                        WHERE _rn = 1
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
        "credit_outstanding_micros": credit_outstanding_micros,
    }


# ---------------------------------------------------------------------------
# Users - list + detail
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

    # Fetch usage counters for query counts - single batched round-trip
    # instead of one Firestore read per user (N+1).
    try:
        usage_map = await asyncio.to_thread(
            fs.get_usage_many, [u["uid"] for u in all_users]
        )
    except Exception:
        logger.exception("Batch usage fetch failed - continuing with empty usage")
        usage_map = {}

    # §E: MTD + all-time $ spend per user - one grouped BigQuery query.
    # BigQuery bills per byte SCANNED, so one full scan + conditional SUM is
    # cheaper than two scans. We bill on BILLED amount (cost × margin) here
    # to match the Finance KPIs; numerically identical at margin = 1×.
    try:
        spend_rows = await asyncio.to_thread(
            get_bq().query,
            f"""
            SELECT user_id,
                   SUM({_REVENUE_EXPR}) AS total_micros,
                   SUM(CASE WHEN created_at >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)
                            THEN {_REVENUE_EXPR} END) AS mtd_micros
            FROM social_listening.usage_events
            WHERE cost_micros IS NOT NULL
            GROUP BY user_id
            """,
        )
        spend_map: dict[str, int] = {}
        total_spend_map: dict[str, int] = {}
        for r in spend_rows:
            uid = r["user_id"]
            spend_map[uid] = int(r.get("mtd_micros") or 0)
            total_spend_map[uid] = int(r.get("total_micros") or 0)
    except Exception:
        logger.warning("Spend query failed - continuing without spend", exc_info=True)
        spend_map = {}
        total_spend_map = {}

    # Merge usage into user records
    users = []
    for u in all_users:
        uid = u["uid"]
        # Skip phantom docs: `apply_spend_micros` merge-creates a users/{uid}
        # doc (credit map only) if cost is ever logged for a uid that was never
        # provisioned - e.g. the test placeholder "u1" or an orphaned id. They
        # have no email and no created_at; they aren't real accounts.
        if not u.get("email") and not u.get("created_at"):
            continue
        usage = usage_map.get(uid, {})
        plan = u.get("plan") or {}
        credit = u.get("credit") or {}
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
            "tier": plan.get("tier") or "blocked",
            "balance_micros": int(credit.get("balance_micros", 0)),
            "mtd_spend_micros": spend_map.get(uid, 0),
            "total_spend_micros": total_spend_map.get(uid, 0),
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


def _range_clause(range_key: str, start: str | None, end: str | None) -> tuple[str, dict]:
    """Build the SQL WHERE-suffix + params for a cost-breakdown date range.

    range_key: 'week' (this calendar week, Mon-start) | 'mtd' (this month) |
    'custom' (start/end inclusive, YYYY-MM-DD) | anything else = all time.
    """
    if range_key == "week":
        return " AND created_at >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), WEEK(MONDAY))", {}
    if range_key == "mtd":
        return " AND created_at >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MONTH)", {}
    if range_key == "custom":
        clause, params = "", {}
        if start:
            clause += " AND created_at >= TIMESTAMP(@start)"
            params["start"] = start
        if end:
            # End is inclusive of the whole day → use exclusive next-day bound.
            try:
                end_excl = (datetime.fromisoformat(end) + timedelta(days=1)).strftime("%Y-%m-%d")
            except ValueError:
                end_excl = end
            clause += " AND created_at < TIMESTAMP(@end_excl)"
            params["end_excl"] = end_excl
        return clause, params
    return "", {}


def _cost_breakdown(user_id: str, range_key: str = "mtd", start: str | None = None, end: str | None = None) -> dict:
    """Cost breakdown by provider + feature + platform from BigQuery (USD
    micros). Adds a (provider, platform) matrix so an admin can see Apify
    IG vs FB vs TikTok costs separately (each has a different per-call rate).
    """
    range_sql, range_params = _range_clause(range_key, start, end)
    where = "user_id = @uid AND cost_micros IS NOT NULL" + range_sql
    params = {"uid": user_id, **range_params}
    bq = get_bq()

    def _grouped(dimension: str) -> list[dict]:
        try:
            rows = bq.query(
                f"""
                SELECT {dimension} AS key, SUM(cost_micros) AS micros, COUNT(*) AS events
                FROM social_listening.usage_events
                WHERE {where}
                GROUP BY {dimension}
                ORDER BY micros DESC
                """,
                params,
            )
        except Exception as e:
            logger.warning("Cost breakdown (%s) failed for %s: %s", dimension, user_id, e)
            return []
        return [
            {"key": r.get("key") or "unknown", "micros": int(r.get("micros") or 0), "events": int(r.get("events") or 0)}
            for r in rows
        ]

    by_provider = _grouped("provider")
    by_feature = _grouped("feature")
    by_platform_provider = _platform_provider_matrix(where, params)
    total = sum(p["micros"] for p in by_provider)
    return {
        "total_micros": total,
        "by_provider": by_provider,
        "by_feature": by_feature,
        "by_platform_provider": by_platform_provider,
    }


def _platform_provider_matrix(where: str, params: dict) -> list[dict]:
    """Group ``usage_events`` rows by (platform, provider) so the UI can
    render a 2-D matrix. NULL platform → "unspecified" (LLM rows that
    aren't platform-scoped). NULL provider → "unknown".
    """
    bq = get_bq()
    try:
        rows = bq.query(
            f"""
            SELECT
                COALESCE(platform, 'unspecified') AS platform,
                COALESCE(provider, 'unknown') AS provider,
                SUM(cost_micros) AS cost_micros,
                SUM(COALESCE(billed_micros, cost_micros)) AS billed_micros,
                COUNT(*) AS events
            FROM social_listening.usage_events
            WHERE {where}
            GROUP BY platform, provider
            ORDER BY cost_micros DESC
            """,
            params,
        )
    except Exception as e:
        logger.warning("platform×provider matrix failed: %s", e)
        return []
    return [
        {
            "platform": r.get("platform") or "unspecified",
            "provider": r.get("provider") or "unknown",
            "cost_micros": int(r.get("cost_micros") or 0),
            "billed_micros": int(r.get("billed_micros") or 0),
            "events": int(r.get("events") or 0),
        }
        for r in rows
    ]


# Sentinel used in SQL to bucket rows with NULL agent_id. Translated back to
# `None` (+ "Unassigned" label) on the Python side. Must not collide with a
# real Firestore document id; the leading "_" makes that safe.
_UNASSIGNED_AGENT_KEY = "_unassigned"


def _agent_cost_breakdown(
    user_id: str,
    agent_meta: dict[str, dict],
    range_key: str = "all",
    start: str | None = None,
    end: str | None = None,
    fs=None,
) -> list[dict]:
    """Per-agent cost/billed rollup for one user.

    Rows with NULL ``agent_id`` (legacy events from before agents were
    introduced) bucket into an "Unassigned" group surfaced in the UI as a
    signal that some paid activity isn't tied to an agent - every priced
    event going forward should carry one.

    ``agent_meta`` is a ``{agent_id: agent_doc}`` map (passed by the caller
    so we don't hit Firestore once per agent inside the loop). Any agent_id
    that appears in BQ but isn't in the map is fetched via ``fs.get_agent``
    so the UI shows the agent's real name, not the raw id - covers agents
    that were deleted, transferred, or shared from another owner.
    """
    range_sql, range_params = _range_clause(range_key, start, end)
    where = "user_id = @uid AND cost_micros IS NOT NULL" + range_sql
    params = {"uid": user_id, **range_params}
    bq = get_bq()

    try:
        rows = bq.query(
            f"""
            SELECT COALESCE(agent_id, @unassigned) AS agent_id,
                   SUM(cost_micros) AS cost_micros,
                   SUM({_REVENUE_EXPR}) AS billed_micros,
                   COUNT(*) AS events,
                   MAX(created_at) AS last_event_at
            FROM social_listening.usage_events
            WHERE {where}
            GROUP BY agent_id
            ORDER BY cost_micros DESC
            """,
            {**params, "unassigned": _UNASSIGNED_AGENT_KEY},
        )
    except Exception as e:
        logger.warning("Agent cost breakdown failed for %s: %s", user_id, e)
        return []

    def _iso(v) -> str | None:
        """BQ TIMESTAMP comes back as a datetime; normalise to ISO (the FE
        sorts agents by this). Strings pass through; None stays None."""
        return v.isoformat() if hasattr(v, "isoformat") else (v or None)

    out: list[dict] = []
    for r in rows:
        aid = r.get("agent_id")
        if aid == _UNASSIGNED_AGENT_KEY or not aid:
            out.append({
                "agent_id": None,
                "agent_name": "Unassigned",
                "agent_icon": None,
                "cost_micros": int(r.get("cost_micros") or 0),
                "billed_micros": int(r.get("billed_micros") or 0),
                "events": int(r.get("events") or 0),
                "last_event_at": _iso(r.get("last_event_at")),
            })
            continue
        meta = agent_meta.get(aid)
        if meta is None and fs is not None:
            # Hydrate on-demand so deleted/cross-owner agents still resolve.
            try:
                meta = fs.get_agent(aid)
            except Exception:
                meta = None
            if meta:
                # Memoise so the second range query doesn't re-fetch.
                agent_meta[aid] = meta
        meta = meta or {}
        # Agent docs use `title` (api/routers/agents.py::create_agent_endpoint);
        # fall back to `name`/`display_name` for forward compat, then to the
        # raw id for orphans whose Firestore doc was deleted.
        out.append({
            "agent_id": aid,
            "agent_name": (
                meta.get("title")
                or meta.get("name")
                or meta.get("display_name")
                or aid
            ),
            "agent_icon": meta.get("icon"),
            "cost_micros": int(r.get("cost_micros") or 0),
            "billed_micros": int(r.get("billed_micros") or 0),
            "events": int(r.get("events") or 0),
            "last_event_at": _iso(r.get("last_event_at")),
        })
    return out


@router.get("/users/{user_id}")
async def admin_user_detail(
    user_id: str,
    user: CurrentUser = Depends(_admin_user),
):
    """Detailed view of a single user: profile, plan, $ wallet, cost breakdown,
    credit ledger, plan/credit audit log, usage trend, recent events."""
    fs = get_fs()
    bq = get_bq()

    user_doc, usage, user_collections, user_agents = await asyncio.gather(
        asyncio.to_thread(fs.get_user, user_id),
        asyncio.to_thread(fs.get_usage, user_id),
        asyncio.to_thread(fs.list_all_collection_statuses, 1000),
        asyncio.to_thread(fs.list_user_agents, user_id, None),
    )

    if not user_doc:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")

    # Index agents once so cost-by-agent doesn't hit Firestore per row.
    agent_meta: dict[str, dict] = {a.get("agent_id"): a for a in user_agents if a.get("agent_id")}

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

    # §E plan + $ wallet (per-user; no org inheritance).
    plan = user_doc.get("plan") or {}
    credit = user_doc.get("credit") or {}
    balance = int(credit.get("balance_micros", 0))
    total_in = int(credit.get("total_in_micros", 0))
    trial_expires_at = plan.get("trial_expires_at")
    if hasattr(trial_expires_at, "isoformat"):
        trial_expires_at = trial_expires_at.isoformat()

    org_id = user_doc.get("org_id")

    # Recent events, cost breakdowns, per-agent rollups, ledger, audit
    # (parallel where useful).
    cost_mtd, cost_all, agents_cost_mtd, agents_cost_all, ledger, audit = await asyncio.gather(
        asyncio.to_thread(_cost_breakdown, user_id, "mtd"),
        asyncio.to_thread(_cost_breakdown, user_id, "all"),
        asyncio.to_thread(_agent_cost_breakdown, user_id, agent_meta, "mtd", None, None, fs),
        asyncio.to_thread(_agent_cost_breakdown, user_id, agent_meta, "all", None, None, fs),
        asyncio.to_thread(fs.list_credit_transactions, user_id, 50),
        asyncio.to_thread(fs.list_admin_audit, user_id, 50),
    )

    try:
        # Pull a large window so the grouped Recent Activity shows every
        # priced event per agent - the UI default-collapses each accordion
        # so the wire size only matters when an admin actually expands one.
        # Cost-only view: hide bare counter rows (event_type=posts_collected
        # for Apify writes a row with cost_micros=NULL because Apify is
        # PROVIDER_REPORTED - rate-table lookup returns None for it; the real
        # cost shows up on the sibling provider_call row). Without the
        # filter, Recent Activity surfaces both side-by-side and the
        # NULL-cost counter row visually competes with the real $-cost row.
        recent_events = await asyncio.to_thread(
            bq.query,
            """
            SELECT event_id, event_type, feature, provider, model,
                   session_id, collection_id, agent_id,
                   cost_micros, billed_micros, created_at,
                   platform, cost_source
            FROM social_listening.usage_events
            WHERE user_id = @uid AND cost_micros IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1000
            """,
            {"uid": user_id},
        )
    except Exception as e:
        logger.warning("BQ recent events query failed for %s: %s", user_id, e)
        recent_events = []

    # Usage trend (last 30 days) - per-user cost vs revenue from usage_events
    # (replaces the old queries/collections/posts counters; the $ view is the
    # useful one now that we bill for usage).
    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=30)
    try:
        trend_rows = await asyncio.to_thread(
            bq.query,
            f"""
            SELECT FORMAT_DATE('%Y-%m-%d', DATE(created_at)) AS date,
                   SUM(cost_micros) AS cost, SUM({_REVENUE_EXPR}) AS revenue
            FROM social_listening.usage_events
            WHERE user_id = @uid AND cost_micros IS NOT NULL
                  AND created_at >= TIMESTAMP(@start)
            GROUP BY date
            """,
            {"uid": user_id, "start": start_date.strftime("%Y-%m-%d")},
        )
    except Exception as e:
        logger.warning("BQ usage trend query failed for %s: %s", user_id, e)
        trend_rows = []

    by_day = {r.get("date"): r for r in trend_rows}
    trend = []
    for i in range(30):
        day_str = (start_date + timedelta(days=i + 1)).strftime("%Y-%m-%d")
        row = by_day.get(day_str) or {}
        trend.append({
            "date": day_str,
            "cost_micros": int(row.get("cost") or 0),
            "billed_micros": int(row.get("revenue") or 0),
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
        "agents_count": len(user_agents),
        "plan": {
            "tier": plan.get("tier") or "blocked",
            "trial_expires_at": trial_expires_at,
            "notes": plan.get("notes", ""),
        },
        "credit": {
            "balance_micros": balance,
            "total_in_micros": total_in,
            "spent_micros": int(credit.get("spent_micros", 0)),
            "progress_pct": round(balance / total_in * 100, 1) if total_in > 0 else 0.0,
        },
        "cost_mtd": cost_mtd,
        "cost_all_time": cost_all,
        "cost_by_agent_mtd": agents_cost_mtd,
        "cost_by_agent_all_time": agents_cost_all,
        "credit_transactions": ledger,
        "audit_log": audit,
        "recent_events": recent_events,
        "usage_trend": trend,
    }


# ---------------------------------------------------------------------------
# §E - plan + credit administration (super-admin only)
# ---------------------------------------------------------------------------


class UpdatePlanRequest(BaseModel):
    tier: str  # blocked | free | trial | paid
    trial_expires_at: str | None = None  # ISO date/datetime; trial only
    notes: str | None = None


class GrantCreditRequest(BaseModel):
    amount_micros: int | None = None  # exact micros, OR
    amount_cents: int | None = None  # convenience: dollars*100
    reason: str = ""
    kind: str = "grant"  # grant | adjustment | refund


_VALID_TIERS = {"blocked", "free", "trial", "paid"}


@router.patch("/users/{user_id}/plan")
async def admin_update_plan(
    user_id: str,
    body: UpdatePlanRequest,
    admin: CurrentUser = Depends(_admin_user),
):
    """Set a user's entitlement tier (+ optional trial expiry / notes)."""
    if body.tier not in _VALID_TIERS:
        raise HTTPException(status_code=400, detail=f"tier must be one of {sorted(_VALID_TIERS)}")

    fs = get_fs()
    target = await asyncio.to_thread(fs.get_user, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    before = target.get("plan") or {}

    trial_expires_at = None
    if body.tier == "trial" and body.trial_expires_at:
        try:
            trial_expires_at = datetime.fromisoformat(body.trial_expires_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="trial_expires_at must be ISO format")

    fields: dict = {"tier": body.tier, "trial_expires_at": trial_expires_at, "updated_by": admin.uid}
    if body.notes is not None:
        fields["notes"] = body.notes

    await asyncio.to_thread(fs.set_plan, user_id, **fields)

    from api.services import entitlements
    entitlements.invalidate(user_id)

    await asyncio.to_thread(
        fs.write_admin_audit,
        {
            "event": "plan_change",
            "target_uid": user_id,
            "target_email": target.get("email"),
            "actor_uid": admin.uid,
            "actor_email": admin.email,
            "before": {"tier": before.get("tier")},
            "after": {"tier": body.tier, "trial_expires_at": body.trial_expires_at, "notes": body.notes},
        },
    )
    logger.info("Admin %s set tier=%s on %s", admin.email, body.tier, user_id)
    return {"status": "ok", "tier": body.tier}


@router.post("/users/{user_id}/credit")
async def admin_grant_credit(
    user_id: str,
    body: GrantCreditRequest,
    admin: CurrentUser = Depends(_admin_user),
):
    """Grant / adjust a user's $ wallet. Amount in micros or cents."""
    if body.amount_micros is not None:
        amount = int(body.amount_micros)
    elif body.amount_cents is not None:
        amount = int(body.amount_cents) * 10_000
    else:
        raise HTTPException(status_code=400, detail="amount_micros or amount_cents required")
    if amount == 0:
        raise HTTPException(status_code=400, detail="amount must be non-zero")
    if body.kind not in {"grant", "adjustment", "refund"}:
        raise HTTPException(status_code=400, detail="invalid kind")

    fs = get_fs()
    target = await asyncio.to_thread(fs.get_user, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    new_balance = await asyncio.to_thread(
        fs.add_credit_micros, user_id, amount, body.kind, body.reason, admin.uid, None,
    )

    from api.services import entitlements
    entitlements.invalidate(user_id)

    await asyncio.to_thread(
        fs.write_admin_audit,
        {
            "event": "credit_grant",
            "target_uid": user_id,
            "target_email": target.get("email"),
            "actor_uid": admin.uid,
            "actor_email": admin.email,
            "after": {"amount_micros": amount, "kind": body.kind, "reason": body.reason, "balance_after_micros": new_balance},
        },
    )
    logger.info("Admin %s %s %d micros to %s", admin.email, body.kind, amount, user_id)
    return {"status": "ok", "balance_micros": new_balance}


@router.get("/users/{user_id}/cost")
async def admin_user_cost(
    user_id: str,
    range: str = Query("mtd", pattern="^(week|mtd|all|custom)$"),
    start: str | None = Query(None, description="ISO date (custom range)"),
    end: str | None = Query(None, description="ISO date, inclusive (custom range)"),
    admin: CurrentUser = Depends(_admin_user),
):
    """Cost breakdown by provider + feature for a user (week | mtd | all | custom)."""
    return await asyncio.to_thread(_cost_breakdown, user_id, range, start, end)


# ---------------------------------------------------------------------------
# Activity - daily breakdown by event type
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
# Collections - platform-wide
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
    #
    # Both enriched_posts and post_embeddings lack a collection_id stamp, so a
    # naive USING(post_id) join inflates counts whenever the same post appears
    # in sibling collections (very common - shared keywords/sources). The funnel
    # column should reflect "what THIS run did", so we filter per-collection:
    # - enriched: (agent_id, agent_version) matches the collection's owning
    #   agent AND enriched_at >= collection.created_at. The agent match mirrors
    #   the pipeline's _prime_idempotency_cache skip key; the time window
    #   excludes posts already enriched by a sibling collection (which the
    #   pipeline correctly cache-skips and does not re-enrich this run).
    # - embedded: embedded_at >= collection.created_at. post_embeddings has no
    #   agent stamp, so time-window is the only available proxy. Collections
    #   that ran after PIPELINE_EMBED_STEP_ENABLED was turned off naturally
    #   show 0.
    visible_ids = [c["collection_id"] for c in collections if c.get("collection_id")]
    if visible_ids:
        try:
            bq = get_bq()
            status_by_id = {c.get("collection_id"): c for c in all_collections}

            def _sql_str(v) -> str:
                if v is None or v == "":
                    return "NULL"
                return "'" + str(v).replace("'", "''") + "'"

            def _sql_int(v) -> str:
                if v is None:
                    return "NULL"
                try:
                    return str(int(v))
                except (TypeError, ValueError):
                    return "NULL"

            def _sql_ts(v) -> str:
                if not v:
                    return "NULL"
                if hasattr(v, "isoformat"):
                    v = v.isoformat()
                return f"SAFE.TIMESTAMP({_sql_str(v)})"

            triples_sql = ",\n".join(
                "STRUCT("
                f"{_sql_str(cid)} AS collection_id, "
                f"{_sql_str((status_by_id.get(cid) or {}).get('agent_id'))} AS agent_id, "
                f"{_sql_int((status_by_id.get(cid) or {}).get('agent_version'))} AS agent_version, "
                f"{_sql_ts((status_by_id.get(cid) or {}).get('created_at'))} AS started_at)"
                for cid in visible_ids
            )

            rows = await asyncio.to_thread(
                bq.query,
                "WITH collection_agent AS ("
                f"  SELECT * FROM UNNEST([{triples_sql}])"
                "), first_seen AS ("
                "  SELECT post_id, collection_id AS first_collection_id FROM ("
                "    SELECT post_id, collection_id, "
                "      ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at, collection_id) AS rn "
                "    FROM social_listening.posts "
                "    WHERE post_id IN ("
                "      SELECT post_id FROM social_listening.posts "
                "      WHERE collection_id IN UNNEST(@ids)"
                "    )"
                "  ) WHERE rn = 1"
                ") "
                "SELECT p.collection_id AS collection_id, "
                "COUNT(DISTINCT p.post_id) AS stored, "
                "COUNTIF(p.posted_at BETWEEN c.time_range_start AND c.time_range_end) AS in_range, "
                "COUNT(DISTINCT IF(fs.first_collection_id = p.collection_id, p.post_id, NULL)) AS unique_posts, "
                "COUNT(DISTINCT e.post_id) AS enriched, "
                "COUNT(DISTINCT IF(e.is_related_to_task = TRUE, e.post_id, NULL)) AS related, "
                "COUNT(DISTINCT em.post_id) AS embedded "
                "FROM social_listening.posts p "
                "JOIN social_listening.collections c USING (collection_id) "
                "JOIN collection_agent ca ON ca.collection_id = p.collection_id "
                "LEFT JOIN social_listening.enriched_posts e "
                "  ON e.post_id = p.post_id "
                "  AND e.agent_id IS NOT DISTINCT FROM ca.agent_id "
                "  AND e.agent_version IS NOT DISTINCT FROM ca.agent_version "
                "  AND (ca.started_at IS NULL OR e.enriched_at >= ca.started_at) "
                "LEFT JOIN social_listening.post_embeddings em "
                "  ON em.post_id = p.post_id "
                "  AND (ca.started_at IS NULL OR em.embedded_at >= ca.started_at) "
                "LEFT JOIN first_seen fs ON fs.post_id = p.post_id "
                "WHERE p.collection_id IN UNNEST(@ids) "
                "GROUP BY p.collection_id",
                {"ids": visible_ids},
            )
            bq_by_id = {r["collection_id"]: r for r in rows}
            for c in collections:
                r = bq_by_id.get(c["collection_id"])
                if r is None:
                    continue
                # BQ is authoritative - overwrite even if Firestore has a value.
                c["posts_stored"] = int(r["stored"])
                c["posts_enriched"] = int(r["enriched"])
                c["posts_embedded"] = int(r["embedded"])
                c["posts_in_range"] = int(r["in_range"])
                c["posts_unique"] = int(r["unique_posts"])
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

    # Compute discrepancy indicators (raw = every record we paid a provider
    # for: BrightData records + HikerAPI extracted media).
    raw_records = (funnel.get("bd_raw_records") or 0) + (funnel.get("hiker_raw_media") or 0)
    posts_stored = funnel.get("worker_posts_stored", 0)
    discrepancy_pct = round((1 - posts_stored / raw_records) * 100, 1) if raw_records > 0 else 0

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
# Finance - platform-wide economics (§E).
#   cost      = SUM(usage_events.cost_micros)        - what WE pay providers (all usage)
#   revenue   = SUM(credit_transactions purchases)   - real cash users paid us
#   granted   = non-purchase credit-in (admin grants/adjustments) - NOT revenue
#   net       = revenue − cost                       - true P&L (negative while
#               you subsidise free/trial/test usage with no paying customers)
# billed_micros (cost × margin) is still tracked per usage row and surfaced in
# the by-tier breakdown as "usage value", but it is NOT counted as revenue -
# a wallet funded by an admin grant isn't money we earned.
# ---------------------------------------------------------------------------

_REVENUE_EXPR = "COALESCE(billed_micros, cost_micros)"


def _range_bounds(range_key: str, start: str | None, end: str | None):
    """Python [start, end) datetimes mirroring `_range_clause` (for the credit
    ledger, which we filter in Python rather than SQL). Returns (start, end),
    either of which may be None (= unbounded)."""
    now = datetime.now(timezone.utc)
    if range_key == "week":
        monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return monday, None
    if range_key == "mtd":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), None
    if range_key == "custom":
        s = e = None
        if start:
            try:
                s = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
            except ValueError:
                s = None
        if end:
            try:
                e = (datetime.fromisoformat(end) + timedelta(days=1)).replace(tzinfo=timezone.utc)
            except ValueError:
                e = None
        return s, e
    return None, None


def _finance_breakdown(
    range_key: str,
    start: str | None,
    end: str | None,
    tier_by_uid: dict[str, str],
    credit: dict[str, int],
    unspent_purchased_micros: int = 0,
) -> dict:
    """Platform economics: provider cost (BQ) vs real revenue (purchases).

    Revenue is cash users actually paid (`credit['purchase']`); admin grants and
    all usage-derived "billed" amounts are NOT revenue. The by-tier breakdown
    still shows usage cost/value per tier so internal/free spend is visible.
    """
    range_sql, params = _range_clause(range_key, start, end)
    where = "cost_micros IS NOT NULL" + range_sql
    bq = get_bq()

    def _one(sql: str) -> list[dict]:
        try:
            return list(bq.query(sql, params))
        except Exception as e:
            logger.warning("Finance query failed: %s", e)
            return []

    totals = _one(
        f"""
        SELECT SUM(cost_micros) AS cost, SUM({_REVENUE_EXPR}) AS revenue, COUNT(*) AS events
        FROM social_listening.usage_events WHERE {where}
        """
    )
    t = totals[0] if totals else {}
    cost_micros = int(t.get("cost") or 0)
    revenue_micros = int(t.get("revenue") or 0)

    def _grouped(dimension: str) -> list[dict]:
        rows = _one(
            f"""
            SELECT {dimension} AS key, SUM(cost_micros) AS cost,
                   SUM({_REVENUE_EXPR}) AS revenue, COUNT(*) AS events
            FROM social_listening.usage_events WHERE {where}
            GROUP BY {dimension} ORDER BY cost DESC
            """
        )
        return [
            {
                "key": r.get("key") or "unknown",
                "cost_micros": int(r.get("cost") or 0),
                "revenue_micros": int(r.get("revenue") or 0),
                "events": int(r.get("events") or 0),
            }
            for r in rows
        ]

    series_rows = _one(
        f"""
        SELECT FORMAT_DATE('%Y-%m-%d', DATE(created_at)) AS date,
               SUM(cost_micros) AS cost, SUM({_REVENUE_EXPR}) AS revenue
        FROM social_listening.usage_events WHERE {where}
        GROUP BY date ORDER BY date
        """
    )
    series = [
        {
            "date": r.get("date"),
            "cost_micros": int(r.get("cost") or 0),
            "revenue_micros": int(r.get("revenue") or 0),
        }
        for r in series_rows
    ]

    # Per-user → bucket usage cost/value by the user's tier so internal/free/
    # unattributed spend is visible (it's cost we absorb, not revenue).
    per_user = _one(
        f"""
        SELECT user_id, SUM(cost_micros) AS cost, SUM({_REVENUE_EXPR}) AS revenue,
               COUNT(*) AS events
        FROM social_listening.usage_events WHERE {where}
        GROUP BY user_id
        """
    )
    tier_agg: dict[str, dict] = {}
    for r in per_user:
        uid = r.get("user_id") or ""
        tier = "unattributed" if not uid else tier_by_uid.get(uid, "deleted")
        bucket = tier_agg.setdefault(
            tier, {"key": tier, "cost_micros": 0, "revenue_micros": 0, "events": 0}
        )
        bucket["cost_micros"] += int(r.get("cost") or 0)
        bucket["revenue_micros"] += int(r.get("revenue") or 0)  # usage value (billed), not cash
        bucket["events"] += int(r.get("events") or 0)

    by_tier = sorted(tier_agg.values(), key=lambda b: b["cost_micros"], reverse=True)

    # §E "who absorbs the cost" split. Super-admins + free/trial/demo accounts
    # run on granted (not purchased) credit - we never actually charge them the
    # profit margin, so their usage is a cost WE eat. Report it at raw cost.
    # Only `paid`-tier usage produces real billed-at-margin revenue.
    _ABSORBED_TIERS = {"admin", "free", "trial"}
    absorbed_cost_micros = sum(
        b["cost_micros"] for b in tier_agg.values() if b["key"] in _ABSORBED_TIERS
    )
    paid_billed_micros = sum(
        b["revenue_micros"] for b in tier_agg.values() if b["key"] == "paid"
    )

    purchases = int(credit.get("purchase", 0))
    granted = int(credit.get("grant", 0)) + int(credit.get("adjustment", 0)) + int(credit.get("refund", 0))

    # Platform × provider matrix - each (provider, platform) pair has its
    # own per-call price. Apify alone splits IG/FB/TikTok runs into
    # separately-priced actor calls; rolling them into "Apify $0.26" hides
    # whether a single platform dominates the cost.
    matrix = _platform_provider_matrix(where, params)

    # Cost-source roll-up - tells the operator what fraction of recorded
    # cost is "real" (provider-reported) vs "estimated" (apify fallback)
    # vs "rate_table". One row per source so the Finance page surfaces
    # estimate exposure without drilling into individual events.
    by_cost_source_rows = _one(
        f"""
        SELECT COALESCE(cost_source, 'unknown') AS source,
               SUM(cost_micros) AS cost_micros,
               SUM({_REVENUE_EXPR}) AS billed_micros,
               COUNT(*) AS events
        FROM social_listening.usage_events
        WHERE {where}
        GROUP BY source
        ORDER BY cost_micros DESC
        """
    )
    by_cost_source = [
        {
            "key": r.get("source") or "unknown",
            "cost_micros": int(r.get("cost_micros") or 0),
            "revenue_micros": int(r.get("billed_micros") or 0),
            "events": int(r.get("events") or 0),
        }
        for r in by_cost_source_rows
    ]

    return {
        "cost_micros": cost_micros,
        "revenue_micros": purchases,            # real cash in (purchases only)
        "granted_micros": granted,              # credit we issued (not revenue)
        "net_micros": purchases - cost_micros,  # true P&L
        "usage_billed_micros": revenue_micros,  # cost × margin across all usage (informational)
        # §E who-absorbs split: admin/free/trial usage at raw cost (we eat it),
        # paid-tier usage at margin (the only real billed revenue).
        "absorbed_cost_micros": int(absorbed_cost_micros),
        "paid_billed_micros": int(paid_billed_micros),
        # Point-in-time snapshot (NOT range-filterable - credit balances are
        # live counters in Firestore). The wallet liability we still owe
        # users in deliverable usage.
        "unspent_purchased_micros": int(unspent_purchased_micros or 0),
        "margin_multiplier": cost_rates.get_margin_multiplier(),
        "events": int(t.get("events") or 0),
        "by_provider": _grouped("provider"),
        "by_feature": _grouped("feature"),
        "by_tier": by_tier,
        "by_platform_provider": matrix,
        "by_cost_source": by_cost_source,
        "series": series,
    }


@router.get("/finance")
async def admin_finance(
    range: str = Query("mtd"),
    start: str | None = None,
    end: str | None = None,
    user: CurrentUser = Depends(_admin_user),
):
    """Platform economics: provider cost vs real (purchase) revenue + breakdowns."""
    fs = get_fs()
    all_users = await asyncio.to_thread(fs.list_all_users)
    tier_by_uid: dict[str, str] = {}
    unspent_purchased_micros = 0
    for u in all_users:
        uid = u.get("uid")
        if not uid:
            continue
        tier = (u.get("plan") or {}).get("tier") or "blocked"
        tier_by_uid[uid] = "admin" if is_super_admin_email(u.get("email")) else tier
        # Derive wallet liability in the same loop - avoids a second
        # Firestore stream just to sum credit balances. Skip phantom docs
        # (same rule as admin_users at line 225).
        if u.get("email") or u.get("created_at"):
            credit_doc = u.get("credit") or {}
            unspent_purchased_micros += int(credit_doc.get("balance_micros") or 0)

    start_dt, end_dt = _range_bounds(range, start, end)
    credit = await asyncio.to_thread(fs.sum_credit_in, start_dt, end_dt)
    return await asyncio.to_thread(
        _finance_breakdown, range, start, end, tier_by_uid, credit,
        unspent_purchased_micros,
    )


# ---------------------------------------------------------------------------
# Pricing - admin-editable provider rates + profit margin (§E).
# Curated knobs only (see config/cost_rates.py); persisted to app_config/pricing
# and deep-merged over the code seed at runtime.
# ---------------------------------------------------------------------------

# Only the model actually in use today is exposed in the editor (keeps the
# pricing UI focused). The seed COST_RATES["gemini"] still carries every model
# + the "*" fallback, so cost computation keeps working if a call routes a
# different model - we're trimming the *editor surface*, not the rate table.
# Re-add a row here (and in the frontend GEMINI_MODELS) when switching models.
_GEMINI_MODELS = (
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
)


# Scraper providers + platforms exposed in the per-(provider, platform)
# matrix editor. Order = display order in the UI. The "*" column on the
# UI side maps to the wildcard cell (`scraper_rates_per_platform[p]["*"]`)
# and is the fallback used when no platform-specific cell is set.
# Vetric is omitted - not in use (see config/cost_rates.py); re-add to expose.
_SCRAPER_PROVIDERS = ("apify", "brightdata", "x_api", "hikerapi")
_SCRAPER_PLATFORMS = ("instagram", "facebook", "tiktok", "twitter", "reddit", "youtube")


def _scraper_matrix_view() -> dict[str, dict[str, float | None]]:
    """Project the live scraper rate matrix into the UI shape.

    Always emits a cell (possibly ``None``) for every (provider, platform)
    pair in ``_SCRAPER_PROVIDERS × _SCRAPER_PLATFORMS`` plus the wildcard
    "*" column, so the editor can render an even grid.

    The wildcard "*" cell falls through to the **legacy single rate** from
    ``COST_RATES`` (BrightData per-record, X_api per-unit, Vetric per-call,
    Apify assumed-per-post) when the matrix hasn't been edited yet - that
    way the admin opens the editor and immediately sees the rates that
    were in effect, instead of an empty grid that looks like everything
    is unconfigured.

    Per-platform cells stay ``None`` (no override) until the admin sets one;
    the live cost-lookup code in ``compute_cost_micros`` already falls back
    to the wildcard / legacy table when a platform cell is missing.
    """
    matrix = cost_rates.get_scraper_rates_per_platform()
    legacy_rates = cost_rates.get_active_rates()

    # Effective wildcard rate per provider - prefer an explicit matrix cell,
    # fall back to the legacy single rate in COST_RATES so the editor shows
    # the value that's actually being applied.
    legacy_wildcard = {
        "apify": cost_rates.get_apify_assumed_per_post_usd(),
        "brightdata": ((legacy_rates.get("brightdata") or {}).get("*") or {}).get("per_record_usd"),
        "x_api": ((legacy_rates.get("x_api") or {}).get("*") or {}).get("per_unit_usd"),
        "vetric": ((legacy_rates.get("vetric") or {}).get("*") or {}).get("per_call_usd"),
        "hikerapi": ((legacy_rates.get("hikerapi") or {}).get("*") or {}).get("per_request_usd"),
    }

    out: dict[str, dict[str, float | None]] = {}
    for prov in _SCRAPER_PROVIDERS:
        cells = matrix.get(prov) or {}
        out[prov] = {p: cells.get(p) for p in _SCRAPER_PLATFORMS}
        out[prov]["*"] = cells.get("*", legacy_wildcard.get(prov))
    return out


def _scraper_comment_matrix_view() -> dict[str, dict[str, float | None]]:
    """Project the live COMMENTS scraper rate matrix into the UI shape.

    Same even grid as :func:`_scraper_matrix_view` but for comment scrapes.
    Cells stay ``None`` until an admin sets one - a ``None`` cell means "no
    comment-specific rate, inherit the posts rate" (see
    :func:`config.cost_rates.get_scraper_rate`). No legacy-wildcard fallback:
    an unset comment cell is intentionally blank so the editor shows that
    comments inherit the posts price.
    """
    matrix = cost_rates.get_scraper_comment_rates_per_platform()
    out: dict[str, dict[str, float | None]] = {}
    for prov in _SCRAPER_PROVIDERS:
        cells = matrix.get(prov) or {}
        out[prov] = {p: cells.get(p) for p in _SCRAPER_PLATFORMS}
        out[prov]["*"] = cells.get("*")
    return out


def _scraper_channel_matrix_view() -> dict[str, dict[str, float | None]]:
    """Project the live CHANNEL scraper rate matrix into the UI shape.

    Same even grid as :func:`_scraper_comment_matrix_view`. A ``None`` cell means
    "no channel-specific rate, inherit the posts rate" (see
    :func:`config.cost_rates.get_scraper_rate`).
    """
    matrix = cost_rates.get_scraper_channel_rates_per_platform()
    out: dict[str, dict[str, float | None]] = {}
    for prov in _SCRAPER_PROVIDERS:
        cells = matrix.get(prov) or {}
        out[prov] = {p: cells.get(p) for p in _SCRAPER_PLATFORMS}
        out[prov]["*"] = cells.get("*")
    return out


def _curated_pricing_view() -> dict:
    """Project the effective rate table down to the curated, editable knobs."""
    r = cost_rates.get_active_rates()
    gem = r.get("gemini", {})
    gs = r.get("google_search", {})
    return {
        "margin_multiplier": cost_rates.get_margin_multiplier(),
        "apify_assumed_per_post_usd": cost_rates.get_apify_assumed_per_post_usd(),
        # Per-(provider, platform) scraper matrix - drives the live cost
        # row $ for all scrapers (Apify fallback path + BrightData / X_api /
        # Vetric rate-table replacement). The Pricing editor renders this
        # as a grid; a cell that's NULL means "no override, use wildcard".
        "scraper_rates_per_platform": _scraper_matrix_view(),
        # Parallel comments-rate matrix - cells default to NULL ("inherit the
        # posts rate"); only populated where comment scraping costs differently.
        "scraper_comment_rates_per_platform": _scraper_comment_matrix_view(),
        # Parallel channel-rate matrix - same NULL-inherits-posts semantics; only
        # populated where channel (profile/page/subreddit) collection costs
        # differently than keyword search.
        "scraper_channel_rates_per_platform": _scraper_channel_matrix_view(),
        "gemini": {
            m: {
                "input_per_mtok": gem.get(m, {}).get("input_per_mtok"),
                "output_per_mtok": gem.get(m, {}).get("output_per_mtok"),
                "cached_per_mtok": gem.get(m, {}).get("cached_per_mtok"),
            }
            for m in _GEMINI_MODELS
        },
        "google_search_gemini3_per_query_usd": gs.get("gemini-3", {}).get("per_query_usd"),
        "google_search_gemini25_per_prompt_usd": gs.get("gemini-2.5", {}).get("per_prompt_usd"),
        # Legacy single rates kept so callers that haven't filled in the
        # matrix don't lose their pricing. New code prefers the matrix.
        "brightdata_per_record_usd": r.get("brightdata", {}).get("*", {}).get("per_record_usd"),
        "x_api_per_unit_usd": r.get("x_api", {}).get("*", {}).get("per_unit_usd"),
        "vetric_per_call_usd": r.get("vetric", {}).get("*", {}).get("per_call_usd"),
        "bq_per_tb_processed_usd": r.get("bq", {}).get("per_tb_processed_usd"),
        "gcs_per_gb_stored_usd": r.get("gcs", {}).get("per_gb_stored_usd"),
        "gcs_per_gb_egress_usd": r.get("gcs", {}).get("per_gb_egress_usd"),
    }


class _GeminiRate(BaseModel):
    input_per_mtok: float
    output_per_mtok: float
    cached_per_mtok: float


class PricingUpdate(BaseModel):
    margin_multiplier: float | None = None
    apify_assumed_per_post_usd: float | None = None
    # Per-(provider, platform) scraper matrix. Only providers + platforms
    # whose cells the admin actually touched need to be present; omitted
    # ones keep their current value. A cell value of ``None`` clears that
    # cell (so it falls through to the wildcard "*" for that provider).
    # Schema: ``{provider: {platform_or_star: usd | None}}``.
    scraper_rates_per_platform: dict[str, dict[str, float | None]] | None = None
    # Parallel comments-rate matrix, same shape + same partial-edit semantics
    # (a cell of ``None`` clears that comment rate → inherits the posts rate).
    scraper_comment_rates_per_platform: dict[str, dict[str, float | None]] | None = None
    # Parallel channel-rate matrix, same shape + semantics (None → inherit posts).
    scraper_channel_rates_per_platform: dict[str, dict[str, float | None]] | None = None
    gemini: dict[str, _GeminiRate] | None = None
    google_search_gemini3_per_query_usd: float | None = None
    google_search_gemini25_per_prompt_usd: float | None = None
    brightdata_per_record_usd: float | None = None
    x_api_per_unit_usd: float | None = None
    vetric_per_call_usd: float | None = None
    bq_per_tb_processed_usd: float | None = None
    gcs_per_gb_stored_usd: float | None = None
    gcs_per_gb_egress_usd: float | None = None


def _merge_scraper_matrix(
    existing: dict | None,
    patch: dict[str, dict[str, float | None]] | None,
) -> dict | None:
    """Merge a partial scraper-rate matrix patch over the stored matrix.

    ``patch`` only carries the cells the admin touched; an explicit ``None``
    cell clears that cell (so it falls through to the wildcard / posts rate).
    Providers whose cells all clear are dropped. Returns ``None`` (no change)
    when ``patch`` is ``None`` so the caller skips persisting that field.
    Used for both the posts and comments scraper matrices.
    """
    if patch is None:
        return None
    out = dict(existing or {})
    for prov, by_plat in patch.items():
        if not isinstance(by_plat, dict):
            continue
        cells = dict(out.get(prov) or {})
        for plat, val in by_plat.items():
            if val is None:
                cells.pop(plat, None)
            else:
                cells[plat] = float(val)
        if cells:
            out[prov] = cells
        else:
            out.pop(prov, None)
    return out


def _build_rate_overrides(body: PricingUpdate) -> dict:
    """Translate the curated payload into the nested COST_RATES override shape."""
    overrides: dict = {}
    if body.gemini:
        overrides["gemini"] = {
            m: rate.model_dump() for m, rate in body.gemini.items() if m in _GEMINI_MODELS
        }
    gs: dict = {}
    if body.google_search_gemini3_per_query_usd is not None:
        gs["gemini-3"] = {"per_query_usd": body.google_search_gemini3_per_query_usd}
    if body.google_search_gemini25_per_prompt_usd is not None:
        gs["gemini-2.5"] = {"per_prompt_usd": body.google_search_gemini25_per_prompt_usd}
        gs["*"] = {"per_prompt_usd": body.google_search_gemini25_per_prompt_usd}
    if gs:
        overrides["google_search"] = gs
    if body.brightdata_per_record_usd is not None:
        overrides["brightdata"] = {"*": {"per_record_usd": body.brightdata_per_record_usd}}
    if body.x_api_per_unit_usd is not None:
        v = body.x_api_per_unit_usd
        # Mirror across the read endpoints so both the estimate (reads `*`) and
        # actual per-call logging (reads sub_kind) reflect the edit.
        overrides["x_api"] = {
            "*": {"per_unit_usd": v},
            "search_per_post": {"per_unit_usd": v},
            "lookup_per_call": {"per_unit_usd": v},
        }
    if body.vetric_per_call_usd is not None:
        overrides["vetric"] = {"*": {"per_call_usd": body.vetric_per_call_usd}}
    if body.bq_per_tb_processed_usd is not None:
        overrides["bq"] = {"per_tb_processed_usd": body.bq_per_tb_processed_usd}
    gcs: dict = {}
    if body.gcs_per_gb_stored_usd is not None:
        gcs["per_gb_stored_usd"] = body.gcs_per_gb_stored_usd
    if body.gcs_per_gb_egress_usd is not None:
        gcs["per_gb_egress_usd"] = body.gcs_per_gb_egress_usd
    if gcs:
        overrides["gcs"] = gcs
    return overrides


@router.get("/pricing")
async def admin_get_pricing(user: CurrentUser = Depends(_admin_user)):
    """Return the curated, editable pricing knobs (effective values) + metadata."""
    fs = get_fs()
    doc = await asyncio.to_thread(fs.get_pricing_config)
    view = await asyncio.to_thread(_curated_pricing_view)
    view["updated_at"] = doc.get("updated_at")
    view["updated_by"] = doc.get("updated_by")
    return view


@router.put("/pricing")
async def admin_update_pricing(
    body: PricingUpdate,
    user: CurrentUser = Depends(_admin_user),
):
    """Persist edited rates + margin; invalidate caches; audit the change."""
    if body.margin_multiplier is not None and body.margin_multiplier <= 0:
        raise HTTPException(status_code=400, detail="margin_multiplier must be > 0")

    fs = get_fs()
    before = await asyncio.to_thread(_curated_pricing_view)

    overrides = _build_rate_overrides(body)
    # Merge new overrides over any existing ones so partial edits don't drop
    # previously-saved knobs.
    pricing_doc = await asyncio.to_thread(fs.get_pricing_config)
    existing = pricing_doc.get("rate_overrides") or {}
    merged = cost_rates._deep_merge(existing, overrides)

    # Merge the scraper (provider × platform) matrices. The body only sends
    # cells the admin actually touched; an explicit ``null`` clears that
    # cell so it falls through to the provider's "*" wildcard (posts) or to
    # the posts rate (comments). Preserves providers + platforms not in the
    # editor today (forward compat).
    scraper_matrix_merged = _merge_scraper_matrix(
        pricing_doc.get("scraper_rates_per_platform"),
        body.scraper_rates_per_platform,
    )
    scraper_comment_matrix_merged = _merge_scraper_matrix(
        pricing_doc.get("scraper_comment_rates_per_platform"),
        body.scraper_comment_rates_per_platform,
    )
    scraper_channel_matrix_merged = _merge_scraper_matrix(
        pricing_doc.get("scraper_channel_rates_per_platform"),
        body.scraper_channel_rates_per_platform,
    )

    await asyncio.to_thread(
        fs.set_pricing_config,
        rate_overrides=merged,
        margin_multiplier=body.margin_multiplier,
        apify_assumed_per_post_usd=body.apify_assumed_per_post_usd,
        scraper_rates_per_platform=scraper_matrix_merged,
        scraper_comment_rates_per_platform=scraper_comment_matrix_merged,
        scraper_channel_rates_per_platform=scraper_channel_matrix_merged,
        updated_by=user.email,
    )
    cost_rates.invalidate_pricing_cache()

    after = await asyncio.to_thread(_curated_pricing_view)
    await asyncio.to_thread(
        fs.write_admin_audit,
        {
            "event": "pricing_change",
            "actor_uid": user.uid,
            "actor_email": user.email,
            "before": before,
            "after": after,
        },
    )
    return after


# ---------------------------------------------------------------------------
# Provider routing - admin-editable per-platform vendor (keyword vs channel).
# Persisted to app_config/routing; deep-merged over the code seeds in
# config/collection_routing.py. Lets us switch a platform's provider (e.g. flip
# IG keyword between hikerapi and apify) WITHOUT a redeploy.
# ---------------------------------------------------------------------------

# Vendor tokens selectable in the editor (match wrapper._VENDOR_CLASS_MAP keys).
_ROUTING_VENDORS = ("apify", "brightdata", "xapi", "vetric", "hikerapi")
# Platforms shown in the routing editor (display order).
_ROUTING_PLATFORMS = ("instagram", "tiktok", "twitter", "facebook", "youtube", "reddit")


def _routing_view() -> dict:
    """Effective per-platform keyword + channel provider + editor options."""
    from config import collection_routing

    eff = collection_routing.effective_routing_view()
    return {
        "platforms": list(_ROUTING_PLATFORMS),
        "vendors": list(_ROUTING_VENDORS),
        # {platform: vendor|None} for each intent (None = first-supporting).
        "keyword_provider_by_platform": {
            p: eff["keyword_provider_by_platform"].get(p) for p in _ROUTING_PLATFORMS
        },
        "channel_provider_by_platform": {
            p: eff["channel_provider_by_platform"].get(p) for p in _ROUTING_PLATFORMS
        },
    }


class RoutingUpdate(BaseModel):
    # Each map carries only the platforms the admin touched; a value of ``None``
    # (or empty string) clears that platform's override so it falls back to the
    # code seed / first-supporting. Unknown platforms/vendors are rejected.
    keyword_provider_by_platform: dict[str, str | None] | None = None
    channel_provider_by_platform: dict[str, str | None] | None = None


def _merge_routing_map(existing: dict | None, patch: dict[str, str | None] | None) -> dict | None:
    """Merge a partial routing patch over the stored map. ``None``/empty clears
    a cell. Returns None (skip persisting) when patch is None."""
    if patch is None:
        return None
    out = dict(existing or {})
    for plat, vendor in patch.items():
        if plat not in _ROUTING_PLATFORMS:
            raise HTTPException(status_code=400, detail=f"unknown platform: {plat}")
        if vendor in (None, ""):
            out.pop(plat, None)
        elif vendor not in _ROUTING_VENDORS:
            raise HTTPException(status_code=400, detail=f"unknown vendor: {vendor}")
        else:
            out[plat] = vendor
    return out


@router.get("/routing")
async def admin_get_routing(user: CurrentUser = Depends(_admin_user)):
    """Return the effective per-platform provider routing + editor options."""
    fs = get_fs()
    doc = await asyncio.to_thread(fs.get_routing_config)
    view = await asyncio.to_thread(_routing_view)
    view["updated_at"] = doc.get("updated_at")
    view["updated_by"] = doc.get("updated_by")
    return view


@router.put("/routing")
async def admin_update_routing(
    body: RoutingUpdate,
    user: CurrentUser = Depends(_admin_user),
):
    """Persist edited provider routing; invalidate the cache; audit the change."""
    from config import collection_routing

    fs = get_fs()
    before = await asyncio.to_thread(_routing_view)

    routing_doc = await asyncio.to_thread(fs.get_routing_config)
    keyword_merged = _merge_routing_map(
        routing_doc.get("keyword_provider_by_platform"), body.keyword_provider_by_platform,
    )
    channel_merged = _merge_routing_map(
        routing_doc.get("channel_provider_by_platform"), body.channel_provider_by_platform,
    )

    await asyncio.to_thread(
        fs.set_routing_config,
        keyword_provider_by_platform=keyword_merged,
        channel_provider_by_platform=channel_merged,
        updated_by=user.email,
    )
    collection_routing.invalidate_routing_cache()

    after = await asyncio.to_thread(_routing_view)
    await asyncio.to_thread(
        fs.write_admin_audit,
        {
            "event": "routing_change",
            "actor_uid": user.uid,
            "actor_email": user.email,
            "before": before,
            "after": after,
        },
    )
    return after


# ---------------------------------------------------------------------------
# Impersonation - "View as User" for super admins
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

    Best-effort - failures are logged but do not block the request.
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

    This endpoint does NOT mutate server state - the actual impersonation
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
    currently set - the frontend fires this during teardown.
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
    logger.info("Impersonation STOP: %s", redact_email(real_user.email))


# ---------------------------------------------------------------------------
# Waitlist (private-beta signups from the landing page)
# ---------------------------------------------------------------------------


def _serialize_waitlist_doc(doc) -> dict:
    data = doc.to_dict() or {}
    data["id"] = doc.id
    for key in ("created_at", "updated_at"):
        val = data.get(key)
        if val is not None and hasattr(val, "isoformat"):
            data[key] = val.isoformat()
    return data


@router.get("/waitlist")
async def admin_waitlist(
    search: str = Query("", description="Filter by email or interested_in text"),
    sort_by: str = Query("created_at", pattern="^(created_at|updated_at|email|submission_count)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(_admin_user),
):
    """List waitlist signups captured from the landing page."""
    fs = get_fs()

    def _load() -> list[dict]:
        return [_serialize_waitlist_doc(d) for d in fs._db.collection("waitlist").stream()]

    entries = await asyncio.to_thread(_load)

    if search:
        s = search.lower()
        entries = [
            e for e in entries
            if s in (e.get("email") or "").lower()
            or s in (e.get("interested_in") or "").lower()
            or s in (e.get("display_name") or "").lower()
        ]

    reverse = order == "desc"
    entries.sort(key=lambda e: e.get(sort_by) or "", reverse=reverse)

    total = len(entries)
    entries = entries[offset : offset + limit]

    return {"entries": entries, "total": total}


@router.delete("/waitlist/{entry_id}", status_code=204)
async def admin_waitlist_delete(
    entry_id: str,
    user: CurrentUser = Depends(_admin_user),
):
    """Remove a waitlist entry (e.g. after promoting to a real account)."""
    fs = get_fs()
    await asyncio.to_thread(
        fs._db.collection("waitlist").document(entry_id).delete
    )
    logger.info("admin %s deleted waitlist entry %s", redact_email(user.email), entry_id)
