"""Unit tests for FirestoreClient.get_collection_statuses (batched read).

The dashboard freshness stamp previously fired one Firestore read per collection
(36+ on a large share, all before the response-cache check). The batched variant
collapses them into a single `get_all` round-trip; these tests pin its contract:
one entry per requested id, missing docs -> None, identical normalization to the
single-read path, and dedupe of repeated ids.
"""

from datetime import datetime, timezone

from workers.shared.firestore_client import FirestoreClient


class _FakeSnap:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class _FakeRef:
    def __init__(self, doc_id):
        self.id = doc_id


class _FakeColl:
    def document(self, doc_id):
        return _FakeRef(doc_id)


class _FakeDB:
    def __init__(self, docs):
        self._docs = docs

    def collection(self, name):
        assert name == "collection_status"
        return _FakeColl()

    def get_all(self, refs):
        # Firestore returns a snapshot per ref; missing docs come back exists=False.
        for ref in refs:
            yield _FakeSnap(ref.id, self._docs.get(ref.id))


def _client(docs):
    fc = FirestoreClient.__new__(FirestoreClient)  # skip GCP client init
    fc._db = _FakeDB(docs)
    return fc


def test_returns_entry_per_id_with_missing_as_none():
    fc = _client({"a": {"status": "running"}, "b": {"status": "running"}})
    out = fc.get_collection_statuses(["a", "b", "missing"])
    assert set(out) == {"a", "b", "missing"}
    assert out["missing"] is None
    assert out["a"]["status"] == "running"


def test_normalizes_legacy_status_and_isoformats_timestamps():
    ts = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    fc = _client({"a": {"status": "completed", "updated_at": ts}})
    out = fc.get_collection_statuses(["a"])
    assert out["a"]["status"] == "success"  # legacy -> 3-state, same as single read
    assert out["a"]["updated_at"] == ts.isoformat()


def test_empty_input_returns_empty_dict():
    fc = _client({"a": {"status": "running"}})
    assert fc.get_collection_statuses([]) == {}


def test_dedupes_repeated_ids():
    fc = _client({"a": {"status": "running"}})
    out = fc.get_collection_statuses(["a", "a"])
    assert out == {"a": {"status": "running"}}
