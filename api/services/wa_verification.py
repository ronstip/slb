"""WhatsApp number verification (spec §11): the OTP layer in front of the
Attachment bind contract.

A logged-in web User proves possession of a number by entering a one-time code
we send via an AUTHENTICATION template. On a correct code we call the existing
``attach_number`` (api/services/wa_attachment.py) — this module never binds a
number itself; it only gates the bind behind proof-of-possession.

Security (§11.3): the code is hashed at rest (never stored/logged in clear),
expires fast, allows few confirm attempts, and the send is rate-limited per
number because an OTP template send is window-independent and costs money
(an SMS-pumping-equivalent abuse vector). All gates live here, server-side.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

from channels.whatsapp.client import normalize_e164

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
SEND_COOLDOWN = timedelta(seconds=60)
MAX_SENDS_PER_DAY = 5
SEND_WINDOW = timedelta(hours=24)
MAX_NUMBERS_PER_USER = 5


class VerificationError(Exception):
    """Raised for any failed verification step. ``code`` is a stable machine
    token for the client; ``status`` is the HTTP status the router should map.
    Wrong/expired/missing codes all collapse to a single neutral ``invalid_code``
    so a caller can't enumerate which numbers have a pending code."""

    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def _gen_code() -> str:
    """A cryptographically-random 6-digit code (uniform, leading zeros kept)."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _hash_code(code: str, e164: str) -> str:
    """Salt the code with the number so a hash is meaningless cross-number."""
    return hashlib.sha256(f"{e164}:{code}".encode()).hexdigest()


def start_verification(uid, e164, *, fs, send_otp, now=None, code_factory=None) -> dict:
    """Mint + send a one-time code for ``e164``, gated by the §11.3 limits.

    ``send_otp(e164, code) -> bool`` performs the actual WhatsApp send (or a dev
    stub). ``code_factory`` overrides code generation for tests.
    Raises ``VerificationError`` on any gate. Returns ``{"status": "sent", ...}``.
    """
    now = now or _utcnow()
    e164 = normalize_e164(e164)

    # Ownership guard: a number bound to a DIFFERENT user can't be linked.
    # Neutral message — don't disclose the other account.
    existing = fs.resolve_wa_number(e164)
    if existing and existing.get("uid") != uid:
        raise VerificationError("number_unavailable", 409)

    # Per-user cap (only for a genuinely new number; re-linking is idempotent).
    user = fs.get_user(uid) or {}
    owned = {n.get("e164") for n in user.get("wa_numbers", [])}
    if e164 not in owned and len(owned) >= MAX_NUMBERS_PER_USER:
        raise VerificationError("too_many_numbers", 409)

    # Rate limits, tracked on the verification doc.
    rec = fs.get_wa_verification(e164)
    send_count = 0
    first_sent_at = now
    if rec:
        last = _as_aware(rec.get("last_sent_at"))
        if last and now - last < SEND_COOLDOWN:
            raise VerificationError("cooldown", 429)
        first = _as_aware(rec.get("first_sent_at"))
        if first and now - first < SEND_WINDOW:
            if rec.get("send_count", 0) >= MAX_SENDS_PER_DAY:
                raise VerificationError("rate_limited", 429)
            send_count = rec.get("send_count", 0)
            first_sent_at = first
        # else: the 24h window lapsed — counter resets to 0 from `now`.

    code = (code_factory or _gen_code)()
    if not send_otp(e164, code):
        # Don't persist a doc for a send we couldn't make.
        raise VerificationError("send_failed", 502)

    fs.put_wa_verification(e164, {
        "uid": uid,
        "code_hash": _hash_code(code, e164),
        "expires_at": now + CODE_TTL,
        "attempts": 0,
        "send_count": send_count + 1,
        "first_sent_at": first_sent_at,
        "last_sent_at": now,
    })
    logger.info("WA verification code sent to %s for user %s (send #%d)",
                e164, uid, send_count + 1)
    return {"status": "sent", "expires_in": int(CODE_TTL.total_seconds())}


def confirm_verification(uid, e164, code, *, org_id=None, fs, now=None) -> dict:
    """Check ``code`` for ``e164`` and, on success, bind via ``attach_number``.

    Every failure mode (no doc, wrong user, expired, exhausted, mismatch) raises
    the same neutral ``invalid_code`` (§11.3). Returns ``attach_number``'s result.
    """
    from api.services.wa_attachment import attach_number

    now = now or _utcnow()
    e164 = normalize_e164(e164)

    rec = fs.get_wa_verification(e164)
    if not rec or rec.get("uid") != uid:
        raise VerificationError("invalid_code")

    expires_at = _as_aware(rec.get("expires_at"))
    if expires_at and now > expires_at:
        fs.delete_wa_verification(e164)
        raise VerificationError("invalid_code")

    if rec.get("attempts", 0) >= MAX_ATTEMPTS:
        fs.delete_wa_verification(e164)
        raise VerificationError("invalid_code")

    if not hmac.compare_digest(rec.get("code_hash", ""), _hash_code(code, e164)):
        rec["attempts"] = rec.get("attempts", 0) + 1
        if rec["attempts"] >= MAX_ATTEMPTS:
            fs.delete_wa_verification(e164)
        else:
            fs.put_wa_verification(e164, rec)
        raise VerificationError("invalid_code")

    out = attach_number(uid, e164, org_id=org_id, fs=fs)
    fs.delete_wa_verification(e164)
    logger.info("WA number %s verified + attached to user %s", e164, uid)
    return out
