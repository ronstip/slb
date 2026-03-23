import logging

logger = logging.getLogger(__name__)


def compose_email(
    recipient_email: str,
    subject: str,
    body_markdown: str,
) -> dict:
    """Send a composed email to a specified recipient.

    WHEN TO USE: When the user explicitly asks you to email something — a
    summary, report highlights, key findings, or any content you've composed
    during the conversation.

    IMPORTANT: You MUST ask the user for their email address before calling
    this tool. Never guess or assume the recipient email.

    Args:
        recipient_email: The recipient's email address. Always ask the user
            for this before calling.
        subject: Email subject line. Keep it concise and descriptive.
        body_markdown: Email body as markdown. Write this based on your
            analysis — include key data points, findings, bullet points,
            and any relevant context. Markdown formatting (bold, lists,
            headers) will be converted to HTML.

    Returns:
        A dict with status ("success" or "error") and a message.
    """
    if not recipient_email:
        return {"status": "error", "message": "Recipient email address is required. Please ask the user for their email."}
    if not subject or not body_markdown:
        return {"status": "error", "message": "Both subject and body are required."}

    try:
        from workers.notifications.service import send_composed_email

        return send_composed_email(
            recipient_email=recipient_email,
            subject=subject,
            body_markdown=body_markdown,
        )
    except Exception:
        logger.exception("compose_email failed")
        return {"status": "error", "message": "Failed to send email. Please try again later."}
