"""Auth & identity endpoints: current-user profile and account linking."""

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

    org_name = None
    if user.org_id:
        org = fs.get_org(user.org_id)
        if org:
            org_name = org.get("name")

    user_doc = fs.get_user(user.uid)

    # is_super_admin reflects the TARGET user's privileges — during
    # impersonation this is always false because admin-on-admin is blocked.
    # The real caller's super admin status is not leaked through this field.
    from api.auth.admin import is_super_admin_email
    is_super_admin = is_super_admin_email(user.email)

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
        "subscription_plan": user_doc.get("subscription_plan") if user_doc else None,
        "subscription_status": user_doc.get("subscription_status") if user_doc else None,
        "is_super_admin": is_super_admin,
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
    # Block while impersonating — mutates user docs and would corrupt the
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
            old_user["is_anonymous"] = False
            fs.create_user(new_uid, old_user)
        fs._db.collection("users").document(old_uid).delete()

    _user_cache.pop(old_uid, None)
    _user_cache.pop(new_uid, None)

    logger.info("Linked account: %s -> %s (migrated %d sessions)", old_uid, new_uid, len(old_sessions))
    return {"status": "ok", "migrated": True, "sessions_migrated": len(old_sessions)}
