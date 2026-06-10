"""Provider-routing tests for DataProviderWrapper (keyword + channel + URL modes).

`_resolve_preferred_vendor` is exercised with an empty providers list (vendor
selection needs no live adapter). `_get_adapter` / `fetch_engagements` use light
fake adapters to verify the URL-capability guard keeps keyword-only providers
(HikerAPI) off URL-based work.
"""

import types

import pytest

import config.collection_routing as routing
import workers.collection.wrapper as wmod
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.wrapper import DataProviderWrapper


@pytest.fixture(autouse=True)
def _no_env_vendor_defaults(monkeypatch):
    """Neutralize DEFAULT_VENDOR_* env so routing assertions don't depend on the
    dev environment's vendor defaults, and force the routing config to the code
    seeds (no Firestore read) with a clean per-test cache."""
    monkeypatch.setattr(wmod, "get_settings", lambda: types.SimpleNamespace())
    monkeypatch.setattr(routing, "_load_routing_doc", lambda: {})
    routing.invalidate_routing_cache()
    yield
    routing.invalidate_routing_cache()


def _wrapper(config: dict, providers=None) -> DataProviderWrapper:
    return DataProviderWrapper(providers=providers if providers is not None else [], config=config)


class _FakeAdapter(DataProviderAdapter):
    """Minimal adapter for routing tests; records fetch_engagements calls."""

    def __init__(self, platforms, url_platforms=None):
        self._platforms = platforms
        self._url_platforms = platforms if url_platforms is None else url_platforms
        self.engagements_called = False

    def collect(self, config):
        return []

    def fetch_engagements(self, post_urls):
        self.engagements_called = True
        return [{"post_url": u} for u in post_urls]

    def fetch_comments(self, post):
        raise NotImplementedError

    def supported_platforms(self):
        return list(self._platforms)

    def supported_url_platforms(self):
        return list(self._url_platforms)


# ── keyword-mode routing ──────────────────────────────────────────────


def test_keyword_mode_instagram_routes_to_hikerapi():
    # New default: IG keyword collection → hikerapi (seed in collection_routing).
    w = _wrapper({"platforms": ["instagram"]})
    assert w._resolve_preferred_vendor("instagram") == "hikerapi"


def test_keyword_mode_every_platform_has_explicit_provider():
    # Every known platform is seeded explicitly (no "Auto" in the editor).
    w = _wrapper({"platforms": ["instagram"]})
    assert w._resolve_preferred_vendor("tiktok") == "apify"
    assert w._resolve_preferred_vendor("twitter") == "xapi"
    assert w._resolve_preferred_vendor("facebook") == "apify"
    assert w._resolve_preferred_vendor("youtube") == "brightdata"
    assert w._resolve_preferred_vendor("reddit") == "brightdata"


def test_keyword_mode_unknown_platform_has_no_forced_vendor():
    # A platform with no seed + no env default → None (first-supporting).
    w = _wrapper({"platforms": ["snapchat"]})
    assert w._resolve_preferred_vendor("snapchat") is None


def test_keyword_routing_admin_override_flips_provider(monkeypatch):
    monkeypatch.setattr(
        routing, "_load_routing_doc",
        lambda: {"keyword_provider_by_platform": {"instagram": "apify"}},
    )
    routing.invalidate_routing_cache()
    w = _wrapper({"platforms": ["instagram"]})
    assert w._resolve_preferred_vendor("instagram") == "apify"


# ── channel-mode routing ──────────────────────────────────────────────


def test_channel_mode_routes_to_channel_provider():
    w = _wrapper({"channel_urls": ["espn"], "platforms": ["tiktok"]})
    assert w._resolve_preferred_vendor("tiktok") == "apify"
    # IG channel collection stays on apify even though keyword default is hiker.
    assert w._resolve_preferred_vendor("instagram") == "apify"
    assert w._resolve_preferred_vendor("youtube") == "brightdata"
    assert w._resolve_preferred_vendor("facebook") == "apify"
    assert w._resolve_preferred_vendor("reddit") == "brightdata"
    assert w._resolve_preferred_vendor("twitter") == "xapi"


def test_explicit_user_override_wins_over_routing():
    w = _wrapper({
        "channel_urls": ["espn"],
        "platforms": ["tiktok"],
        "vendor_config": {"platform_overrides": {"tiktok": "brightdata"}},
    })
    assert w._resolve_preferred_vendor("tiktok") == "brightdata"


# ── URL-mode guard (post_urls + engagement refresh skip keyword-only) ──


def test_post_urls_mode_skips_keyword_only_provider():
    # IG keyword pref = hiker (keyword-only); url mode must skip to apify.
    hiker = _FakeAdapter(["instagram"], url_platforms=[])
    apify = _FakeAdapter(["instagram"])
    w = _wrapper(
        {"platforms": ["instagram"], "post_urls": ["https://www.instagram.com/p/C1/"]},
        providers=[apify, hiker],
    )
    assert w._get_adapter("instagram") is apify


def test_fetch_engagements_skips_keyword_only_provider():
    hiker = _FakeAdapter(["instagram"], url_platforms=[])
    apify = _FakeAdapter(["instagram"])
    # hiker ships first, but it's not URL-capable → refresh routes to apify.
    w = _wrapper({}, providers=[hiker, apify])
    w.fetch_engagements("instagram", ["https://www.instagram.com/p/C1/"])
    assert apify.engagements_called
    assert not hiker.engagements_called


def test_fetch_engagements_facebook_unchanged_first_supporting():
    # FB has no keyword seed → preferred None → first URL-capable supporting wins.
    # brightdata ships before apify, so FB refresh stays on brightdata.
    brightdata = _FakeAdapter(["facebook", "reddit", "youtube"])
    apify = _FakeAdapter(["facebook", "instagram", "tiktok"])
    w = _wrapper({}, providers=[brightdata, apify])
    w.fetch_engagements("facebook", ["https://www.facebook.com/x/posts/1"])
    assert brightdata.engagements_called
    assert not apify.engagements_called
