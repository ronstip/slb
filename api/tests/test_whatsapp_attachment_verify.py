"""§11 — web self-serve number linking: OTP verification in front of attach_number.

Exercises the production verify service (api/services/wa_verification.py) against
the in-memory fakes. No Firestore, no network: the OTP send is a collecting stub.
"""

from datetime import datetime, timedelta, timezone

import pytest

from api.services.wa_verification import (
    CODE_TTL,
    MAX_ATTEMPTS,
    MAX_NUMBERS_PER_USER,
    MAX_SENDS_PER_DAY,
    SEND_COOLDOWN,
    VerificationError,
    confirm_verification,
    start_verification,
)
from api.tests._wa_fakes import FakeFirestore

NUM = "447700900123"


class SendStub:
    """Collects (e164, code) and reports success; mimics the OTP template send."""

    def __init__(self, ok=True):
        self.ok = ok
        self.sent: list[tuple[str, str]] = []

    def __call__(self, e164, code):
        self.sent.append((e164, code))
        return self.ok


def _codes(*values):
    """A deterministic code factory yielding the given values in order."""
    it = iter(values)
    return lambda: next(it)


# --- start ------------------------------------------------------------------


def test_start_sends_code_and_stores_hash_not_plaintext():
    fs = FakeFirestore()
    send = SendStub()
    out = start_verification("u1", NUM, fs=fs, send_otp=send, code_factory=_codes("123456"))

    assert out["status"] == "sent"
    assert send.sent == [(NUM, "123456")]
    rec = fs.get_wa_verification(NUM)
    assert rec["uid"] == "u1"
    assert rec["send_count"] == 1
    # The plaintext code is never persisted.
    assert "123456" not in str(rec)
    assert rec["code_hash"] != "123456"


def test_start_rejects_number_bound_to_another_user():
    fs = FakeFirestore()
    fs.bind_wa_number("someone_else", NUM, org_id="o9")
    with pytest.raises(VerificationError) as ei:
        start_verification("u1", NUM, fs=fs, send_otp=SendStub(), code_factory=_codes("000000"))
    assert ei.value.status == 409


def test_start_relink_same_user_allowed_and_ignores_per_user_cap():
    fs = FakeFirestore()
    fs.bind_wa_number("u1", NUM, org_id="o1")
    # User already at the cap with OTHER numbers...
    fs.users["u1"]["wa_numbers"] = [{"e164": f"99900{i}"} for i in range(MAX_NUMBERS_PER_USER)]
    fs.users["u1"]["wa_numbers"].append({"e164": NUM})
    out = start_verification("u1", NUM, fs=fs, send_otp=SendStub(), code_factory=_codes("111111"))
    assert out["status"] == "sent"


def test_start_per_user_cap_blocks_new_number():
    fs = FakeFirestore()
    fs.users["u1"] = {"wa_numbers": [{"e164": f"99900{i}"} for i in range(MAX_NUMBERS_PER_USER)]}
    with pytest.raises(VerificationError) as ei:
        start_verification("u1", NUM, fs=fs, send_otp=SendStub(), code_factory=_codes("222222"))
    assert ei.value.status == 409


def test_start_cooldown_blocks_rapid_resend():
    fs = FakeFirestore()
    send = SendStub()
    t0 = datetime(2026, 6, 25, 12, 0, 0, tzinfo=timezone.utc)
    start_verification("u1", NUM, fs=fs, send_otp=send, now=t0, code_factory=_codes("100000"))
    with pytest.raises(VerificationError) as ei:
        start_verification("u1", NUM, fs=fs, send_otp=send, now=t0 + timedelta(seconds=30),
                           code_factory=_codes("200000"))
    assert ei.value.status == 429
    assert ei.value.code == "cooldown"


def test_start_daily_send_cap():
    fs = FakeFirestore()
    send = SendStub()
    t = datetime(2026, 6, 25, 12, 0, 0, tzinfo=timezone.utc)
    for i in range(MAX_SENDS_PER_DAY):
        start_verification("u1", NUM, fs=fs, send_otp=send, now=t,
                           code_factory=_codes(f"{i:06d}"))
        t += SEND_COOLDOWN + timedelta(seconds=1)
    with pytest.raises(VerificationError) as ei:
        start_verification("u1", NUM, fs=fs, send_otp=send, now=t,
                           code_factory=_codes("999999"))
    assert ei.value.status == 429
    assert ei.value.code == "rate_limited"


def test_start_send_failure_raises_and_stores_nothing():
    fs = FakeFirestore()
    with pytest.raises(VerificationError) as ei:
        start_verification("u1", NUM, fs=fs, send_otp=SendStub(ok=False),
                           code_factory=_codes("123456"))
    assert ei.value.status == 502
    assert fs.get_wa_verification(NUM) is None


# --- confirm ----------------------------------------------------------------


def test_confirm_right_code_attaches_and_clears_verification():
    fs = FakeFirestore()
    start_verification("u1", NUM, fs=fs, send_otp=SendStub(), code_factory=_codes("424242"))
    out = confirm_verification("u1", NUM, "424242", org_id="o1", fs=fs)
    assert out["bound"] == NUM
    assert fs.resolve_wa_number(NUM) == {"uid": "u1", "org_id": "o1"}
    assert fs.get_wa_verification(NUM) is None  # burned on success


def test_confirm_wrong_code_increments_attempts_then_burns():
    fs = FakeFirestore()
    start_verification("u1", NUM, fs=fs, send_otp=SendStub(), code_factory=_codes("424242"))
    for _ in range(MAX_ATTEMPTS):
        with pytest.raises(VerificationError) as ei:
            confirm_verification("u1", NUM, "000000", org_id="o1", fs=fs)
        assert ei.value.code == "invalid_code"
    # Exhausted: doc burned, number never bound.
    assert fs.get_wa_verification(NUM) is None
    assert fs.resolve_wa_number(NUM) is None


def test_confirm_expired_code_is_invalid_and_burned():
    fs = FakeFirestore()
    t0 = datetime(2026, 6, 25, 12, 0, 0, tzinfo=timezone.utc)
    start_verification("u1", NUM, fs=fs, send_otp=SendStub(), now=t0, code_factory=_codes("424242"))
    with pytest.raises(VerificationError) as ei:
        confirm_verification("u1", NUM, "424242", org_id="o1", fs=fs,
                             now=t0 + CODE_TTL + timedelta(seconds=1))
    assert ei.value.code == "invalid_code"
    assert fs.get_wa_verification(NUM) is None


def test_confirm_no_verification_is_neutral_invalid():
    fs = FakeFirestore()
    with pytest.raises(VerificationError) as ei:
        confirm_verification("u1", NUM, "424242", org_id="o1", fs=fs)
    assert ei.value.code == "invalid_code"
    assert ei.value.status == 400


def test_confirm_wrong_user_cannot_consume_anothers_code():
    fs = FakeFirestore()
    start_verification("u1", NUM, fs=fs, send_otp=SendStub(), code_factory=_codes("424242"))
    with pytest.raises(VerificationError) as ei:
        confirm_verification("attacker", NUM, "424242", org_id="o1", fs=fs)
    assert ei.value.code == "invalid_code"
    # u1's verification is untouched; the legit user can still complete.
    out = confirm_verification("u1", NUM, "424242", org_id="o1", fs=fs)
    assert out["bound"] == NUM
