import logging

from config.settings import get_settings
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.adapters.brightdata import BrightDataAdapter
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
        self._vendor_config = self.config.get("vendor_config", {})

        if providers is not None:
            self._providers = providers
        elif settings.is_dev:
            self._providers = []
            # BrightData first — default for tiktok, youtube, reddit
            if settings.brightdata_api_token:
                try:
                    self._providers.append(BrightDataAdapter())
                    logger.info("BrightDataAdapter initialized (dev mode)")
                except ValueError:
                    logger.warning("BrightDataAdapter init failed, skipping")
            # Vetric second — handles instagram, twitter, and fallback
            try:
                self._providers.append(VetricAdapter())
                logger.info("VetricAdapter initialized (dev mode)")
            except ValueError:
                logger.info("VetricAdapter skipped (no API keys)")
            if not self._providers:
                self._providers = [MockAdapter()]
                logger.info("Using MockAdapter (dev mode, no API keys)")
        else:
            self._providers = []
            # BrightData first in production too
            if settings.brightdata_api_token:
                try:
                    self._providers.append(BrightDataAdapter())
                    logger.info("BrightDataAdapter initialized (production mode)")
                except ValueError:
                    logger.warning("BrightDataAdapter init failed, skipping")
            try:
                self._providers.append(VetricAdapter())
                logger.info("VetricAdapter initialized (production mode)")
            except ValueError:
                logger.info("VetricAdapter skipped (no API keys)")
            if not self._providers:
                raise RuntimeError("No data providers available — configure BRIGHTDATA_API_TOKEN or VETRIC_API_KEY_*")

    def _get_adapter(self, platform: str) -> DataProviderAdapter:
        """Select adapter based on vendor_config, then fallback to first match."""
        preferred = self._vendor_config.get("platform_overrides", {}).get(
            platform, self._vendor_config.get("default")
        )

        if preferred:
            vendor_class_map = {
                "vetric": VetricAdapter,
                "brightdata": BrightDataAdapter,
                "mock": MockAdapter,
            }
            target_class = vendor_class_map.get(preferred)
            if target_class:
                for provider in self._providers:
                    if isinstance(provider, target_class) and platform in provider.supported_platforms():
                        return provider

        # Fallback: first adapter that supports this platform (backward compatible)
        for provider in self._providers:
            if platform in provider.supported_platforms():
                return provider
        raise ValueError(f"No adapter supports platform: {platform}")

    def collect_all(self) -> list[Batch]:
        """Collect from all platforms, routing each to its assigned adapter."""
        # Group platforms by their resolved adapter
        adapter_platforms: dict[int, tuple[DataProviderAdapter, list[str]]] = {}

        for platform in self.config.get("platforms", []):
            try:
                adapter = self._get_adapter(platform)
            except ValueError as e:
                logger.warning("Skipping platform %s: %s", platform, e)
                continue

            key = id(adapter)
            if key not in adapter_platforms:
                adapter_platforms[key] = (adapter, [])
            adapter_platforms[key][1].append(platform)

        # Call collect() once per adapter with only its assigned platforms
        all_batches: list[Batch] = []
        for adapter, platforms in adapter_platforms.values():
            sub_config = dict(self.config)
            sub_config["platforms"] = platforms
            logger.info("Collecting via %s for platforms: %s", type(adapter).__name__, platforms)
            all_batches.extend(adapter.collect(sub_config))

        if not all_batches:
            errors = self.get_collection_errors()
            stats = self.get_platform_stats()
            logger.error(
                "collect_all() returned 0 batches. Platform stats: %s, Errors: %s",
                stats, errors,
            )

        return all_batches

    def get_collection_errors(self) -> list[dict]:
        """Return any errors encountered during the last collect_all() call."""
        errors: list[dict] = []
        for provider in self._providers:
            if hasattr(provider, "collection_errors"):
                errors.extend(provider.collection_errors)
        return errors

    def get_platform_stats(self) -> dict[str, dict]:
        """Return per-platform collection stats from the last collect_all() call."""
        stats: dict[str, dict] = {}
        for provider in self._providers:
            if hasattr(provider, "platform_stats"):
                stats.update(provider.platform_stats)
        return stats

    def fetch_engagements(self, platform: str, post_urls: list[str]) -> list[dict]:
        adapter = self._get_adapter(platform)
        return adapter.fetch_engagements(post_urls)
