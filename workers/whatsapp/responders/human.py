"""HumanTakeoverResponder (spec §2b) — a platform/org operator answers by hand
instead of the Concierge. Takeover is INITIATED elsewhere (an operator action
that sets the conversation's responder to "human"); this responder simply
honors that state: it routes the inbound to the operator surface and sends no
automatic reply.

The operator surface (an inbox/queue) is a deferred seam (spec §9) — for now
the inbound is logged so it isn't dropped.
"""

import logging

from channels.interfaces import Disposition, Responder, ResponderContext
from channels.message import CanonicalMessage

logger = logging.getLogger(__name__)


class HumanTakeoverResponder(Responder):
    def handle(self, ctx: ResponderContext, msg: CanonicalMessage) -> Disposition:
        # DEFERRED: forward to the operator inbox/queue (spec §9). Log so the
        # message is never silently dropped while in human takeover.
        logger.info(
            "Human takeover — inbound %s on conversation %s awaiting operator",
            msg.wamid, ctx.conversation_id,
        )
        return Disposition.HANDED_OFF
