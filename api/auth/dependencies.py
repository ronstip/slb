"""FastAPI auth dependencies - Firebase ID token verification + user provisioning."""

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from firebase_admin import auth as firebase_auth

from api.deps import get_fs
from api.services.logging_utils import redact_email
from config.settings import get_settings

logger = logging.getLogger(__name__)

# In-memory cache: uid -> (CurrentUser, expiry_timestamp)
# Avoids a Firestore read + write on every single API request.
_user_cache: dict[str, tuple["CurrentUser", float]] = {}
_USER_CACHE_TTL = 300  # 5 minutes

# Track last_login_at writes to avoid writing on every request
_last_login_written: dict[str, float] = {}
_LAST_LOGIN_INTERVAL = 3600  # Only update last_login_at once per hour

# Header used by super admins to view the app as another user.
IMPERSONATE_HEADER = "X-Impersonate-User-Id"


@dataclass
class CurrentUser:
    uid: str
    email: str
    display_name: str | None
    org_id: str | None
    org_role: str | None
    is_anonymous: bool = False
    # Set only when a super admin is viewing the app as another user.
    # `uid`/`email` above refer to the TARGET user; these fields preserve
    # the real caller's identity for audit logging and permission gates.
    impersonated_by: str | None = None
    real_email: str | None = None


def _has_invite_or_membership(uid: str, email: str) -> bool:
    """True when the caller is already in an org OR has a pending invite for
    their email. Used by the allowlist gate to wave through invitees and
    long-standing org members whose emails aren't on the allowlist."""
    fs = get_fs()
    if uid:
        user_doc = fs.get_user(uid)
        if user_doc and user_doc.get("org_id"):
            return True
    if email:
        return bool(fs.find_pending_invite_by_email(email))
    return False


async def _resolve_real_user(request: Request) -> CurrentUser:
    """Verify the Firebase token and return the real caller.

    Does NOT apply impersonation - used by `get_current_user` internally
    and by endpoints that must always resolve against the true caller
    (e.g. start/stop impersonation).
    """
    settings = get_settings()

    auth_header = request.headers.get("Authorization", "")

    # Extract Bearer token
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")

    token = auth_header.removeprefix("Bearer ")

    # Verify with Firebase Admin SDK (CPU-bound crypto - run in thread pool)
    try:
        decoded = await asyncio.to_thread(firebase_auth.verify_id_token, token)
    except Exception as e:
        logger.warning("Invalid Firebase token: %s", e)
        raise HTTPException(status_code=401, detail="Invalid auth token")

    uid = decoded["uid"]
    email = decoded.get("email", "")
    firebase_info = decoded.get("firebase", {})
    is_anonymous = firebase_info.get("sign_in_provider") == "anonymous"

    # Signup-gate check - anonymous Firebase users (landing-page chat preview)
    # always bypass; for everyone else, the behaviour depends on `signup_gate`:
    #   - "open"         → no check (dev default).
    #   - "allowlist"    → reject emails not in ALLOWED_EMAILS.
    #   - "entitlements" → reserved for §E per-user Firestore tiers; treated
    #                      as "open" here until that lands.
    if settings.signup_gate == "allowlist" and not is_anonymous:
        if not settings.allowed_emails:
            # Defense in depth - `lifespan()` should have hardfailed at boot.
            raise HTTPException(
                status_code=503, detail={"error": "service_misconfigured"}
            )
        allowed = {e.strip().lower() for e in settings.allowed_emails.split(",") if e.strip()}
        if email.lower() not in allowed:
            # Org invites + existing org membership are themselves an
            # authorization signal: an admin already vouched. Without this
            # bypass a non-allowlisted invitee can never accept their invite
            # (this check 403s before `/orgs/join/{code}` ever runs) and an
            # existing member would get locked out the moment their email is
            # removed from the allowlist.
            if not await asyncio.to_thread(_has_invite_or_membership, uid, email):
                logger.warning("Email not in allowlist: %s", redact_email(email))
                raise HTTPException(status_code=403, detail="Access restricted to approved users")

    # Check in-memory cache first
    now = time.monotonic()
    cached = _user_cache.get(uid)
    if cached and cached[1] > now:
        cached_user = cached[0]
        # Identity drift: an anonymous Firebase user that just linked to Google
        # keeps the same uid but the token now carries a real email + a non-anon
        # provider. The cached CurrentUser still has email="" / is_anonymous=True,
        # so email-sensitive endpoints (org-invite join, audit logs) would see
        # the wrong identity. Re-provision when those fields drift.
        if cached_user.is_anonymous == is_anonymous and cached_user.email == email:
            return cached_user
        _user_cache.pop(uid, None)

    # Fetch or provision user in Firestore
    user_doc = await asyncio.to_thread(_get_or_create_user, uid, decoded, is_anonymous)

    current_user = CurrentUser(
        uid=uid,
        email=decoded.get("email", ""),
        display_name=decoded.get("name"),
        org_id=user_doc.get("org_id"),
        org_role=user_doc.get("org_role"),
        is_anonymous=is_anonymous,
    )

    # Cache the result
    _user_cache[uid] = (current_user, now + _USER_CACHE_TTL)

    return current_user


def invalidate_user_cache(uid: str) -> None:
    """Drop the cached CurrentUser for `uid`.

    Why: org membership writes (join/create/leave/role-change/remove) update the
    Firestore user doc directly, but `_resolve_real_user` serves a 5-minute
    cached `CurrentUser` with the OLD `org_id`. Without invalidation the user
    keeps acting as if they were not in the new org - e.g. agents they create
    get `org_id=None` and become unshareable.
    """
    _user_cache.pop(uid, None)


async def get_real_user(request: Request) -> CurrentUser:
    """FastAPI dependency: resolves the real Firebase-authenticated caller.

    Unlike `get_current_user`, this NEVER honors the impersonation header.
    Use for endpoints that must always identify the true caller, such as
    `/admin/impersonate/start` and `/admin/impersonate/stop`.
    """
    return await _resolve_real_user(request)


async def get_current_user(request: Request) -> CurrentUser:
    """FastAPI dependency that extracts and verifies user identity.

    - Dev mode (no Authorization header): returns a default dev user.
    - Prod: verifies Firebase ID token and provisions user if needed.
    - If the caller is a super admin AND the `X-Impersonate-User-Id` header
      is present, returns a `CurrentUser` representing the target user with
      `impersonated_by` set. The header is ignored for non-super-admins.
    """
    real_user = await _resolve_real_user(request)

    target_uid = request.headers.get(IMPERSONATE_HEADER, "").strip()
    if not target_uid:
        return real_user

    # Impersonation requested - gate behind super admin check.
    # Import locally to avoid a circular import (admin.py imports CurrentUser).
    from api.auth.admin import is_super_admin_email

    if not is_super_admin_email(real_user.email):
        # IGNORE the header (don't 403). A non-admin should never be able to
        # impersonate, but a *stale* impersonation header left in sessionStorage
        # from a prior admin session must not brick the user's whole app - every
        # request would otherwise 403 → /access-denied. Treat them as themselves.
        logger.warning(
            "Non-admin %s sent impersonation header for %s - ignoring",
            redact_email(real_user.email), target_uid,
        )
        return real_user

    if target_uid == real_user.uid:
        return real_user

    fs = get_fs()
    target_doc = await asyncio.to_thread(fs.get_user, target_uid)
    if not target_doc:
        raise HTTPException(status_code=404, detail="Impersonation target not found")

    target_email = target_doc.get("email", "") or ""

    # Block admin-on-admin impersonation.
    if is_super_admin_email(target_email):
        raise HTTPException(status_code=403, detail="Cannot impersonate another super admin")

    # Build a CurrentUser for the target. CRUCIAL: do NOT write to
    # `_user_cache` or `_last_login_written` for the target uid - normal
    # requests from the target would then incorrectly see `impersonated_by`
    # set (cache poisoning).
    return CurrentUser(
        uid=target_uid,
        email=target_email,
        display_name=target_doc.get("display_name"),
        org_id=target_doc.get("org_id"),
        org_role=target_doc.get("org_role"),
        is_anonymous=bool(target_doc.get("is_anonymous", False)),
        impersonated_by=real_user.uid,
        real_email=real_user.email,
    )


async def enforce_access(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Router-level dependency (defense in depth) for private data endpoints.

    Rejects `blocked` / expired-trial accounts server-side so a stale token can't
    fetch data via direct API calls even though the UI gates them. Anonymous
    landing-preview users and super admins pass; balance is NOT enforced here
    (out-of-credit paid users can still read). Reuses the same `get_current_user`
    resolution as the endpoint (FastAPI caches it per request - no double work).
    """
    if not user.is_anonymous:
        from api.services.entitlements import require_access

        require_access(user.uid)
    return user


def _get_or_create_user(uid: str, decoded_token: dict, is_anonymous: bool = False) -> dict:
    """Lazy user provisioning - create Firestore user doc on first login."""
    fs = get_fs()

    existing = fs.get_user(uid)
    if existing:
        # Anon → linked: the doc was created when the user was anonymous
        # (email="", is_anonymous=True). After linkWithPopup the same uid now
        # has a real Google identity - backfill the profile so Finance/audit/
        # invite-email-match all see the real address.
        if existing.get("is_anonymous") and not is_anonymous:
            email = decoded_token.get("email", "")
            updates: dict = {"is_anonymous": False}
            if email:
                updates["email"] = email
            name = decoded_token.get("name")
            if name:
                updates["display_name"] = name
            picture = decoded_token.get("picture")
            if picture:
                updates["photo_url"] = picture
            fs.update_user(uid, **updates)
            existing.update(updates)
        elif not existing.get("email") and decoded_token.get("email"):
            # Self-heal a non-anonymous doc that has no email - e.g. one created
            # by an older `link-account` migration that copied the anonymous
            # doc (email="") without backfilling. Such docs render as blank rows
            # in the admin Users list and never recover (the anon branch above
            # requires `is_anonymous`). Repair from the token here.
            updates = {"email": decoded_token["email"]}
            name = decoded_token.get("name")
            if name and not existing.get("display_name"):
                updates["display_name"] = name
            picture = decoded_token.get("picture")
            if picture and not existing.get("photo_url"):
                updates["photo_url"] = picture
            fs.update_user(uid, **updates)
            existing.update(updates)
        # Only update last_login_at once per hour (not on every request)
        now_mono = time.monotonic()
        last_written = _last_login_written.get(uid, 0)
        if now_mono - last_written > _LAST_LOGIN_INTERVAL:
            fs.update_user(uid, last_login_at=datetime.now(timezone.utc))
            _last_login_written[uid] = now_mono
        return existing

    # New user - check for domain auto-join
    email = decoded_token.get("email", "")
    domain = email.split("@")[1] if "@" in email else None

    org_id = None
    org_role = None

    # If there's a pending invite waiting for this email, skip domain auto-join.
    # Otherwise the user would get attached to a domain-matched org first and
    # `POST /orgs/join` would then reject the invite with "already belongs to
    # an organization". The invite flow attaches them to the correct org.
    pending_invite = fs.find_pending_invite_by_email(email) if email else None

    if domain and not pending_invite:
        org = fs.find_org_by_domain(domain)
        if org:
            org_id = org["org_id"]
            org_role = "member"

    now = datetime.now(timezone.utc)
    user_data = {
        "email": email,
        "display_name": decoded_token.get("name"),
        "photo_url": decoded_token.get("picture"),
        "is_anonymous": is_anonymous,
        "org_id": org_id,
        "org_role": org_role,
        "created_at": now,
        "last_login_at": now,
        # §E entitlements: new accounts start blocked (admin must promote) with
        # an empty $ wallet. Anonymous landing-page users get blocked too - they
        # never hit a gated action, and signing in upgrades the same uid.
        "plan": {"tier": "blocked", "trial_expires_at": None, "notes": "", "updated_at": now},
        "credit": {"balance_micros": 0, "total_in_micros": 0, "spent_micros": 0, "updated_at": now},
    }

    fs.create_user(uid, user_data)
    logger.info("Provisioned new user %s (%s)", uid, redact_email(email))
    return user_data
