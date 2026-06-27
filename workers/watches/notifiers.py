"""Channel-agnostic delivery for Watch fires (docs/alerts/watch-system-spec.md §5).

A `Notifier` takes a channel-neutral `NotificationPayload` and delivers it. The
abstraction is the point — adding WhatsApp later is a new adapter, not a change to
the firing pipeline. v1: `in_app` and `email` are real; `whatsapp` is registered
but stubbed (the grass is laid — enum value, routing, per-watch channel selection
all exist; only the adapter is empty).
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field as dc_field

logger = logging.getLogger(__name__)


@dataclass
class NotificationPayload:
    title: str
    body_markdown: str
    severity: str = "med"  # low | med | high
    watch_id: str | None = None
    owner_uid: str | None = None
    agent_id: str | None = None
    evidence_post_ids: list[str] = dc_field(default_factory=list)
    recipients: list[str] = dc_field(default_factory=list)  # email; empty → owner
    attachments: list[dict] = dc_field(default_factory=list)  # opt-in widget PNGs


@dataclass
class DeliveryResult:
    channel: str
    ok: bool
    detail: str = ""


class Notifier(ABC):
    channel: str

    @abstractmethod
    def deliver(self, payload: NotificationPayload) -> DeliveryResult: ...


class InAppNotifier(Notifier):
    """Writes a notification doc to the owner's in-app feed (`users/{uid}/notifications`)
    and bumps an unread counter. Cheapest real channel; the home for low-severity
    fires that shouldn't hit an inbox."""

    channel = "in_app"

    def __init__(self, fs):
        self._fs = fs

    def deliver(self, payload: NotificationPayload) -> DeliveryResult:
        if not payload.owner_uid:
            return DeliveryResult(self.channel, False, "no owner_uid")
        try:
            self._fs.add_user_notification(
                payload.owner_uid,
                {
                    "title": payload.title,
                    "body_markdown": payload.body_markdown,
                    "severity": payload.severity,
                    "watch_id": payload.watch_id,
                    "agent_id": payload.agent_id,
                    "evidence_post_ids": payload.evidence_post_ids,
                },
            )
            return DeliveryResult(self.channel, True)
        except Exception as e:  # noqa: BLE001 - one channel failing must not kill the rest
            logger.exception("in_app notify failed for watch %s", payload.watch_id)
            return DeliveryResult(self.channel, False, str(e))


class EmailNotifier(Notifier):
    """Renders the channel-neutral payload through the existing SendGrid markdown
    path. Recipients = explicit list, else the owner's email."""

    channel = "email"

    def __init__(self, fs):
        self._fs = fs

    def _resolve_recipients(self, payload: NotificationPayload) -> list[str]:
        recipients = [r for r in (payload.recipients or []) if r]
        if recipients:
            return recipients
        if payload.owner_uid:
            user = self._fs.get_user(payload.owner_uid) or {}
            email = (user.get("email") or "").strip()
            if email:
                return [email]
        return []

    def deliver(self, payload: NotificationPayload) -> DeliveryResult:
        recipients = self._resolve_recipients(payload)
        if not recipients:
            return DeliveryResult(self.channel, False, "no recipients")

        # With rendered widget PNGs → hand-built HTML; otherwise the markdown path.
        if payload.attachments:
            from workers.notifications.service import send_composed_html_email
            from workers.watches.email import build_watch_email_html
            from config.settings import get_settings

            html = build_watch_email_html(
                watch_name=payload.title,
                body_markdown=payload.body_markdown,
                images=payload.attachments,
                app_url=get_settings().frontend_url,
                agent_id=payload.agent_id,
            )
            send = lambda r: send_composed_html_email(recipient_email=r, subject=payload.title, body_html=html)
        else:
            from workers.notifications.service import send_composed_email

            send = lambda r: send_composed_email(
                recipient_email=r, subject=payload.title, body_markdown=payload.body_markdown
            )

        sent = 0
        for r in recipients:
            res = send(r)
            if res.get("status") == "success":
                sent += 1
            else:
                logger.error("watch %s email to %s failed: %s", payload.watch_id, r, res.get("message"))
        return DeliveryResult(self.channel, sent > 0, f"{sent}/{len(recipients)} sent")


class WhatsAppNotifier(Notifier):
    """Stub — the abstraction is ready, the adapter is not. WhatsApp delivery is a
    separate later effort (ADR-0003 transport). Registered so per-watch channel
    selection and routing already exist; selecting it is a no-op with a warning,
    never an error that kills the other channels."""

    channel = "whatsapp"

    def deliver(self, payload: NotificationPayload) -> DeliveryResult:
        logger.warning("whatsapp Notifier is a stub (watch %s) — not delivered", payload.watch_id)
        return DeliveryResult(self.channel, False, "whatsapp delivery not yet implemented")


def build_registry(fs) -> dict:
    return {
        "in_app": InAppNotifier(fs),
        "email": EmailNotifier(fs),
        "whatsapp": WhatsAppNotifier(),
    }


def deliver_to_channels(channels: list[str], payload: NotificationPayload, registry: dict) -> list[DeliveryResult]:
    """Deliver to each requested channel; an unknown/failed channel is logged and
    skipped, never raised — one channel must not block the others."""
    results: list[DeliveryResult] = []
    for ch in channels or []:
        notifier = registry.get(ch)
        if notifier is None:
            logger.warning("unknown notification channel %r — skipped", ch)
            results.append(DeliveryResult(ch, False, "unknown channel"))
            continue
        results.append(notifier.deliver(payload))
    return results
