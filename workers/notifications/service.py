"""Notification service — sends agent-composed emails via SendGrid."""

import logging

import markdown

from config.settings import get_settings
from workers.notifications.channel import EmailChannel
from workers.notifications.templates import wrap_html

logger = logging.getLogger(__name__)


def send_composed_email(
    recipient_email: str,
    subject: str,
    body_markdown: str,
) -> dict:
    """Send an agent-composed email.

    Returns a dict with status and message (matches agent tool return pattern).
    """
    settings = get_settings()

    if not settings.sendgrid_api_key:
        return {"status": "error", "message": "Email is not configured. SendGrid API key is missing."}

    if not recipient_email:
        return {"status": "error", "message": "Recipient email address is required."}

    body_html = markdown.markdown(body_markdown)
    html_email = wrap_html(body_html, subject, app_url=settings.frontend_url)

    channel = EmailChannel(
        api_key=settings.sendgrid_api_key,
        from_email=settings.sendgrid_from_email,
        from_name=settings.sendgrid_from_name,
    )
    success = channel.send(
        recipient=recipient_email,
        subject=subject,
        html_body=html_email,
        plain_body=body_markdown,
    )

    if success:
        return {"status": "success", "message": f"Email sent to {recipient_email}."}
    return {"status": "error", "message": "Failed to send email. Please try again later."}
