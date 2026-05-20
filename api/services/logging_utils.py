"""Logging utilities — PII redaction helpers used across loggers.

Format-preserving redaction (not hash) so ops staff scanning Cloud Logging can
still differentiate users at a glance — e.g. ``sa***@ba***`` is recognisably
distinct from ``ro***@ex***`` — without exposing full PII. A hash-based variant
can be layered on top later inside the §C.2 structured-logging work if support
tooling materialises.

DO NOT use these helpers when persisting data (Firestore writes, admin API
response bodies, SendGrid/LemonSqueezy payloads). They are for log lines only.
"""

from __future__ import annotations


def redact_email(email: str | None) -> str:
    """Return a redacted, format-preserving rendering of ``email``.

    Examples::

        redact_email("sahar.malka@basesite.com")  # -> "sa***@ba***"
        redact_email("ab@cd.com")                  # -> "ab***@cd***"
        redact_email("a@b.com")                    # -> "a***@b***"
        redact_email("")                           # -> "<no-email>"
        redact_email(None)                         # -> "<no-email>"

    Anything that doesn't look like an email (missing ``@``) is rendered as
    ``<no-email>`` rather than echoed raw — guards against accidental logging
    of tokens or other secrets that got plumbed into an email-shaped slot.
    """
    if not email or "@" not in email:
        return "<no-email>"
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain[:2]}***"
