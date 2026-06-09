"""Channel-mode behavior of collection_service.estimate_request_micros.

Verifies that a channel collection (a request carrying channel_urls) is priced
in channel mode and routed to the SAME provider the worker will use
(config.collection_routing.CHANNEL_PROVIDER_BY_PLATFORM), so the pre-flight
estimate and live billing stay aligned.
"""

from __future__ import annotations

import pytest

from api.schemas.requests import CreateCollectionRequest
from api.services import collection_service as cs


@pytest.fixture()
def capture_estimate(monkeypatch):
    captured: dict = {}

    def _fake(**kwargs):
        captured.clear()
        captured.update(kwargs)
        return 4242

    monkeypatch.setattr(cs, "estimate_run_cost_micros", _fake)
    return captured


def _req(**over) -> CreateCollectionRequest:
    base = dict(description="d", platforms=["tiktok"], keywords=[], n_posts=100)
    base.update(over)
    return CreateCollectionRequest(**base)


def test_channel_request_prices_in_channel_mode(capture_estimate):
    out = cs.estimate_request_micros(_req(channel_urls=["espn"]))
    assert out == 4242
    assert capture_estimate["channel_mode"] is True
    assert capture_estimate["n_posts"] == 100
    assert capture_estimate["provider_platform_pairs"] == [("apify", "tiktok")]


def test_channel_request_maps_each_platform_to_channel_provider(capture_estimate):
    cs.estimate_request_micros(
        _req(platforms=["youtube", "facebook", "twitter"], channel_urls=["espn"])
    )
    assert capture_estimate["provider_platform_pairs"] == [
        ("brightdata", "youtube"),
        ("apify", "facebook"),  # FB channel now collects via apify/facebook-posts-scraper
        ("x_api", "twitter"),  # "xapi" token translated to the cost-rate key
    ]


def test_keyword_request_is_not_channel_mode(capture_estimate):
    cs.estimate_request_micros(_req(keywords=["lakers"]))  # no channel_urls
    assert capture_estimate.get("channel_mode") in (None, False)
