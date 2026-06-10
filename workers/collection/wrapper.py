import logging
import queue
import threading
from collections.abc import Iterator

from config.settings import get_settings
from workers.collection.adapters.apify import ApifyAdapter
from workers.collection.adapters.base import DataProviderAdapter
from workers.collection.adapters.brightdata import BrightDataAdapter
from workers.collection.adapters.hikerapi import HikerAPIAdapter
from workers.collection.adapters.mock_adapter import MockAdapter
from workers.collection.adapters.vetric import VetricAdapter
from workers.collection.adapters.x_api import XAPIAdapter
from workers.collection.models import Batch, CommentBatch

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
        else:
            self._providers = []
            mode = "dev" if settings.is_dev else "production"
            # BrightData first - default for youtube, reddit, facebook (tiktok now routes to Apify)
            if settings.brightdata_api_token:
                try:
                    self._providers.append(BrightDataAdapter(snapshot_tracker=snapshot_tracker, max_snapshots=max_snapshots))
                    logger.info("BrightDataAdapter initialized (%s mode)", mode)
                except ValueError:
                    logger.warning("BrightDataAdapter init failed, skipping")
            # X API - official vendor; default for twitter via fallback ordering
            if settings.x_api_bearer_token:
                try:
                    self._providers.append(XAPIAdapter())
                    logger.info("XAPIAdapter initialized (%s mode)", mode)
                except ValueError:
                    logger.info("XAPIAdapter skipped (no bearer token)")
            # Vetric - handles instagram and acts as twitter fallback when overridden
            try:
                self._providers.append(VetricAdapter())
                logger.info("VetricAdapter initialized (%s mode)", mode)
            except ValueError:
                logger.info("VetricAdapter skipped (no API keys)")
            # Apify - ships AFTER Vetric so the natural first-supporting fallback
            # keeps existing IG/FB routing on Vetric/BrightData. TikTok defaults
            # to Apify via DEFAULT_VENDOR_TIKTOK; other platforms only select
            # Apify when env or per-collection vendor_config names "apify".
            if settings.apify_api_token:
                try:
                    self._providers.append(ApifyAdapter())
                    logger.info("ApifyAdapter initialized (%s mode)", mode)
                except ValueError as e:
                    logger.warning("ApifyAdapter init failed, skipping: %s", e)
            # HikerAPI - Instagram keyword (reels SERP) provider. Ships AFTER
            # Apify so the first-supporting fallback still prefers Apify; hiker
            # is selected only when routing explicitly names it (default for IG
            # keyword via config/collection_routing.py). Keyword-only - the
            # wrapper keeps URL-based work off it via supported_url_platforms().
            if settings.hikerapi_api_key:
                try:
                    self._providers.append(HikerAPIAdapter())
                    logger.info("HikerAPIAdapter initialized (%s mode)", mode)
                except ValueError as e:
                    logger.warning("HikerAPIAdapter init failed, skipping: %s", e)
            if not self._providers:
                if settings.is_dev:
                    self._providers = [MockAdapter()]
                    logger.info("Using MockAdapter (dev mode, no API keys)")
                else:
                    raise RuntimeError(
                        "No data providers available - configure BRIGHTDATA_API_TOKEN, "
                        "X_API_BEARER_TOKEN, VETRIC_API_KEY_*, or APIFY_API_TOKEN"
                    )

    _VENDOR_CLASS_MAP: dict[str, type[DataProviderAdapter]] = {
        "vetric": VetricAdapter,
        "brightdata": BrightDataAdapter,
        "xapi": XAPIAdapter,
        "apify": ApifyAdapter,
        "hikerapi": HikerAPIAdapter,
        "mock": MockAdapter,
    }

    def _resolve_preferred_vendor(self, platform: str) -> str | None:
        """Vendor selection precedence (highest to lowest):
        1. Per-collection `vendor_config.platform_overrides[platform]` (explicit user choice)
        2. Channel mode (`config.channel_urls` present) → `channel_provider_for`
           (admin-editable; channel collection uses a different API/actor than
           keyword search for some platforms).
        3. Keyword mode → `keyword_provider_for` (admin-editable; itself falls
           back to the env `DEFAULT_VENDOR_<PLATFORM>` seed).
        4. Per-collection `vendor_config.default`
        5. None - caller falls back to first-supporting adapter

        Both (2) and (3) read `config.collection_routing`, which deep-merges the
        admin-editable `app_config/routing` Firestore doc over the code seeds -
        so a provider can be switched per (platform, intent) without a redeploy.
        """
        override = self._vendor_config.get("platform_overrides", {}).get(platform)
        if override:
            return override

        from config.collection_routing import channel_provider_for, keyword_provider_for

        if self.config.get("channel_urls"):
            channel_vendor = channel_provider_for(platform)
            if channel_vendor:
                return channel_vendor
        else:
            keyword_vendor = keyword_provider_for(platform)
            if keyword_vendor:
                return keyword_vendor

        return self._vendor_config.get("default")

    def _get_adapter(self, platform: str) -> DataProviderAdapter:
        """Select adapter using the layered precedence. If the preferred vendor
        was requested but is not initialized (e.g. missing API token), log a
        warning and fall through to first-supporting so the crawl still runs.

        URL mode: when the collection fetches specific posts by URL
        (`config.post_urls`), keyword-only providers (whose
        `supported_url_platforms()` excludes this platform - e.g. HikerAPI's
        reels SERP) can't resolve a post URL, so they're skipped in favour of a
        URL-capable adapter (e.g. Apify, which handles IG directUrls)."""
        url_mode = bool(self.config.get("post_urls"))

        def _supports(provider: DataProviderAdapter) -> bool:
            if url_mode:
                return platform in provider.supported_url_platforms()
            return platform in provider.supported_platforms()

        preferred = self._resolve_preferred_vendor(platform)

        if preferred:
            target_class = self._VENDOR_CLASS_MAP.get(preferred)
            if target_class:
                for provider in self._providers:
                    if isinstance(provider, target_class) and _supports(provider):
                        return provider
                logger.warning(
                    "Preferred vendor %r for platform %r is not initialized or "
                    "can't serve this mode - falling back to first-supporting adapter",
                    preferred, platform,
                )
            else:
                logger.warning(
                    "Unknown preferred vendor %r for platform %r - falling back",
                    preferred, platform,
                )

        # Fallback: first adapter that supports this platform (and mode).
        for provider in self._providers:
            if _supports(provider):
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
            # Nothing to parallelize - avoid the queue overhead.
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

    _FUNNEL_KEYS = (
        # BrightData funnel
        "bd_raw_records", "bd_error_items_filtered", "bd_cross_keyword_dedup",
        "bd_parse_failures", "bd_empty_post_id", "bd_valid_posts",
        # Apify funnel
        "apify_runs_triggered", "apify_runs_succeeded", "apify_runs_failed",
        "apify_runs_budget_exhausted", "apify_raw_records",
        "apify_filtered_by_time_window", "apify_parse_failures", "apify_valid_posts",
        # HikerAPI funnel (billed per REQUEST; raw_media = extracted IG media objects)
        "hiker_requests", "hiker_raw_media", "hiker_duplicates",
        "hiker_parse_failures", "hiker_valid_posts",
    )

    def get_funnel_stats(self) -> dict:
        """Return aggregated post funnel stats from all providers."""
        combined: dict = {key: 0 for key in self._FUNNEL_KEYS}
        combined["per_platform"] = {}
        for provider in self._providers:
            if not hasattr(provider, "funnel_stats"):
                continue
            pf = provider.funnel_stats
            for key in self._FUNNEL_KEYS:
                if key in pf:
                    combined[key] += pf.get(key, 0)
            for platform, pstats in pf.get("per_platform", {}).items():
                combined["per_platform"][platform] = pstats
        return combined

    def fetch_engagements(self, platform: str, post_urls: list[str]) -> list[dict]:
        """Route engagement refresh (a URL-based op) to a URL-capable adapter.

        Mirrors `fetch_comments` routing: the preferred vendor is used only if
        it can serve URL-based work for the platform (`supported_url_platforms`),
        else the first URL-capable supporting adapter. This keeps refresh off
        keyword-only providers (HikerAPI) - so e.g. IG posts collected via hiker
        still refresh via Apify by their canonical /p/{code}/ URLs - while every
        other platform keeps today's resolution.
        """
        preferred = self._resolve_preferred_vendor(platform)
        if preferred:
            target_class = self._VENDOR_CLASS_MAP.get(preferred)
            if target_class:
                for provider in self._providers:
                    if (
                        isinstance(provider, target_class)
                        and platform in provider.supported_url_platforms()
                    ):
                        return provider.fetch_engagements(post_urls)
        for provider in self._providers:
            if platform in provider.supported_url_platforms():
                return provider.fetch_engagements(post_urls)
        raise ValueError(f"No adapter supports URL fetch for platform: {platform}")

    def fetch_comments(self, platform: str, post: dict) -> CommentBatch:
        """Route to the first provider whose `supported_comment_platforms`
        includes this platform.

        Comments routing is *separate* from post-collection routing: e.g.
        Instagram posts collect via Vetric (first-supporting in provider
        order), but Vetric exposes no comments endpoint, so a comments call
        skips past Vetric to Apify. The standard vendor-precedence (env /
        per-collection overrides) still applies as a first pass when the
        named vendor explicitly supports comments for the platform.
        """
        preferred = self._resolve_preferred_vendor(platform)
        if preferred:
            target_class = self._VENDOR_CLASS_MAP.get(preferred)
            if target_class:
                for provider in self._providers:
                    if (
                        isinstance(provider, target_class)
                        and platform in provider.supported_comment_platforms()
                    ):
                        return provider.fetch_comments(post)
        for provider in self._providers:
            if platform in provider.supported_comment_platforms():
                return provider.fetch_comments(post)
        raise ValueError(f"No adapter supports comments for platform: {platform}")
