"""FastAPI auth dependencies — Firebase ID token verification + user provisioning."""

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from firebase_admin import auth as firebase_auth

from api.deps import get_fs
from config.settings import get_settings

logger = logging.getLogger(__name__)

# In-memory cache: uid -> (CurrentUser, expiry_timestamp)
# Avoids a Firestore read + write on every single API request.
_user_cache: dict[str, tuple["CurrentUser", float]] = {}
_USER_CACHE_TTL = 300  # 5 minutes

# Track last_login_at writes to avoid writing on every request
_last_login_written: dict[str, float] = {}
_LAST_LOGIN_INTERVAL = 3600  # Only update last_login_at once per hour


@dataclass
class CurrentUser:
    uid: str
    email: str
    display_name: str | None
    org_id: str | None
    org_role: str | None
    is_anonymous: bool = False


async def get_current_user(request: Request) -> CurrentUser:
    """FastAPI dependency that extracts and verifies user identity.

    - Dev mode (no Authorization header): returns a default dev user.
    - Prod: verifies Firebase ID token and provisions user if needed.
    """
    settings = get_settings()

    auth_header = request.headers.get("Authorization", "")

    # Dev mode bypass — only when no token is provided
    if settings.is_dev and not auth_header:
        return CurrentUser(
            uid="default_user",
            email="dev@localhost",
            display_name="Dev User",
            org_id=None,
            org_role=None,
        )

    # Extract Bearer token
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")

    token = auth_header.removeprefix("Bearer ")

    # Verify with Firebase Admin SDK (CPU-bound crypto — run in thread pool)
    try:
        decoded = await asyncio.to_thread(firebase_auth.verify_id_token, token)
    except Exception as e:
        logger.warning("Invalid Firebase token: %s", e)
        raise HTTPException(status_code=401, detail="Invalid auth token")

    uid = decoded["uid"]
    email = decoded.get("email", "")
    firebase_info = decoded.get("firebase", {})
    is_anonymous = firebase_info.get("sign_in_provider") == "anonymous"

    # Email allowlist — skip for anonymous users; if set, reject anyone not on the list
    if settings.allowed_emails and not is_anonymous:
        allowed = {e.strip().lower() for e in settings.allowed_emails.split(",") if e.strip()}
        if email.lower() not in allowed:
            logger.warning("Email not in allowlist: %s", email)
            raise HTTPException(status_code=403, detail="Access restricted to approved users")

    # Check in-memory cache first
    now = time.monotonic()
    cached = _user_cache.get(uid)
    if cached and cached[1] > now:
        return cached[0]

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


def _get_or_create_user(uid: str, decoded_token: dict, is_anonymous: bool = False) -> dict:
    """Lazy user provisioning — create Firestore user doc on first login."""
    fs = get_fs()

    existing = fs.get_user(uid)
    if existing:
        # Only update last_login_at once per hour (not on every request)
        now_mono = time.monotonic()
        last_written = _last_login_written.get(uid, 0)
        if now_mono - last_written > _LAST_LOGIN_INTERVAL:
            fs.update_user(uid, last_login_at=datetime.now(timezone.utc))
            _last_login_written[uid] = now_mono
        return existing

    # New user — check for domain auto-join
    email = decoded_token.get("email", "")
    domain = email.split("@")[1] if "@" in email else None

    org_id = None
    org_role = None

    if domain:
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
    }

    fs.create_user(uid, user_data)
    logger.info("Provisioned new user %s (%s)", uid, email)
    return user_data
