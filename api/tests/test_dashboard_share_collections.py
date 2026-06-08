"""Unit tests for shared-dashboard collection resolution.

A share freezes `collection_ids` at create time, but the owner's explorer renders
the agent's CURRENT collection set. Collections added to the agent after the
share was made (e.g. a later run that introduced list[object] enrichment) must
still appear on the share, or widgets bound to those fields show "No Data" only
on the public link. `resolve_share_collection_ids` unions the snapshot with the
agent's live collections to keep share and explorer in parity.
"""

from api.routers.dashboard_shares import resolve_share_collection_ids


class _FakeFS:
    def __init__(self, agent_collections=None, raises=False):
        self._agent_collections = agent_collections
        self._raises = raises

    def get_agent_collection_ids(self, agent_id):
        if self._raises:
            raise RuntimeError("firestore down")
        return self._agent_collections


def test_unions_frozen_snapshot_with_live_agent_collections():
    # The regression: share frozen to the old collection only; the list[object]
    # data lives in a collection added later. The union must surface it.
    fs = _FakeFS(agent_collections=["old", "new_list_object"])
    result = resolve_share_collection_ids(fs, ["old"], "agent-1")
    assert result == ["new_list_object", "old"]  # sorted union


def test_no_agent_id_returns_frozen_snapshot():
    fs = _FakeFS(agent_collections=["should-not-be-used"])
    assert resolve_share_collection_ids(fs, ["old"], None) == ["old"]


def test_empty_agent_collections_falls_back_to_frozen():
    fs = _FakeFS(agent_collections=[])
    assert resolve_share_collection_ids(fs, ["old"], "agent-1") == ["old"]


def test_lookup_exception_falls_back_to_frozen():
    fs = _FakeFS(raises=True)
    assert resolve_share_collection_ids(fs, ["old"], "agent-1") == ["old"]


def test_dedupes_overlap():
    fs = _FakeFS(agent_collections=["a", "b"])
    assert resolve_share_collection_ids(fs, ["a"], "agent-1") == ["a", "b"]
