"""WhatsApp Cloud API transport (spec §0/§1).

Two concerns, deliberately together but cleanly separable:

* **Pure functions** (no network): ``verify_signature``, ``normalize_e164``,
  ``normalize_inbound``, ``parse_statuses``. These are the testable core of
  the channel — the webhook and worker call them with raw Meta payloads.
* **``WhatsAppClient``**: the thin Graph API HTTP wrapper (send text / send
  template / download media). Network is isolated here so handler and
  responder logic stay testable without HTTP.
"""

import hashlib
import hmac
import logging
import re
from datetime import datetime, timezone

import httpx

from channels.message import CanonicalMessage, MediaRef, StatusUpdate

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.facebook.com/v21.0"

# Media-bearing inbound message types -> the payload key carrying the blob.
_MEDIA_TYPES = ("image", "audio", "video", "document", "sticker")


# --- Pure helpers -----------------------------------------------------------


def build_template_components(variables: dict[str, str] | None) -> list:
    """Map ``TemplateRef.variables`` to Graph API body parameters (positional,
    in insertion order). Empty/none ⇒ no components (a static template)."""
    if not variables:
        return []
    return [
        {
            "type": "body",
            "parameters": [
                {"type": "text", "text": str(v)} for v in variables.values()
            ],
        }
    ]


def normalize_e164(raw: str | None) -> str:
    """Strip a WhatsApp number to E.164 digits-only (no '+', no separators).

    WhatsApp's ``wa_id`` / ``from`` are already digits-only; this guards
    against any '+'/spaces sneaking in from other call sites.
    """
    if not raw:
        return ""
    return re.sub(r"\D", "", raw)


def verify_signature(body: bytes, signature_header: str, app_secret: str) -> bool:
    """Verify Meta's ``X-Hub-Signature-256`` (HMAC-SHA256 over the raw body).

    Mirrors the billing-webhook HMAC pattern (``api/routers/billing.py``):
    constant-time compare, never raises. ``signature_header`` is the full
    header value, e.g. ``"sha256=abcd..."``.
    """
    if not app_secret or not signature_header:
        return False
    if not signature_header.startswith("sha256="):
        return False
    received = signature_header.removeprefix("sha256=")
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received)


def _ts(raw: str | int | None) -> datetime:
    """Meta timestamps are unix-epoch seconds (as strings). Fall back to now."""
    try:
        return datetime.fromtimestamp(int(raw), tz=timezone.utc)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def _iter_values(payload: dict, field: str):
    """Yield each ``change.value`` whose ``field`` matches, across all
    ``entry`` items. Meta batches multiple entries/changes per webhook POST."""
    for entry in payload.get("entry", []) or []:
        for change in entry.get("changes", []) or []:
            if change.get("field") == field:
                value = change.get("value")
                if isinstance(value, dict):
                    yield value


def _media_ref(msg: dict, msg_type: str) -> list[MediaRef]:
    blob = msg.get(msg_type)
    if not isinstance(blob, dict):
        return []
    return [
        MediaRef(
            type=msg_type,
            wa_media_id=blob.get("id"),
            mime_type=blob.get("mime_type"),
            caption=blob.get("caption"),
            sha256=blob.get("sha256"),
        )
    ]


def normalize_inbound(payload: dict) -> list[CanonicalMessage]:
    """Map a Meta ``messages`` webhook payload to ``CanonicalMessage`` list.

    Handles text + media types. Unknown/unsupported types are still emitted
    (type coerced to ``system``) so dedup + audit see them; the responder
    decides what to do. Returns ``[]`` for non-message payloads.
    """
    out: list[CanonicalMessage] = []
    now = datetime.now(timezone.utc)
    for value in _iter_values(payload, "messages"):
        for msg in value.get("messages", []) or []:
            msg_type = msg.get("type", "")
            text = None
            media: list[MediaRef] = []
            if msg_type == "text":
                text = (msg.get("text") or {}).get("body")
                canonical_type = "text"
            elif msg_type in _MEDIA_TYPES:
                media = _media_ref(msg, msg_type)
                # `sticker` collapses onto the closest canonical type.
                canonical_type = "image" if msg_type == "sticker" else msg_type
                text = media[0].caption if media else None
            else:
                canonical_type = "system"
            out.append(
                CanonicalMessage(
                    wamid=msg.get("id", ""),
                    channel="whatsapp",
                    direction="inbound",
                    wa_id=normalize_e164(msg.get("from")),
                    type=canonical_type,
                    text=text,
                    media=media,
                    status="received",
                    created_at=_ts(msg.get("timestamp")),
                    received_at=now,
                    raw=msg,
                )
            )
    return out


def parse_statuses(payload: dict) -> list[StatusUpdate]:
    """Map a Meta ``statuses`` webhook payload to ``StatusUpdate`` list
    (delivery/read receipts for outbound messages, spec §8a)."""
    out: list[StatusUpdate] = []
    for value in _iter_values(payload, "messages"):
        for st in value.get("statuses", []) or []:
            errors = st.get("errors") or []
            err = None
            if errors:
                first = errors[0]
                err = first.get("title") or first.get("message") or str(first)
            out.append(
                StatusUpdate(
                    wamid=st.get("id", ""),
                    status=st.get("status", "sent"),
                    timestamp=_ts(st.get("timestamp")),
                    recipient_id=st.get("recipient_id"),
                    error=err,
                )
            )
    return out


# --- Graph API client (network) ---------------------------------------------


class WhatsAppClient:
    """Thin Graph API wrapper. Constructed with the worker-side credentials
    (``whatsapp_access_token`` + ``whatsapp_phone_number_id``)."""

    def __init__(self, access_token: str, phone_number_id: str, timeout: float = 15.0):
        self._token = access_token
        self._phone_number_id = phone_number_id
        self._timeout = timeout

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    def _send(self, payload: dict) -> str | None:
        """POST a message payload; return the sent ``wamid`` or None on failure.
        Never raises (mirrors ``EmailChannel.send``)."""
        url = f"{GRAPH_BASE}/{self._phone_number_id}/messages"
        try:
            resp = httpx.post(
                url, json=payload, headers=self._headers, timeout=self._timeout
            )
            if resp.status_code >= 400:
                logger.error(
                    "WhatsApp send failed %s: %s", resp.status_code, resp.text
                )
                return None
            data = resp.json()
            msgs = data.get("messages") or []
            return msgs[0].get("id") if msgs else None
        except Exception:
            logger.exception("WhatsApp send raised")
            return None

    def send_text(self, to: str, body: str) -> str | None:
        return self._send(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": normalize_e164(to),
                "type": "text",
                "text": {"body": body},
            }
        )

    def send_template(
        self, to: str, name: str, language: str, components: list | None = None
    ) -> str | None:
        template: dict = {"name": name, "language": {"code": language}}
        if components:
            template["components"] = components
        return self._send(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": normalize_e164(to),
                "type": "template",
                "template": template,
            }
        )

    def download_media(self, media_id: str) -> bytes | None:
        """DEFERRED (spec §9): durable media download. Stubbed so the
        MediaRef carries only ``wa_media_id`` until the GCS download lands."""
        raise NotImplementedError("media download deferred — see spec §9")
