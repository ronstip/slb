"""Organization create / read / leave endpoints."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/orgs")
async def create_org(
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Create an organization. The creator becomes the owner."""
    name = request.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Organization name is required")

    if user.org_id:
        raise HTTPException(status_code=400, detail="You already belong to an organization")

    fs = get_fs()

    domain = request.get("domain", "").strip().lower() or None

    if domain:
        existing = fs.find_org_by_domain(domain)
        if existing:
            raise HTTPException(status_code=409, detail="An organization with this domain already exists")

    slug = name.lower().replace(" ", "-")

    org_id = fs.create_org({
        "name": name,
        "slug": slug,
        "owner_uid": user.uid,
        "domain": domain,
        "created_at": datetime.now(timezone.utc),
    })

    fs.update_user(user.uid, org_id=org_id, org_role="owner")

    return {"org_id": org_id, "name": name, "slug": slug, "domain": domain}


@router.get("/orgs/me")
async def get_my_org(user: CurrentUser = Depends(get_current_user)):
    """Get the current user's organization details and member list."""
    if not user.org_id:
        raise HTTPException(status_code=404, detail="You are not in an organization")

    fs = get_fs()

    org = fs.get_org(user.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    members = fs.list_org_members(user.org_id)
    member_list = [
        {
            "uid": m["uid"],
            "email": m.get("email"),
            "display_name": m.get("display_name"),
            "photo_url": m.get("photo_url"),
            "role": m.get("org_role"),
        }
        for m in members
    ]

    return {
        "org_id": user.org_id,
        "name": org.get("name"),
        "slug": org.get("slug"),
        "domain": org.get("domain"),
        "members": member_list,
        "subscription_plan": org.get("subscription_plan"),
        "subscription_status": org.get("subscription_status"),
        "billing_cycle": org.get("billing_cycle"),
        "current_period_end": org.get("current_period_end"),
    }


@router.delete("/orgs/me/leave")
async def leave_org(user: CurrentUser = Depends(get_current_user)):
    """Leave the current organization."""
    if not user.org_id:
        raise HTTPException(status_code=400, detail="You are not in an organization")

    if user.org_role == "owner":
        raise HTTPException(status_code=400, detail="Organization owner cannot leave. Transfer ownership first.")

    fs = get_fs()
    fs.update_user(user.uid, org_id=None, org_role=None)
    return {"status": "left"}
