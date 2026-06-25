"""Canonical, channel-agnostic message model (spec §1).

Internal contract — unknown fields should fail loudly, so these models do
NOT use ``extra="ignore"``. ``wamid`` is the single idempotency key
end-to-end: it is the Firestore message-doc id and the dedup key checked
before any side effect.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ChannelType = Literal["whatsapp", "web"]
Direction = Literal["inbound", "outbound"]
MessageType = Literal[
    "text", "image", "audio", "video", "document", "template", "system"
]
# Outbound lifecycle (driven by Meta `statuses` webhooks). Inbound messages
# are always "received". Ordering of the non-terminal states is used by the
# status updater to advance monotonically (never regress read -> delivered).
DeliveryStatus = Literal[
    "received", "queued", "sent", "delivered", "read", "failed"
]

# Monotonic rank for outbound status advancement (spec §8a). `failed` is
# terminal and handled separately; `received` is the inbound resting state.
STATUS_RANK: dict[str, int] = {
    "received": 0,
    "queued": 1,
    "sent": 2,
    "delivered": 3,
    "read": 4,
}


class MediaRef(BaseModel):
    type: str  # image | audio | video | document
    wa_media_id: str | None = None  # Meta media handle (download deferred)
    gcs_uri: str | None = None  # populated after durable download (deferred)
    mime_type: str | None = None
    caption: str | None = None
    sha256: str | None = None


class TemplateRef(BaseModel):
    name: str  # Meta-approved template name
    language: str  # e.g. "en_US"
    variables: dict[str, str] = Field(default_factory=dict)


class CanonicalMessage(BaseModel):
    # identity / idempotency
    wamid: str
    channel: ChannelType
    direction: Direction
    # routing
    conversation_id: str | None = None  # resolved during handling
    wa_id: str | None = None  # sender/recipient E.164 digits-only (WhatsApp `wa_id`)
    # content
    type: MessageType
    text: str | None = None
    media: list[MediaRef] = Field(default_factory=list)
    template: TemplateRef | None = None  # outbound template sends only
    # status / time
    status: DeliveryStatus = "received"
    error: str | None = None
    created_at: datetime  # message timestamp (Meta `timestamp` for inbound)
    received_at: datetime  # when our worker processed it
    # raw escape hatch (inbound only) for debugging / forward-compat
    raw: dict | None = None


class StatusUpdate(BaseModel):
    """A Meta `statuses` entry: a delivery/read receipt for an OUTBOUND
    message we previously sent (spec §8a)."""

    wamid: str  # the outbound message id this receipt refers to
    status: DeliveryStatus
    timestamp: datetime
    recipient_id: str | None = None
    error: str | None = None
