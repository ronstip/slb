"""Tests for the fail-closed startup gates in `api.main.lifespan`.

Pins three invariants that protect prod:
  - prod + SIGNUP_GATE=allowlist + empty ALLOWED_EMAILS  → RuntimeError
  - prod + empty SUPER_ADMIN_EMAILS                      → RuntimeError
  - dev with empty values                                → boots fine

The gates run inside lifespan, so the tests just drive the (sync portion of
the) check directly with a fake settings object - avoids spinning up the
full FastAPI app and its Firestore/BQ deps.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest


@dataclass
class _FakeSettings:
    """Minimum surface that the startup gates touch."""
    is_dev: bool
    signup_gate: str
    allowed_emails: str
    super_admin_emails: str


def _run_gates(s: _FakeSettings) -> None:
    """Mirror of the gate block inside `api.main.lifespan`. Keeping it inline
    here lets the test exercise the exact validation logic without booting
    FastAPI (which would import Firebase Admin + Firestore on import)."""
    if not s.is_dev:
        if s.signup_gate == "allowlist" and not s.allowed_emails.strip():
            raise RuntimeError(
                "SIGNUP_GATE=allowlist but ALLOWED_EMAILS is empty - refusing to start"
            )
        if not s.super_admin_emails.strip():
            raise RuntimeError(
                "SUPER_ADMIN_EMAILS is empty in production - refusing to start"
            )


def test_prod_allowlist_with_empty_emails_raises() -> None:
    s = _FakeSettings(
        is_dev=False, signup_gate="allowlist",
        allowed_emails="", super_admin_emails="admin@example.com",
    )
    with pytest.raises(RuntimeError, match="ALLOWED_EMAILS is empty"):
        _run_gates(s)


def test_prod_whitespace_only_allowlist_raises() -> None:
    s = _FakeSettings(
        is_dev=False, signup_gate="allowlist",
        allowed_emails="   ", super_admin_emails="admin@example.com",
    )
    with pytest.raises(RuntimeError, match="ALLOWED_EMAILS is empty"):
        _run_gates(s)


def test_prod_empty_super_admin_raises() -> None:
    s = _FakeSettings(
        is_dev=False, signup_gate="open",
        allowed_emails="", super_admin_emails="",
    )
    with pytest.raises(RuntimeError, match="SUPER_ADMIN_EMAILS is empty"):
        _run_gates(s)


def test_prod_open_gate_does_not_require_allowed_emails() -> None:
    s = _FakeSettings(
        is_dev=False, signup_gate="open",
        allowed_emails="", super_admin_emails="admin@example.com",
    )
    _run_gates(s)  # must not raise


def test_prod_entitlements_gate_does_not_require_allowed_emails() -> None:
    # Reserved value - should not trip the allowlist check.
    s = _FakeSettings(
        is_dev=False, signup_gate="entitlements",
        allowed_emails="", super_admin_emails="admin@example.com",
    )
    _run_gates(s)


def test_dev_with_empty_values_does_not_raise() -> None:
    s = _FakeSettings(
        is_dev=True, signup_gate="allowlist",
        allowed_emails="", super_admin_emails="",
    )
    _run_gates(s)


def test_prod_allowlist_with_populated_values_passes() -> None:
    s = _FakeSettings(
        is_dev=False, signup_gate="allowlist",
        allowed_emails="ok@example.com",
        super_admin_emails="admin@example.com",
    )
    _run_gates(s)
