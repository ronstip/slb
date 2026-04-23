"""Enrichment Worker — enriches posts using Gemini API (multimodal).

Two modes:
  - Inline: receives PostData directly from collection pipeline (no BQ read)
  - Standalone: reads posts from BQ, for manual/re-enrichment via agent tool

Usage:
    python -m workers.enrichment.worker <collection_id>
    python -m workers.enrichment.worker --post-ids id1,id2,id3
"""

import json
import logging
import sys
import time
from datetime import datetime, timezone

from config.settings import get_settings
from workers.enrichment.enricher import enrich_posts
from workers.enrichment.schema import CustomFieldDef, EnrichmentResult, MediaRef, PostData
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# BQ write: MERGE enrichment results into enriched_posts
# ---------------------------------------------------------------------------

def _write_results_to_bq(
    bq: BQClient,
    results: list[tuple[str, EnrichmentResult]],
) -> None:
    """Write enrichment results to BQ via MERGE (idempotent, supports re-enrichment)."""
    if not results:
        return
    _write_results_via_values(bq, results)


def _write_results_via_values(
    bq: BQClient,
    results: list[tuple[str, EnrichmentResult]],
) -> None:
    """Write results using a MERGE with inline VALUES (works around BQ param limitations)."""
    if not results:
        return

    # Build a UNION ALL of SELECT statements for each row
    selects = []
    for post_id, r in results:
        entities_arr = ", ".join(f"'{_esc(e)}'" for e in r.entities)
        themes_arr = ", ".join(f"'{_esc(t)}'" for t in r.themes)
        brands_arr = ", ".join(f"'{_esc(b)}'" for b in r.detected_brands)

        custom_json = json.dumps(r.custom_fields) if r.custom_fields else None
        custom_sql = f"PARSE_JSON('{_esc(custom_json)}')" if custom_json else "CAST(NULL AS JSON)"

        selects.append(
            f"SELECT '{_esc(post_id)}' AS post_id, "
            f"'{_esc(r.context)}' AS context, "
            f"'{_esc(r.sentiment)}' AS sentiment, "
            f"'{_esc(r.emotion)}' AS emotion, "
            f"[{entities_arr}] AS entities, "
            f"[{themes_arr}] AS themes, "
            f"'{_esc(r.ai_summary)}' AS ai_summary, "
            f"'{_esc(r.language)}' AS language, "
            f"'{_esc(r.content_type)}' AS content_type, "
            f"{'TRUE' if r.is_related_to_task else 'FALSE'} AS is_related_to_task, "
            f"[{brands_arr}] AS detected_brands, "
            f"'{_esc(r.channel_type)}' AS channel_type, "
            f"{custom_sql} AS custom_fields"
        )

    source_sql = " UNION ALL\n".join(selects)

    merge_sql = f"""\
MERGE social_listening.enriched_posts AS target
USING (
    {source_sql}
) AS source
ON target.post_id = source.post_id
WHEN NOT MATCHED THEN
    INSERT (post_id, context, sentiment, emotion, entities, themes, ai_summary, language, content_type, is_related_to_task, detected_brands, channel_type, custom_fields, enriched_at)
    VALUES (source.post_id, source.context, source.sentiment, source.emotion, source.entities, source.themes, source.ai_summary, source.language, source.content_type, source.is_related_to_task, source.detected_brands, source.channel_type, source.custom_fields, CURRENT_TIMESTAMP())
WHEN MATCHED THEN
    UPDATE SET
        context                = source.context,
        sentiment              = source.sentiment,
        emotion                = source.emotion,
        entities               = source.entities,
        themes                 = source.themes,
        ai_summary             = source.ai_summary,
        language               = source.language,
        content_type           = source.content_type,
        is_related_to_task     = source.is_related_to_task,
        detected_brands        = source.detected_brands,
        channel_type           = source.channel_type,
        custom_fields          = source.custom_fields,
        enriched_at            = CURRENT_TIMESTAMP();"""

    bq.query(merge_sql)
    logger.info("Wrote %d enrichment results to BQ", len(results))


def _esc(s: str) -> str:
    """Escape single quotes for BQ SQL string literals."""
    return s.replace("\\", "\\\\").replace("'", "\\'")


# ---------------------------------------------------------------------------
# BQ read: load posts for standalone mode
# ---------------------------------------------------------------------------

def _read_posts_from_bq(
    bq: BQClient,
    collection_id: str,
    min_likes: int = 0,
) -> list[PostData]:
    """Read posts from BQ for a collection, filtered by engagement threshold."""
    rows = bq.query(
        "SELECT p.post_id, p.platform, p.channel_handle, "
        "  CAST(p.posted_at AS STRING) AS posted_at, p.title, p.content, "
        "  p.post_url, p.search_keyword, p.media_refs "
        "FROM social_listening.posts p "
        "LEFT JOIN ("
        "  SELECT post_id, likes, "
        "    ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn "
        "  FROM social_listening.post_engagements"
        ") eng ON eng.post_id = p.post_id AND eng.rn = 1 "
        "LEFT JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id "
        "WHERE p.collection_id = @collection_id "
        "  AND COALESCE(eng.likes, 0) >= @min_likes "
        "  AND ep.post_id IS NULL",  # skip already-enriched
        {"collection_id": collection_id, "min_likes": min_likes},
    )
    return [_row_to_post_data(r) for r in rows]


def _read_posts_from_bq_by_ids(bq: BQClient, post_ids: list[str]) -> list[PostData]:
    """Read specific posts from BQ by ID."""
    rows = bq.query(
        "SELECT p.post_id, p.platform, p.channel_handle, "
        "  CAST(p.posted_at AS STRING) AS posted_at, p.title, p.content, "
        "  p.post_url, p.search_keyword, p.media_refs "
        "FROM social_listening.posts p "
        "WHERE p.post_id IN UNNEST(@post_ids)",
        {"post_ids": post_ids},
    )
    return [_row_to_post_data(r) for r in rows]


def _row_to_post_data(row: dict) -> PostData:
    """Convert a BQ row dict to PostData."""
    media_refs = []
    raw_refs = row.get("media_refs")
    if raw_refs:
        if isinstance(raw_refs, str):
            raw_refs = json.loads(raw_refs)
        for ref in (raw_refs or []):
            if not isinstance(ref, dict):
                continue
            gcs_uri = ref.get("gcs_uri", "")
            original_url = ref.get("original_url", "")
            media_type = ref.get("media_type", "image")
            if gcs_uri or (original_url and media_type == "image"):
                media_refs.append(MediaRef(
                    gcs_uri=gcs_uri,
                    original_url=original_url,
                    media_type=media_type,
                    content_type=ref.get("content_type", ""),
                ))

    return PostData(
        post_id=row["post_id"],
        platform=row["platform"],
        channel_handle=row.get("channel_handle"),
        posted_at=row.get("posted_at"),
        title=row.get("title"),
        content=row.get("content"),
        post_url=row.get("post_url"),
        search_keyword=row.get("search_keyword"),
        media_refs=media_refs,
    )


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

def run_enrichment_inline(
    posts: list[PostData],
    collection_id: str = "",
    custom_fields: list[CustomFieldDef] | None = None,
    enrichment_context: str | None = None,
    content_types: list[str] | None = None,
) -> list[tuple[str, EnrichmentResult]]:
    """Enrich posts from in-memory data. Used by parallel pipeline callback.

    No BQ read needed — post data is passed directly from collection.
    custom_fields: per-collection custom field definitions from config.
    enrichment_context: task-level context for relevance judgement.
    content_types: optional closed vocabulary for the content_type field.
    """
    if not posts:
        return []

    settings = get_settings()
    bq = BQClient(settings)

    start = time.monotonic()
    results = enrich_posts(
        posts,
        custom_fields=custom_fields,
        enrichment_context=enrichment_context,
        content_types=content_types,
    )
    _write_results_to_bq(bq, results)
    logger.info("Enrichment batch: %d/%d ok in %.1fs", len(results), len(posts), round(time.monotonic() - start, 1))
    return results


def _load_custom_fields(fs: FirestoreClient, collection_id: str) -> list[CustomFieldDef] | None:
    """Load custom field definitions from collection config in Firestore."""
    status = fs.get_collection_status(collection_id)
    if not status:
        return None
    config = status.get("config") or {}
    raw_fields = config.get("custom_fields")
    if not raw_fields:
        return None
    return [CustomFieldDef(**f) for f in raw_fields]


def _load_enrichment_context(fs: FirestoreClient, collection_id: str) -> str | None:
    """Load enrichment context from collection config in Firestore."""
    status = fs.get_collection_status(collection_id)
    if not status:
        return None
    config = status.get("config") or {}
    return config.get("enrichment_context")


def _load_content_types(fs: FirestoreClient, collection_id: str) -> list[str] | None:
    """Load per-agent content_type vocabulary from collection config in Firestore."""
    status = fs.get_collection_status(collection_id)
    if not status:
        return None
    config = status.get("config") or {}
    raw = config.get("content_types")
    if not raw:
        return None
    return [str(t).strip() for t in raw if str(t).strip()]


def run_enrichment(collection_id: str, min_likes: int = 0, batch_size: int = 50) -> None:
    """Enrich all qualifying posts in a collection. Reads from BQ (standalone mode).

    Processes posts in batches of `batch_size`, writing results after each batch
    so progress is preserved if the process is interrupted.
    """
    settings = get_settings()
    bq = BQClient(settings)
    fs = FirestoreClient(settings)

    # Status stays "running" — no granular enriching status anymore
    custom_fields = _load_custom_fields(fs, collection_id)
    enrichment_context = _load_enrichment_context(fs, collection_id)
    content_types = _load_content_types(fs, collection_id)

    try:
        posts = _read_posts_from_bq(bq, collection_id, min_likes)
        logger.info("Standalone enrichment: %d posts for collection %s", len(posts), collection_id)

        start = time.monotonic()
        all_results = []
        for i in range(0, len(posts), batch_size):
            batch = posts[i : i + batch_size]
            batch_results = enrich_posts(
                batch,
                custom_fields=custom_fields,
                enrichment_context=enrichment_context,
                content_types=content_types,
            )
            _write_results_to_bq(bq, batch_results)
            all_results.extend(batch_results)
            logger.info(
                "Standalone batch %d/%d: %d/%d ok (total %d/%d)",
                i // batch_size + 1,
                (len(posts) + batch_size - 1) // batch_size,
                len(batch_results), len(batch),
                len(all_results), len(posts),
            )
        results = all_results
        duration = round(time.monotonic() - start, 1)

        # Count total enriched posts for this collection
        count_result = bq.query(
            "SELECT COUNT(*) AS cnt FROM social_listening.enriched_posts ep "
            "JOIN social_listening.posts p ON p.post_id = ep.post_id "
            "WHERE p.collection_id = @collection_id",
            {"collection_id": collection_id},
        )
        enriched_count = count_result[0]["cnt"] if count_result else 0

        now_iso = datetime.now(timezone.utc).isoformat()
        existing_status = fs.get_collection_status(collection_id)
        run_log = (existing_status or {}).get("run_log") or {}
        run_log["enrichment"] = {
            "min_likes_threshold": min_likes,
            "total_posts": len(posts),
            "enriched": len(results),
            "failed": len(posts) - len(results),
            "completed_at": now_iso,
            "duration_sec": duration,
        }

        fs.update_collection_status(
            collection_id,
            posts_enriched=enriched_count,
            status="success",
            run_log=run_log,
        )
        logger.info("Standalone enrichment done: %d posts in %.1fs", len(results), duration)

    except Exception as e:
        logger.exception("Enrichment failed for %s", collection_id)
        fs.update_collection_status(
            collection_id, status="failed", error_message=f"Enrichment error: {e}"
        )
        raise


def run_enrichment_for_posts(
    post_ids: list[str],
    min_likes: int = 0,
    collection_id: str = "",
) -> None:
    """Enrich specific posts by ID. Reads from BQ (standalone mode).

    If collection_id is provided, loads custom field definitions from config.
    """
    settings = get_settings()
    bq = BQClient(settings)

    custom_fields = None
    enrichment_context = None
    content_types = None
    if collection_id:
        fs = FirestoreClient(settings)
        custom_fields = _load_custom_fields(fs, collection_id)
        enrichment_context = _load_enrichment_context(fs, collection_id)
        content_types = _load_content_types(fs, collection_id)

    posts = _read_posts_from_bq_by_ids(bq, post_ids)
    logger.info("Enriching %d posts by ID", len(posts))

    results = enrich_posts(
        posts,
        custom_fields=custom_fields,
        enrichment_context=enrichment_context,
        content_types=content_types,
    )
    _write_results_to_bq(bq, results)
    logger.info("Enriched %d/%d posts by ID", len(results), len(posts))


def update_enrichment_counts(collection_id: str) -> None:
    """Update Firestore with final enrichment counts. Called after parallel pipeline completes."""
    settings = get_settings()
    bq = BQClient(settings)
    fs = FirestoreClient(settings)

    result = bq.query(
        "SELECT COUNT(*) AS cnt FROM social_listening.enriched_posts ep "
        "JOIN social_listening.posts p ON p.post_id = ep.post_id "
        "WHERE p.collection_id = @collection_id",
        {"collection_id": collection_id},
    )
    enriched_count = result[0]["cnt"] if result else 0
    fs.update_collection_status(collection_id, posts_enriched=enriched_count)
    logger.info("Updated enrichment count for %s: %d posts", collection_id, enriched_count)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python -m workers.enrichment.worker <collection_id>")
        print("  python -m workers.enrichment.worker --post-ids id1,id2,id3")
        sys.exit(1)

    if sys.argv[1] == "--post-ids":
        ids = sys.argv[2].split(",")
        run_enrichment_for_posts(ids)
    else:
        run_enrichment(sys.argv[1])
