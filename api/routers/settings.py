"""Settings router — profile updates, organization management, invites, usage."""

import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from api.auth.dependencies import CurrentUser, get_current_user
from api.auth.permissions import require_org_role, require_org_member
from api.schemas.requests import (
    UpdateProfileRequest,
    UpdateOrgRequest,
    InviteMemberRequest,
    UpdateMemberRoleRequest,
)
from api.schemas.responses import (
    OrgDetailsResponse,
    OrgMemberResponse,
    OrgInviteResponse,
    UsageResponse,
    UsageTrendPoint,
    UsageTrendResponse,
)
from config.settings import get_settings
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)

router = APIRouter()

PLAN_LIMITS = {
    "free": {"queries": 50, "collections": 3, "posts": 500},
    "pro": {"queries": 500, "collections": 20, "posts": 10_000},
    "enterprise": {"queries": -1, "collections": -1, "posts": 100_000},
}


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------


@router.post("/me")
async def update_profile(
    request: UpdateProfileRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Update the current user's profile (display name, preferences)."""
    settings = get_settings()
    fs = FirestoreClient(settings)

    updates = {}
    if request.display_name is not None:
        updates["display_name"] = request.display_name
    if request.preferences is not None:
        updates["preferences"] = request.preferences

    if updates:
        fs.update_user(user.uid, **updates)

    # Return updated profile
    user_doc = fs.get_user(user.uid)
    org_name = None
    if user.org_id:
        org = fs.get_org(user.org_id)
        if org:
            org_name = org.get("name")

    return {
        "uid": user.uid,
        "email": user.email,
        "display_name": user_doc.get("display_name") if user_doc else user.display_name,
        "photo_url": user_doc.get("photo_url") if user_doc else None,
        "org_id": user.org_id,
        "org_role": user.org_role,
        "org_name": org_name,
        "preferences": user_doc.get("preferences") if user_doc else None,
        "subscription_plan": user_doc.get("subscription_plan") if user_doc else None,
        "subscription_status": user_doc.get("subscription_status") if user_doc else None,
    }


# ---------------------------------------------------------------------------
# Organization management
# ---------------------------------------------------------------------------


@router.post("/orgs/me/update")
async def update_org(
    request: UpdateOrgRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Update organization details (name, domain). Requires admin role."""
    require_org_role(user, "admin")

    settings = get_settings()
    fs = FirestoreClient(settings)

    updates = {}
    if request.name is not None:
        updates["name"] = request.name.strip()
        updates["slug"] = request.name.strip().lower().replace(" ", "-")
    if request.domain is not None:
        domain = request.domain.strip().lower() or None
        if domain:
            existing = fs.find_org_by_domain(domain)
            if existing and existing.get("org_id") != user.org_id:
                raise HTTPException(status_code=409, detail="Domain already in use")
        updates["domain"] = domain

    if updates:
        fs.update_org(user.org_id, **updates)

    # Return updated org
    org = fs.get_org(user.org_id)
    members = fs.list_org_members(user.org_id)
    return OrgDetailsResponse(
        org_id=user.org_id,
        name=org.get("name", ""),
        slug=org.get("slug"),
        domain=org.get("domain"),
        members=[
            OrgMemberResponse(
                uid=m["uid"],
                email=m.get("email"),
                display_name=m.get("display_name"),
                photo_url=m.get("photo_url"),
                role=m.get("org_role"),
            )
            for m in members
        ],
        subscription_plan=org.get("subscription_plan"),
        subscription_status=org.get("subscription_status"),
    )


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------


@router.post("/orgs/me/invites", response_model=OrgInviteResponse)
async def create_invite(
    request: InviteMemberRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create an invite link for a new member. Requires admin role."""
    require_org_role(user, "admin")

    if request.role not in ("member", "admin"):
        raise HTTPException(status_code=400, detail="Role must be 'member' or 'admin'")

    settings = get_settings()
    fs = FirestoreClient(settings)

    now = datetime.now(timezone.utc)
    invite_code = uuid4().hex[:12]

    invite_data = {
        "org_id": user.org_id,
        "email": request.email.strip().lower(),
        "role": request.role,
        "invite_code": invite_code,
        "status": "pending",
        "created_by": user.uid,
        "created_at": now,
        "expires_at": now + timedelta(days=7),
    }

    invite_id = fs.create_invite(invite_data)

    return OrgInviteResponse(
        invite_id=invite_id,
        email=invite_data["email"],
        role=invite_data["role"],
        status="pending",
        invite_code=invite_code,
        created_at=now.isoformat(),
        expires_at=invite_data["expires_at"].isoformat(),
    )


@router.get("/orgs/me/invites", response_model=list[OrgInviteResponse])
async def list_invites(user: CurrentUser = Depends(get_current_user)):
    """List pending invites for the org. Requires admin role."""
    require_org_role(user, "admin")

    settings = get_settings()
    fs = FirestoreClient(settings)
    invites = fs.list_org_invites(user.org_id)

    return [
        OrgInviteResponse(
            invite_id=inv["invite_id"],
            email=inv.get("email", ""),
            role=inv.get("role", "member"),
            status=inv.get("status", "pending"),
            invite_code=inv.get("invite_code", ""),
            created_at=inv.get("created_at", ""),
            expires_at=inv.get("expires_at", ""),
        )
        for inv in invites
        if inv.get("status") == "pending"
    ]


@router.post("/orgs/me/invites/{invite_id}/revoke")
async def revoke_invite(
    invite_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Revoke a pending invite. Requires admin role."""
    require_org_role(user, "admin")

    settings = get_settings()
    fs = FirestoreClient(settings)
    fs.delete_invite(invite_id)
    return {"status": "revoked"}


@router.post("/orgs/join/{invite_code}")
async def join_org(
    invite_code: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Accept an invite and join the organization."""
    if user.org_id:
        raise HTTPException(status_code=400, detail="You already belong to an organization")

    settings = get_settings()
    fs = FirestoreClient(settings)

    invite = fs.get_invite_by_code(invite_code)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or expired")

    if invite.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Invite is no longer valid")

    # Check expiry
    expires_at = invite.get("expires_at")
    if expires_at:
        if hasattr(expires_at, "timestamp"):
            expires_dt = expires_at
        else:
            expires_dt = datetime.fromisoformat(str(expires_at))
        if datetime.now(timezone.utc) > expires_dt.replace(tzinfo=timezone.utc):
            raise HTTPException(status_code=400, detail="Invite has expired")

    org_id = invite["org_id"]
    role = invite.get("role", "member")

    # Add user to org
    fs.update_user(user.uid, org_id=org_id, org_role=role)

    # Mark invite as accepted
    fs.update_invite(invite["invite_id"], status="accepted")

    return {"status": "joined", "org_id": org_id}


# ---------------------------------------------------------------------------
# Member management
# ---------------------------------------------------------------------------


@router.post("/orgs/me/members/{member_uid}/role")
async def update_member_role(
    member_uid: str,
    request: UpdateMemberRoleRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Change a member's role. Only owners can change roles."""
    require_org_role(user, "owner")

    if request.role not in ("member", "admin", "owner"):
        raise HTTPException(status_code=400, detail="Invalid role")

    if member_uid == user.uid:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    settings = get_settings()
    fs = FirestoreClient(settings)

    member = fs.get_user(member_uid)
    if not member or member.get("org_id") != user.org_id:
        raise HTTPException(status_code=404, detail="Member not found in your organization")

    # If transferring ownership, demote current owner
    if request.role == "owner":
        fs.update_user(user.uid, org_role="admin")

    fs.update_user(member_uid, org_role=request.role)
    return {"status": "updated"}


@router.post("/orgs/me/members/{member_uid}/remove")
async def remove_member(
    member_uid: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Remove a member from the organization. Requires admin role."""
    require_org_role(user, "admin")

    if member_uid == user.uid:
        raise HTTPException(status_code=400, detail="Cannot remove yourself. Use leave instead.")

    settings = get_settings()
    fs = FirestoreClient(settings)

    member = fs.get_user(member_uid)
    if not member or member.get("org_id") != user.org_id:
        raise HTTPException(status_code=404, detail="Member not found in your organization")

    if member.get("org_role") == "owner":
        raise HTTPException(status_code=400, detail="Cannot remove the owner")

    fs.update_user(member_uid, org_id=None, org_role=None)
    return {"status": "removed"}


@router.post("/orgs/me/leave")
async def leave_org(user: CurrentUser = Depends(get_current_user)):
    """Leave the current organization."""
    require_org_member(user)

    if user.org_role == "owner":
        raise HTTPException(
            status_code=400,
            detail="Organization owner cannot leave. Transfer ownership first.",
        )

    settings = get_settings()
    fs = FirestoreClient(settings)
    fs.update_user(user.uid, org_id=None, org_role=None)
    return {"status": "left"}


# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------


@router.get("/usage/me", response_model=UsageResponse)
async def get_usage(user: CurrentUser = Depends(get_current_user)):
    """Get the current user's usage stats."""
    settings = get_settings()
    fs = FirestoreClient(settings)

    # Determine plan limits
    plan = "free"
    if user.org_id:
        org = fs.get_org(user.org_id)
        if org:
            plan = org.get("subscription_plan") or "free"
    else:
        user_doc = fs.get_user(user.uid)
        if user_doc:
            plan = user_doc.get("subscription_plan") or "free"

    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])

    # Get usage counters
    usage = fs.get_usage(user.uid, user.org_id)

    now = datetime.now(timezone.utc)
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_month = (period_start.replace(day=28) + timedelta(days=4)).replace(day=1)

    return UsageResponse(
        period_start=period_start.isoformat(),
        period_end=next_month.isoformat(),
        queries_used=usage.get("queries_used", 0),
        queries_limit=limits["queries"],
        collections_created=usage.get("collections_created", 0),
        collections_limit=limits["collections"],
        posts_collected=usage.get("posts_collected", 0),
        posts_limit=limits["posts"],
    )


@router.get("/usage/org", response_model=UsageResponse)
async def get_org_usage(user: CurrentUser = Depends(get_current_user)):
    """Get the organization's aggregate usage stats. Requires admin role."""
    require_org_role(user, "admin")

    settings = get_settings()
    fs = FirestoreClient(settings)

    org = fs.get_org(user.org_id)
    plan = org.get("subscription_plan", "free") if org else "free"
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])

    usage = fs.get_org_usage(user.org_id)

    now = datetime.now(timezone.utc)
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_month = (period_start.replace(day=28) + timedelta(days=4)).replace(day=1)

    return UsageResponse(
        period_start=period_start.isoformat(),
        period_end=next_month.isoformat(),
        queries_used=usage.get("queries_used", 0),
        queries_limit=limits["queries"],
        collections_created=usage.get("collections_created", 0),
        collections_limit=limits["collections"],
        posts_collected=usage.get("posts_collected", 0),
        posts_limit=limits["posts"],
    )


@router.get("/usage/trend", response_model=UsageTrendResponse)
async def get_usage_trend(
    days: int = 30,
    user: CurrentUser = Depends(get_current_user),
):
    """Get daily usage trend for the current user (personal view)."""
    settings = get_settings()
    fs = FirestoreClient(settings)

    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=days)

    try:
        daily_logs = fs.get_usage_daily(user.uid, start_date, now)
    except Exception as e:
        logger.warning("Failed to get usage trend: %s", e)
        daily_logs = {}

    points = []
    for i in range(days):
        day = start_date + timedelta(days=i + 1)
        day_str = day.strftime("%Y-%m-%d")
        entry = daily_logs.get(day_str, {})
        points.append(
            UsageTrendPoint(
                date=day_str,
                queries=entry.get("queries", 0),
                collections=entry.get("collections", 0),
                posts=entry.get("posts", 0),
            )
        )

    return UsageTrendResponse(points=points, granularity="daily")


@router.get("/usage/org/trend", response_model=UsageTrendResponse)
async def get_org_usage_trend(
    days: int = 30,
    user: CurrentUser = Depends(get_current_user),
):
    """Get daily usage trend for the org, split by user. Requires admin role."""
    require_org_role(user, "admin")

    settings = get_settings()
    fs = FirestoreClient(settings)

    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=days)

    try:
        members = fs.list_org_members(user.org_id)
    except Exception as e:
        logger.warning("Failed to list org members for trend: %s", e)
        return UsageTrendResponse(points=[], granularity="daily")

    # Fetch daily logs for each member once (not per-day)
    member_logs: dict[str, dict] = {}
    for member in members:
        try:
            member_logs[member["uid"]] = fs.get_usage_daily(member["uid"], start_date, now)
        except Exception:
            member_logs[member["uid"]] = {}

    points = []
    for i in range(days):
        day = start_date + timedelta(days=i + 1)
        day_str = day.strftime("%Y-%m-%d")

        for member in members:
            daily_logs = member_logs.get(member["uid"], {})
            entry = daily_logs.get(day_str, {})
            if entry.get("queries", 0) > 0 or entry.get("collections", 0) > 0 or entry.get("posts", 0) > 0:
                points.append(
                    UsageTrendPoint(
                        date=day_str,
                        queries=entry.get("queries", 0),
                        collections=entry.get("collections", 0),
                        posts=entry.get("posts", 0),
                        user_name=member.get("display_name") or member.get("email", "Unknown"),
                        user_id=member["uid"],
                    )
                )

    return UsageTrendResponse(points=points, granularity="daily")
