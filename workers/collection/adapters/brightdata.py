from collections.abc import Iterator

from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.models import Batch


class BrightDataAdapter(DataProviderAdapter):
    """Wraps BrightData's web scraping API.

    Supports: Instagram, TikTok, Reddit, Twitter/X, YouTube.
    Not yet implemented — stub only.
    """

    def supported_platforms(self) -> list[str]:
        return ["instagram", "tiktok", "reddit", "twitter", "youtube"]

    def collect(self, config: dict) -> Iterator[Batch]:
        raise NotImplementedError("BrightData integration not yet implemented")

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        raise NotImplementedError("BrightData engagement refresh not yet implemented")
