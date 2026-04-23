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


def run_pipeline(collection_id: str, continuation: bool = False) -> None:
    """Run collection + parallel enrichment + embedding pipeline.

    continuation=True resumes a prior run that hit the soft timeout
    (Pipeline V2 only — legacy pipeline doesn't support continuations).
    """
    settings = get_settings()
    if settings.use_pipeline_v2:
        from workers.pipeline_v2.pipeline import run_pipeline_v2
        return run_pipeline_v2(collection_id, continuation=continuation)

    fs = FirestoreClient(settings)
    bq = BQClient(settings)

    logger.info("━━━ Pipeline START %s ━━━", collection_id)
    pipeline_start = _time.monotonic()

    # Load custom field definitions and enrichment context from collection config
    status_doc = fs.get_collection_status(collection_id)
    custom_fields_defs = None
    enrichment_context = None
    if status_doc:
        config = status_doc.get("config") or {}
        raw_cf = config.get("custom_fields")
        if raw_cf:
            custom_fields_defs = [CustomFieldDef(**f) for f in raw_cf]
        enrichment_context = config.get("enrichment_context")

    # Thread pool for parallel enrichment batches
    enrichment_executor = ThreadPoolExecutor(max_workers=settings.enrichment_batch_workers)
    enrichment_futures = []

    enrichment_batch_sizes = []

    def on_batch_complete(new_posts):
        """Callback from collection worker — fire enrichment for this batch."""
        post_data = [_post_to_enrichment_data(p) for p in new_posts]
        enrichment_batch_sizes.append(len(post_data))
        future = enrichment_executor.submit(
            run_enrichment_inline, post_data, collection_id, custom_fields_defs, enrichment_context,
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

    # Step 4: Set final status (completed BEFORE embedding so UX is not blocked)
    status = fs.get_collection_status(collection_id)
    current_status = (status or {}).get("status")

    if current_status not in ("cancelled", "failed", "completed_with_errors"):
        final_status = "completed_with_errors" if enrichment_failed else "completed"
        fs.update_collection_status(collection_id, status=final_status)
    else:
        final_status = current_status

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

    # Step 6: Topic clustering (deferred, after embedding)
    logger.info("── Step 6: topic clustering (deferred)")
    t0 = _time.monotonic()
    try:
        from workers.clustering.worker import run_clustering
        result = run_clustering(collection_id)
        logger.info("── Step 6 done in %.1fs (%d topics)",
                    _time.monotonic() - t0, result.get("topics_count", 0))
    except Exception:
        logger.exception("Topic clustering failed for %s", collection_id)

