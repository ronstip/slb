"""Opt-in / opt-out keyword detection (spec §5, CONTEXT.md Opt-in/Opt-out).

WhatsApp users manage business-initiated consent with reserved keywords. We
honor STOP immediately. Pure function — the handler applies the result.
"""

_STOP_WORDS = {"stop", "unsubscribe", "cancel", "end", "quit", "stopall"}
_START_WORDS = {"start", "unstop", "subscribe", "resume"}


def detect_consent_command(text: str | None) -> str | None:
    """Return ``"stop"``, ``"start"``, or None for a message body.

    Matches only when the (trimmed, lowercased) body IS the keyword — a
    message that merely contains "stop" in a sentence is not a command.
    """
    if not text:
        return None
    word = text.strip().lower()
    if word in _STOP_WORDS:
        return "stop"
    if word in _START_WORDS:
        return "start"
    return None
