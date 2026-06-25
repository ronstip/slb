"""Build a ``CurrentUser`` from a resolved WhatsApp identity (spec §6).

A WhatsApp inbound carries no Firebase token, so the Concierge cannot use the
normal ``get_current_user`` dependency. This factory produces the SAME scope
object (uid + org_id) from a bound `number → User` resolution, so the Concierge
reuses the exact downstream Organization scope that web chat uses (ADR 0001).
"""

from api.auth.dependencies import CurrentUser
from channels.interfaces import ResolvedIdentity


def current_user_from_identity(
    identity: ResolvedIdentity, fs=None
) -> CurrentUser:
    """Map a bound identity to a ``CurrentUser``. Raises if the identity is a
    Lobby (the Concierge only runs for attached conversations)."""
    if identity.kind != "user" or not identity.uid:
        raise ValueError("current_user_from_identity requires a bound user identity")

    email = ""
    display_name = None
    org_role = None
    if fs is not None:
        user_doc = fs.get_user(identity.uid) or {}
        email = user_doc.get("email", "") or ""
        display_name = user_doc.get("display_name")
        org_role = user_doc.get("org_role")

    return CurrentUser(
        uid=identity.uid,
        email=email,
        display_name=display_name,
        org_id=identity.org_id,
        org_role=org_role,
        is_anonymous=False,
    )
