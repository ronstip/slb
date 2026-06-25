"""The three channel-handling interfaces (spec §2).

Protocols, in the style of ``workers/notifications/channel.py``'s
``NotificationChannel``. Concrete WhatsApp implementations live under
``channels/whatsapp/`` and ``workers/whatsapp/``.
"""

from enum import Enum
from typing import Literal, Protocol, runtime_checkable

from pydantic import BaseModel

from channels.message import CanonicalMessage, TemplateRef


# --- Identity ---------------------------------------------------------------


class ResolvedIdentity(BaseModel):
    """Result of resolving a WhatsApp number. ``kind="user"`` carries the
    owning User uid + the Organization data scope it inherits (ADR 0001);
    ``kind="lobby"`` carries neither."""

    kind: Literal["user", "lobby"]
    uid: str | None = None
    org_id: str | None = None


@runtime_checkable
class IdentityResolver(Protocol):
    def resolve(self, wa_id: str) -> ResolvedIdentity: ...


# --- Responder --------------------------------------------------------------


class Disposition(str, Enum):
    REPLIED = "replied"  # responder produced and sent a reply
    DEFERRED = "deferred"  # acknowledged; async work continues
    HANDED_OFF = "handed_off"  # ownership passed to a human; no auto-reply
    NOOP = "noop"  # nothing to do (dedup, status-only, opt-out handled)


class ResponderContext(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    conversation_id: str
    identity: ResolvedIdentity
    conversation: dict  # the conversations/{id} doc snapshot
    sender: "OutboundSender"  # injected — responders never call the client directly


@runtime_checkable
class Responder(Protocol):
    def handle(
        self, ctx: ResponderContext, msg: CanonicalMessage
    ) -> Disposition: ...


# --- Outbound ---------------------------------------------------------------


class SendResult(BaseModel):
    ok: bool
    wamid: str | None = None
    blocked_reason: Literal[
        "opted_out", "window_closed_no_template", "send_failed"
    ] | None = None


@runtime_checkable
class OutboundSender(Protocol):
    # free-form reply — allowed ONLY inside an open Service Window
    def send_text(self, conversation_id: str, text: str) -> SendResult: ...

    # template — required outside the window / for business-initiated sends
    def send_template(
        self, conversation_id: str, template: TemplateRef
    ) -> SendResult: ...


# Resolve the forward reference (ResponderContext -> OutboundSender).
ResponderContext.model_rebuild()
