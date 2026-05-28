"""Unit tests for ApifyAdapter.fetch_comments (Instagram).

Patches `_run_actor_collect_raw` so the parse + thread-resolution path runs
offline. Mirrors `test_x_api_comments.py` in shape.

Covers:
- Top-level comments + nested replies flatten into one CommentBatch.
- `root_comment_id` resolution links nested replies back to their top-level.
- Channel rows emitted for unique authors across top + reply tiers.
- `crawl_provider` stamped as "apify".
- Missing `post_url` returns an empty batch (defensive).
- Non-instagram platforms still raise NotImplementedError.
"""

from unittest.mock import patch

import pytest

from config.settings import Settings
from workers.collection.adapters.apify import ApifyAdapter


def _settings(**overrides) -> Settings:
    defaults = dict(
        gcp_project_id="test-project",
        apify_api_token="t-abc",
        apify_actor_instagram="apify/instagram-scraper",
        apify_actor_facebook="scrapeforge/facebook-search-posts",
        apify_actor_tiktok="clockworks/tiktok-scraper",
        apify_actor_instagram_comments="apify/instagram-comment-scraper",
        apify_instagram_comments_max=100,
        apify_run_timeout_sec=600,
        apify_memory_mbytes=1024,
        apify_max_parallel_runs=4,
        apify_account_memory_cap_mbytes=32768,
        apify_max_runs_per_collection=30,
        apify_build="",
        apify_proxy_group="RESIDENTIAL",
    )
    defaults.update(overrides)
    return Settings(**defaults)


def _build_adapter(**setting_overrides):
    s = _settings(**setting_overrides)
    settings_patch = patch("workers.collection.adapters.apify.get_settings", return_value=s)
    settings_patch.start()
    try:
        with patch("workers.collection.adapters.apify.ApifyAdapterClient"):
            adapter = ApifyAdapter()
    except Exception:
        settings_patch.stop()
        raise
    return adapter, settings_patch


def _comment(cid: str, handle: str, owner_id: str, text: str = "hi", replies=None) -> dict:
    return {
        "id": cid,
        "ownerUsername": handle,
        "ownerId": owner_id,
        "ownerProfilePicUrl": f"https://instagram.com/{handle}/pic.jpg",
        "ownerIsVerified": False,
        "text": text,
        "timestamp": "2026-04-30T17:48:00.000Z",
        "likesCount": 5,
        "repliesCount": len(replies or []),
        "commentUrl": f"https://www.instagram.com/p/POST/c/{cid}/",
        "replies": replies or [],
    }


def test_fetch_comments_emits_threaded_batch_with_replies():
    """Top comment c1 with two nested replies c2, c3. All three flat in the
    output; c2 + c3 resolve to root=c1; c1 is its own root."""
    adapter, settings_patch = _build_adapter()

    raw_items = [
        _comment(
            "c1", "alice", "uid_alice", text="great post",
            replies=[
                _comment("c2", "bob", "uid_bob", text="disagree"),
                _comment("c3", "carol", "uid_carol", text="me too"),
            ],
        ),
        _comment("c4", "alice", "uid_alice", text="another root"),
    ]

    try:
        with patch.object(adapter, "_run_actor_collect_raw", return_value=raw_items):
            batch = adapter.fetch_comments({
                "post_id": "ROOT_POST",
                "platform": "instagram",
                "post_url": "https://www.instagram.com/p/SHORTCODE/",
            })
    finally:
        settings_patch.stop()

    by_id = {c.comment_id: c for c in batch.comments}
    assert set(by_id) == {"c1", "c2", "c3", "c4"}

    # Thread roots
    assert by_id["c1"].root_comment_id == "c1"
    assert by_id["c2"].root_comment_id == "c1"
    assert by_id["c3"].root_comment_id == "c1"
    assert by_id["c4"].root_comment_id == "c4"

    # Replied-to links
    assert by_id["c1"].replied_to_id == "ROOT_POST"
    assert by_id["c2"].replied_to_id == "c1"
    assert by_id["c3"].replied_to_id == "c1"
    assert by_id["c4"].replied_to_id == "ROOT_POST"

    # Provider + platform stamp
    for c in batch.comments:
        assert c.platform == "instagram"
        assert c.crawl_provider == "apify"

    # Three distinct authors (alice de-duped across c1 + c4)
    by_handle = {ch.channel_handle: ch for ch in batch.channels}
    assert set(by_handle) == {"alice", "bob", "carol"}
    assert by_handle["alice"].channel_id == "uid_alice"


def test_fetch_comments_missing_post_url_returns_empty():
    adapter, settings_patch = _build_adapter()
    try:
        batch = adapter.fetch_comments({"platform": "instagram", "post_id": "X"})
    finally:
        settings_patch.stop()
    assert batch.comments == []
    assert batch.channels == []


def test_fetch_comments_non_instagram_raises():
    adapter, settings_patch = _build_adapter()
    try:
        with pytest.raises(NotImplementedError):
            adapter.fetch_comments({"platform": "facebook", "post_url": "https://fb.com/x"})
    finally:
        settings_patch.stop()


def test_fetch_comments_passes_results_limit_to_actor():
    """The configured cap should land in the run_input as `resultsLimit`."""
    adapter, settings_patch = _build_adapter(apify_instagram_comments_max=42)

    captured: dict = {}

    def fake_run(platform, run_input, *, feature, actor_id):
        captured["platform"] = platform
        captured["feature"] = feature
        captured["actor_id"] = actor_id
        captured["run_input"] = run_input
        return []

    try:
        with patch.object(adapter, "_run_actor_collect_raw", side_effect=fake_run):
            adapter.fetch_comments({
                "post_id": "P1",
                "platform": "instagram",
                "post_url": "https://www.instagram.com/p/ABC/",
            })
    finally:
        settings_patch.stop()

    assert captured["platform"] == "instagram"
    assert captured["feature"] == "comments"
    assert captured["actor_id"] == "apify/instagram-comment-scraper"
    assert captured["run_input"]["directUrls"] == ["https://www.instagram.com/p/ABC/"]
    assert captured["run_input"]["resultsLimit"] == 42
