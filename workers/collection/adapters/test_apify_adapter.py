"""Unit tests for ApifyAdapter.

Mocks the apify-client SDK so tests run offline. Verifies:
- Time-window gate drops out-of-range posts
- Run budget enforcement
- Memory cap guard at init time
- Parser registry init (fail-fast on unknown actor)
- _detect_platform_from_url
- date / hashtag-URL helpers
- Per-keyword fan-out for TikTok and Facebook input shape
- Instagram hybrid details+posts pass with cross-pass dedupe
"""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from config.settings import Settings
from workers.collection.adapters.apify import (
    ApifyAdapter,
    _detect_platform_from_url,
    _hashtag_url,
    _to_yyyymmdd,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _settings_with_apify(**overrides) -> Settings:
    """Build a Settings instance with sensible defaults plus overrides."""
    defaults = dict(
        gcp_project_id="test-project",
        apify_api_token="t-abc",
        apify_actor_instagram="apify/instagram-scraper",
        apify_actor_facebook="scrapeforge/facebook-search-posts",
        apify_actor_tiktok="clockworks/tiktok-scraper",
        apify_run_timeout_sec=60,
        apify_max_runs_per_collection=5,
        apify_max_parallel_runs=2,
        apify_memory_mbytes=2048,
        apify_account_memory_cap_mbytes=8192,
        apify_build="",
        apify_proxy_group="RESIDENTIAL",
    )
    defaults.update(overrides)
    return Settings(**defaults)


def _build_adapter(**setting_overrides) -> ApifyAdapter:
    """Construct an ApifyAdapter with a mocked SDK client."""
    settings = _settings_with_apify(**setting_overrides)
    with patch("workers.collection.adapters.apify.get_settings", return_value=settings), \
         patch("workers.collection.adapters.apify.ApifyAdapterClient"):
        return ApifyAdapter()


# ---------------------------------------------------------------------------
# Date / URL helpers
# ---------------------------------------------------------------------------

def test_to_yyyymmdd_strips_time_and_zone():
    assert _to_yyyymmdd("2026-04-15T12:34:56Z") == "2026-04-15"
    assert _to_yyyymmdd("2026-04-15") == "2026-04-15"
    assert _to_yyyymmdd(None) is None
    assert _to_yyyymmdd("not-a-date") is None


def test_hashtag_url_strips_hash_and_spaces():
    assert _hashtag_url("photography") == "https://www.instagram.com/explore/tags/photography/"
    assert _hashtag_url("#photo") == "https://www.instagram.com/explore/tags/photo/"
    assert _hashtag_url("euphoria hbo") == "https://www.instagram.com/explore/tags/euphoriahbo/"


# ---------------------------------------------------------------------------
# URL → platform detection
# ---------------------------------------------------------------------------

def test_detect_platform_from_url():
    assert _detect_platform_from_url("https://www.instagram.com/p/X/") == "instagram"
    assert _detect_platform_from_url("https://www.tiktok.com/@x/video/1") == "tiktok"
    assert _detect_platform_from_url("https://www.facebook.com/x/posts/1") == "facebook"
    assert _detect_platform_from_url("https://twitter.com/x/status/1") is None
    assert _detect_platform_from_url(None) is None


# ---------------------------------------------------------------------------
# Init-time guards
# ---------------------------------------------------------------------------

def test_init_requires_token():
    settings = _settings_with_apify(apify_api_token="")
    with patch("workers.collection.adapters.apify.get_settings", return_value=settings):
        with pytest.raises(ValueError, match="APIFY_API_TOKEN"):
            ApifyAdapter()


def test_init_rejects_memory_cap_violation():
    # 3 parallel * 4096 MB = 12 GB > 8 GB cap
    settings = _settings_with_apify(apify_max_parallel_runs=3, apify_memory_mbytes=4096)
    with patch("workers.collection.adapters.apify.get_settings", return_value=settings), \
         patch("workers.collection.adapters.apify.ApifyAdapterClient"):
        with pytest.raises(ValueError, match="account memory cap"):
            ApifyAdapter()


def test_init_rejects_unknown_actor():
    settings = _settings_with_apify(apify_actor_instagram="unknown/actor")
    with patch("workers.collection.adapters.apify.get_settings", return_value=settings), \
         patch("workers.collection.adapters.apify.ApifyAdapterClient"):
        with pytest.raises(ValueError, match="No Apify parser registered"):
            ApifyAdapter()


def test_supported_platforms():
    adapter = _build_adapter()
    assert set(adapter.supported_platforms()) == {"instagram", "facebook", "tiktok"}


# ---------------------------------------------------------------------------
# Run budget
# ---------------------------------------------------------------------------

def test_run_budget_blocks_after_max():
    adapter = _build_adapter(apify_max_runs_per_collection=2)
    assert adapter._claim_run() is True
    assert adapter._claim_run() is True
    assert adapter._claim_run() is False  # exhausted
    assert adapter.funnel_stats["apify_runs_budget_exhausted"] == 1


# ---------------------------------------------------------------------------
# Time-window gate via _parse_results
# ---------------------------------------------------------------------------

def _ig_item_at(iso_ts: str, post_id: str = "p1") -> dict:
    return {
        "id": post_id,
        "shortCode": post_id,
        "url": f"https://www.instagram.com/p/{post_id}/",
        "caption": "x",
        "timestamp": iso_ts,
        "type": "Image",
        "ownerUsername": "u",
        "ownerId": "1",
        "displayUrl": "https://x/img.jpg",
        "likesCount": 1,
        "commentsCount": 0,
    }


def test_parse_results_drops_out_of_window_posts():
    adapter = _build_adapter()
    config = {
        "time_range": {
            "start": "2026-04-10T00:00:00Z",
            "end": "2026-04-20T00:00:00Z",
        }
    }
    raw = [
        _ig_item_at("2026-04-15T12:00:00Z", "in_window"),
        _ig_item_at("2026-04-01T12:00:00Z", "too_old"),
        _ig_item_at("2026-04-25T12:00:00Z", "too_new"),
    ]
    batches = adapter._parse_results("instagram", raw, config)
    posts = [p for b in batches for p in b.posts]
    ids = {p.post_id for p in posts}
    assert ids == {"in_window"}
    assert adapter.funnel_stats["apify_filtered_by_time_window"] == 2


def test_parse_results_dedupes_by_post_id():
    adapter = _build_adapter()
    raw = [_ig_item_at("2026-04-15T12:00:00Z", "dup"), _ig_item_at("2026-04-15T12:00:00Z", "dup")]
    batches = adapter._parse_results("instagram", raw, {})
    posts = [p for b in batches for p in b.posts]
    assert len(posts) == 1


def test_parse_results_records_funnel():
    adapter = _build_adapter()
    raw = [_ig_item_at("2026-04-15T12:00:00Z", "p1"), _ig_item_at("2026-04-15T12:00:00Z", "p2")]
    adapter._parse_results("instagram", raw, {})
    funnel = adapter.funnel_stats
    assert funnel["apify_valid_posts"] == 2
    assert funnel["per_platform"]["instagram"]["valid_posts"] == 2


def test_parse_results_skips_time_gate_when_disabled():
    adapter = _build_adapter()
    config = {
        "time_range": {
            "start": "2026-04-10T00:00:00Z",
            "end": "2026-04-20T00:00:00Z",
        }
    }
    raw = [
        _ig_item_at("2026-04-15T12:00:00Z", "in_window"),
        _ig_item_at("2026-04-01T12:00:00Z", "before"),
        _ig_item_at("2026-04-25T12:00:00Z", "after"),
    ]
    batches = adapter._parse_results("instagram", raw, config, apply_time_gate=False)
    posts = [p for b in batches for p in b.posts]
    assert {p.post_id for p in posts} == {"in_window", "before", "after"}
    assert adapter.funnel_stats["apify_filtered_by_time_window"] == 0


# ---------------------------------------------------------------------------
# TikTok routing: relevance + no date filter (cost + relevancy fix)
# ---------------------------------------------------------------------------

def test_collect_tiktok_fans_out_per_keyword_with_top_section():
    """TikTok must run one actor call per keyword (so resultsPerPage applies
    per-query), explicitly target the Top section, and skip the client-side
    time gate."""
    adapter = _build_adapter()
    captured: list[dict] = []

    def _capture(platform, run_input, config, *, apply_time_gate=True):
        captured.append({
            "platform": platform,
            "run_input": run_input,
            "apply_time_gate": apply_time_gate,
        })
        return []

    with patch.object(adapter, "_run_and_parse", side_effect=_capture):
        # _collect_tiktok is a generator (streams batches per-keyword) — drain
        # it so the futures actually execute.
        list(adapter._collect_tiktok({
            "keywords": ["alo yoga", "lululemon", "athleta"],
            "max_posts_per_keyword": 100,
            "time_range": {
                "start": "2026-04-26T00:00:00Z",
                "end": "2026-05-03T00:00:00Z",
            },
        }))

    # One run per keyword.
    assert len(captured) == 3
    seen_queries = {tuple(c["run_input"]["searchQueries"]) for c in captured}
    assert seen_queries == {("alo yoga",), ("lululemon",), ("athleta",)}

    for c in captured:
        assert c["platform"] == "tiktok"
        assert c["apply_time_gate"] is False
        run_input = c["run_input"]
        assert run_input["resultsPerPage"] == 100
        # Explicit Top section + default sort.
        assert run_input["searchSection"] == ""
        assert run_input["searchSorting"] == 0
        # No server-side date filter (clockworks ignores these for searchQueries).
        assert "oldestPostDateUnified" not in run_input
        assert "newestPostDate" not in run_input


def test_collect_facebook_uses_relevance_sort_with_buffer():
    """Facebook must request relevance ordering (recent_posts=False) and pad
    max_results to compensate for the actor's server-side dedupe."""
    adapter = _build_adapter()
    captured: list[dict] = []

    def _capture(platform, run_input, config, *, apply_time_gate=True):
        captured.append({"platform": platform, "run_input": run_input})
        return []

    with patch.object(adapter, "_run_and_parse", side_effect=_capture):
        list(adapter._collect_facebook({
            "keywords": ["alo yoga", "lululemon"],
            "max_posts_per_keyword": 25,
            "time_range": {
                "start": "2026-04-26T00:00:00Z",
                "end": "2026-05-03T00:00:00Z",
            },
        }))

    assert len(captured) == 2
    for c in captured:
        ri = c["run_input"]
        assert c["platform"] == "facebook"
        assert ri["recent_posts"] is False  # relevance/top, not most-recent
        # 1.5x buffer on requested 25 → 38 (capped at 1000).
        assert ri["max_results"] == 38
        assert ri["start_date"] == "2026-04-26"
        assert ri["end_date"] == "2026-05-03"
        assert ri["search_type"] == "posts"


def test_collect_facebook_caps_max_results_at_1000():
    adapter = _build_adapter()
    captured: list[dict] = []

    def _capture(platform, run_input, config, *, apply_time_gate=True):
        captured.append(run_input)
        return []

    with patch.object(adapter, "_run_and_parse", side_effect=_capture):
        list(adapter._collect_facebook({
            "keywords": ["x"],
            "max_posts_per_keyword": 800,  # 1.5x = 1200, must clamp to 1000
        }))

    assert captured[0]["max_results"] == 1000


# ---------------------------------------------------------------------------
# Instagram — apidojo/instagram-hashtag-scraper
# ---------------------------------------------------------------------------

def _build_ig_adapter() -> ApifyAdapter:
    return _build_adapter(apify_actor_instagram="apidojo/instagram-hashtag-scraper")


def test_collect_instagram_builds_actor_input_with_new_shape():
    """One run per collect call: startUrls (hashtag URLs derived from keywords),
    maxItems (per_keyword * n_hashtags), until (date floor), and both
    getReels/getPosts toggles enabled."""
    adapter = _build_ig_adapter()

    raw_calls: list[dict] = []

    def _capture_raw(platform, run_input):
        raw_calls.append(run_input)
        return []

    with patch.object(adapter, "_run_actor_collect_raw", side_effect=_capture_raw), \
         patch.object(adapter, "_parse_results", return_value=[]):
        adapter._collect_instagram({
            "keywords": ["climate", "sustainability"],
            "max_posts_per_keyword": 50,
            "time_range": {"start": "2026-04-28T00:00:00Z"},
        })

    assert len(raw_calls) == 1
    run_input = raw_calls[0]
    assert run_input["startUrls"] == [
        "https://www.instagram.com/explore/tags/climate/",
        "https://www.instagram.com/explore/tags/sustainability/",
    ]
    assert run_input["getReels"] is True
    assert run_input["getPosts"] is True
    assert run_input["maxItems"] == 100  # 50 * 2 hashtags
    assert run_input["until"] == "2026-04-28"
    # Legacy pass-mode flags must NOT leak into the new shape.
    assert "resultsType" not in run_input
    assert "resultsLimit" not in run_input
    assert "directUrls" not in run_input


def test_collect_instagram_warns_and_ignores_channel_urls():
    """The new actor only accepts hashtag URLs. channel_urls should be logged
    and ignored, not break the run, not be sent to the actor."""
    adapter = _build_ig_adapter()

    raw_calls: list[dict] = []
    with patch.object(adapter, "_run_actor_collect_raw", side_effect=lambda p, ri: raw_calls.append(ri) or []), \
         patch.object(adapter, "_parse_results", return_value=[]):
        adapter._collect_instagram({
            "keywords": ["climate"],
            "channel_urls": ["https://www.instagram.com/someprofile/"],
            "max_posts_per_keyword": 10,
        })

    assert len(raw_calls) == 1
    # Only the keyword-derived hashtag URL should be in startUrls.
    assert raw_calls[0]["startUrls"] == [
        "https://www.instagram.com/explore/tags/climate/"
    ]


def test_collect_instagram_skips_when_no_keywords():
    """Empty keywords short-circuits without spending an actor run, even when
    channel_urls is set (those are now ignored)."""
    adapter = _build_ig_adapter()
    with patch.object(adapter, "_run_actor_collect_raw") as raw, \
         patch.object(adapter, "_parse_results") as parse:
        result = adapter._collect_instagram({
            "keywords": [],
            "channel_urls": ["https://www.instagram.com/someprofile/"],
        })
    assert result == []
    raw.assert_not_called()
    parse.assert_not_called()


def test_collect_instagram_engagement_rerank_trims_and_reorders():
    """When _parse_results returns more posts than the per-keyword cap allows,
    they should be sorted by engagement score and trimmed to cap *
    n_keywords. The score is likes + 2*comments + 0.01*views."""
    from workers.collection.models import Batch, Channel, Post

    def _post(pid: str, likes: int, comments: int, views: int = 0, ch: str = "u1") -> Post:
        return Post(
            post_id=pid,
            platform="instagram",
            channel_handle=ch,
            channel_id=ch,
            title=None,
            content="",
            post_url=f"https://www.instagram.com/p/{pid}/",
            posted_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
            post_type="image",
            parent_post_id=None,
            media_urls=[],
            media_refs=[],
            likes=likes,
            shares=None,
            comments_count=comments,
            views=views,
            saves=None,
            comments=[],
            platform_metadata={},
            crawl_provider="apify",
        )

    adapter = _build_ig_adapter()

    # 4 posts with diverging scores; cap is 1 keyword * 2 = 2 posts -> top 2 wins.
    posts = [
        _post("low", likes=1, comments=0),                        # score 1
        _post("mid", likes=10, comments=2),                       # score 14
        _post("high", likes=5, comments=20),                      # score 45
        _post("viral", likes=2, comments=1, views=10000),         # score 104
    ]
    fake_channels = [Channel(channel_id="u1", platform="instagram", channel_handle="u1")]

    with patch.object(adapter, "_run_actor_collect_raw", return_value=[{"id": "ignored"}] * 4), \
         patch.object(adapter, "_parse_results", return_value=[Batch(posts=posts, channels=fake_channels)]):
        batches = adapter._collect_instagram({
            "keywords": ["climate"],
            "max_posts_per_keyword": 2,  # cap => 2 posts
        })

    surviving_ids = [p.post_id for b in batches for p in b.posts]
    assert surviving_ids == ["viral", "high"]


def test_collect_instagram_no_rerank_when_under_cap():
    """When _parse_results already returns fewer posts than the cap, the
    re-rank/trim path is skipped and original batches are returned."""
    from workers.collection.models import Batch, Post

    def _post(pid: str) -> Post:
        return Post(
            post_id=pid, platform="instagram", channel_handle="u",
            channel_id="u", title=None, content="",
            post_url=f"https://www.instagram.com/p/{pid}/",
            posted_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
            post_type="image", parent_post_id=None, media_urls=[],
            media_refs=[], likes=1, shares=None, comments_count=0,
            views=None, saves=None, comments=[], platform_metadata={},
            crawl_provider="apify",
        )

    adapter = _build_ig_adapter()
    original_batches = [Batch(posts=[_post("a"), _post("b")], channels=[])]

    with patch.object(adapter, "_run_actor_collect_raw", return_value=[]), \
         patch.object(adapter, "_parse_results", return_value=original_batches):
        batches = adapter._collect_instagram({
            "keywords": ["k1"],
            "max_posts_per_keyword": 50,  # cap > 2 posts
        })

    assert batches is original_batches
