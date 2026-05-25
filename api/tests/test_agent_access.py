"""Tests for opt-in agent sharing: access rule, list scoping, visibility propagation.

Covers the regression where every org member saw all org agents (and then 403'd
on their private collections). Sharing is now opt-in at the agent level.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from api.auth.dependencies import CurrentUser
from api.services import agent_service
from api.services.collection_service import can_access_agent
from workers.shared.firestore_client import FirestoreClient


def _user(uid: str, org_id: str | None = None) -> CurrentUser:
    return CurrentUser(uid=uid, email=f"{uid}@x.com", display_name=uid, org_id=org_id, org_role="member")


# ── can_access_agent ────────────────────────────────────────────────────


def test_owner_always_has_access():
    user = _user("owner", org_id="orgA")
    agent = {"user_id": "owner", "org_id": "orgA", "visibility": "private"}
    assert can_access_agent(user, agent) is True


def test_org_member_sees_shared_agent():
    user = _user("member", org_id="orgA")
    agent = {"user_id": "owner", "org_id": "orgA", "visibility": "org"}
    assert can_access_agent(user, agent) is True


def test_org_member_denied_private_agent():
    user = _user("member", org_id="orgA")
    agent = {"user_id": "owner", "org_id": "orgA", "visibility": "private"}
    assert can_access_agent(user, agent) is False


def test_absent_visibility_is_private():
    user = _user("member", org_id="orgA")
    agent = {"user_id": "owner", "org_id": "orgA"}  # legacy doc, no visibility field
    assert can_access_agent(user, agent) is False


def test_different_org_denied_even_if_shared():
    user = _user("member", org_id="orgB")
    agent = {"user_id": "owner", "org_id": "orgA", "visibility": "org"}
    assert can_access_agent(user, agent) is False


def test_no_org_user_denied_others_agent():
    user = _user("member", org_id=None)
    agent = {"user_id": "owner", "org_id": "orgA", "visibility": "org"}
    assert can_access_agent(user, agent) is False


# ── list_user_agents scoping (the regression) ───────────────────────────


class _FakeDoc:
    def __init__(self, doc_id: str, data: dict):
        self.id = doc_id
        self._data = data

    def to_dict(self) -> dict:
        return dict(self._data)


class _FakeQuery:
    """Minimal Firestore query supporting chained equality .where() + .stream()."""

    def __init__(self, docs: list[_FakeDoc], filters: list[tuple] | None = None):
        self._docs = docs
        self._filters = filters or []

    def where(self, field, op, value):
        assert op == "=="
        return _FakeQuery(self._docs, self._filters + [(field, value)])

    def stream(self):
        for doc in self._docs:
            data = doc.to_dict()
            if all(data.get(f) == v for f, v in self._filters):
                yield doc


class _FakeDB:
    def __init__(self, docs: list[_FakeDoc]):
        self._docs = docs

    def collection(self, name):
        assert name == "agents"
        return _FakeQuery(self._docs)


def _client_with(docs: list[_FakeDoc]) -> FirestoreClient:
    fs = object.__new__(FirestoreClient)  # bypass __init__ (no real GCP client)
    fs._db = _FakeDB(docs)
    return fs


def test_member_sees_own_plus_only_shared_org_agents():
    docs = [
        _FakeDoc("own1", {"user_id": "member", "org_id": "orgA", "visibility": "private", "created_at": "3"}),
        _FakeDoc("shared", {"user_id": "owner", "org_id": "orgA", "visibility": "org", "created_at": "2"}),
        _FakeDoc("private", {"user_id": "owner", "org_id": "orgA", "visibility": "private", "created_at": "1"}),
        _FakeDoc("legacy", {"user_id": "owner", "org_id": "orgA", "created_at": "0"}),  # no visibility
    ]
    fs = _client_with(docs)

    result_ids = {a["agent_id"] for a in fs.list_user_agents("member", "orgA")}

    assert result_ids == {"own1", "shared"}  # NOT 'private' or 'legacy'


def test_member_with_no_org_sees_only_own():
    docs = [
        _FakeDoc("own1", {"user_id": "member", "org_id": None, "created_at": "1"}),
        _FakeDoc("shared", {"user_id": "owner", "org_id": "orgA", "visibility": "org", "created_at": "2"}),
    ]
    fs = _client_with(docs)
    assert {a["agent_id"] for a in fs.list_user_agents("member", None)} == {"own1"}


# ── set_agent_visibility propagation ─────────────────────────────────────


class _FakeFS:
    def __init__(self, agent: dict):
        self._agent = agent
        self.agent_updates: dict = {}
        self.collection_updates: list[tuple[str, dict]] = []

    def get_agent(self, agent_id):
        return dict(self._agent)

    def update_agent(self, agent_id, **fields):
        self.agent_updates.update(fields)

    def update_collection_status(self, collection_id, **fields):
        self.collection_updates.append((collection_id, fields))


def test_share_propagates_org_visibility_to_collections(monkeypatch):
    fake = _FakeFS({"user_id": "owner", "org_id": "orgA", "collection_ids": ["c1", "c2"]})
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    agent_service.set_agent_visibility("a1", "org")

    assert fake.agent_updates == {"visibility": "org"}
    assert sorted(fake.collection_updates) == [
        ("c1", {"visibility": "org", "org_id": "orgA"}),
        ("c2", {"visibility": "org", "org_id": "orgA"}),
    ]


def test_unshare_propagates_private_to_collections(monkeypatch):
    fake = _FakeFS({"user_id": "owner", "org_id": "orgA", "collection_ids": ["c1"]})
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    agent_service.set_agent_visibility("a1", "private")

    assert fake.agent_updates == {"visibility": "private"}
    assert fake.collection_updates == [("c1", {"visibility": "private", "org_id": "orgA"})]


def test_invalid_visibility_rejected(monkeypatch):
    monkeypatch.setattr(agent_service, "get_fs", lambda: _FakeFS({}))
    with pytest.raises(ValueError):
        agent_service.set_agent_visibility("a1", "public")
