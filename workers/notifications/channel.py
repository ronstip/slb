"""Notification channel protocol and implementations.

NotificationChannel is a minimal protocol — email now, Slack later.
"""

import logging
from typing import Protocol, runtime_checkable

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Content, Email, Mail, To

logger = logging.getLogger(__name__)


@runtime_checkable
class NotificationChannel(Protocol):
    def send(
        self, recipient: str, subject: str, html_body: str, plain_body: str = ""
    ) -> bool: ...


class EmailChannel:
    """SendGrid email notification channel.

    Returns True on success, False on failure — never raises.
    """

    def __init__(self, api_key: str, from_email: str, from_name: str):
        self._client = SendGridAPIClient(api_key)
        self._from_email = Email(from_email, from_name)

    def send(
        self, recipient: str, subject: str, html_body: str, plain_body: str = ""
    ) -> bool:
        message = Mail(
            from_email=self._from_email,
            to_emails=To(recipient),
            subject=subject,
        )
        message.content = [
            Content("text/plain", plain_body or subject),
            Content("text/html", html_body),
        ]

        try:
            response = self._client.send(message)
            if response.status_code >= 400:
                logger.error(
                    "SendGrid returned %s for %s: %s",
                    response.status_code,
                    recipient,
                    response.body,
                )
                return False
            logger.info("Email sent to %s (status=%s)", recipient, response.status_code)
            return True
        except Exception:
            logger.exception("Failed to send email to %s", recipient)
            return False
