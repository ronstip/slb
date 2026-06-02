"""Tests for the PII redaction helper.

The exact format-preserving output is part of the contract - ops staff rely on
the ``xx***@yy***`` shape when scanning logs, so any change here must update
this test deliberately.
"""

from api.services.logging_utils import redact_email


def test_redact_full_email() -> None:
    assert redact_email("sahar.malka@basesite.com") == "sa***@ba***"


def test_redact_short_local_and_domain() -> None:
    assert redact_email("ab@cd.com") == "ab***@cd***"


def test_redact_single_char_parts() -> None:
    # Single-char local: `local[:2]` returns just "a". Domain "b.com"[:2] is
    # "b." - the dot is preserved on purpose so the redaction is purely a
    # left-prefix slice (no special-casing per-character).
    assert redact_email("a@b.com") == "a***@b.***"


def test_redact_empty_string() -> None:
    assert redact_email("") == "<no-email>"


def test_redact_none() -> None:
    assert redact_email(None) == "<no-email>"


def test_redact_non_email_string() -> None:
    # Token-shaped input must not be echoed raw.
    assert redact_email("not-an-email-token-12345") == "<no-email>"
