"""Unit tests for §E entitlement enforcement."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.services import entitlements as ent

UID = "u1"


class _FakeFS:
    def __init__(self, doc: dict):
        self._doc = doc

    def get_user(self, uid: str):
        return self._doc


@pytest.fixture(autouse=True)
def _entitlements_on(monkeypatch):
    """Enable both gates (access + credit) and clear the cache between tests."""
    monkeypatch.setattr(
        ent, "get_settings",
        lambda: SimpleNamespace(signup_gate="entitlements", enforce_credits=True),
    )
    ent._cache.clear()
    yield
    ent._cache.clear()


def _set_user_doc(monkeypatch, *, tier, balance_micros=0, trial_expires_at=None):
    doc = {
        "plan": {"tier": tier, "trial_expires_at": trial_expires_at},
        "credit": {"balance_micros": balance_micros},
    }
    monkeypatch.setattr(ent, "get_fs", lambda: _FakeFS(doc))


# ── enforcement toggle ────────────────────────────────────────────────


def test_credit_gates_disabled_when_enforce_credits_off(monkeypatch):
    monkeypatch.setattr(
        ent, "get_settings",
        lambda: SimpleNamespace(signup_gate="entitlements", enforce_credits=False),
    )

    def _boom():
        raise AssertionError("fs should not be read when credit enforcement is off")

    monkeypatch.setattr(ent, "get_fs", _boom)
    # Cost gates must pass without touching Firestore.
    ent.require_active(UID)
    ent.require_credit_for_run(UID, 999_999)


def test_credit_gate_independent_of_signup_gate(monkeypatch):
    # #1 regression: even with the signup/access gate OFF ("open"), credit
    # enforcement still blocks a paid, zero-balance regular user's run.
    monkeypatch.setattr(
        ent, "get_settings",
        lambda: SimpleNamespace(signup_gate="open", enforce_credits=True),
    )
    _set_user_doc(monkeypatch, tier="paid", balance_micros=0)
    with pytest.raises(HTTPException) as exc:
        ent.require_credit_for_run(UID, 5_000_000)
    assert exc.value.detail["error"] == ent.ERR_INSUFFICIENT


def test_access_gate_uses_signup_gate_not_credit_flag(monkeypatch):
    # require_access keys off signup_gate: with it OFF, a blocked user can
    # still READ even though credit enforcement is ON.
    monkeypatch.setattr(
        ent, "get_settings",
        lambda: SimpleNamespace(signup_gate="open", enforce_credits=True),
    )
    _set_user_doc(monkeypatch, tier="blocked", balance_micros=0)
    ent.require_access(UID)  # no raise (access gate off)
    with pytest.raises(HTTPException):  # but cost gate still blocks
        ent.require_active(UID)


# ── require_active ────────────────────────────────────────────────────


def test_blocked_raises_402_account_blocked(monkeypatch):
    _set_user_doc(monkeypatch, tier="blocked")
    with pytest.raises(HTTPException) as exc:
        ent.require_active(UID)
    assert exc.value.status_code == 402
    assert exc.value.detail["error"] == ent.ERR_BLOCKED


def test_missing_plan_fails_closed_as_blocked(monkeypatch):
    monkeypatch.setattr(ent, "get_fs", lambda: _FakeFS({}))
    with pytest.raises(HTTPException) as exc:
        ent.require_active(UID)
    assert exc.value.detail["error"] == ent.ERR_BLOCKED


def test_free_always_passes(monkeypatch):
    _set_user_doc(monkeypatch, tier="free", balance_micros=0)
    ent.require_active(UID)  # no raise


def test_trial_expired_raises(monkeypatch):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _set_user_doc(monkeypatch, tier="trial", balance_micros=10_000, trial_expires_at=past)
    with pytest.raises(HTTPException) as exc:
        ent.require_active(UID)
    assert exc.value.detail["error"] == ent.ERR_TRIAL_EXPIRED


def test_trial_active_with_balance_passes(monkeypatch):
    future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    _set_user_doc(monkeypatch, tier="trial", balance_micros=10_000, trial_expires_at=future)
    ent.require_active(UID)  # no raise


def test_paid_zero_balance_raises_insufficient(monkeypatch):
    _set_user_doc(monkeypatch, tier="paid", balance_micros=0)
    with pytest.raises(HTTPException) as exc:
        ent.require_active(UID)
    assert exc.value.detail["error"] == ent.ERR_INSUFFICIENT


def test_paid_positive_balance_passes(monkeypatch):
    _set_user_doc(monkeypatch, tier="paid", balance_micros=1)
    ent.require_active(UID)


# ── require_credit_for_run ────────────────────────────────────────────


def test_run_free_bypasses_estimate(monkeypatch):
    _set_user_doc(monkeypatch, tier="free", balance_micros=0)
    ent.require_credit_for_run(UID, 5_000_000)  # no raise


def test_run_blocked_raises(monkeypatch):
    _set_user_doc(monkeypatch, tier="blocked", balance_micros=999_999)
    with pytest.raises(HTTPException) as exc:
        ent.require_credit_for_run(UID, 1)
    assert exc.value.detail["error"] == ent.ERR_BLOCKED


def test_run_insufficient_reports_shortfall(monkeypatch):
    _set_user_doc(monkeypatch, tier="paid", balance_micros=1_000)
    with pytest.raises(HTTPException) as exc:
        ent.require_credit_for_run(UID, 3_000)
    detail = exc.value.detail
    assert detail["error"] == ent.ERR_INSUFFICIENT
    assert detail["required_micros"] == 3_000
    assert detail["balance_micros"] == 1_000
    assert detail["shortfall_micros"] == 2_000


def test_run_sufficient_passes(monkeypatch):
    _set_user_doc(monkeypatch, tier="paid", balance_micros=5_000)
    ent.require_credit_for_run(UID, 3_000)  # no raise


def test_run_zero_balance_zero_estimate_still_blocks(monkeypatch):
    # Regression: a paid/trial user at $0 must not slip through when the
    # pre-flight estimate rounds to 0 (e.g. sources with no keywords → empty
    # runnable_sources → total_estimate 0). `0 < 0` was False, so the gate
    # used to no-op and let an out-of-credit run proceed.
    _set_user_doc(monkeypatch, tier="paid", balance_micros=0)
    with pytest.raises(HTTPException) as exc:
        ent.require_credit_for_run(UID, 0)
    assert exc.value.detail["error"] == ent.ERR_INSUFFICIENT


def test_run_negative_balance_blocks(monkeypatch):
    # An already-overdrafted wallet can't start anything, regardless of estimate.
    _set_user_doc(monkeypatch, tier="paid", balance_micros=-240_000)
    with pytest.raises(HTTPException) as exc:
        ent.require_credit_for_run(UID, 1_000)
    assert exc.value.detail["error"] == ent.ERR_INSUFFICIENT


# ── require_access (read gate - balance NOT enforced) ─────────────────


def test_require_access_blocks_blocked(monkeypatch):
    _set_user_doc(monkeypatch, tier="blocked")
    with pytest.raises(HTTPException) as exc:
        ent.require_access(UID)
    assert exc.value.detail["error"] == ent.ERR_BLOCKED


def test_require_access_blocks_expired_trial(monkeypatch):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    _set_user_doc(monkeypatch, tier="trial", balance_micros=0, trial_expires_at=past)
    with pytest.raises(HTTPException) as exc:
        ent.require_access(UID)
    assert exc.value.detail["error"] == ent.ERR_TRIAL_EXPIRED


def test_require_access_allows_paid_with_zero_balance(monkeypatch):
    # Out-of-credit paid users can still READ their existing data.
    _set_user_doc(monkeypatch, tier="paid", balance_micros=0)
    ent.require_access(UID)  # no raise


def test_require_access_allows_free(monkeypatch):
    _set_user_doc(monkeypatch, tier="free", balance_micros=0)
    ent.require_access(UID)  # no raise


def test_super_admin_bypasses_gate_even_when_blocked(monkeypatch):
    import api.auth.admin as admin_mod
    monkeypatch.setattr(admin_mod, "is_super_admin_email", lambda email: email == "admin@x.com")
    doc = {"plan": {"tier": "blocked"}, "credit": {"balance_micros": 0}, "email": "admin@x.com"}
    monkeypatch.setattr(ent, "get_fs", lambda: _FakeFS(doc))
    # A blocked super admin must never be locked out - both gates pass.
    ent.require_active(UID)
    ent.require_credit_for_run(UID, 10_000_000)
