"""Role-based permission helpers for organization access control."""

from fastapi import HTTPException

from api.auth.dependencies import CurrentUser

ROLE_LEVELS = {"member": 0, "admin": 1, "owner": 2}


def require_org_role(user: CurrentUser, min_role: str) -> None:
    """Raise 403 if user doesn't have at least min_role in their org."""
    if not user.org_id or not user.org_role:
        raise HTTPException(status_code=403, detail="Not in an organization")
    if ROLE_LEVELS.get(user.org_role, 0) < ROLE_LEVELS.get(min_role, 0):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def require_org_member(user: CurrentUser) -> None:
    """Raise 403 if user is not in an organization."""
    if not user.org_id:
        raise HTTPException(status_code=403, detail="Not in an organization")
