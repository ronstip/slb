"""Streaming step runner — eliminates batch drain by claiming and processing
posts individually with a persistent executor.

Replaces the batched `_step_worker` model for download and enrich:
- Producer thread atomically claims one post at a time (claim_state →
  in_flight_state) and submits to a persistent ThreadPoolExecutor.
- Consumer thread drains completed futures and periodically flushes batched
  side-effects (BQ MERGE for enrich) and state transitions.

The slowest call no longer holds up the pool — as soon as a slot frees, the
next post is claimed. Pool stays saturated until the queue runs dry.
"""

import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable

from workers.pipeline.post_state import PostState
from workers.pipeline.steps import StepContext

logger = logging.getLogger(__name__)


# Process function: takes (post_state_doc, ctx), returns ("ok"|"fail", extra_payload | None).
# extra_payload may carry "media_refs" (download) or "enrichment_result" (enrich) for the
# consumer flush.
ProcessFn = Callable[[dict, StepContext], tuple[str, dict | None]]

# Flush function: called on the consumer thread with the batched results from one
# tick of the consumer loop. Used for BQ MERGE on enrich. None = skip flush, just
# transition states.
FlushFn = Callable[[list[tuple[str, str, dict | None]], StepContext], None] | None


class StreamingStepRunner:
    """Runs one streaming step (download or enrich) for a single collection."""

    def __init__(
        self,
        *,
        name: str,
        ctx: StepContext,
        claim_state: PostState,
        in_flight_state: PostState,
        success_state: PostState,
        failure_state: PostState,
        concurrency: int,
        process_fn: ProcessFn,
        flush_fn: FlushFn = None,
        flush_size: int = 1,
        flush_interval_sec: float = 1.0,
        record_step_timing: Callable | None = None,
    ) -> None:
        self._name = name
        self._ctx = ctx
        self._claim_state = claim_state
        self._in_flight_state = in_flight_state
        self._success_state = success_state
        self._failure_state = failure_state
        self._concurrency = max(1, concurrency)
        self._process_fn = process_fn
        self._flush_fn = flush_fn
        self._flush_size = max(1, flush_size)
        self._flush_interval_sec = max(0.1, flush_interval_sec)
        self._record_step_timing = record_step_timing

        # Cap how many posts are in-flight at once. The executor's queue is
        # unbounded, so without this we'd over-claim.
        self._in_flight_sem = threading.Semaphore(self._concurrency)
        self._executor = ThreadPoolExecutor(
            max_workers=self._concurrency,
            thread_name_prefix=f"stream-{name}-{ctx.collection_id[:8]}",
        )

        self._results_lock = threading.Lock()
        self._pending: list[tuple[str, str, dict | None]] = []
        self._last_flush = time.monotonic()

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(self, stop_event: threading.Event) -> None:
        """Drive producer + consumer until stop_event is set and queue drains."""
        producer_done = threading.Event()
        consumer = threading.Thread(
            target=self._consume_loop,
            args=(stop_event, producer_done),
            daemon=True,
            name=f"stream-{self._name}-consumer-{self._ctx.collection_id[:8]}",
        )
        consumer.start()
        try:
            self._produce_loop(stop_event)
        finally:
            producer_done.set()
            consumer.join(timeout=60)
            self._executor.shutdown(wait=True)

    # ------------------------------------------------------------------
    # Producer
    # ------------------------------------------------------------------

    def _produce_loop(self, stop_event: threading.Event) -> None:
        idle_backoff = 0.05
        while not stop_event.is_set():
            # Block waiting for an in-flight slot. Bounded so we re-check
            # stop_event regularly.
            if not self._in_flight_sem.acquire(timeout=0.2):
                continue
            try:
                post = self._ctx.state_manager.claim_one(
                    self._claim_state, self._in_flight_state,
                )
            except Exception:
                logger.warning(
                    "claim_one failed for step '%s' in %s — backing off",
                    self._name, self._ctx.collection_id, exc_info=True,
                )
                self._in_flight_sem.release()
                stop_event.wait(timeout=1.0)
                continue

            if post is None:
                # No work right now. Release the slot, back off, retry.
                self._in_flight_sem.release()
                stop_event.wait(timeout=idle_backoff)
                idle_backoff = min(0.5, idle_backoff * 1.5)
                continue
            idle_backoff = 0.05

            future = self._executor.submit(self._wrapped_process, post)
            future.add_done_callback(
                lambda f, p=post: self._on_complete(p, f),
            )

    def _wrapped_process(self, post: dict) -> tuple[str, dict | None]:
        """Run process_fn, catching all exceptions so the executor never raises."""
        t_start = time.monotonic()
        try:
            outcome, extra = self._process_fn(post, self._ctx)
            return outcome, extra
        except Exception:
            logger.exception(
                "Streaming process failed for post %s in step '%s'",
                post.get("post_id"), self._name,
            )
            return "fail", None
        finally:
            elapsed = time.monotonic() - t_start
            # Track per-post latency in a coarse aggregate (used later for
            # telemetry; the precise per-post times can be sampled at debug).
            logger.debug(
                "stream-%s: post %s took %.1fs",
                self._name, post.get("post_id"), elapsed,
            )

    def _on_complete(self, post: dict, future: Future) -> None:
        """Callback fired when a future completes. Buffers result for the consumer."""
        try:
            outcome, extra = future.result()
        except Exception:
            outcome, extra = "fail", None
            logger.exception(
                "Future raised for post %s in step '%s' (should be unreachable)",
                post.get("post_id"), self._name,
            )
        with self._results_lock:
            self._pending.append((post["post_id"], outcome, extra))
        # Free the slot — producer can claim the next post.
        self._in_flight_sem.release()

    # ------------------------------------------------------------------
    # Consumer
    # ------------------------------------------------------------------

    def _consume_loop(
        self, stop_event: threading.Event, producer_done: threading.Event,
    ) -> None:
        """Periodically flush buffered results and transition states."""
        while True:
            stop = stop_event.is_set()
            done = producer_done.is_set()

            with self._results_lock:
                pending_count = len(self._pending)
                age = time.monotonic() - self._last_flush

            should_flush = (
                pending_count >= self._flush_size
                or (pending_count > 0 and age >= self._flush_interval_sec)
            )

            if should_flush:
                self._flush()
            elif done and pending_count == 0:
                # Producer is done and we have nothing left — exit.
                return
            elif stop and pending_count == 0:
                return
            else:
                time.sleep(0.1)

    def _flush(self) -> None:
        """Drain pending results, run flush_fn, transition states."""
        with self._results_lock:
            if not self._pending:
                return
            results = self._pending
            self._pending = []
            self._last_flush = time.monotonic()

        # Side-effects (BQ MERGE for enrich, no-op for download).
        if self._flush_fn is not None:
            try:
                self._flush_fn(results, self._ctx)
            except Exception:
                logger.exception(
                    "flush_fn raised for step '%s' — marking all in this batch as failed",
                    self._name,
                )
                # Whole batch failed at the side-effect layer; downgrade outcomes.
                results = [(pid, "fail", None) for pid, _, _ in results]

        # Build state transitions and media_refs payloads.
        transitions: list[tuple[str, PostState]] = []
        media_refs_map: dict[str, list[dict]] = {}
        for post_id, outcome, extra in results:
            new_state = self._success_state if outcome == "ok" else self._failure_state
            transitions.append((post_id, new_state))
            if extra and "media_refs" in extra:
                media_refs_map[post_id] = extra["media_refs"]

        try:
            self._ctx.state_manager.transition_batch(
                transitions, media_refs=media_refs_map,
            )
        except Exception:
            logger.exception(
                "transition_batch failed for step '%s' (%d posts)",
                self._name, len(transitions),
            )
            return

        # Telemetry — record the flush as one "batch" for stage_timings compat.
        if self._record_step_timing is not None:
            try:
                self._record_step_timing(
                    self._name, 0.0,  # action_cpu not meaningful in streaming
                    [(pid, outcome, extra) for pid, outcome, extra in results],
                )
            except Exception:
                logger.debug("record_step_timing raised", exc_info=True)
