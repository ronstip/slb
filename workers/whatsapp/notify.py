"""Proactive (business-initiated) WhatsApp send (spec §3a, ADR 0003).

A Concierge alert tries a free-form text first; if the Service Window is
closed it escalates to a pre-approved Template. Opt-out is honored by the
``OutboundSender`` gate (returns before either send).
"""

import logging

from channels.interfaces import OutboundSender, SendResult
from channels.message import TemplateRef

logger = logging.getLogger(__name__)


def send_alert(
    sender: OutboundSender,
    conversation_id: str,
    text: str,
    template: TemplateRef,
) -> SendResult:
    """Send a proactive alert: free-form inside an open window, else Template.

    ``template`` is the pre-approved fallback carrying the same information
    (its variables filled by the caller).
    """
    result = sender.send_text(conversation_id, text)
    if result.ok or result.blocked_reason != "window_closed_no_template":
        return result  # sent, or blocked for a reason a template won't fix (opt-out)
    logger.info("Service Window closed for %s — escalating to Template", conversation_id)
    return sender.send_template(conversation_id, template)
