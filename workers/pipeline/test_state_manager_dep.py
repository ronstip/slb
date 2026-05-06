"""Unit tests for StateManager.mark_collected — focused on the new
`awaits_dep_post_id` post_meta field set when a Post depends on another
in-range post (X API quote/reply unpack).
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from workers.collection.models import Post
from workers.pipeline.post_state import PostState
from workers.pipeline.state_manager import StateManager


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_manager() -> StateManager:
    """Build a StateManager with the Firestore client patched to a MagicMock."""
    with patch("workers.pipeline.state_manager.firestore.Client", return_value=MagicMock()), \
         patch("workers.pipeline.state_manager.get_settings"):
        return StateManager(collection_id="c-1")


def _post(
    post_id: str,
    *,
    dep: str | None = None,
    dep_type: str | None = None,
    content: str = "hi",
    media_urls=None,
) -> Post:
    return Post(
        post_id=post_id,
        platform="twitter",
        channel_handle="x",
        post_url=f"https://x.com/x/status/{post_id}",
        posted_at=datetime(2026, 4, 30, tzinfo=timezone.utc),
        post_type="text",
        content=content,
        media_urls=media_urls or [],
        enrichment_dependency_post_id=dep,
        enrichment_dependency_type=dep_type,
    )


def _captured_post_meta(mgr: StateManager) -> dict[str, dict]:
    """Run mark_collected and return the post_meta dict passed to transition_batch."""
    captured: dict = {}

    def _capture(transitions, media_refs=None, post_meta=None, is_initial=False):
        captured["post_meta"] = post_meta or {}
        captured["transitions"] = list(transitions)

    mgr.transition_batch = _capture  # type: ignore[assignment]
    return captured


# ---------------------------------------------------------------------------
# awaits_dep_post_id flag
# ---------------------------------------------------------------------------

def test_awaits_dep_set_when_dep_is_in_range():
    """Quote-tweet (parent) and its source (dep) both in the in-range list →
    parent's post_meta gets awaits_dep_post_id pointing at the dep."""
    mgr = _make_manager()
    parent = _post("9001", dep="8000", dep_type="quoted")
    dep = _post("8000")  # the source — also in this batch
    captured = _captured_post_meta(mgr)

    mgr.mark_collected([parent, dep])

    parent_meta = captured["post_meta"]["9001"]
    assert parent_meta["awaits_dep_post_id"] == "8000"
    assert parent_meta["enrichment_dependency_type"] == "quoted"
    # Dep itself never has awaits set — 1-level cap.
    dep_meta = captured["post_meta"]["8000"]
    assert "awaits_dep_post_id" not in dep_meta


def test_awaits_dep_set_for_replied_to():
    mgr = _make_manager()
    parent = _post("9001", dep="8000", dep_type="replied_to")
    dep = _post("8000")
    captured = _captured_post_meta(mgr)

    mgr.mark_collected([parent, dep])

    parent_meta = captured["post_meta"]["9001"]
    assert parent_meta["awaits_dep_post_id"] == "8000"
    assert parent_meta["enrichment_dependency_type"] == "replied_to"


def test_awaits_dep_NOT_set_when_dep_is_out_of_range():
    """Parent depends on a tweet not in the in-range list (e.g. dep is too old).
    Parent must NOT wait — would deadlock on a non-existent post_state."""
    mgr = _make_manager()
    parent = _post("9001", dep="8000", dep_type="quoted")
    captured = _captured_post_meta(mgr)

    mgr.mark_collected([parent])  # only parent — dep absent from in-range list

    parent_meta = captured["post_meta"]["9001"]
    assert "awaits_dep_post_id" not in parent_meta
    assert "enrichment_dependency_type" not in parent_meta


def test_awaits_dep_NOT_set_when_post_has_no_dep():
    """Standalone tweet — no dep field on the Post."""
    mgr = _make_manager()
    standalone = _post("9001")
    captured = _captured_post_meta(mgr)

    mgr.mark_collected([standalone])

    meta = captured["post_meta"]["9001"]
    assert "awaits_dep_post_id" not in meta


def test_existing_post_meta_fields_preserved():
    """Adding awaits_dep_post_id must not break the existing platform/post_url fields."""
    mgr = _make_manager()
    parent = _post("9001", dep="8000", dep_type="quoted")
    dep = _post("8000")
    captured = _captured_post_meta(mgr)

    mgr.mark_collected([parent, dep])

    for pid in ("9001", "8000"):
        m = captured["post_meta"][pid]
        assert m["platform"] == "twitter"
        assert m["post_url"].startswith("https://x.com/")


def test_initial_state_classification_unchanged():
    """The new dep logic must not alter the initial state classification."""
    mgr = _make_manager()
    text_only = _post("9001", content="just text")
    with_media = _post("9002", media_urls=["https://cdn/x.jpg"])
    empty = _post("9003", content="")
    captured = _captured_post_meta(mgr)

    mgr.mark_collected([text_only, with_media, empty])

    by_id = {pid: state for pid, state in captured["transitions"]}
    assert by_id["9001"] == PostState.READY_FOR_ENRICHMENT
    assert by_id["9002"] == PostState.COLLECTED_WITH_MEDIA
    assert by_id["9003"] == PostState.MISSING_MEDIA
