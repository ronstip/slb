"""Impersonation denylist — block high-risk endpoints while impersonating."""

from fastapi import Depends, HTTPException

from api.auth.dependencies import CurrentUser, get_current_user


def block_during_impersonation(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """FastAPI dependency that rejects requests made under an impersonated session.

    Apply to mutating endpoints that must never be triggered while a super
    admin is viewing the app as another user — e.g. billing checkouts,
    account linking, any irreversible action with real-world side effects.
    """
    if user.impersonated_by is not None:
        raise HTTPException(
            status_code=403,
            detail="This action is disabled while viewing as another user",
        )
    return user
