"""Unit tests for shared-dashboard live title resolution.

Renames go to `explorer_layouts` / `artifacts`; the share doc keeps the title
frozen at create time. The resolver must prefer the authoritative source so the
public link reflects the latest name.
"""

from types import SimpleNamespace

from api.routers.dashboard_shares import resolve_current_dashboard_title


class _Doc:
    def __init__(self, exists: bool, data: dict | None = None):
        self.exists = exists
        self._data = data or {}

    def to_dict(self):
        return self._data


class _DocRef:
    def __init__(self, doc: _Doc):
        self._doc = doc

    def get(self):
        return self._doc


class _Collection:
    def __init__(self, docs: dict[str, _Doc]):
        self._docs = docs

    def document(self, doc_id: str) -> _DocRef:
        return _DocRef(self._docs.get(doc_id, _Doc(exists=False)))


class _FakeDB:
    def __init__(self, mapping: dict[str, dict[str, _Doc]]):
        self._mapping = mapping

    def collection(self, name: str) -> _Collection:
        return _Collection(self._mapping.get(name, {}))


def test_prefers_explorer_layout_title():
    db = _FakeDB({
        "explorer_layouts": {"d1": _Doc(True, {"title": "New Name"})},
        "artifacts": {"d1": _Doc(True, {"title": "Stale Artifact Title"})},
    })
    assert resolve_current_dashboard_title(db, "d1", "Frozen Share") == "New Name"


def test_falls_back_to_artifact_when_no_layout():
    db = _FakeDB({
        "artifacts": {"d1": _Doc(True, {"title": "Live Artifact"})},
    })
    assert resolve_current_dashboard_title(db, "d1", "Frozen Share") == "Live Artifact"


def test_falls_back_to_share_title_when_no_doc():
    db = _FakeDB({})
    assert resolve_current_dashboard_title(db, "d1", "Frozen Share") == "Frozen Share"


def test_falls_back_when_title_blank():
    db = _FakeDB({
        "explorer_layouts": {"d1": _Doc(True, {"title": "   "})},
        "artifacts": {"d1": _Doc(True, {"title": ""})},
    })
    assert resolve_current_dashboard_title(db, "d1", "Frozen Share") == "Frozen Share"


def test_lookup_exception_does_not_break():
    class _BrokenCollection:
        def document(self, _):
            raise RuntimeError("firestore down")

    db = SimpleNamespace(collection=lambda _name: _BrokenCollection())
    assert resolve_current_dashboard_title(db, "d1", "Frozen Share") == "Frozen Share"
