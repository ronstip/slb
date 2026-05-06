"""Unit tests for XAPIAdapter — focused on Option B unpacking of referenced
tweets (`x_api_unpack_referenced_posts` flag) and pagination behavior.

Mocks XAPIClient so tests run offline.
"""

from unittest.mock import patch

import pytest

from config.settings import Settings
from workers.collection.adapters.x_api import XAPIAdapter


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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
    )
    defaults.update(overrides)
    return Settings(**defaults)


def _build_adapter(unpack: bool = False) -> XAPIAdapter:
    s = _settings(x_api_unpack_referenced_posts=unpack)
    with patch("workers.collection.adapters.x_api.get_settings", return_value=s), \
         patch("workers.collection.adapters.x_api.XAPIClient"):
        return XAPIAdapter()


def _make_response(
    *,
    primary_tweets: list[dict],
    referenced_tweets: list[dict] | None = None,
    users: list[dict] | None = None,
    next_token: str | None = None,
) -> dict:
    includes: dict = {
        "users": users or [],
        "media": [],
    }
    if referenced_tweets:
        includes["tweets"] = referenced_tweets
    resp: dict = {"data": primary_tweets, "includes": includes}
    if next_token:
        resp["meta"] = {"next_token": next_token}
    return resp


def _user(uid: str, handle: str) -> dict:
    return {
        "id": uid, "username": handle, "verified": False,
        "public_metrics": {"followers_count": 100},
    }


def _tweet(
    tid: str, author_id: str, text: str = "hi",
    refs: list[dict] | None = None,
) -> dict:
    t: dict = {
        "id": tid,
        "author_id": author_id,
        "text": text,
        "created_at": "2026-04-30T17:48:00.000Z",
        "lang": "en",
        "conversation_id": tid,
        "public_metrics": {
            "like_count": 1, "retweet_count": 0, "reply_count": 0,
            "quote_count": 0, "impression_count": 10, "bookmark_count": 0,
        },
    }
    if refs:
        t["referenced_tweets"] = refs
    return t


# ---------------------------------------------------------------------------
# Unpack flag OFF — backwards-compat baseline
# ---------------------------------------------------------------------------

def test_unpack_off_emits_only_primary_posts():
    adapter = _build_adapter(unpack=False)
    parent = _tweet("9001", "100", "quote!", refs=[{"type": "quoted", "id": "8000"}])
    src = _tweet("8000", "200", "source body")
    resp = _make_response(
        primary_tweets=[parent],
        referenced_tweets=[src],
        users=[_user("100", "alice"), _user("200", "bob")],
    )
    adapter._client.get.return_value = resp
    adapter._referenced_post_count = 0

    batches = adapter._paginate(
        path="tweets/search/all", params={}, max_calls=1,
        hard_cap=None, search_keyword="kw",
    )

    assert len(batches) == 1
    posts = batches[0].posts
    assert {p.post_id for p in posts} == {"9001"}  # only primary
    primary = posts[0]
    assert primary.enrichment_dependency_post_id is None
    assert primary.enrichment_dependency_type is None
    # Defensive cache still populated even when unpack is off — cheap to keep.
    assert primary.platform_metadata["referenced_post"]["id"] == "8000"
    assert primary.platform_metadata["referenced_post"]["text"] == "source body"
    assert adapter._referenced_post_count == 0


# ---------------------------------------------------------------------------
# Unpack flag ON — basic unpack
# ---------------------------------------------------------------------------

def test_unpack_on_emits_dep_post_and_links_parent():
    adapter = _build_adapter(unpack=True)
    parent = _tweet("9001", "100", "quote!", refs=[{"type": "quoted", "id": "8000"}])
    src = _tweet("8000", "200", "source body")
    resp = _make_response(
        primary_tweets=[parent],
        referenced_tweets=[src],
        users=[_user("100", "alice"), _user("200", "bob")],
    )
    adapter._client.get.return_value = resp
    adapter._referenced_post_count = 0

    batches = adapter._paginate(
        path="tweets/search/all", params={}, max_calls=1,
        hard_cap=None, search_keyword="kw",
    )

    posts = batches[0].posts
    by_id = {p.post_id: p in posts for p in posts}
    assert "9001" in {p.post_id for p in posts}
    assert "8000" in {p.post_id for p in posts}

    parent_post = next(p for p in posts if p.post_id == "9001")
    dep_post = next(p for p in posts if p.post_id == "8000")

    assert parent_post.enrichment_dependency_post_id == "8000"
    assert parent_post.enrichment_dependency_type == "quoted"
    # Dep itself has no dep — 1-level cap.
    assert dep_post.enrichment_dependency_post_id is None
    assert dep_post.enrichment_dependency_type is None
    assert dep_post.channel_handle == "bob"
    assert dep_post.content == "source body"
    # Both stamped with crawl_provider + search_keyword.
    assert dep_post.crawl_provider == "xapi"
    assert dep_post.search_keyword == "kw"
    assert adapter._referenced_post_count == 1


def test_unpack_on_replied_to_also_unpacks():
    adapter = _build_adapter(unpack=True)
    parent = _tweet("9001", "100", "reply!", refs=[{"type": "replied_to", "id": "8000"}])
    src = _tweet("8000", "200", "the parent thread")
    resp = _make_response(
        primary_tweets=[parent],
        referenced_tweets=[src],
        users=[_user("100", "alice"), _user("200", "bob")],
    )
    adapter._client.get.return_value = resp
    adapter._referenced_post_count = 0

    batches = adapter._paginate(
        path="tweets/search/all", params={}, max_calls=1,
        hard_cap=None, search_keyword=None,
    )

    posts = batches[0].posts
    parent_post = next(p for p in posts if p.post_id == "9001")
    assert parent_post.enrichment_dependency_post_id == "8000"
    assert parent_post.enrichment_dependency_type == "replied_to"


# ---------------------------------------------------------------------------
# Dedup behaviors
# ---------------------------------------------------------------------------

def test_unpack_dedupes_when_same_source_referenced_by_multiple_parents():
    adapter = _build_adapter(unpack=True)
    p1 = _tweet("9001", "100", "quote A!", refs=[{"type": "quoted", "id": "8000"}])
    p2 = _tweet("9002", "101", "quote B!", refs=[{"type": "quoted", "id": "8000"}])
    src = _tweet("8000", "200", "viral source")
    resp = _make_response(
        primary_tweets=[p1, p2],
        referenced_tweets=[src],
        users=[_user("100", "alice"), _user("101", "carol"), _user("200", "bob")],
    )
    adapter._client.get.return_value = resp
    adapter._referenced_post_count = 0

    batches = adapter._paginate(
        path="tweets/search/all", params={}, max_calls=1,
        hard_cap=None, search_keyword="kw",
    )

    posts = batches[0].posts
    ids = [p.post_id for p in posts]
    # Source appears only once.
    assert ids.count("8000") == 1
    # Both parents link to it.
    parents = [p for p in posts if p.post_id != "8000"]
    assert all(p.enrichment_dependency_post_id == "8000" for p in parents)
    assert adapter._referenced_post_count == 1


def test_unpack_skips_when_source_already_a_primary_post():
    """If we directly collected the source AND a quote of it in the same page,
    don't duplicate the source — just link the parent."""
    adapter = _build_adapter(unpack=True)
    src_as_primary = _tweet("8000", "200", "source body")
    parent = _tweet("9001", "100", "quote!", refs=[{"type": "quoted", "id": "8000"}])
    resp = _make_response(
        primary_tweets=[src_as_primary, parent],
        referenced_tweets=[src_as_primary],  # X may or may not include it; either way
        users=[_user("100", "alice"), _user("200", "bob")],
    )
    adapter._client.get.return_value = resp
    adapter._referenced_post_count = 0

    batches = adapter._paginate(
        path="tweets/search/all", params={}, max_calls=1,
        hard_cap=None, search_keyword=None,
    )

    posts = batches[0].posts
    ids = [p.post_id for p in posts]
    # Exactly two posts — no duplicate of 8000.
    assert sorted(ids) == ["8000", "9001"]
    parent_post = next(p for p in posts if p.post_id == "9001")
    assert parent_post.enrichment_dependency_post_id == "8000"
    assert parent_post.enrichment_dependency_type == "quoted"
    assert adapter._referenced_post_count == 0


# ---------------------------------------------------------------------------
# Skip cases
# ---------------------------------------------------------------------------

def test_unpack_skips_retweets():
    adapter = _build_adapter(unpack=True)
    parent = _tweet("9001", "100", "RT", refs=[{"type": "retweeted", "id": "8000"}])
    src = _tweet("8000", "200", "original")
    resp = _make_response(
        primary_tweets=[parent],
        referenced_tweets=[src],
        users=[_user("100", "alice"), _user("200", "bob")],
    )
    adapter._client.get.return_value = resp
    adapter._referenced_post_count = 0

    batches = adapter._paginate(
        path="tweets/search/all", params={}, max_calls=1,
        hard_cap=None, search_keyword=None,
    )

    posts = batches[0].posts
    assert {p.post_id for p in posts} == {"9001"}
    assert posts[0].enrichment_dependency_post_id is None


def test_unpack_skips_when_ref_not_in_includes_tweets():
    """Source deleted/protected — referenced_tweets[] points at id but no full
    tweet in includes.tweets. Parent stays without dep, only defensive cache."""
    adapter = _build_adapter(unpack=True)
    parent = _tweet("9001", "100", "quote", refs=[{"type": "quoted", "id": "8000"}])
    resp = _make_response(
        primary_tweets=[parent],
        referenced_tweets=None,  # nothing hydrated
        users=[_user("100", "alice")],
    )
    adapter._client.get.return_value = resp
    adapter._referenced_post_count = 0

    batches = adapter._paginate(
        path="tweets/search/all", params={}, max_calls=1,
        hard_cap=None, search_keyword=None,
    )

    posts = batches[0].posts
    assert {p.post_id for p in posts} == {"9001"}
    parent_post = posts[0]
    assert parent_post.enrichment_dependency_post_id is None
    snap = parent_post.platform_metadata["referenced_post"]
    assert snap == {"id": "8000", "type": "quoted"}
    assert adapter._referenced_post_count == 0


# ---------------------------------------------------------------------------
# hard_cap interaction
# ---------------------------------------------------------------------------

def test_hard_cap_counts_only_primary_posts_not_refs():
    """A budget of 1 should yield 1 primary + its dep, not 0 because we already
    spent the budget on the dep."""
    adapter = _build_adapter(unpack=True)
    parent = _tweet("9001", "100", "quote!", refs=[{"type": "quoted", "id": "8000"}])
    src = _tweet("8000", "200", "source body")
    resp = _make_response(
        primary_tweets=[parent],
        referenced_tweets=[src],
        users=[_user("100", "alice"), _user("200", "bob")],
    )
    adapter._client.get.return_value = resp
    adapter._referenced_post_count = 0

    batches = adapter._paginate(
        path="tweets/search/all", params={}, max_calls=1,
        hard_cap=1, search_keyword=None,
    )

    posts = batches[0].posts
    assert {p.post_id for p in posts} == {"9001", "8000"}
