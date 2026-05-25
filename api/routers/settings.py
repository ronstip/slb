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
)
from api.deps import get_fs

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------


@router.post("/me")
async def update_profile(
    request: UpdateProfileRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Update the current user's profile (display name, preferences)."""
    fs = get_fs()

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

    fs = get_fs()

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

    fs = get_fs()

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

    fs = get_fs()
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

    fs = get_fs()
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

    fs = get_fs()

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

    fs = get_fs()

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

    fs = get_fs()

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

    fs = get_fs()
    fs.update_user(user.uid, org_id=None, org_role=None)
    return {"status": "left"}


# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------


@router.get("/usage/me", response_model=UsageResponse)
async def get_usage(user: CurrentUser = Depends(get_current_user)):
    """Get the current user's $ wallet + this-month action counts.

    No quota limits, no provider names, no $ breakdown — that lives in the
    admin panel. `free` users have an unenforced wallet (UI shows "Unlimited").
    """
    fs = get_fs()
    user_doc = fs.get_user(user.uid) or {}
    plan = user_doc.get("plan") or {}
    credit = user_doc.get("credit") or {}
    balance = int(credit.get("balance_micros", 0))
    total_in = int(credit.get("total_in_micros", 0))

    now = datetime.now(timezone.utc)
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_month = (period_start.replace(day=28) + timedelta(days=4)).replace(day=1)

    # This-month action counts from the daily usage logs.
    try:
        daily = fs.get_usage_daily(user.uid, period_start, now)
    except Exception:
        daily = {}
    chats = sum(int(d.get("queries", 0)) for d in daily.values())
    collections = sum(int(d.get("collections", 0)) for d in daily.values())
    posts = sum(int(d.get("posts", 0)) for d in daily.values())

    trial = plan.get("trial_expires_at")
    if hasattr(trial, "isoformat"):
        trial = trial.isoformat()

    return UsageResponse(
        period_start=period_start.isoformat(),
        period_end=next_month.isoformat(),
        tier=plan.get("tier") or "free",
        trial_expires_at=trial,
        balance_micros=balance,
        total_in_micros=total_in,
        spent_micros=int(credit.get("spent_micros", 0)),
        progress_pct=round(balance / total_in * 100, 1) if total_in > 0 else 0.0,
        chats=chats,
        collections=collections,
        posts=posts,
    )


# NOTE: the per-user `/usage/trend` endpoint was removed — the settings UI now
# shows only the wallet (the low-value action-count trend was dropped, §E). The
# rich cost/revenue view lives in the admin panel.
