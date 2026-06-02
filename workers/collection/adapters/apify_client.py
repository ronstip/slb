"""Thin wrapper around the apify-client Python SDK.

Responsibilities:
- Hold a single ApifyClient instance (auth + connection reuse).
- Run an actor synchronously (start → wait → fetch dataset) and yield items.
- Translate Apify run statuses into success / failure / timeout outcomes -
  ActorClient.call() does not raise on actor FAILED/TIMED-OUT/ABORTED, it just
  returns the run dict, so callers must inspect the status explicitly.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any

from apify_client import ApifyClient

logger = logging.getLogger(__name__)


class ApifyAPIError(Exception):
    """Raised when an Apify actor run does not reach SUCCEEDED status."""

    def __init__(self, status: str, run_id: str, actor_id: str, message: str = ""):
        self.status = status
        self.run_id = run_id
        self.actor_id = actor_id
        super().__init__(
            f"Apify actor {actor_id} run {run_id} ended with status={status}"
            + (f": {message}" if message else "")
        )


class ApifyAdapterClient:
    """Wraps apify-client with status-aware run + dataset retrieval."""

    def __init__(self, api_token: str):
        if not api_token:
            raise ValueError("APIFY_API_TOKEN not configured")
        self._client = ApifyClient(api_token)

    def run_actor(
        self,
        actor_id: str,
        run_input: dict,
        *,
        timeout_secs: int,
        memory_mbytes: int,
        build: str = "",
        wait_secs: int | None = None,
    ) -> dict:
        """Start an actor, block until it finishes (or timeout_secs elapses),
        return the final run dict. Raises ApifyAPIError if the run did not
        reach SUCCEEDED.

        Apify computes run cost = memory_mbytes/1024 * runtime_hours. Pass
        timeout_secs so Apify itself aborts overrunning runs server-side.
        """
        call_kwargs: dict[str, Any] = {
            "run_input": run_input,
            "timeout_secs": timeout_secs,
            "memory_mbytes": memory_mbytes,
        }
        if build:
            call_kwargs["build"] = build
        if wait_secs is not None:
            call_kwargs["wait_secs"] = wait_secs

        logger.info(
            "Apify run starting: actor=%s memory_mb=%d timeout_s=%d input_keys=%s",
            actor_id, memory_mbytes, timeout_secs, list(run_input.keys()),
        )

        run = self._client.actor(actor_id).call(**call_kwargs)
        if run is None:
            raise ApifyAPIError("UNKNOWN", "", actor_id, "call() returned None")

        status = run.get("status", "UNKNOWN")
        run_id = run.get("id", "")
        if status != "SUCCEEDED":
            # Pull stats so callers can distinguish "actor crashed" from
            # "ran fine but timed out client-side".
            stats = run.get("stats", {}) or {}
            raise ApifyAPIError(
                status, run_id, actor_id,
                message=f"stats={stats!r}",
            )

        logger.info(
            "Apify run finished: actor=%s run_id=%s status=%s dataset=%s",
            actor_id, run_id, status, run.get("defaultDatasetId"),
        )
        return run

    def iter_dataset_items(self, dataset_id: str) -> Iterator[dict]:
        """Yield items from a dataset. Wraps SDK's iterate_items, which is a
        paginated generator behind the scenes."""
        if not dataset_id:
            return
        for item in self._client.dataset(dataset_id).iterate_items():
            if isinstance(item, dict):
                yield item
            else:
                logger.warning("Apify dataset returned non-dict item, skipping: %r", type(item))
