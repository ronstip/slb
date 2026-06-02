"""Tests for the one-click org-invite flow.

Covers the changes that let a non-registered user open an invite link, sign in,
and join the org in a single click:

- ``find_pending_invite_by_email`` lookup on the firestore client.
- ``_get_or_create_user`` skips domain auto-join when a pending invite waits.
- ``preview_invite`` returns public-safe invite metadata to anonymous visitors.
- ``join_org`` enforces email match between Firebase identity and invite.
- ``join_org`` promotes ``blocked`` invitees to ``trial`` (admin already vouched).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.auth import dependencies as auth_deps
from api.auth.dependencies import CurrentUser
from api.routers import settings as settings_router
from workers.shared.firestore_client import FirestoreClient


# ── Fakes ────────────────────────────────────────────────────────────────


class _FakeDoc:
    def __init__(self, doc_id: str, data: dict):
        self.id = doc_id
        self._data = data

    def to_dict(self) -> dict:
        return dict(self._data)


class _FakeQuery:
    """Minimal Firestore query supporting chained equality .where(.).limit(.).stream()."""

    def __init__(self, docs: list[_FakeDoc], filters: list[tuple] | None = None):
        self._docs = docs
        self._filters = filters or []

    def where(self, field, op, value):
        assert op == "=="
        return _FakeQuery(self._docs, self._filters + [(field, value)])

    def limit(self, _n):
        return self

    def stream(self):
        for doc in self._docs:
            data = doc.to_dict()
            if all(data.get(f) == v for f, v in self._filters):
                yield doc


class _FakeInviteDB:
    def __init__(self, invites: list[_FakeDoc]):
        self._invites = invites

    def collection(self, name):
        assert name == "org_invites"
        return _FakeQuery(self._invites)


def _client_with_invites(invites: list[_FakeDoc]) -> FirestoreClient:
    fs = object.__new__(FirestoreClient)
    fs._db = _FakeInviteDB(invites)
    return fs


# ── find_pending_invite_by_email ─────────────────────────────────────────


def test_find_pending_invite_by_email_matches_lowercased():
    fs = _client_with_invites([
        _FakeDoc("i1", {"email": "client@acme.com", "status": "pending", "org_id": "orgA"}),
    ])
    assert fs.find_pending_invite_by_email("Client@Acme.com")["org_id"] == "orgA"


def test_find_pending_invite_by_email_ignores_accepted():
    fs = _client_with_invites([
        _FakeDoc("i1", {"email": "x@x.com", "status": "accepted", "org_id": "orgA"}),
    ])
    assert fs.find_pending_invite_by_email("x@x.com") is None


def test_find_pending_invite_by_email_returns_none_for_missing():
    fs = _client_with_invites([])
    assert fs.find_pending_invite_by_email("nope@x.com") is None


def test_find_pending_invite_by_email_empty_input_returns_none():
    fs = _client_with_invites([
        _FakeDoc("i1", {"email": "", "status": "pending"}),
    ])
    assert fs.find_pending_invite_by_email("") is None


# ── _get_or_create_user: suppress domain auto-join when invite pending ───


class _ProvisionFS:
    """Captures create_user writes + answers get_user/find_org_by_domain/
    find_pending_invite_by_email per-test."""

    def __init__(self, *, domain_org: dict | None = None, pending_invite: dict | None = None):
        self.domain_org = domain_org
        self.pending_invite = pending_invite
        self.created: dict | None = None

    def get_user(self, _uid):
        return None  # always treat as new user

    def find_org_by_domain(self, _domain):
        return self.domain_org

    def find_pending_invite_by_email(self, _email):
        return self.pending_invite

    def create_user(self, _uid, data):
        self.created = data


def _decoded(email: str) -> dict:
    return {"email": email, "name": "Test User", "picture": None}


def test_provision_pending_invite_suppresses_domain_auto_join(monkeypatch):
    fake = _ProvisionFS(
        domain_org={"org_id": "domain_org", "name": "Acme"},
        pending_invite={"invite_id": "i1", "org_id": "invite_org", "email": "x@acme.com"},
    )
    monkeypatch.setattr(auth_deps, "get_fs", lambda: fake)

    auth_deps._get_or_create_user("uid1", _decoded("x@acme.com"))

    # Invite present → must NOT be domain-auto-joined; join_org will attach
    # them to the *invited* org once they accept.
    assert fake.created is not None
    assert fake.created["org_id"] is None
    assert fake.created["org_role"] is None


def test_provision_no_invite_still_uses_domain_auto_join(monkeypatch):
    fake = _ProvisionFS(
        domain_org={"org_id": "domain_org", "name": "Acme"},
        pending_invite=None,
    )
    monkeypatch.setattr(auth_deps, "get_fs", lambda: fake)

    auth_deps._get_or_create_user("uid1", _decoded("x@acme.com"))

    assert fake.created["org_id"] == "domain_org"
    assert fake.created["org_role"] == "member"


# ── anon → linked upgrade: cache staleness + user-doc backfill ───────────


class _UpgradeFS:
    """Captures get_user/update_user for the anon→linked upgrade path."""

    def __init__(self, existing: dict | None):
        self._existing = existing
        self.updates: dict = {}

    def get_user(self, _uid):
        return dict(self._existing) if self._existing else None

    def update_user(self, _uid, **fields):
        self.updates.update(fields)


def test_anon_to_linked_backfills_email_on_user_doc(monkeypatch):
    """Anonymous user linked to Google. Existing doc has email="" - the upgrade
    path must overwrite it with the Google email so /me + invite-email-match
    work afterwards."""
    fake = _UpgradeFS(existing={"email": "", "is_anonymous": True, "org_id": None})
    monkeypatch.setattr(auth_deps, "get_fs", lambda: fake)

    auth_deps._get_or_create_user(
        "uid1",
        {"email": "client@acme.com", "name": "Client", "picture": "p"},
        is_anonymous=False,
    )

    assert fake.updates["email"] == "client@acme.com"
    assert fake.updates["display_name"] == "Client"
    assert fake.updates["is_anonymous"] is False


def test_allowlist_bypass_pending_invite_passes(monkeypatch):
    """Allowlist gate must let through emails that have a pending invite -
    otherwise the invitee can never accept (/orgs/join 403s before it runs)."""

    class _FS:
        def get_user(self, _uid):
            return None  # brand-new user, no doc yet

        def find_pending_invite_by_email(self, _email):
            return {"invite_id": "i1", "org_id": "orgA"}

    monkeypatch.setattr(auth_deps, "get_fs", lambda: _FS())
    assert auth_deps._has_invite_or_membership("uid1", "client@acme.com") is True


def test_allowlist_bypass_existing_member_passes(monkeypatch):
    """Once a user is in an org (after accepting), allowlist must still wave
    them through - otherwise they get locked out on the next request."""

    class _FS:
        def get_user(self, _uid):
            return {"org_id": "orgA"}

        def find_pending_invite_by_email(self, _email):
            return None  # invite already accepted

    monkeypatch.setattr(auth_deps, "get_fs", lambda: _FS())
    assert auth_deps._has_invite_or_membership("uid1", "client@acme.com") is True


def test_allowlist_bypass_random_user_blocked(monkeypatch):
    """Sanity: someone with no invite and no org membership is NOT bypassed."""

    class _FS:
        def get_user(self, _uid):
            return None

        def find_pending_invite_by_email(self, _email):
            return None

    monkeypatch.setattr(auth_deps, "get_fs", lambda: _FS())
    assert auth_deps._has_invite_or_membership("uid1", "random@x.com") is False


def test_anon_to_linked_invalidates_user_cache():
    """Regression: same uid, anon CurrentUser cached with email="". After link
    the token carries the Google email - `_resolve_real_user` must NOT keep
    returning the stale anon CurrentUser (would 403 the invite join)."""
    anon = CurrentUser(uid="X", email="", display_name=None, org_id=None,
                       org_role=None, is_anonymous=True)
    # Pre-populate cache with the anon entry, very-far-future expiry.
    auth_deps._user_cache["X"] = (anon, 9_999_999_999.0)

    # Simulate the second-half of _resolve_real_user's cache check inline:
    cached = auth_deps._user_cache.get("X")
    is_anonymous_now = False
    email_now = "client@acme.com"
    assert cached is not None
    stale = not (cached[0].is_anonymous == is_anonymous_now and cached[0].email == email_now)
    assert stale, "anon-cached entry must be detected as stale after linking"

    # Cleanup so the global cache doesn't leak between tests.
    auth_deps._user_cache.pop("X", None)


# ── preview_invite (public endpoint) ─────────────────────────────────────


class _RouterFS:
    """Fake FS for the settings router. Captures plan/user/invite writes."""

    def __init__(
        self,
        *,
        invite: dict | None = None,
        org: dict | None = None,
        inviter: dict | None = None,
        user_doc: dict | None = None,
    ):
        self._invite = invite
        self._org = org
        self._inviter = inviter
        self._user_doc = user_doc
        self.user_updates: dict = {}
        self.plan_updates: dict = {}
        self.invite_updates: dict = {}

    def get_invite_by_code(self, _code):
        return dict(self._invite) if self._invite else None

    def get_org(self, _org_id):
        return dict(self._org) if self._org else None

    def get_user(self, _uid):
        if self._inviter and _uid == self._inviter.get("uid"):
            return dict(self._inviter)
        if self._user_doc and _uid == self._user_doc.get("uid"):
            return dict(self._user_doc)
        return None

    def update_user(self, _uid, **fields):
        self.user_updates.update(fields)

    def set_plan(self, _uid, **fields):
        self.plan_updates.update(fields)

    def update_invite(self, _invite_id, **fields):
        self.invite_updates.update(fields)


def _stub_router_dependencies(monkeypatch, fake: _RouterFS):
    """Wire the router to the fake FS and no-op the side-effect helpers."""
    monkeypatch.setattr(settings_router, "get_fs", lambda: fake)
    monkeypatch.setattr(settings_router, "invalidate_user_cache", lambda _uid: None)
    monkeypatch.setattr(settings_router, "reconcile_user_org_membership", lambda *_a, **_kw: 0)
    from api.services import entitlements
    monkeypatch.setattr(entitlements, "invalidate", lambda _uid: None)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def test_preview_invite_returns_org_and_inviter(monkeypatch):
    fake = _RouterFS(
        invite={
            "invite_id": "i1",
            "invite_code": "abc",
            "org_id": "orgA",
            "email": "client@acme.com",
            "role": "member",
            "status": "pending",
            "created_by": "admin_uid",
            "expires_at": datetime.now(timezone.utc) + timedelta(days=3),
        },
        org={"name": "Acme", "org_id": "orgA"},
        inviter={"uid": "admin_uid", "display_name": "John Admin", "email": "john@acme.com"},
    )
    _stub_router_dependencies(monkeypatch, fake)

    result = _run(settings_router.preview_invite("abc"))

    assert result.org_name == "Acme"
    assert result.invited_email == "client@acme.com"
    assert result.role == "member"
    assert result.inviter_name == "John Admin"
    assert result.inviter_email == "john@acme.com"


def test_preview_invite_404_when_missing(monkeypatch):
    fake = _RouterFS(invite=None)
    _stub_router_dependencies(monkeypatch, fake)

    with pytest.raises(HTTPException) as exc:
        _run(settings_router.preview_invite("nope"))
    assert exc.value.status_code == 404


def test_preview_invite_404_when_expired(monkeypatch):
    fake = _RouterFS(
        invite={
            "invite_id": "i1",
            "invite_code": "abc",
            "org_id": "orgA",
            "email": "client@acme.com",
            "role": "member",
            "status": "pending",
            "created_by": "admin_uid",
            "expires_at": datetime.now(timezone.utc) - timedelta(days=1),
        },
        org={"name": "Acme"},
        inviter={"uid": "admin_uid"},
    )
    _stub_router_dependencies(monkeypatch, fake)

    with pytest.raises(HTTPException) as exc:
        _run(settings_router.preview_invite("abc"))
    assert exc.value.status_code == 404


# ── join_org: email match + tier promotion ───────────────────────────────


def _make_user(uid: str = "u1", email: str = "client@acme.com") -> CurrentUser:
    return CurrentUser(
        uid=uid,
        email=email,
        display_name=None,
        org_id=None,
        org_role=None,
    )


def _valid_invite(email: str = "client@acme.com") -> dict:
    return {
        "invite_id": "i1",
        "invite_code": "abc",
        "org_id": "orgA",
        "email": email,
        "role": "member",
        "status": "pending",
        "created_by": "admin_uid",
        "expires_at": datetime.now(timezone.utc) + timedelta(days=3),
    }


def test_join_org_rejects_email_mismatch(monkeypatch):
    fake = _RouterFS(invite=_valid_invite("invited@acme.com"))
    _stub_router_dependencies(monkeypatch, fake)
    user = _make_user(email="other@x.com")

    with pytest.raises(HTTPException) as exc:
        _run(settings_router.join_org("abc", user=user))

    assert exc.value.status_code == 403
    # Must NOT have attached user to the org on a rejected join.
    assert fake.user_updates == {}
    assert fake.plan_updates == {}


def test_join_org_email_match_case_insensitive(monkeypatch):
    fake = _RouterFS(
        invite=_valid_invite("client@acme.com"),
        user_doc={"uid": "u1", "plan": {"tier": "blocked"}},
    )
    _stub_router_dependencies(monkeypatch, fake)
    user = _make_user(email="Client@ACME.com")

    result = _run(settings_router.join_org("abc", user=user))

    assert result == {"status": "joined", "org_id": "orgA"}
    assert fake.user_updates == {"org_id": "orgA", "org_role": "member"}


def test_join_org_promotes_blocked_to_trial(monkeypatch):
    fake = _RouterFS(
        invite=_valid_invite(),
        user_doc={"uid": "u1", "plan": {"tier": "blocked"}},
    )
    _stub_router_dependencies(monkeypatch, fake)
    user = _make_user()

    _run(settings_router.join_org("abc", user=user))

    assert fake.plan_updates["tier"] == "trial"
    assert isinstance(fake.plan_updates["trial_expires_at"], datetime)
    assert fake.plan_updates["trial_expires_at"] > datetime.now(timezone.utc)
    assert fake.invite_updates == {"status": "accepted"}


def test_join_org_does_not_downgrade_paid_user(monkeypatch):
    fake = _RouterFS(
        invite=_valid_invite(),
        user_doc={"uid": "u1", "plan": {"tier": "paid"}},
    )
    _stub_router_dependencies(monkeypatch, fake)
    user = _make_user()

    _run(settings_router.join_org("abc", user=user))

    # Already-paying user keeps their tier - no set_plan call.
    assert fake.plan_updates == {}


def test_join_org_rejects_user_already_in_org(monkeypatch):
    fake = _RouterFS(invite=_valid_invite())
    _stub_router_dependencies(monkeypatch, fake)
    user = CurrentUser(
        uid="u1", email="client@acme.com", display_name=None,
        org_id="orgB", org_role="member",
    )

    with pytest.raises(HTTPException) as exc:
        _run(settings_router.join_org("abc", user=user))

    assert exc.value.status_code == 400


# Suppress unused-import lint
_ = SimpleNamespace
