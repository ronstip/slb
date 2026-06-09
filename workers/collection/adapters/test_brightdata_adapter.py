"""Unit tests for BrightDataAdapter channel-mode input shapes.

Mocks the BrightData client so tests run offline. Regression coverage for
YouTube channel collection, which must hit the POSTS dataset in URL-discovery
mode (discover_by="url") - NOT the profiles dataset, which returns only
channel metadata (zero videos).
"""

from unittest.mock import patch

from config.settings import Settings
from workers.collection.adapters.brightdata import BrightDataAdapter


def _settings_with_bd(**overrides) -> Settings:
    defaults = dict(
        gcp_project_id="test-project",
        brightdata_api_token="bd-token",
        brightdata_poll_max_wait_sec=60,
        brightdata_poll_initial_interval_sec=1,
        brightdata_max_snapshots_per_collection=20,
    )
    defaults.update(overrides)
    return Settings(**defaults)


def _build_adapter(**setting_overrides) -> BrightDataAdapter:
    settings = _settings_with_bd(**setting_overrides)
    with patch("workers.collection.adapters.brightdata.get_settings", return_value=settings), \
         patch("workers.collection.adapters.brightdata.BrightDataClient"):
        return BrightDataAdapter()


def test_youtube_channel_uses_posts_dataset_url_discovery():
    """YouTube channel collection must use the POSTS dataset with
    discover_by="url" (the profiles dataset returns only channel metadata, so
    it yields zero videos). The input carries the channel url + post budget,
    and must NOT carry start_date/end_date (URL discovery rejects them; the
    date window is enforced downstream)."""
    adapter = _build_adapter()

    captured: dict = {}

    def _fake_scrape_and_wait(*, dataset_id, inputs, **kwargs):
        captured["dataset_id"] = dataset_id
        captured["inputs"] = inputs
        captured["kwargs"] = kwargs
        return []

    adapter._client.scrape_and_wait = _fake_scrape_and_wait

    config = {
        "channel_urls": ["https://www.youtube.com/@NASA"],
        "time_range": {"start": "2026-03-10T00:00:00Z", "end": "2026-06-08T00:00:00Z"},
        "max_posts_per_keyword": 10,
    }
    list(adapter._collect_youtube_channels(config["channel_urls"], config))

    assert captured["dataset_id"] == BrightDataAdapter._DATASET_IDS["youtube"]["posts"]
    assert captured["kwargs"].get("discover_by") == "url"
    assert captured["inputs"] == [{"url": "https://www.youtube.com/@NASA", "num_of_posts": 10}]
    for forbidden in ("start_date", "end_date"):
        assert forbidden not in captured["inputs"][0]


def test_reddit_channel_normalizes_subreddit_inputs():
    """Reddit channel inputs may arrive as a full URL, an "r/name" handle (what
    the "reddit.com/r/name or name" placeholder invites), or a bare "name".
    All must resolve to a single, valid subreddit URL - "r/nba" must NOT become
    https://www.reddit.com/r/r/nba/ (double "r/" → invalid subreddit → 0 posts)."""
    adapter = _build_adapter()

    captured: dict = {}

    def _fake_scrape_and_wait(*, dataset_id, inputs, **kwargs):
        captured["dataset_id"] = dataset_id
        captured["inputs"] = inputs
        captured["kwargs"] = kwargs
        return []

    adapter._client.scrape_and_wait = _fake_scrape_and_wait

    config = {
        "channel_urls": ["r/nba", "nba", "https://www.reddit.com/r/nba/"],
        "time_range": {"start": "2026-05-10T00:00:00Z", "end": "2026-06-09T00:00:00Z"},
    }
    list(adapter._collect_reddit(config))

    assert captured["dataset_id"] == BrightDataAdapter._DATASET_IDS["reddit"]["posts"]
    assert captured["kwargs"].get("discover_by") == "subreddit_url"
    urls = [i["url"] for i in captured["inputs"]]
    assert all(u == "https://www.reddit.com/r/nba/" for u in urls), urls
