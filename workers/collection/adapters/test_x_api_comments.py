"""Unit tests for XAPIAdapter.fetch_comments — mocks XAPIClient so tests run offline.

Covers:
- Comment + Channel rows produced from a paged /search/all response.
- `root_comment_id` resolution on a 3-level nested reply chain.
- `platform_metadata` carries `conversation_id` + `referenced_tweets`.
- `commented_at` parsed from `created_at`.
- `views` sourced from `impression_count`.
- Channel `subscribers`/`total_posts` populated from user `public_metrics`.
- Page cap honored via `x_api_max_comment_pages`.
"""

from unittest.mock import patch

import pytest

from config.settings import Settings
from workers.collection.adapters.x_api import XAPIAdapter


def _settings(**overrides) -> Settings:
    defaults = dict(
        gcp_project_id="test-project",
        x_api_bearer_token="t-abc",
        x_api_max_results=100,
        x_api_min_request_interval_sec=0.0,
        x_api_sort_order="recency",
        x_api_default_max_calls=1,
        x_api_end_time_lag_hours=0.0,
        x_api_unpack_referenced_posts=False,
        x_api_max_comment_pages=5,
    )
    defaults.update(overrides)
    return Settings(**defaults)


def _build_adapter(**setting_overrides):
    """Return (adapter, settings_patch) — caller starts the patch so it stays
    alive across both __init__ and fetch_comments (which calls get_settings)."""
    s = _settings(**setting_overrides)
    settings_patch = patch("workers.collection.adapters.x_api.get_settings", return_value=s)
    settings_patch.start()
    try:
        with patch("workers.collection.adapters.x_api.XAPIClient"):
            adapter = XAPIAdapter()
    except Exception:
        settings_patch.stop()
        raise
    return adapter, settings_patch


def _user(uid: str, handle: str, followers: int = 500, tweets: int = 42) -> dict:
    return {
        "id": uid,
        "username": handle,
        "name": f"{handle.title()} Name",
        "verified": False,
        "public_metrics": {
            "followers_count": followers,
            "tweet_count": tweets,
            "following_count": 10,
            "listed_count": 1,
        },
        "profile_image_url": f"https://x.com/{handle}/pic.jpg",
    }


def _reply(tid: str, author_id: str, *, replied_to: str, text: str = "hi") -> dict:
    return {
        "id": tid,
        "author_id": author_id,
        "text": text,
        "created_at": "2026-04-30T17:48:00.000Z",
        "lang": "en",
        "conversation_id": "ROOT_POST",
        "public_metrics": {
            "like_count": 3,
            "retweet_count": 1,
            "reply_count": 0,
            "impression_count": 99,
        },
        "referenced_tweets": [{"type": "replied_to", "id": replied_to}],
        "in_reply_to_user_id": "post_author_uid",
    }


def test_fetch_comments_emits_comments_and_channels_with_root_resolution():
    """3-level nested chain: c1 -> ROOT_POST, c2 -> c1, c3 -> c2. All three
    should resolve root=c1. Two distinct authors -> two Channel rows."""
    adapter, settings_patch = _build_adapter()

    # Root tweet lookup returns conversation_id=ROOT_POST
    # Single page of /search/all with the three replies + two authors
    responses = [
        {"data": {"id": "ROOT_POST", "conversation_id": "ROOT_POST"}},
        {
            "data": [
                _reply("c1", "uid_alice", replied_to="ROOT_POST", text="great post"),
                _reply("c2", "uid_bob", replied_to="c1", text="disagree"),
                _reply("c3", "uid_alice", replied_to="c2", text="why?"),
            ],
            "includes": {
                "users": [
                    _user("uid_alice", "alice", followers=1234, tweets=88),
                    _user("uid_bob", "bob", followers=42, tweets=7),
                ],
            },
            "meta": {},
        },
    ]

    def fake_get(path, params=None):
        return responses.pop(0)

    adapter._client.get.side_effect = fake_get

    try:
        batch = adapter.fetch_comments({
            "post_id": "ROOT_POST",
            "platform": "twitter",
            "post_url": "https://x.com/poster/status/ROOT_POST",
        })
    finally:
        settings_patch.stop()

    assert len(batch.comments) == 3
    assert len(batch.channels) == 2

    by_id = {c.comment_id: c for c in batch.comments}
    assert by_id["c1"].root_comment_id == "c1"  # direct reply to post
    assert by_id["c2"].root_comment_id == "c1"  # nested 1 level
    assert by_id["c3"].root_comment_id == "c1"  # nested 2 levels

    c1 = by_id["c1"]
    assert c1.channel_handle == "alice"
    assert c1.channel_id == "uid_alice"
    assert c1.commented_at is not None
    assert c1.commented_at.year == 2026
    assert c1.views == 99
    assert c1.likes == 3
    assert c1.shares == 1
    assert c1.crawl_provider == "xapi"
    assert c1.platform_metadata["conversation_id"] == "ROOT_POST"
    assert c1.platform_metadata["referenced_tweets"] == [
        {"type": "replied_to", "id": "ROOT_POST"}
    ]

    by_handle = {ch.channel_handle: ch for ch in batch.channels}
    assert by_handle["alice"].subscribers == 1234
    assert by_handle["alice"].total_posts == 88
    assert by_handle["bob"].subscribers == 42
    assert by_handle["bob"].total_posts == 7


def test_fetch_comments_stops_at_page_cap():
    """When pagination keeps returning a next_token, we must stop at
    x_api_max_comment_pages (defensive against runaway PAYG cost)."""
    adapter, settings_patch = _build_adapter(x_api_max_comment_pages=2)

    root_resp = {"data": {"id": "ROOT_POST", "conversation_id": "ROOT_POST"}}
    page = {
        "data": [_reply("cX", "uid_alice", replied_to="ROOT_POST")],
        "includes": {"users": [_user("uid_alice", "alice")]},
        "meta": {"next_token": "MORE"},
    }

    call_count = {"n": 0}

    def fake_get(path, params=None):
        call_count["n"] += 1
        if path.startswith("tweets/") and "search" not in path:
            return root_resp
        return page

    adapter._client.get.side_effect = fake_get

    try:
        batch = adapter.fetch_comments({
            "post_id": "ROOT_POST",
            "platform": "twitter",
            "post_url": "https://x.com/poster/status/ROOT_POST",
        })
    finally:
        settings_patch.stop()

    # 1 root lookup + 2 pages of search/all = 3 calls total
    assert call_count["n"] == 3
    # Both pages return the same fixture, so 2 comments emitted
    assert len(batch.comments) == 2


def test_fetch_comments_root_lookup_failure_falls_back_to_post_id():
    """If the initial tweets/{id} lookup fails, we still proceed using
    post_id as conversation_id rather than aborting."""
    from workers.collection.adapters.x_api_client import XAPIError

    adapter, settings_patch = _build_adapter()

    def fake_get(path, params=None):
        if path.startswith("tweets/") and "search" not in path:
            raise XAPIError(500, "boom", url=path)
        return {
            "data": [_reply("c1", "uid_alice", replied_to="ROOT_POST")],
            "includes": {"users": [_user("uid_alice", "alice")]},
            "meta": {},
        }

    adapter._client.get.side_effect = fake_get

    try:
        batch = adapter.fetch_comments({
            "post_id": "ROOT_POST",
            "platform": "twitter",
            "post_url": "https://x.com/poster/status/ROOT_POST",
        })
    finally:
        settings_patch.stop()

    assert len(batch.comments) == 1
    assert batch.comments[0].comment_id == "c1"


def test_fetch_comments_missing_post_id_returns_empty():
    adapter, settings_patch = _build_adapter()
    try:
        batch = adapter.fetch_comments({"platform": "twitter", "post_url": "not-a-twitter-url"})
    finally:
        settings_patch.stop()
    assert batch.comments == []
    assert batch.channels == []
