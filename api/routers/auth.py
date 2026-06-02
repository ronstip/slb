"""Auth & identity endpoints: current-user profile and account linking."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/me")
async def get_me(user: CurrentUser = Depends(get_current_user)):
    """Return the current user's profile.

    During impersonation this returns the TARGET user's profile so all
    frontend permission gates flip. The real caller's identity is surfaced
    in the optional `impersonation` block for the banner UI.
    """
    fs = get_fs()

    # Run the two Firestore reads in parallel - previously they were sync and
    # sequential on the asyncio loop, blocking every other request for the
    # duration of both gets. /me is hit on every page load.
    if user.org_id:
        org, user_doc = await asyncio.gather(
            asyncio.to_thread(fs.get_org, user.org_id),
            asyncio.to_thread(fs.get_user, user.uid),
        )
    else:
        org = None
        user_doc = await asyncio.to_thread(fs.get_user, user.uid)

    org_name = org.get("name") if org else None

    # is_super_admin reflects the TARGET user's privileges - during
    # impersonation this is always false because admin-on-admin is blocked.
    # The real caller's super admin status is not leaked through this field.
    from api.auth.admin import is_super_admin_email
    is_super_admin = is_super_admin_email(user.email)

    # §E entitlements: surface tier + $ wallet so the shell can render the
    # pending page / credit bar without a second round-trip.
    plan = (user_doc.get("plan") if user_doc else None) or {}
    credit = (user_doc.get("credit") if user_doc else None) or {}
    balance = int(credit.get("balance_micros", 0))
    total_in = int(credit.get("total_in_micros", 0))
    trial_expires_at = plan.get("trial_expires_at")
    if hasattr(trial_expires_at, "isoformat"):
        trial_expires_at = trial_expires_at.isoformat()

    response = {
        "uid": user.uid,
        "email": user.email,
        "display_name": user_doc.get("display_name") if user_doc else user.display_name,
        "photo_url": user_doc.get("photo_url") if user_doc else None,
        "org_id": user.org_id,
        "org_role": user.org_role,
        "org_name": org_name,
        "is_anonymous": user.is_anonymous,
        "preferences": user_doc.get("preferences") if user_doc else None,
        "is_super_admin": is_super_admin,
        "plan": {
            "tier": plan.get("tier") or "blocked",
            "trial_expires_at": trial_expires_at,
        },
        "credit": {
            "balance_micros": balance,
            "total_in_micros": total_in,
            "spent_micros": int(credit.get("spent_micros", 0)),
            "progress_pct": round(balance / total_in * 100, 1) if total_in > 0 else 0.0,
        },
    }

    if user.impersonated_by is not None:
        response["impersonation"] = {
            "real_uid": user.impersonated_by,
            "real_email": user.real_email,
            "target_uid": user.uid,
            "target_email": user.email,
            "target_display_name": response["display_name"],
        }

    return response


class LinkAccountRequest(BaseModel):
    old_uid: str


@router.post("/auth/link-account")
async def link_account(
    body: LinkAccountRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Migrate anonymous user data to linked account after UID change."""
    # Block while impersonating - mutates user docs and would corrupt the
    # target user's data if triggered as another user.
    if user.impersonated_by is not None:
        raise HTTPException(
            status_code=403,
            detail="This action is disabled while viewing as another user",
        )
    from api.auth.dependencies import _user_cache

    old_uid = body.old_uid
    new_uid = user.uid

    if old_uid == new_uid:
        return {"status": "ok", "migrated": False}

    fs = get_fs()

    sessions_ref = fs._db.collection("sessions")
    old_sessions = list(sessions_ref.where("user_id", "==", old_uid).stream())
    for doc in old_sessions:
        doc.reference.update({"user_id": new_uid})
        data = doc.to_dict()
        if data.get("state", {}).get("user_id") == old_uid:
            doc.reference.update({"state.user_id": new_uid, "state.is_anonymous": False})

    old_user = fs.get_user(old_uid)
    if old_user:
        new_user = fs.get_user(new_uid)
        if not new_user:
            # Backfill the real identity from the now-authenticated caller. The
            # old doc was anonymous (email=""), so copying it verbatim would
            # leave the new uid with a blank email - present in Firestore but
            # invisible-looking in the admin Users list, even though /me (which
            # reads the token, not Firestore) shows the right address.
            old_user["is_anonymous"] = False
            if user.email:
                old_user["email"] = user.email
            if user.display_name:
                old_user["display_name"] = user.display_name
            fs.create_user(new_uid, old_user)
        fs._db.collection("users").document(old_uid).delete()

    _user_cache.pop(old_uid, None)
    _user_cache.pop(new_uid, None)

    logger.info("Linked account: %s -> %s (migrated %d sessions)", old_uid, new_uid, len(old_sessions))
    return {"status": "ok", "migrated": True, "sessions_migrated": len(old_sessions)}
