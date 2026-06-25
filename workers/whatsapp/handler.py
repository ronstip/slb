"""WhatsApp inbound handler (worker side).

Invoked by ``POST /whatsapp/inbound`` (enqueued by the webhook). It:
  1. branches `messages` vs `statuses` (statuses → persist receipts, §8a);
  2. resolves identity (bound → User, else Lobby);
  3. dedups on `wamid` before any side effect;
  4. honors STOP/START consent immediately;
  5. opens the Service Window and dispatches to a Responder.

Responder selection here is by identity (Lobby → Scripted, attached → Echo
placeholder). Phase 4 replaces the Echo placeholder with the Concierge and
introduces state-driven routing + Human takeover.
"""

import logging

from channels.interfaces import ResponderContext
from channels.whatsapp.client import (
    WhatsAppClient,
    normalize_inbound,
    parse_statuses,
)
from channels.whatsapp.consent import detect_consent_command
from channels.whatsapp.outbound import WhatsAppOutboundSender
from channels.whatsapp.resolver import WhatsAppIdentityResolver
from workers.whatsapp.router import select_responder
from workers.whatsapp.status import apply_status_update

logger = logging.getLogger(__name__)


def process_inbound(
    payload: dict, *, fs=None, sender=None, resolver=None, run_fn=None
) -> dict:
    """Process one Meta webhook payload. ``fs``/``sender``/``resolver``/``run_fn``
    are injectable for tests; production builds the singletons here. ``run_fn``
    is forwarded to the Concierge (the ADK run)."""
    if fs is None:
        from api.deps import get_fs

        fs = get_fs()

    statuses = parse_statuses(payload)
    messages = normalize_inbound(payload)

    # `statuses` payloads carry no inbound messages — persist the receipts.
    if statuses and not messages:
        applied = [apply_status_update(s, fs) for s in statuses]
        logger.info("WhatsApp statuses: %s", applied)
        return {"status": "ok", "handled": "statuses", "results": applied}

    if sender is None:
        from config.settings import get_settings

        settings = get_settings()
        client = WhatsAppClient(
            settings.whatsapp_access_token, settings.whatsapp_phone_number_id
        )
        sender = WhatsAppOutboundSender(client, fs)
    if resolver is None:
        resolver = WhatsAppIdentityResolver(fs)

    handled = 0
    for msg in messages:
        identity = resolver.resolve(msg.wa_id)
        conv = fs.get_or_create_wa_conversation(
            msg.wa_id, uid=identity.uid, org_id=identity.org_id
        )
        conv_id = conv["conv_id"]
        msg.conversation_id = conv_id

        # Dedup gate — a duplicate `wamid` (Meta retry) short-circuits before
        # any side effect (NOOP).
        if not fs.append_channel_message(conv_id, msg.model_dump(mode="python")):
            logger.info("Duplicate wamid %s — noop", msg.wamid)
            continue

        # Inbound opens / resets the 24h Service Window (spec §3a).
        fs.set_window(conv_id, True, msg.created_at)

        # Consent — honor STOP/START immediately, before any reply (only a
        # bound User has a consent state to set).
        command = detect_consent_command(msg.text)
        if command and identity.kind == "user":
            fs.set_wa_opt_out(identity.uid, command == "stop")
            logger.info("Consent %s for user %s", command, identity.uid)
            handled += 1
            continue  # no auto-reply to a consent command

        responder = select_responder(conv, fs, run_fn=run_fn)
        ctx = ResponderContext(
            conversation_id=conv_id,
            identity=identity,
            conversation=conv,
            sender=sender,
        )
        disposition = responder.handle(ctx, msg)
        logger.info("WhatsApp %s -> %s", msg.wamid, disposition.value)
        handled += 1

    return {"status": "ok", "handled": handled}
