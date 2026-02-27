"""Super admin authentication — hardcoded email list from env vars."""

from fastapi import HTTPException

from api.auth.dependencies import CurrentUser
from config.settings import get_settings


def require_super_admin(user: CurrentUser) -> None:
    """Raise 403 if user is not a super admin."""
    settings = get_settings()
    admin_emails = [
        e.strip().lower()
        for e in settings.super_admin_emails.split(",")
        if e.strip()
    ]
    if not admin_emails or user.email.lower() not in admin_emails:
        raise HTTPException(status_code=403, detail="Super admin access required")
