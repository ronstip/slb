"""Tests for opt-in agent sharing: access rule, list scoping, visibility propagation.

Covers the regression where every org member saw all org agents (and then 403'd
on their private collections). Sharing is now opt-in at the agent level.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from api.auth.dependencies import CurrentUser
from api.services import agent_service
from api.services.collection_service import can_access_agent, can_access_component
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


# ── can_access_component (collections / artifacts / layouts) ─────────────


def test_component_owner_always_has_access():
    user = _user("owner", org_id="orgA")
    assert can_access_component(user, {"user_id": "owner", "visibility": "private"}) is True


def test_component_org_member_sees_visibility_org():
    user = _user("member", org_id="orgA")
    doc = {"user_id": "owner", "org_id": "orgA", "visibility": "org"}
    assert can_access_component(user, doc) is True


def test_component_org_member_sees_shared_flag():
    """Artifacts gate on the legacy `shared` bool rather than `visibility`."""
    user = _user("member", org_id="orgA")
    doc = {"user_id": "owner", "org_id": "orgA", "shared": True}
    assert can_access_component(user, doc) is True


def test_component_org_member_denied_private():
    user = _user("member", org_id="orgA")
    doc = {"user_id": "owner", "org_id": "orgA", "visibility": "private"}
    assert can_access_component(user, doc) is False
    assert can_access_component(user, {"user_id": "owner", "org_id": "orgA", "shared": False}) is False


def test_component_different_org_denied():
    user = _user("member", org_id="orgB")
    doc = {"user_id": "owner", "org_id": "orgA", "visibility": "org", "shared": True}
    assert can_access_component(user, doc) is False


def test_component_no_org_user_denied():
    user = _user("member", org_id=None)
    doc = {"user_id": "owner", "org_id": "orgA", "visibility": "org"}
    assert can_access_component(user, doc) is False


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
        self.artifact_updates: list[tuple[str, dict]] = []

    def get_agent(self, agent_id):
        return dict(self._agent)

    def update_agent(self, agent_id, **fields):
        self.agent_updates.update(fields)

    def update_collection_status(self, collection_id, **fields):
        self.collection_updates.append((collection_id, fields))

    def update_artifact(self, artifact_id, fields=None, **kwargs):
        self.artifact_updates.append((artifact_id, {**(fields or {}), **kwargs}))


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


def test_share_propagates_shared_flag_to_artifacts(monkeypatch):
    fake = _FakeFS({
        "user_id": "owner", "org_id": "orgA",
        "collection_ids": [], "artifact_ids": ["art1", "art2"],
    })
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    agent_service.set_agent_visibility("a1", "org")

    assert sorted(fake.artifact_updates) == [
        ("art1", {"org_id": "orgA", "shared": True}),
        ("art2", {"org_id": "orgA", "shared": True}),
    ]


def test_unshare_clears_shared_flag_on_artifacts(monkeypatch):
    fake = _FakeFS({
        "user_id": "owner", "org_id": "orgA",
        "collection_ids": [], "artifact_ids": ["art1"],
    })
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    agent_service.set_agent_visibility("a1", "private")

    assert fake.artifact_updates == [("art1", {"org_id": "orgA", "shared": False})]


def test_reconcile_unshare_clears_artifacts(monkeypatch):
    """Switching orgs on a shared agent must also un-share its artifacts."""
    fake = _ReconcileFS([
        {"agent_id": "a1", "user_id": "u", "org_id": "orgA",
         "visibility": "org", "collection_ids": [], "artifact_ids": ["art1"]},
    ])
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    agent_service.reconcile_user_org_membership("u", "orgB")

    assert fake.artifact_writes == [("art1", {"org_id": "orgB", "shared": False})]


def test_invalid_visibility_rejected(monkeypatch):
    monkeypatch.setattr(agent_service, "get_fs", lambda: _FakeFS({}))
    with pytest.raises(ValueError):
        agent_service.set_agent_visibility("a1", "public")


# ── reconcile_user_org_membership ────────────────────────────────────────


class _ReconcileFS:
    """Fake FS for reconcile tests: backs both the stream-by-user_id read and
    the per-agent / per-collection writes."""

    def __init__(self, agents: list[dict]):
        self._docs = [_FakeDoc(a["agent_id"], a) for a in agents]
        self.agent_writes: list[tuple[str, dict]] = []
        self.collection_writes: list[tuple[str, dict]] = []
        self.artifact_writes: list[tuple[str, dict]] = []
        # _ReconcileFS exposes `_db` so reconcile can stream agents the same
        # way the real client does in list_user_agents.
        self._db = _FakeDB(self._docs)

    def update_agent(self, agent_id, **fields):
        self.agent_writes.append((agent_id, fields))

    def update_collection_status(self, cid, **fields):
        self.collection_writes.append((cid, fields))

    def update_artifact(self, artifact_id, fields=None, **kwargs):
        self.artifact_writes.append((artifact_id, {**(fields or {}), **kwargs}))


def test_reconcile_stamps_org_id_on_orphan_agents(monkeypatch):
    """User joined an org after creating agents — their old agents have
    org_id=None and the UI can't share them. Reconcile must stamp the new org."""
    fake = _ReconcileFS([
        {"agent_id": "a1", "user_id": "u", "org_id": None,
         "visibility": "private", "collection_ids": ["c1"]},
    ])
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    reconciled = agent_service.reconcile_user_org_membership("u", "orgA")

    assert reconciled == 1
    assert fake.agent_writes == [("a1", {"org_id": "orgA"})]
    assert fake.collection_writes == [("c1", {"org_id": "orgA"})]


def test_reconcile_is_noop_when_org_matches(monkeypatch):
    """Steady state: no agents drifted -> no writes, no log spam."""
    fake = _ReconcileFS([
        {"agent_id": "a1", "user_id": "u", "org_id": "orgA",
         "visibility": "org", "collection_ids": ["c1"]},
    ])
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    reconciled = agent_service.reconcile_user_org_membership("u", "orgA")

    assert reconciled == 0
    assert fake.agent_writes == []
    assert fake.collection_writes == []


def test_reconcile_unshares_when_switching_orgs(monkeypatch):
    """User left orgA (where agent was shared) and joined orgB. The share
    must NOT silently follow them into orgB — reset to private."""
    fake = _ReconcileFS([
        {"agent_id": "a1", "user_id": "u", "org_id": "orgA",
         "visibility": "org", "collection_ids": ["c1"]},
    ])
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    reconciled = agent_service.reconcile_user_org_membership("u", "orgB")

    assert reconciled == 1
    assert fake.agent_writes == [("a1", {"org_id": "orgB", "visibility": "private"})]
    assert fake.collection_writes == [("c1", {"org_id": "orgB", "visibility": "private"})]


def test_reconcile_drops_share_when_leaving_org(monkeypatch):
    """User left their org -> org_id=None and any active share is stale."""
    fake = _ReconcileFS([
        {"agent_id": "a1", "user_id": "u", "org_id": "orgA",
         "visibility": "org", "collection_ids": []},
    ])
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    agent_service.reconcile_user_org_membership("u", None)

    assert fake.agent_writes == [("a1", {"org_id": None, "visibility": "private"})]


def test_reconcile_preserves_private_visibility_on_join(monkeypatch):
    """Joining an org with private agents must NOT auto-share them."""
    fake = _ReconcileFS([
        {"agent_id": "a1", "user_id": "u", "org_id": None,
         "visibility": "private", "collection_ids": []},
    ])
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    agent_service.reconcile_user_org_membership("u", "orgA")

    # Only org_id changes; visibility stays private (no leak).
    assert fake.agent_writes == [("a1", {"org_id": "orgA"})]


def test_reconcile_ignores_other_users_agents(monkeypatch):
    """The query filter `user_id == uid` keeps reconcile from touching agents
    owned by anyone else, even when their org_id mismatches."""
    fake = _ReconcileFS([
        {"agent_id": "mine", "user_id": "u", "org_id": None,
         "visibility": "private", "collection_ids": []},
        {"agent_id": "theirs", "user_id": "other", "org_id": "orgZ",
         "visibility": "org", "collection_ids": []},
    ])
    monkeypatch.setattr(agent_service, "get_fs", lambda: fake)

    agent_service.reconcile_user_org_membership("u", "orgA")

    assert [w[0] for w in fake.agent_writes] == ["mine"]


# ── invalidate_user_cache ────────────────────────────────────────────────


def test_invalidate_user_cache_drops_entry():
    """Org membership writes must be visible to the next request, even within
    the 5-min user-cache TTL window."""
    from api.auth import dependencies as deps

    deps._user_cache["u1"] = (_user("u1"), 9_999_999_999.0)  # very-far-future expiry
    deps.invalidate_user_cache("u1")
    assert "u1" not in deps._user_cache


def test_invalidate_user_cache_missing_key_is_noop():
    from api.auth import dependencies as deps

    deps._user_cache.pop("ghost", None)
    deps.invalidate_user_cache("ghost")  # must not raise
