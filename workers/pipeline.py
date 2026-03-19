"""Full collection pipeline: collect → enrich → embed → stats.

Used by both the worker server (prod) and the API dev-mode thread.
"""

import logging
import time as _time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from config.settings import get_settings
from workers.collection.worker import run_collection
from workers.enrichment.schema import CustomFieldDef, MediaRef, PostData
from workers.enrichment.worker import run_enrichment_inline, update_enrichment_counts
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient
from workers.shared.statistical_signature import refresh_statistical_signature

logger = logging.getLogger(__name__)


def _post_to_enrichment_data(post):
    """Convert a collection Post model to enrichment PostData (in-memory, no BQ read)."""
    media_refs = []
    for ref in (post.media_refs or []):
        if isinstance(ref, dict) and (ref.get("gcs_uri") or ref.get("original_url")):
            media_refs.append(MediaRef(
                gcs_uri=ref.get("gcs_uri", ""),
                original_url=ref.get("original_url", ""),
                media_type=ref.get("media_type", "image"),
                content_type=ref.get("content_type", ""),
            ))

    return PostData(
        post_id=post.post_id,
        platform=post.platform,
        channel_handle=post.channel_handle,
        posted_at=post.posted_at.isoformat() if post.posted_at else None,
        title=post.title,
        content=post.content,
        post_url=post.post_url,
        search_keyword=post.search_keyword,
        media_refs=media_refs,
    )


def _parse_schedule(schedule: str | None) -> tuple[str, int, int | None, int | None]:
    """Return (unit, interval, hour_utc, minute_utc) for a schedule string."""
    import re
    if not schedule or schedule == "daily":
        return ("d", 1, 9, 0)
    if schedule == "weekly":
        return ("d", 7, 9, 0)
    m = re.match(r"^(\d+)m$", schedule)
    if m:
        return ("m", int(m.group(1)), None, None)
    m = re.match(r"^(\d+)h$", schedule)
    if m:
        return ("h", int(m.group(1)), None, None)
    m = re.match(r"^(\d+)d@(\d{2}):(\d{2})$", schedule)
    if m:
        return ("d", int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return ("d", 1, 9, 0)


def _compute_next_run_at(schedule: str | None, from_time: datetime) -> datetime:
    """Return the next future run datetime for the given schedule."""
    from datetime import timedelta
    unit, interval, hour, minute = _parse_schedule(schedule)

    if unit == "m":
        candidate = from_time + timedelta(minutes=interval)
        return candidate.replace(second=0, microsecond=0)
    if unit == "h":
        candidate = from_time + timedelta(hours=interval)
        return candidate.replace(second=0, microsecond=0)

    assert hour is not None and minute is not None
    candidate = from_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
    candidate += timedelta(days=interval)
    while candidate <= from_time:
        candidate += timedelta(days=1)
    return candidate


def run_pipeline(collection_id: str) -> None:
    """Run collection + parallel enrichment + embedding pipeline."""
    from google.cloud.firestore_v1 import transforms

    settings = get_settings()
    fs = FirestoreClient(settings)
    bq = BQClient(settings)

    logger.info("━━━ Pipeline START %s ━━━", collection_id)
    pipeline_start = _time.monotonic()

    # Load custom field definitions from collection config
    status_doc = fs.get_collection_status(collection_id)
    custom_fields_defs = None
    if status_doc:
        config = status_doc.get("config") or {}
        raw_cf = config.get("custom_fields")
        if raw_cf:
            custom_fields_defs = [CustomFieldDef(**f) for f in raw_cf]

    # Thread pool for parallel enrichment batches
    enrichment_executor = ThreadPoolExecutor(max_workers=settings.enrichment_batch_workers)
    enrichment_futures = []

    enrichment_batch_sizes = []

    def on_batch_complete(new_posts):
        """Callback from collection worker — fire enrichment for this batch."""
        post_data = [_post_to_enrichment_data(p) for p in new_posts]
        enrichment_batch_sizes.append(len(post_data))
        future = enrichment_executor.submit(
            run_enrichment_inline, post_data, collection_id, custom_fields_defs,
        )
        enrichment_futures.append(future)

    # Step 1: Collection (enrichment fires in parallel per batch via callback)
    logger.info("── Step 1: collection")
    t0 = _time.monotonic()
    try:
        run_collection(collection_id, on_batch_complete=on_batch_complete)
    except Exception:
        logger.exception("Collection pipeline failed for %s", collection_id)
        enrichment_executor.shutdown(wait=False)
        return
    logger.info("── Step 1 done in %.1fs", _time.monotonic() - t0)

    # Check if collection was cancelled or failed
    status = fs.get_collection_status(collection_id)
    if not status or status.get("status") not in ("enriching", "collecting"):
        logger.info(
            "Pipeline stopping for %s — status is '%s' (not enriching/collecting)",
            collection_id, (status or {}).get("status"),
        )
        enrichment_executor.shutdown(wait=False)
        return

    # Step 2: Wait for all enrichment batches to complete
    logger.info("── Step 2: enrichment (%d batches queued)", len(enrichment_futures))
    t0 = _time.monotonic()
    enrichment_executor.shutdown(wait=True)
    enrichment_failed = False
    failed_batches = 0
    for i, future in enumerate(enrichment_futures):
        try:
            result = future.result()
            batch_size = enrichment_batch_sizes[i] if i < len(enrichment_batch_sizes) else 0
            if not result and batch_size > 0:
                logger.warning(
                    "Enrichment batch %d returned 0/%d results for %s",
                    i, batch_size, collection_id,
                )
                enrichment_failed = True
                failed_batches += 1
        except Exception:
            logger.exception("Enrichment batch failed for %s", collection_id)
            enrichment_failed = True
            failed_batches += 1
    logger.info(
        "── Step 2 done in %.1fs (%d/%d batches ok)",
        _time.monotonic() - t0,
        len(enrichment_futures) - failed_batches,
        len(enrichment_futures),
    )

    # Step 3: Update enrichment counts in Firestore (even on partial failure)
    try:
        update_enrichment_counts(collection_id)
    except Exception:
        logger.exception("Failed to update enrichment counts for %s", collection_id)

    if enrichment_failed:
        fs.update_collection_status(
            collection_id, status="completed_with_errors",
            error_message="One or more enrichment batches failed. Partial data is available.",
        )
        # Continue to stats — partial enrichment data is still useful

    # Step 4: Compute and persist statistical signature (non-fatal)
    logger.info("── Step 3: statistical signature")
    t0 = _time.monotonic()
    try:
        sig = refresh_statistical_signature(collection_id, bq, fs)

        # Write headline metrics to Firestore status doc for progress card
        eng = sig.get("engagement_summary") or {}
        total_views = int(eng.get("total_views") or 0)
        total_posts = int(sig.get("total_posts") or 0)
        positive = next(
            (r for r in sig.get("sentiment_breakdown", []) if r["value"] == "positive"),
            None,
        )
        positive_pct = None
        if positive:
            if total_views > 0:
                # Views-based (YouTube, TikTok): % of total views that are on positive posts
                positive_pct = round(positive["view_count"] / total_views * 100, 1)
            elif total_posts > 0:
                # Post-count fallback (Reddit, text-only): % of posts that are positive
                positive_pct = round(positive["post_count"] / total_posts * 100, 1)
        fs.update_collection_status(
            collection_id,
            total_views=total_views,
            positive_pct=positive_pct,
        )
        logger.info("── Step 3 done in %.1fs (views=%d, posts=%d, positive=%s%%)", _time.monotonic() - t0, total_views, total_posts, positive_pct)
    except Exception:
        logger.exception("Statistical signature computation failed for %s", collection_id)

    # Step 4: Decide final status based on ongoing flag (set completed BEFORE embedding)
    status = fs.get_collection_status(collection_id)
    current_status = (status or {}).get("status")
    config = (status or {}).get("config") or {}

    # Don't reschedule if user cancelled or collection failed fatally
    if current_status in ("cancelled", "failed"):
        logger.info(
            "Collection %s has status '%s' — skipping reschedule",
            collection_id, current_status,
        )
        return

    # Check if user toggled ongoing off mid-run
    ongoing_flag = (status or {}).get("ongoing", False)
    if not ongoing_flag and not config.get("ongoing"):
        if current_status != "completed_with_errors":
            fs.update_collection_status(collection_id, status="completed")
        return

    if config.get("ongoing"):
        schedule = config.get("schedule", "daily")
        now = datetime.now(timezone.utc)

        # Use the previous next_run_at as the base to maintain cadence
        # (avoids drift from pipeline duration)
        prev_next_run = (status or {}).get("next_run_at")
        if prev_next_run:
            if isinstance(prev_next_run, str):
                prev_next_run = datetime.fromisoformat(prev_next_run)
            base_time = prev_next_run
        else:
            base_time = now
        next_run_at = _compute_next_run_at(schedule, base_time)
        # Safety: if computed time is already in the past, fall back to now
        if next_run_at <= now:
            next_run_at = _compute_next_run_at(schedule, now)
        logger.info(
            "Schedule computation for %s: schedule=%r, base_time=%s, next_run_at=%s",
            collection_id, schedule, base_time.isoformat(), next_run_at.isoformat(),
        )

        run_status = "completed" if not enrichment_failed else "completed_with_errors"
        run_entry = {
            "run_at": now.isoformat(),
            "posts_added": (status or {}).get("last_run_posts_added", 0),
            "status": run_status,
        }

        # Track consecutive failures for auto-pause
        consecutive_failures = (status or {}).get("consecutive_failures", 0)
        if enrichment_failed or current_status == "completed_with_errors":
            consecutive_failures += 1
        else:
            consecutive_failures = 0

        MAX_CONSECUTIVE_FAILURES = 3
        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
            fs.update_collection_status(
                collection_id,
                status="paused",
                error_message=f"Auto-paused after {consecutive_failures} consecutive failures. "
                              "Review errors and resume monitoring manually.",
                consecutive_failures=consecutive_failures,
                total_runs=transforms.Increment(1),
                run_history=transforms.ArrayUnion([run_entry]),
                last_run_at=now,
            )
            logger.warning(
                "Ongoing collection %s paused after %d consecutive failures",
                collection_id, consecutive_failures,
            )
            return

        fs.update_collection_status(
            collection_id,
            status="monitoring",
            last_run_at=now,
            next_run_at=next_run_at,
            total_runs=transforms.Increment(1),
            run_history=transforms.ArrayUnion([run_entry]),
            consecutive_failures=consecutive_failures,
        )
        logger.info(
            "Ongoing collection %s set to monitoring; next run at %s (run: %s)",
            collection_id, next_run_at.isoformat(), run_status,
        )
    elif current_status != "completed_with_errors":
        # Don't overwrite completed_with_errors from enrichment step
        fs.update_collection_status(collection_id, status="completed")

    final_status = current_status if config.get("ongoing") else (
        "completed_with_errors" if enrichment_failed else "completed"
    )
    logger.info("━━━ Pipeline DONE %s — status=%s total=%.1fs ━━━",
                collection_id, final_status, _time.monotonic() - pipeline_start)

    # Step 5: Embedding (deferred — runs AFTER status is set so UX is not blocked)
    logger.info("── Step 5: embedding (deferred, non-blocking)")
    t0 = _time.monotonic()
    try:
        bq.query_from_file("batch_queries/batch_embed.sql", {
            "collection_id": collection_id,
            "post_ids": [],
        })
        logger.info("── Step 5 done in %.1fs", _time.monotonic() - t0)
    except Exception:
        logger.exception("Embedding failed for %s", collection_id)

    # Update posts_embedded count in Firestore
    try:
        rows = bq.query(
            "SELECT COUNT(*) as cnt FROM social_listening.post_embeddings pe "
            "JOIN social_listening.posts p ON p.post_id = pe.post_id "
            "WHERE p.collection_id = @collection_id",
            {"collection_id": collection_id},
        )
        embedded_count = rows[0]["cnt"] if rows else 0
        fs.update_collection_status(collection_id, posts_embedded=embedded_count)
    except Exception:
        logger.exception("Failed to update posts_embedded count for %s", collection_id)
