"""WhatsApp ``OutboundSender`` (spec §2c).

The single choke point for outbound sends. The opt-out and Service-Window
gates are enforced HERE so no caller can bypass them.

Phase 1: text send + persist the outbound message. The gates are stubbed
open and filled in by later phases:
  * opt-out gate    → phase 2
  * window gate     → phase 3
  * send_template   → phase 3
"""

import logging
from datetime import datetime, timezone

from channels.interfaces import OutboundSender, SendResult
from channels.message import CanonicalMessage, TemplateRef
from channels.whatsapp.client import WhatsAppClient, build_template_components
from channels.whatsapp.window import is_window_open

logger = logging.getLogger(__name__)


class WhatsAppOutboundSender(OutboundSender):
    def __init__(self, client: WhatsAppClient, fs):
        self._client = client
        self._fs = fs

    def _record_outbound(self, conv_id: str, wa_id: str | None, msg_type: str,
                         wamid: str, text: str | None, template: TemplateRef | None):
        now = datetime.now(timezone.utc)
        msg = CanonicalMessage(
            wamid=wamid,
            channel="whatsapp",
            direction="outbound",
            conversation_id=conv_id,
            wa_id=wa_id,
            type=msg_type,
            text=text,
            template=template,
            status="sent",
            created_at=now,
            received_at=now,
        )
        self._fs.append_channel_message(conv_id, msg.model_dump(mode="python"))
        # Index for later status receipts (spec §8a).
        self._fs.index_outbound_message(wamid, conv_id)

    def _opted_out(self, conv: dict) -> bool:
        """GATE 1 — opt-out. A User who sent STOP gets no outbound at all
        (honored immediately, CONTEXT.md). Lobby conversations have no User,
        so no opt-out state applies."""
        uid = conv.get("user_id")
        return bool(uid) and self._fs.get_wa_opt_out(uid)

    def send_text(self, conversation_id: str, text: str) -> SendResult:
        conv = self._fs.get_conversation(conversation_id) or {}
        if self._opted_out(conv):
            return SendResult(ok=False, blocked_reason="opted_out")
        # GATE 2 — Service Window. Free-form text is allowed ONLY inside an
        # open window; outside it the caller must escalate to a Template.
        if not is_window_open(conv.get("last_inbound_at")):
            return SendResult(ok=False, blocked_reason="window_closed_no_template")
        wa_id = conv.get("wa_id")
        wamid = self._client.send_text(wa_id, text)
        if not wamid:
            return SendResult(ok=False, blocked_reason="send_failed")
        self._record_outbound(conversation_id, wa_id, "text", wamid, text, None)
        return SendResult(ok=True, wamid=wamid)

    def send_template(
        self, conversation_id: str, template: TemplateRef
    ) -> SendResult:
        # Window-independent (a Template is exactly what's allowed outside the
        # window). The opt-out gate still applies.
        conv = self._fs.get_conversation(conversation_id) or {}
        if self._opted_out(conv):
            return SendResult(ok=False, blocked_reason="opted_out")
        wa_id = conv.get("wa_id")
        components = build_template_components(template.variables)
        wamid = self._client.send_template(
            wa_id, template.name, template.language, components or None
        )
        if not wamid:
            return SendResult(ok=False, blocked_reason="send_failed")
        self._record_outbound(
            conversation_id, wa_id, "template", wamid, None, template
        )
        return SendResult(ok=True, wamid=wamid)
