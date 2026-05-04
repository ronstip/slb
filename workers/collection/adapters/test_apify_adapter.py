"""Unit tests for ApifyAdapter.

Mocks the apify-client SDK so tests run offline. Verifies:
- Time-window gate drops out-of-range posts
- Run budget enforcement
- Memory cap guard at init time
- Parser registry init (fail-fast on unknown actor)
- _detect_platform_from_url
- date / hashtag-URL helpers
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

def test_collect_tiktok_omits_date_params_and_skips_time_gate():
    """TikTok must hit Top section with no server-side date params, and the
    client-side time gate must be disabled — otherwise we pay for posts we drop."""
    adapter = _build_adapter()
    captured: dict = {}

    def _capture(platform, run_input, config, *, apply_time_gate=True):
        captured["platform"] = platform
        captured["run_input"] = run_input
        captured["apply_time_gate"] = apply_time_gate
        return []

    with patch.object(adapter, "_run_and_parse", side_effect=_capture):
        adapter._collect_tiktok({
            "keywords": ["alo yoga"],
            "max_posts_per_keyword": 100,
            "time_range": {
                "start": "2026-04-26T00:00:00Z",
                "end": "2026-05-03T00:00:00Z",
            },
        })

    assert captured["platform"] == "tiktok"
    assert captured["apply_time_gate"] is False
    run_input = captured["run_input"]
    assert run_input["searchQueries"] == ["alo yoga"]
    assert run_input["resultsPerPage"] == 100
    # No server-side date filter (clockworks ignores these for searchQueries)
    assert "oldestPostDateUnified" not in run_input
    assert "newestPostDate" not in run_input
    # No section/sort overrides → defaults to Top section (relevance)
    assert "searchSection" not in run_input
    assert "searchSorting" not in run_input
