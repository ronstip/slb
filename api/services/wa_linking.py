"""User-initiated WhatsApp number linking (spec §11, replaces the §11.6 OTP path).

A logged-in web User links a number by sending a one-time **link token** to the
Scolto business number from WhatsApp itself. Two halves:

  * ``start_link`` (web, authed) — mint a token, store its hash + TTL against the
    User, and hand back a ``wa.me`` deep link prefilled with the token.
  * ``redeem_link_token`` (worker, no session) — when that token arrives as an
    inbound from a number, bind the number to the token's User via the existing
    ``attach_number`` contract. The inbound IS the proof of possession; the token
    names the account.

No Meta template, no approval, no per-message cost — the confirm reply rides the
Service Window the User's own inbound just opened (§11.4).
"""

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from channels.whatsapp.client import normalize_e164

logger = logging.getLogger(__name__)

TOKEN_TTL = timedelta(minutes=10)
TOKEN_LEN = 10
# Unambiguous alphabet — no 0/O/1/I so a User can't mistype the visible token.
# 32 symbols ** 10 = 50 bits of entropy.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_NUMBERS_PER_USER = 5

# Human-readable lead-in for the prefilled message. The token is appended; the
# redeemer ignores everything but token-shaped runs, so the prose is cosmetic.
LINK_MESSAGE_PREFIX = "Link my Scolto account"


class LinkError(Exception):
    """Raised on a failed mint. ``code`` is a stable machine token; ``status`` the
    HTTP status the router maps."""

    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass
class RedeemResult:
    ok: bool
    uid: str | None = None
    org_id: str | None = None
    reason: str | None = None  # diagnostic only — never shown to the sender


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def _gen_token() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(TOKEN_LEN))


def _hash_token(token: str) -> str:
    """Doc-id hash — the raw token is never stored or logged."""
    return hashlib.sha256(token.encode()).hexdigest()


def extract_token_candidates(text: str | None) -> list[str]:
    """Pull token-shaped runs from inbound text (pure helper).

    Tokens are fixed-length runs over the unambiguous alphabet. We scan greedily
    over an uppercased copy and slice every maximal alphabet run of exactly
    ``TOKEN_LEN`` — robust to surrounding prose/emoji/punctuation."""
    if not text:
        return []
    upper = text.upper()
    out: list[str] = []
    run: list[str] = []
    for ch in upper:
        if ch in _ALPHABET:
            run.append(ch)
        else:
            if len(run) == TOKEN_LEN:
                out.append("".join(run))
            run = []
    if len(run) == TOKEN_LEN:
        out.append("".join(run))
    return out


def build_deep_link(business_number: str, token: str) -> str:
    """``wa.me`` deep link prefilled with the lead-in + token."""
    number = normalize_e164(business_number)
    text = f"{LINK_MESSAGE_PREFIX}\n\n{token}"
    return f"https://wa.me/{number}?text={quote(text)}"


def start_link(
    uid: str,
    org_id: str | None,
    *,
    fs,
    business_number: str,
    now=None,
    token_factory=None,
) -> dict:
    """Mint a one-time link token for ``uid`` and return its deep link.

    Raises ``LinkError('not_configured', 503)`` when the business number is unset.
    Returns ``{deep_link, expires_in, token}`` (``token`` is for dev display; the
    deep link already embeds it)."""
    if not normalize_e164(business_number):
        raise LinkError("not_configured", 503)
    now = now or _utcnow()
    token = (token_factory or _gen_token)()
    fs.put_wa_link_token(
        _hash_token(token),
        {
            "uid": uid,
            "org_id": org_id,
            "expires_at": now + TOKEN_TTL,
            "created_at": now,
        },
    )
    logger.info("WA link token minted for user %s", uid)
    return {
        "deep_link": build_deep_link(business_number, token),
        "expires_in": int(TOKEN_TTL.total_seconds()),
        "token": token,
    }


def redeem_link_token(text: str | None, wa_id: str, *, fs, now=None) -> RedeemResult:
    """Redeem the first valid link token in ``text`` by binding ``wa_id`` to its
    User. Single-use: the token doc is deleted on a successful (or expired) hit.

    Returns ``RedeemResult(ok=False)`` (no exception) when no candidate matches —
    the caller falls back to the normal Lobby invite."""
    from api.services.wa_attachment import attach_number

    now = now or _utcnow()
    e164 = normalize_e164(wa_id)

    for candidate in extract_token_candidates(text):
        rec = fs.get_wa_link_token(_hash_token(candidate))
        if not rec:
            continue
        expires_at = _as_aware(rec.get("expires_at"))
        if expires_at and now > expires_at:
            fs.delete_wa_link_token(_hash_token(candidate))
            return RedeemResult(ok=False, reason="expired")

        uid = rec.get("uid")
        org_id = rec.get("org_id")

        # Ownership guard: a number already bound to a different User can't be
        # re-bound here (neutral — don't disclose the other account).
        existing = fs.resolve_wa_number(e164)
        if existing and existing.get("uid") != uid:
            fs.delete_wa_link_token(_hash_token(candidate))
            return RedeemResult(ok=False, reason="number_unavailable")

        # Per-user cap (skip for an idempotent re-link of an already-owned number).
        user = fs.get_user(uid) or {}
        owned = {n.get("e164") for n in user.get("wa_numbers", [])}
        if e164 not in owned and len(owned) >= MAX_NUMBERS_PER_USER:
            fs.delete_wa_link_token(_hash_token(candidate))
            return RedeemResult(ok=False, reason="too_many_numbers")

        attach_number(uid, e164, org_id=org_id, fs=fs)
        fs.delete_wa_link_token(_hash_token(candidate))
        logger.info("WA number %s linked to user %s via deep-link token", e164, uid)
        return RedeemResult(ok=True, uid=uid, org_id=org_id)

    return RedeemResult(ok=False, reason="no_token")
