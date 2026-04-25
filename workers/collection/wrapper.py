import logging
import queue
import threading
from collections.abc import Iterator

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
        snapshot_tracker: "callable | None" = None,
        max_snapshots: int = 0,
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
                    self._providers.append(BrightDataAdapter(snapshot_tracker=snapshot_tracker, max_snapshots=max_snapshots))
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
                    self._providers.append(BrightDataAdapter(snapshot_tracker=snapshot_tracker, max_snapshots=max_snapshots))
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

    def _resolve_adapter_platforms(self) -> dict[int, tuple[DataProviderAdapter, list[str]]]:
        """Group requested platforms by the adapter that handles them."""
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
        return adapter_platforms

    def collect_all(self) -> Iterator[Batch]:
        """Collect from all platforms, yielding batches as they arrive from each adapter."""
        adapter_platforms = self._resolve_adapter_platforms()

        # Call collect() once per adapter with only its assigned platforms
        for adapter, platforms in adapter_platforms.values():
            sub_config = dict(self.config)
            sub_config["platforms"] = platforms
            logger.info("Collecting via %s for platforms: %s", type(adapter).__name__, platforms)
            yield from adapter.collect(sub_config)

    def collect_all_parallel(self) -> Iterator[Batch]:
        """Fan adapters across threads; yield batches in whatever order they arrive.

        Cuts multi-provider crawl wall-time from sum(adapter_times) to
        max(adapter_times). Snapshot budgets are per-adapter, so fan-out
        introduces no cross-adapter contention.
        """
        adapter_platforms = self._resolve_adapter_platforms()
        if len(adapter_platforms) <= 1:
            # Nothing to parallelize — avoid the queue overhead.
            yield from self.collect_all()
            return

        batch_queue: queue.Queue[Batch | object] = queue.Queue(maxsize=64)
        SENTINEL = object()

        def _run_adapter(adapter: DataProviderAdapter, platforms: list[str]) -> None:
            sub_config = dict(self.config)
            sub_config["platforms"] = platforms
            logger.info(
                "Collecting (parallel) via %s for platforms: %s",
                type(adapter).__name__, platforms,
            )
            try:
                for batch in adapter.collect(sub_config):
                    batch_queue.put(batch)
            except Exception:
                logger.exception(
                    "Adapter %s crashed during parallel collect", type(adapter).__name__,
                )
            finally:
                batch_queue.put(SENTINEL)

        threads: list[threading.Thread] = []
        for adapter, platforms in adapter_platforms.values():
            t = threading.Thread(
                target=_run_adapter, args=(adapter, platforms),
                daemon=True, name=f"adapter-{type(adapter).__name__}",
            )
            t.start()
            threads.append(t)

        remaining = len(threads)
        while remaining > 0:
            item = batch_queue.get()
            if item is SENTINEL:
                remaining -= 1
                continue
            yield item  # type: ignore[misc]

        for t in threads:
            t.join(timeout=5)

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

    def get_funnel_stats(self) -> dict:
        """Return aggregated post funnel stats from all providers."""
        combined: dict = {
            "bd_raw_records": 0,
            "bd_error_items_filtered": 0,
            "bd_cross_keyword_dedup": 0,
            "bd_parse_failures": 0,
            "bd_empty_post_id": 0,
            "bd_valid_posts": 0,
            "per_platform": {},
        }
        for provider in self._providers:
            if not hasattr(provider, "funnel_stats"):
                continue
            pf = provider.funnel_stats
            for key in ("bd_raw_records", "bd_error_items_filtered",
                        "bd_cross_keyword_dedup", "bd_parse_failures",
                        "bd_empty_post_id", "bd_valid_posts"):
                combined[key] = combined.get(key, 0) + pf.get(key, 0)
            for platform, pstats in pf.get("per_platform", {}).items():
                combined["per_platform"][platform] = pstats
        return combined

    def fetch_engagements(self, platform: str, post_urls: list[str]) -> list[dict]:
        adapter = self._get_adapter(platform)
        return adapter.fetch_engagements(post_urls)
