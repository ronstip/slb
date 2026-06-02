"""Tests for the `enforce_access` router dependency (Issue #1 enforcement point).

`enforce_access` is the defense-in-depth gate wired onto every private data
router (`_gated` in api/main.py). It must run `require_access` for real users
(so a `blocked` account is 402'd server-side) and skip anonymous landing-preview
users. The tier-decision logic itself lives in `api.services.entitlements` and is
covered by test_entitlements.py; here we only pin the wiring.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from api.auth import dependencies as auth_deps
from api.auth.dependencies import CurrentUser, enforce_access
from api.services import entitlements as ent


def _run(coro):
    return asyncio.run(coro)


def _user(uid="u1", *, anonymous=False):
    return CurrentUser(uid=uid, email="x@y.com", display_name=None,
                       org_id=None, org_role=None, is_anonymous=anonymous)


def test_enforce_access_invokes_require_access_for_real_user(monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(ent, "require_access", lambda uid: seen.append(uid))
    user = _user("real_uid")

    result = _run(enforce_access(user))

    assert seen == ["real_uid"]
    assert result is user


def test_enforce_access_propagates_block(monkeypatch):
    def _blocked(_uid):
        raise HTTPException(status_code=402, detail={"error": ent.ERR_BLOCKED})

    monkeypatch.setattr(ent, "require_access", _blocked)

    with pytest.raises(HTTPException) as exc:
        _run(enforce_access(_user("blocked_uid")))
    assert exc.value.status_code == 402
    assert exc.value.detail["error"] == ent.ERR_BLOCKED


def test_enforce_access_skips_anonymous(monkeypatch):
    def _boom(_uid):
        raise AssertionError("anonymous users must not hit the entitlements gate")

    monkeypatch.setattr(ent, "require_access", _boom)
    user = _user("anon_uid", anonymous=True)

    assert _run(enforce_access(user)) is user


# Suppress unused-import lint (kept for symmetry with sibling tests).
_ = auth_deps
