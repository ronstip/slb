"""ScriptedResponder — the lobby's only Responder (spec §2b, CONTEXT.md
Lobby Conversation). A single fixed login-invite reply, the same every time,
zero Organization data, no LLM. Promotional Q&A is a future addition to this
same slot (deferred — spec §9)."""

import logging

from channels.interfaces import Disposition, Responder, ResponderContext
from channels.message import CanonicalMessage

logger = logging.getLogger(__name__)

# Single fixed invite. Kept here (not config) until the lobby script grows.
LOBBY_LOGIN_INVITE = (
    "👋 Thanks for messaging Scolto. To use the assistant here, first create or "
    "sign in to your account at https://scolto.com and add this WhatsApp number "
    "in Settings. Once it's verified, message us again and we'll be connected."
)


class ScriptedResponder(Responder):
    def handle(self, ctx: ResponderContext, msg: CanonicalMessage) -> Disposition:
        result = ctx.sender.send_text(ctx.conversation_id, LOBBY_LOGIN_INVITE)
        return Disposition.REPLIED if result.ok else Disposition.NOOP
