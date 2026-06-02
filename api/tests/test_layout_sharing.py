"""Layouts are components of an agent: whoever can access the agent can read
and edit its explorer layouts (collaborative), and read/save its dashboard
(widget) layouts via the owning artifact. Private agents stay owner-only.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from api.auth.dependencies import CurrentUser
from api.routers import explorer_layouts, dashboard_layouts


def _user(uid: str, org_id: str | None = None) -> CurrentUser:
    return CurrentUser(uid=uid, email=f"{uid}@x.com", display_name=uid, org_id=org_id, org_role="member")


# ── minimal Firestore fakes ──────────────────────────────────────────────


class _Doc:
    def __init__(self, doc_id, data, exists=True):
        self.id = doc_id
        self._data = data
        self.exists = exists

    def to_dict(self):
        return dict(self._data)

    def get(self, field):
        # Firestore DocumentSnapshot.get(field_path)
        return self._data.get(field)


class _DocRef:
    def __init__(self, store, doc_id):
        self._store = store
        self._id = doc_id

    def get(self):
        if self._id in self._store:
            return _Doc(self._id, self._store[self._id], exists=True)
        return _Doc(self._id, {}, exists=False)

    def set(self, data, merge=False):
        if merge and self._id in self._store:
            self._store[self._id].update(data)
        else:
            self._store[self._id] = dict(data)

    def update(self, data):
        self._store[self._id].update(data)

    def delete(self):
        self._store.pop(self._id, None)


class _Query:
    def __init__(self, store, filters=None):
        self._store = store
        self._filters = filters or []

    def where(self, field, op, value):
        assert op == "=="
        return _Query(self._store, self._filters + [(field, value)])

    def stream(self):
        for doc_id, data in self._store.items():
            if all(data.get(f) == v for f, v in self._filters):
                yield _Doc(doc_id, data)


class _Collection:
    def __init__(self, store):
        self._store = store

    def where(self, field, op, value):
        return _Query(self._store).where(field, op, value)

    def document(self, doc_id):
        return _DocRef(self._store, doc_id)


class _DB:
    def __init__(self, collections):
        self._collections = collections

    def collection(self, name):
        return _Collection(self._collections.setdefault(name, {}))


class _FS:
    def __init__(self, agents, collections=None):
        self._agents = agents
        self._db = _DB(collections or {})

    def get_agent(self, agent_id):
        a = self._agents.get(agent_id)
        return dict(a) if a is not None else None


SHARED_AGENT = {"user_id": "owner", "org_id": "orgA", "visibility": "org"}
PRIVATE_AGENT = {"user_id": "owner", "org_id": "orgA", "visibility": "private"}


# ── explorer layouts ─────────────────────────────────────────────────────


def test_member_lists_all_layouts_of_shared_agent():
    fs = _FS(
        agents={"a1": SHARED_AGENT},
        collections={"explorer_layouts": {
            "L1": {"agent_id": "a1", "user_id": "owner", "title": "Owner view",
                   "created_at": "1", "updated_at": "1"},
            "L2": {"agent_id": "a1", "user_id": "member", "title": "Member view",
                   "created_at": "2", "updated_at": "2"},
            "Lx": {"agent_id": "other", "user_id": "owner", "title": "Other",
                   "created_at": "3", "updated_at": "3"},
        }},
    )
    items = asyncio.run(
        explorer_layouts.list_explorer_layouts(agent_id="a1", user=_user("member", "orgA"), fs=fs)
    )
    # Sees both layouts on a1 (collaborative), regardless of creator; not 'other'.
    assert {i.layout_id for i in items} == {"L1", "L2"}


def test_member_denied_layouts_of_private_agent():
    fs = _FS(agents={"a1": PRIVATE_AGENT}, collections={"explorer_layouts": {}})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            explorer_layouts.list_explorer_layouts(agent_id="a1", user=_user("member", "orgA"), fs=fs)
        )
    assert exc.value.status_code == 403


def test_member_can_rename_layout_on_shared_agent():
    fs = _FS(
        agents={"a1": SHARED_AGENT},
        collections={"explorer_layouts": {
            "L1": {"agent_id": "a1", "user_id": "owner", "title": "Old",
                   "created_at": "1", "updated_at": "1"},
        }},
    )
    req = explorer_layouts.ExplorerLayoutUpdate(title="New")
    resp = asyncio.run(
        explorer_layouts.update_explorer_layout(
            layout_id="L1", request=req, user=_user("member", "orgA"), fs=fs
        )
    )
    assert resp.title == "New"


def test_member_cannot_rename_layout_on_private_agent():
    fs = _FS(
        agents={"a1": PRIVATE_AGENT},
        collections={"explorer_layouts": {
            "L1": {"agent_id": "a1", "user_id": "owner", "title": "Old",
                   "created_at": "1", "updated_at": "1"},
        }},
    )
    req = explorer_layouts.ExplorerLayoutUpdate(title="New")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            explorer_layouts.update_explorer_layout(
                layout_id="L1", request=req, user=_user("member", "orgA"), fs=fs
            )
        )
    assert exc.value.status_code == 403


# ── dashboard (widget) layouts - gated via owning artifact ─────────────────


class _ArtifactFS(_FS):
    def __init__(self, agents, artifacts, collections=None):
        super().__init__(agents, collections)
        self._artifacts = artifacts

    def get_artifact(self, artifact_id):
        a = self._artifacts.get(artifact_id)
        return dict(a) if a is not None else None


def test_member_reads_dashboard_layout_of_shared_artifact():
    fs = _ArtifactFS(
        agents={},
        artifacts={"art1": {"user_id": "owner", "org_id": "orgA", "shared": True}},
        collections={"dashboard_layouts": {"art1": {"user_id": "owner", "layout": [{"x": 0}]}}},
    )
    resp = asyncio.run(
        dashboard_layouts.get_dashboard_layout(artifact_id="art1", user=_user("member", "orgA"), fs=fs)
    )
    assert resp.layout == [{"x": 0}]


def test_member_denied_dashboard_layout_of_private_artifact():
    fs = _ArtifactFS(
        agents={},
        artifacts={"art1": {"user_id": "owner", "org_id": "orgA", "shared": False}},
        collections={"dashboard_layouts": {"art1": {"user_id": "owner", "layout": [{"x": 0}]}}},
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            dashboard_layouts.get_dashboard_layout(artifact_id="art1", user=_user("member", "orgA"), fs=fs)
        )
    assert exc.value.status_code == 403


# An explorer-VIEW dashboard has NO artifact: the dashboard_layouts doc is keyed
# by the explorer layout_id, so access must resolve via the layout's agent.


def test_member_reads_explorer_dashboard_layout_when_agent_shared():
    fs = _ArtifactFS(
        agents={"a1": SHARED_AGENT},
        artifacts={},  # explorer view has no backing artifact
        collections={
            "explorer_layouts": {"L1": {"agent_id": "a1", "user_id": "owner", "title": "V"}},
            "dashboard_layouts": {"L1": {"user_id": "owner", "layout": [{"x": 1}]}},
        },
    )
    resp = asyncio.run(
        dashboard_layouts.get_dashboard_layout(artifact_id="L1", user=_user("member", "orgA"), fs=fs)
    )
    assert resp.layout == [{"x": 1}]


def test_member_denied_explorer_dashboard_layout_when_agent_private():
    fs = _ArtifactFS(
        agents={"a1": PRIVATE_AGENT},
        artifacts={},
        collections={
            "explorer_layouts": {"L1": {"agent_id": "a1", "user_id": "owner", "title": "V"}},
            "dashboard_layouts": {"L1": {"user_id": "owner", "layout": [{"x": 1}]}},
        },
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            dashboard_layouts.get_dashboard_layout(artifact_id="L1", user=_user("member", "orgA"), fs=fs)
        )
    assert exc.value.status_code == 403
