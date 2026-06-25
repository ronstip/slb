"""Outbound delivery-status persistence (spec §8a).

Meta posts `statuses` receipts (sent/delivered/read/failed) for our outbound
messages on the same webhook as inbound messages. We advance the stored
outbound message's status **monotonically** (never regress read → delivered).
Status events never open the Service Window and never invoke a Responder.
"""

import logging

from channels.message import STATUS_RANK, StatusUpdate

logger = logging.getLogger(__name__)


def resolve_status(current: str | None, incoming: str) -> str | None:
    """Return the status to persist, or None if the receipt should be ignored.

    `failed` is written unless already failed (records the error). Otherwise
    only advance when the incoming rank is strictly higher than the stored one.
    """
    if incoming == "failed":
        return None if current == "failed" else "failed"
    if current == "failed":
        return None  # terminal — a late delivered/read can't un-fail it
    if STATUS_RANK.get(incoming, 0) > STATUS_RANK.get(current or "received", 0):
        return incoming
    return None


def apply_status_update(update: StatusUpdate, fs) -> str:
    """Apply one receipt. Returns "applied" | "ignored" | "missing"."""
    conv_id = fs.get_outbound_conversation(update.wamid)
    if not conv_id:
        # Status for a message we never recorded (e.g. sent before this code
        # shipped). Never create a doc — just log.
        logger.info("Status for unknown wamid %s — noop", update.wamid)
        return "missing"
    current = (fs.get_message(conv_id, update.wamid) or {}).get("status")
    new_status = resolve_status(current, update.status)
    if new_status is None:
        return "ignored"
    fs.update_message_status(
        conv_id, update.wamid, new_status, error=update.error, ts=update.timestamp
    )
    return "applied"
