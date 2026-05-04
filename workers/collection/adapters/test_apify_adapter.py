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
        adapter._collect_tiktok({
            "keywords": ["alo yoga", "lululemon", "athleta"],
            "max_posts_per_keyword": 100,
            "time_range": {
                "start": "2026-04-26T00:00:00Z",
                "end": "2026-05-03T00:00:00Z",
            },
        })

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
        adapter._collect_facebook({
            "keywords": ["alo yoga", "lululemon"],
            "max_posts_per_keyword": 25,
            "time_range": {
                "start": "2026-04-26T00:00:00Z",
                "end": "2026-05-03T00:00:00Z",
            },
        })

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
        adapter._collect_facebook({
            "keywords": ["x"],
            "max_posts_per_keyword": 800,  # 1.5x = 1200, must clamp to 1000
        })

    assert captured[0]["max_results"] == 1000


# ---------------------------------------------------------------------------
# Instagram hybrid details + posts pass
# ---------------------------------------------------------------------------

def test_collect_instagram_skips_details_pass_by_default():
    """Details pass is gated off until session cookies are wired up — without
    auth it returns an empty wrapper, so we'd burn one Apify run for 0 posts.
    Only the posts pass should fire."""
    adapter = _build_adapter()
    assert adapter._IG_DETAILS_PASS_ENABLED is False  # default state

    raw_calls: list[dict] = []
    parsed_args: dict = {}

    def _capture_raw(platform, run_input):
        raw_calls.append(run_input)
        return [{"id": "p1"}, {"id": "p2"}]

    def _capture_parse(platform, raw_items, config, *, apply_time_gate=True):
        parsed_args["raw_items"] = raw_items
        return []

    with patch.object(adapter, "_run_actor_collect_raw", side_effect=_capture_raw), \
         patch.object(adapter, "_parse_results", side_effect=_capture_parse):
        adapter._collect_instagram({
            "keywords": ["photography"],
            "max_posts_per_keyword": 10,
        })

    assert len(raw_calls) == 1
    assert raw_calls[0]["resultsType"] == "posts"
    # 1.3x buffer on 10 → 13
    assert raw_calls[0]["resultsLimit"] == 13


def test_collect_instagram_runs_hybrid_when_details_enabled():
    """When details pass is enabled (cookies/auth would be in place), run
    BOTH details (top + recent) and posts (chronological breadth) and merge
    raw items so dedupe runs once via _parse_results before posts reach
    enrichment."""
    adapter = _build_adapter()
    # Force-enable details for this test only; default is False.
    adapter._IG_DETAILS_PASS_ENABLED = True

    raw_calls: list[dict] = []
    parsed_args: dict = {}

    def _capture_raw(platform, run_input):
        raw_calls.append(run_input)
        if run_input.get("resultsType") == "details":
            return [{
                "topPosts": [{"id": "t1"}, {"id": "shared"}],
                "latestPosts": [{"id": "l1"}],
            }]
        return [{"id": "p1"}, {"id": "shared"}, {"id": "p2"}]

    def _capture_parse(platform, raw_items, config, *, apply_time_gate=True):
        parsed_args["raw_items"] = raw_items
        return []

    with patch.object(adapter, "_run_actor_collect_raw", side_effect=_capture_raw), \
         patch.object(adapter, "_parse_results", side_effect=_capture_parse):
        adapter._collect_instagram({
            "keywords": ["photography"],
            "max_posts_per_keyword": 50,  # > 18 → triggers hybrid
        })

    assert len(raw_calls) == 2
    types = {c["resultsType"] for c in raw_calls}
    assert types == {"details", "posts"}
    posts_call = next(c for c in raw_calls if c["resultsType"] == "posts")
    assert posts_call["resultsLimit"] == 65  # ceil(50 * 1.3)

    # Details items must come BEFORE posts items in the merged list, so
    # dedupe in _parse_results keeps the engagement-rich top-posts version.
    ids_in_order = [i["id"] for i in parsed_args["raw_items"]]
    assert ids_in_order.index("shared") < ids_in_order.index("p1")
    assert {"t1", "l1", "shared", "p1", "p2"} <= set(ids_in_order)


def test_collect_instagram_details_only_when_budget_fits_and_enabled():
    """With details enabled AND budget within the cap, posts pass is skipped."""
    adapter = _build_adapter()
    adapter._IG_DETAILS_PASS_ENABLED = True

    raw_calls: list[dict] = []

    def _capture_raw(platform, run_input):
        raw_calls.append(run_input)
        return [{"topPosts": [{"id": "t1"}], "latestPosts": [{"id": "l1"}]}]

    with patch.object(adapter, "_run_actor_collect_raw", side_effect=_capture_raw), \
         patch.object(adapter, "_parse_results", return_value=[]):
        adapter._collect_instagram({
            "keywords": ["photography"],
            "max_posts_per_keyword": 10,  # ≤ 18 details cap → no posts pass
        })

    assert len(raw_calls) == 1
    assert raw_calls[0]["resultsType"] == "details"


def test_collect_instagram_skips_when_no_inputs():
    adapter = _build_adapter()
    with patch.object(adapter, "_run_actor_collect_raw") as raw, \
         patch.object(adapter, "_parse_results") as parse:
        result = adapter._collect_instagram({"keywords": [], "channel_urls": []})
    assert result == []
    raw.assert_not_called()
    parse.assert_not_called()
