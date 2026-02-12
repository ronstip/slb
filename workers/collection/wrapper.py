import logging
from collections.abc import Iterator

from config.settings import get_settings
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.adapters.mock_adapter import MockAdapter
from workers.collection.adapters.vetric import VetricAdapter
from workers.collection.models import Batch

logger = logging.getLogger(__name__)


class DataProviderWrapper:
    """Single entry point for data collection. Routes to correct adapter per platform."""

    def __init__(
        self,
        providers: list[DataProviderAdapter] | None = None,
        config: dict | None = None,
    ):
        settings = get_settings()
        self.config = config or {}

        if providers is not None:
            self._providers = providers
        elif settings.is_dev:
            try:
                self._providers = [VetricAdapter()]
                logger.info("Using VetricAdapter (dev mode, API keys found)")
            except ValueError:
                self._providers = [MockAdapter()]
                logger.info("Using MockAdapter (dev mode, no API keys)")
        else:
            self._providers = [VetricAdapter()]
            logger.info("Using VetricAdapter (production mode)")

    def _get_adapter(self, platform: str) -> DataProviderAdapter:
        for provider in self._providers:
            if platform in provider.supported_platforms():
                return provider
        raise ValueError(f"No adapter supports platform: {platform}")

    def collect_all(self) -> Iterator[Batch]:
        platforms = self.config.get("platforms", [])
        for platform in platforms:
            try:
                adapter = self._get_adapter(platform)
                logger.info("Collecting from %s via %s", platform, type(adapter).__name__)
                for batch in adapter.collect(self.config):
                    yield batch
            except ValueError as e:
                logger.warning("Skipping platform %s: %s", platform, e)

    def fetch_engagements(self, platform: str, post_urls: list[str]) -> list[dict]:
        adapter = self._get_adapter(platform)
        return adapter.fetch_engagements(post_urls)
