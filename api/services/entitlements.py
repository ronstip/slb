"""§E entitlements - per-user access + prepaid-credit enforcement.

Tiers live at ``users/{uid}.plan.tier`` (blocked | free | trial | paid) and the
$ wallet at ``users/{uid}.credit`` (balance/total_in/spent micros).

Enforcement is **inert** unless ``settings.signup_gate == "entitlements"``, so
this code can ship ahead of the gate flip without affecting dev ("open") or the
current allowlist prod. The Firebase token layer still answers "is this a valid
user"; entitlements decides "may they act / can they afford it".

Raises ``HTTPException(402, {"error": <code>, ...})`` so the frontend can branch
on the code (route blocked users to the pending page, show a top-up dialog for
out-of-credit, etc.).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from api.deps import get_fs
from config.settings import get_settings

logger = logging.getLogger(__name__)

# Structured 402 error codes (kept in sync with the frontend handler).
ERR_BLOCKED = "account_blocked"
ERR_TRIAL_EXPIRED = "trial_expired"
ERR_INSUFFICIENT = "insufficient_credit"

# Short per-process cache of {plan, credit} so chat/collection hot paths don't
# read Firestore every call. Slightly stale balance is acceptable for gating
# (matches the spec's "60s cached aggregate" intent); deduction truth is BQ.
_CACHE_TTL = 30.0
_cache: dict[str, tuple[dict, float]] = {}


def _credit_enforced() -> bool:
    """Credit/cost gating (require_active, require_credit_for_run).

    Controlled by its OWN flag so we can bill regular users for usage without
    flipping the separate signup/access rollout (`signup_gate`). Defaults on.
    """
    return bool(getattr(get_settings(), "enforce_credits", True))


def _access_enforced() -> bool:
    """Read/access gating (require_access) - blocks `blocked`/expired-trial.

    Still tied to the signup-gate flip; left off until that rollout is ready.
    """
    return get_settings().signup_gate == "entitlements"


def invalidate(uid: str) -> None:
    """Drop a user's cached plan/credit (call after a grant / top-up)."""
    _cache.pop(uid, None)


def _load(uid: str) -> dict:
    now = time.monotonic()
    cached = _cache.get(uid)
    if cached and cached[1] > now:
        return cached[0]
    doc = get_fs().get_user(uid) or {}
    data = {"plan": doc.get("plan") or {}, "credit": doc.get("credit") or {}, "email": doc.get("email") or ""}
    _cache[uid] = (data, now + _CACHE_TTL)
    return data


def get_plan(uid: str) -> dict:
    """Return the user's plan map; missing/empty defaults to blocked (fail-closed)."""
    plan = _load(uid).get("plan") or {}
    if not plan.get("tier"):
        plan = {**plan, "tier": "blocked"}
    return plan


def get_credit(uid: str) -> dict:
    credit = _load(uid).get("credit") or {}
    return {
        "balance_micros": int(credit.get("balance_micros", 0)),
        "total_in_micros": int(credit.get("total_in_micros", 0)),
        "spent_micros": int(credit.get("spent_micros", 0)),
    }


def _402(code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=402, detail={"error": code, "message": message, **extra})


def _trial_expired(plan: dict) -> bool:
    exp = plan.get("trial_expires_at")
    if not exp:
        return False
    if isinstance(exp, str):
        try:
            exp = datetime.fromisoformat(exp)
        except ValueError:
            return False
    if getattr(exp, "tzinfo", None) is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > exp


def _check_tier_and_get_balance(uid: str) -> int | None:
    """Shared gate: raise for blocked/expired-trial, else return balance.

    Returns ``None`` for `free` / super admins (unlimited - caller skips the
    balance check)."""
    data = _load(uid)

    # Super admins are never gated - otherwise a blocked admin could lock
    # themselves out of the very admin panel needed to fix it.
    from api.auth.admin import is_super_admin_email
    if is_super_admin_email(data.get("email", "")):
        return None

    plan = data.get("plan") or {}
    tier = plan.get("tier") or "blocked"

    if tier == "free":
        return None
    if tier == "blocked":
        raise _402(ERR_BLOCKED, "Your account is pending approval.")
    if tier == "trial" and _trial_expired(plan):
        raise _402(ERR_TRIAL_EXPIRED, "Your trial has expired.")
    return int((data.get("credit") or {}).get("balance_micros", 0))


def require_access(uid: str) -> None:
    """Gate READ / data access: the account must be active (not blocked, not an
    expired trial). Balance is deliberately NOT enforced - a trial/paid user
    who's out of credit can still VIEW their existing data; only cost-incurring
    actions (chat, collection/agent runs) enforce balance via require_active /
    require_credit_for_run. Free tier + super admins always pass. No-op unless
    the access gate (signup_gate) is on."""
    if not _access_enforced():
        return
    _check_tier_and_get_balance(uid)  # raises for blocked / expired trial; balance ignored


def require_active(uid: str) -> None:
    """Gate chat & light actions: tier must allow access and (trial/paid) have
    a positive balance. No-op unless credit enforcement is on."""
    if not _credit_enforced():
        return
    balance = _check_tier_and_get_balance(uid)
    if balance is None:  # free
        return
    if balance <= 0:
        raise _402(ERR_INSUFFICIENT, "You're out of credit. Top up to continue.", balance_micros=balance)


def require_credit_for_run(uid: str, estimated_micros: int) -> None:
    """Pre-flight gate for collections / agent runs: the wallet must cover the
    estimated run cost up front. No-op unless credit enforcement is on."""
    if not _credit_enforced():
        return
    balance = _check_tier_and_get_balance(uid)
    if balance is None:  # free
        return
    estimated_micros = max(int(estimated_micros or 0), 0)
    # A non-positive balance can't start ANY paid run - even one whose estimate
    # rounds to 0 (e.g. sources with no keywords → empty runnable_sources).
    # Checked first because `0 < 0` is False, which used to let $0 users slip
    # through. Mirrors require_active's `balance <= 0` rule.
    if balance <= 0:
        raise _402(
            ERR_INSUFFICIENT,
            "You're out of credit. Top up to continue.",
            required_micros=estimated_micros,
            balance_micros=balance,
            shortfall_micros=max(estimated_micros - balance, 1),
        )
    if balance < estimated_micros:
        raise _402(
            ERR_INSUFFICIENT,
            "Not enough credit to start this run. Top up to continue.",
            required_micros=estimated_micros,
            balance_micros=balance,
            shortfall_micros=estimated_micros - balance,
        )
