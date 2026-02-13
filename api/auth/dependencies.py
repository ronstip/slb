"""FastAPI auth dependencies — Firebase ID token verification + user provisioning."""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from firebase_admin import auth as firebase_auth

from config.settings import get_settings
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)


@dataclass
class CurrentUser:
    uid: str
    email: str
    display_name: str | None
    org_id: str | None
    org_role: str | None


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

    # Verify with Firebase Admin SDK
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception as e:
        logger.warning("Invalid Firebase token: %s", e)
        raise HTTPException(status_code=401, detail="Invalid auth token")

    uid = decoded["uid"]

    # Fetch or provision user in Firestore
    user_doc = _get_or_create_user(uid, decoded)

    return CurrentUser(
        uid=uid,
        email=decoded.get("email", ""),
        display_name=decoded.get("name"),
        org_id=user_doc.get("org_id"),
        org_role=user_doc.get("org_role"),
    )


def _get_or_create_user(uid: str, decoded_token: dict) -> dict:
    """Lazy user provisioning — create Firestore user doc on first login."""
    settings = get_settings()
    fs = FirestoreClient(settings)

    existing = fs.get_user(uid)
    if existing:
        fs.update_user(uid, last_login_at=datetime.now(timezone.utc))
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
        "org_id": org_id,
        "org_role": org_role,
        "created_at": now,
        "last_login_at": now,
    }

    fs.create_user(uid, user_data)
    logger.info("Provisioned new user %s (%s)", uid, email)
    return user_data
