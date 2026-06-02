"""Unit tests for ApifyAdapter.fetch_comments (YouTube).

Patches `_run_actor_collect_raw` so the parse + thread-resolution path runs
offline. Fixture shape mirrors the observed streamers/youtube-comments-scraper
output (one item per comment; no native id; relative `publishedTimeText`;
flat list with `type` discriminator instead of nested `replies`).
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from config.settings import Settings
from workers.collection.adapters.apify import ApifyAdapter
from workers.collection.adapters.apify_parsers import (
    _parse_yt_relative_time,
    _parse_yt_vote_count,
)


def _settings(**overrides) -> Settings:
    defaults = dict(
        gcp_project_id="test-project",
        apify_api_token="t-abc",
        apify_actor_instagram="apify/instagram-scraper",
        apify_actor_facebook="scrapeforge/facebook-search-posts",
        apify_actor_tiktok="clockworks/tiktok-scraper",
        apify_actor_instagram_comments="apify/instagram-comment-scraper",
        apify_actor_tiktok_comments="clockworks/tiktok-comments-scraper",
        apify_actor_youtube_comments="streamers/youtube-comments-scraper",
        apify_instagram_comments_max=100,
        apify_tiktok_comments_max=100,
        apify_youtube_comments_max=100,
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


def _yt_item(
    handle: str,
    text: str,
    *,
    item_type: str = "comment",
    votes: int = 0,
    replies: int = 0,
    published_text: str = "2 hours ago",
    page_url: str = "https://www.youtube.com/watch?v=MmfECiciDRg",
    title: str = "video title",
) -> dict:
    """Fixture matching the observed actor shape (no id, no channelId)."""
    return {
        "author": f"@{handle}",
        "comment": text,
        "type": item_type,
        "voteCount": votes,
        "replyCount": replies,
        "publishedTimeText": published_text,
        "hasCreatorHeart": False,
        "authorIsChannelOwner": False,
        "title": title,
        "pageUrl": page_url,
    }


def test_fetch_comments_parses_real_shape_with_synthesized_ids():
    """Two flat comments, no native ids - flatten synthesizes stable ids
    and content/author/votes survive the parse."""
    adapter, settings_patch = _build_adapter()

    raw_items = [
        _yt_item("dansi100", "חזק וברוך", votes=0, published_text="2 hours ago"),
        _yt_item("Hakukbaeven", "long political rant", votes=3, published_text="7 hours ago"),
    ]

    try:
        with patch.object(adapter, "_run_actor_collect_raw", return_value=raw_items):
            batch = adapter.fetch_comments({
                "post_id": "MmfECiciDRg",
                "platform": "youtube",
                "post_url": "https://www.youtube.com/watch?v=MmfECiciDRg",
            })
    finally:
        settings_patch.stop()

    assert len(batch.comments) == 2
    by_handle = {c.channel_handle: c for c in batch.comments}

    assert by_handle["dansi100"].content == "חזק וברוך"
    assert by_handle["dansi100"].likes == 0
    assert by_handle["dansi100"].comment_id != ""
    # @ stripped from handle
    assert "@" not in by_handle["dansi100"].channel_handle

    assert by_handle["Hakukbaeven"].content == "long political rant"
    assert by_handle["Hakukbaeven"].likes == 3
    assert by_handle["Hakukbaeven"].comment_id != by_handle["dansi100"].comment_id

    # Both threaded as direct replies to the post (no parent linkage in shape).
    for c in batch.comments:
        assert c.replied_to_id == "MmfECiciDRg"
        assert c.root_comment_id == c.comment_id
        assert c.platform == "youtube"
        assert c.crawl_provider == "apify"
        # publishedTimeText preserved in metadata for downstream review.
        assert c.platform_metadata.get("published_time_text")
        # Commented-at populated from the relative parse (not unix epoch).
        assert c.commented_at.year >= 2025


def test_synthesized_id_stable_across_refetch():
    """Same source item → same comment_id on re-fetch so dedup works."""
    adapter, settings_patch = _build_adapter()

    item = _yt_item("alice", "first take", published_text="3 hours ago")
    post_payload = {
        "post_id": "VID1",
        "platform": "youtube",
        "post_url": "https://www.youtube.com/watch?v=VID1",
    }

    try:
        with patch.object(adapter, "_run_actor_collect_raw", return_value=[item]):
            first = adapter.fetch_comments(post_payload).comments[0]
            second = adapter.fetch_comments(post_payload).comments[0]
    finally:
        settings_patch.stop()

    assert first.comment_id == second.comment_id


def test_fetch_comments_passes_results_limit_and_url_payload_to_actor():
    """YT actor takes `startUrls=[{url}]` + `maxComments`."""
    adapter, settings_patch = _build_adapter(apify_youtube_comments_max=25)

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
                "platform": "youtube",
                "post_url": "https://www.youtube.com/watch?v=V1",
            })
    finally:
        settings_patch.stop()

    assert captured["platform"] == "youtube"
    assert captured["feature"] == "comments"
    assert captured["actor_id"] == "streamers/youtube-comments-scraper"
    assert captured["run_input"]["startUrls"] == [
        {"url": "https://www.youtube.com/watch?v=V1"},
    ]
    assert captured["run_input"]["maxComments"] == 25


def test_legacy_shape_with_native_ids_and_nested_replies():
    """Older builds that ship `id` + nested `replies` still thread cleanly."""
    adapter, settings_patch = _build_adapter()

    raw_items = [
        {
            "id": "c1",
            "comment": "banger",
            "author": "@alice",
            "authorChannelId": "UCalice",
            "voteCount": 1200,
            "publishedAt": "2026-04-30T17:48:00Z",
            "replies": [
                {
                    "id": "c2",
                    "comment": "agreed",
                    "author": "@bob",
                    "authorChannelId": "UCbob",
                    "voteCount": 3,
                    "publishedAt": "2026-04-30T18:00:00Z",
                },
            ],
        },
    ]

    try:
        with patch.object(adapter, "_run_actor_collect_raw", return_value=raw_items):
            batch = adapter.fetch_comments({
                "post_id": "ROOT_VID",
                "platform": "youtube",
                "post_url": "https://www.youtube.com/watch?v=ROOT_VID",
            })
    finally:
        settings_patch.stop()

    by_id = {c.comment_id: c for c in batch.comments}
    assert set(by_id) == {"c1", "c2"}
    assert by_id["c1"].root_comment_id == "c1"
    assert by_id["c2"].root_comment_id == "c1"
    assert by_id["c2"].replied_to_id == "c1"
    assert by_id["c1"].likes == 1200


# ---------------------------------------------------------------------------
# Helper-level tests
# ---------------------------------------------------------------------------


def test_parse_yt_relative_time_handles_common_phrases():
    now = datetime(2026, 5, 28, 12, 0, 0, tzinfo=timezone.utc)
    assert _parse_yt_relative_time("2 hours ago", now) == now - timedelta(hours=2)
    assert _parse_yt_relative_time("a minute ago", now) == now - timedelta(minutes=1)
    assert _parse_yt_relative_time("an hour ago", now) == now - timedelta(hours=1)
    assert _parse_yt_relative_time("3 days ago", now) == now - timedelta(days=3)
    assert _parse_yt_relative_time("yesterday", now) == now - timedelta(days=1)
    assert _parse_yt_relative_time("just now", now) == now
    assert _parse_yt_relative_time("nonsense", now) is None
    assert _parse_yt_relative_time(None, now) is None


def test_parse_yt_vote_count_abbreviations():
    assert _parse_yt_vote_count("1.2K") == 1200
    assert _parse_yt_vote_count("3M") == 3_000_000
    assert _parse_yt_vote_count(42) == 42
    assert _parse_yt_vote_count("") is None
    assert _parse_yt_vote_count(None) is None


def test_fetch_comments_facebook_still_unsupported():
    """Facebook isn't wired yet - should raise NotImplementedError."""
    adapter, settings_patch = _build_adapter()
    try:
        with pytest.raises(NotImplementedError):
            adapter.fetch_comments({"platform": "facebook", "post_url": "https://fb.com/x"})
    finally:
        settings_patch.stop()
