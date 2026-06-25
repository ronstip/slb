"""Responder selection (spec §2b/§4): pick the Responder for a conversation
from its state — NEVER from message content. The Responder is fixed by
attachment; takeover swaps it to human.
"""

from channels.interfaces import Responder
from workers.whatsapp.responders.concierge import ConciergeResponder
from workers.whatsapp.responders.human import HumanTakeoverResponder
from workers.whatsapp.responders.scripted import ScriptedResponder


def select_responder(conversation: dict, fs, run_fn=None) -> Responder:
    """Return the Responder for a conversation.

    Honors an explicit ``responder`` field; falls back to the attachment state
    (attached → Concierge, otherwise Scripted lobby). ``run_fn`` is forwarded to
    the Concierge for test injection.
    """
    responder = conversation.get("responder")
    if responder is None:
        responder = (
            "concierge"
            if conversation.get("attachment_state") == "attached"
            else "scripted"
        )

    if responder == "concierge":
        return ConciergeResponder(fs, run_fn=run_fn)
    if responder == "human":
        return HumanTakeoverResponder()
    return ScriptedResponder()
