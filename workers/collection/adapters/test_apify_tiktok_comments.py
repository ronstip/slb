"""Unit tests for ApifyAdapter.fetch_comments (TikTok).

Patches `_run_actor_collect_raw` so the parse + thread-resolution path runs
offline. Mirrors `test_apify_instagram_comments.py` with TikTok-shaped
fixtures (nested `replies`, plus the flat-with-reply_id variant some actor
builds emit).
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
        apify_actor_tiktok_comments="clockworks/tiktok-comments-scraper",
        apify_instagram_comments_max=100,
        apify_tiktok_comments_max=100,
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


def _comment(
    cid: str,
    handle: str,
    uid: str,
    *,
    text: str = "hi",
    reply_id: str = "0",
    replies=None,
) -> dict:
    return {
        "cid": cid,
        "text": text,
        "create_time": 1714497000,  # 2024-04-30 ish, unix seconds
        "digg_count": 7,
        "reply_comment_total": len(replies or []),
        "reply_id": reply_id,
        "user": {
            "unique_id": handle,
            "uid": uid,
            "nickname": handle.title(),
            "avatar_thumb": f"https://tiktok.com/{handle}/avatar.jpg",
            "verified": False,
        },
        "replies": replies or [],
    }


def test_fetch_comments_threads_nested_replies():
    """Top comment c1 with two nested replies. All three flat in output;
    c2 + c3 resolve to root=c1; c1 is its own root. Authors de-duped."""
    adapter, settings_patch = _build_adapter()

    raw_items = [
        _comment(
            "c1", "alice", "uid_alice", text="banger",
            replies=[
                _comment("c2", "bob", "uid_bob", text="agreed"),
                _comment("c3", "alice", "uid_alice", text="thanks bob"),
            ],
        ),
        _comment("c4", "carol", "uid_carol", text="another root"),
    ]

    try:
        with patch.object(adapter, "_run_actor_collect_raw", return_value=raw_items):
            batch = adapter.fetch_comments({
                "post_id": "ROOT_VIDEO",
                "platform": "tiktok",
                "post_url": "https://www.tiktok.com/@alice/video/12345",
            })
    finally:
        settings_patch.stop()

    by_id = {c.comment_id: c for c in batch.comments}
    assert set(by_id) == {"c1", "c2", "c3", "c4"}

    assert by_id["c1"].root_comment_id == "c1"
    assert by_id["c2"].root_comment_id == "c1"
    assert by_id["c3"].root_comment_id == "c1"
    assert by_id["c4"].root_comment_id == "c4"

    assert by_id["c1"].replied_to_id == "ROOT_VIDEO"
    assert by_id["c2"].replied_to_id == "c1"
    assert by_id["c3"].replied_to_id == "c1"

    for c in batch.comments:
        assert c.platform == "tiktok"
        assert c.crawl_provider == "apify"
        assert c.likes == 7

    by_handle = {ch.channel_handle: ch for ch in batch.channels}
    assert set(by_handle) == {"alice", "bob", "carol"}
    assert by_handle["alice"].channel_id == "uid_alice"


def test_fetch_comments_flat_with_reply_id_respects_parent():
    """Some actor builds emit replies in the top-level list with `reply_id`
    pointing at the parent rather than nesting under `replies`. The parent
    linkage on the item itself must be preserved."""
    adapter, settings_patch = _build_adapter()

    raw_items = [
        _comment("c1", "alice", "uid_alice", reply_id="0"),
        _comment("c2", "bob", "uid_bob", reply_id="c1"),  # flat reply
    ]

    try:
        with patch.object(adapter, "_run_actor_collect_raw", return_value=raw_items):
            batch = adapter.fetch_comments({
                "post_id": "ROOT_VIDEO",
                "platform": "tiktok",
                "post_url": "https://www.tiktok.com/@alice/video/12345",
            })
    finally:
        settings_patch.stop()

    by_id = {c.comment_id: c for c in batch.comments}
    assert by_id["c1"].replied_to_id == "ROOT_VIDEO"
    assert by_id["c2"].replied_to_id == "c1"
    assert by_id["c2"].root_comment_id == "c1"


def test_fetch_comments_passes_results_limit_to_actor():
    adapter, settings_patch = _build_adapter(apify_tiktok_comments_max=25)

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
                "post_id": "V1",
                "platform": "tiktok",
                "post_url": "https://www.tiktok.com/@x/video/V1",
            })
    finally:
        settings_patch.stop()

    assert captured["platform"] == "tiktok"
    assert captured["feature"] == "comments"
    assert captured["actor_id"] == "clockworks/tiktok-comments-scraper"
    assert captured["run_input"]["postURLs"] == ["https://www.tiktok.com/@x/video/V1"]
    assert captured["run_input"]["commentsPerPost"] == 25


def test_fetch_comments_facebook_dispatches_to_actor():
    """Facebook is now wired - fetch_comments routes to the FB comments actor
    and parses the result into threaded Comments."""
    adapter, settings_patch = _build_adapter(
        apify_actor_facebook_comments="apify/facebook-comments-scraper",
        apify_facebook_comments_max=50,
    )
    captured: dict = {}

    def fake_raw(platform, run_input, *, feature, actor_id):
        captured.update(platform=platform, run_input=run_input, feature=feature, actor_id=actor_id)
        return [
            {
                "id": "c1",
                "text": "first!",
                "profileName": "Bob",
                "profileId": "u1",
                "date": "2026-05-02T14:00:00.000Z",
                "replies": [
                    {"id": "c1r1", "text": "reply", "profileName": "Sue", "profileId": "u2"},
                ],
            },
        ]

    try:
        with patch.object(adapter, "_run_actor_collect_raw", side_effect=fake_raw):
            batch = adapter.fetch_comments(
                {"platform": "facebook", "post_url": "https://fb.com/groups/1/posts/P1", "post_id": "P1"}
            )
    finally:
        settings_patch.stop()

    assert captured["platform"] == "facebook"
    assert captured["feature"] == "comments"
    assert captured["actor_id"] == "apify/facebook-comments-scraper"
    assert captured["run_input"]["startUrls"] == [{"url": "https://fb.com/groups/1/posts/P1"}]
    assert captured["run_input"]["resultsLimit"] == 50
    # top-level + nested reply both parsed
    ids = {c.comment_id for c in batch.comments}
    assert ids == {"c1", "c1r1"}
    reply = next(c for c in batch.comments if c.comment_id == "c1r1")
    assert reply.replied_to_id == "c1"
    assert {ch.channel_handle for ch in batch.channels} == {"Bob", "Sue"}
