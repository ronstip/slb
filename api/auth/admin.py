"""Super admin authentication — hardcoded email list from env vars."""

from fastapi import HTTPException

from api.auth.dependencies import CurrentUser
from config.settings import get_settings


def _admin_emails() -> set[str]:
    settings = get_settings()
    return {
        e.strip().lower()
        for e in settings.super_admin_emails.split(",")
        if e.strip()
    }


def is_super_admin_email(email: str | None) -> bool:
    """Return True if the given email is in the super admin allowlist."""
    if not email:
        return False
    admins = _admin_emails()
    return bool(admins) and email.lower() in admins


def require_super_admin(user: CurrentUser) -> None:
    """Raise 403 if user is not a super admin.

    An impersonated session is ALWAYS rejected here, even if the real
    caller is a super admin. This makes `/admin/*` endpoints return 403
    during impersonation, matching what the target user would see.
    """
    if user.impersonated_by is not None:
        raise HTTPException(status_code=403, detail="Super admin access required")

    if not is_super_admin_email(user.email):
        raise HTTPException(status_code=403, detail="Super admin access required")
