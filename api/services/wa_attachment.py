"""Attachment service (spec §2/§3b/§8.2): bind a verified WhatsApp number to a
User and re-parent that number's active conversation in place.

This is the backend seam the email-first web verify flow calls once it has
confirmed possession of the number. The web/UX side is deferred (spec §9);
this function exists now so the binding contract is testable and stable.
"""

import logging

from api.deps import get_fs
from channels.whatsapp.client import normalize_e164

logger = logging.getLogger(__name__)


def attach_number(uid: str, e164: str, org_id: str | None = None, fs=None) -> dict:
    """Bind ``e164`` to the User and re-parent its live lobby conversation.

    Returns ``{"bound": e164, "conversation_id": <id or None>, "reparented": bool}``.
    Idempotent: re-binding an already-bound number just refreshes the index.
    Retains lobby message history (re-parent in place — spec §8.2).
    """
    fs = fs or get_fs()
    e164 = normalize_e164(e164)

    fs.bind_wa_number(uid, e164, org_id)

    # Re-parent the active conversation for this number, if one exists (it
    # will when the User messaged from the lobby before verifying).
    conv = fs.get_active_conversation(e164)
    conv_id = conv.get("conv_id") if conv else None
    reparented = False
    if conv_id and conv.get("attachment_state") != "attached":
        fs.attach_conversation_identity(conv_id, uid, org_id)
        reparented = True

    logger.info(
        "Attached %s to user %s (conversation=%s, reparented=%s)",
        e164, uid, conv_id, reparented,
    )
    return {"bound": e164, "conversation_id": conv_id, "reparented": reparented}
