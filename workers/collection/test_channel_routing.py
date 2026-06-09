"""Channel-mode routing tests for DataProviderWrapper.

Construct the wrapper with an explicit (empty) providers list so it skips real
adapter init - we only exercise `_resolve_preferred_vendor` (vendor selection),
which needs no live adapter.
"""

import types

import pytest

import workers.collection.wrapper as wmod
from workers.collection.wrapper import DataProviderWrapper


@pytest.fixture(autouse=True)
def _no_env_vendor_defaults(monkeypatch):
    """Neutralize DEFAULT_VENDOR_* env so routing assertions don't depend on the
    dev environment's vendor defaults. A bare namespace makes
    getattr(settings, "default_vendor_<p>", "") return "" for every platform."""
    monkeypatch.setattr(wmod, "get_settings", lambda: types.SimpleNamespace())


def _wrapper(config: dict) -> DataProviderWrapper:
    return DataProviderWrapper(providers=[], config=config)


# ── routing ───────────────────────────────────────────────────────────


def test_channel_mode_routes_to_channel_provider():
    w = _wrapper({"channel_urls": ["espn"], "platforms": ["tiktok"]})
    assert w._resolve_preferred_vendor("tiktok") == "apify"
    assert w._resolve_preferred_vendor("instagram") == "apify"
    assert w._resolve_preferred_vendor("youtube") == "brightdata"
    assert w._resolve_preferred_vendor("facebook") == "apify"
    assert w._resolve_preferred_vendor("reddit") == "brightdata"
    assert w._resolve_preferred_vendor("twitter") == "xapi"


def test_keyword_mode_does_not_force_channel_provider():
    # No channel_urls → instagram has no env default → no forced vendor.
    w = _wrapper({"platforms": ["instagram"]})
    assert w._resolve_preferred_vendor("instagram") is None


def test_explicit_user_override_wins_over_channel_routing():
    w = _wrapper({
        "channel_urls": ["espn"],
        "platforms": ["tiktok"],
        "vendor_config": {"platform_overrides": {"tiktok": "brightdata"}},
    })
    assert w._resolve_preferred_vendor("tiktok") == "brightdata"
